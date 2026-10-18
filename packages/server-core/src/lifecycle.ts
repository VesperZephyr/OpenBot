import type { LifecycleStore } from "@openbot/agent-runtime";
import { type LifecycleRecord, type LifecycleReason, type LifecycleState, type NativeLifecycle, ProtocolError } from "@openbot/protocol";
/** A synchronous latch closes authority before asynchronous persistence or cancellation starts. */
type LifecycleOptions = {
	store: LifecycleStore;
	targetId: string;
	nativeRequired?: boolean;
	hasWork?: () => boolean | Promise<boolean>;
	changed: (state: LifecycleState) => void;
	suspend: (reason: LifecycleReason) => Promise<void>;
	resume: () => Promise<void>;
};
export class LifecycleController {
	readonly #options: LifecycleOptions;
	#record: LifecycleRecord = { revision: 0, userPaused: false, needsResume: false };
	#native = { locked: false, suspended: false, quitting: false };
	#source: string | undefined;
	#seq = -1;
	#ready: boolean;
	#latch = true;
	#execution = new AbortController();
	#transitioning = false;
	#epoch = 0;
	#error: string | undefined;
	#line: Promise<unknown> = Promise.resolve();
	constructor(options: LifecycleOptions) {
		this.#options = options;
		this.#ready = !options.nativeRequired;
	}
	async start() {
		this.#record = await this.#options.store.read();
		this.#latch = this.#record.needsResume || this.#record.userPaused || !this.#ready;
		this.#publish();
	}
	get state(): LifecycleState {
		return {
			...this.#record,
			...this.#native,
			targetId: this.#options.targetId,
			nativeReady: this.#ready,
			blocked:
				this.#latch || this.#record.userPaused || this.#record.needsResume || !this.#ready || Object.values(this.#native).some(Boolean),
			transitioning: this.#transitioning,
			...(this.#error ? { error: this.#error } : {}),
		};
	}
	get signal(): AbortSignal {
		return this.#execution.signal;
	}
	assertAllowed(): void {
		if (this.state.blocked) throw new ProtocolError("invalid_request", "Work is paused. Resume work before continuing.");
	}
	pause(reason: LifecycleReason = "user"): Promise<LifecycleState> {
		this.#latch = true;
		this.#execution.abort();
		this.#epoch++;
		this.#publish();
		return this.#serial(() => this.#pause(reason));
	}
	async #pause(reason: LifecycleReason): Promise<LifecycleState> {
		this.#transitioning = true;
		this.#record = {
			...this.#record,
			revision: this.#record.revision + 1,
			userPaused: this.#record.userPaused || reason === "user",
			needsResume:
				this.#record.needsResume ||
				reason !== "quitting" ||
				(await Promise.resolve()
					.then(() => this.#options.hasWork?.() ?? true)
					.catch(() => true)),
			lastReason: reason,
		};
		this.#publish();
		let persisted = false;
		try {
			await this.#options.store.write(this.#record);
			persisted = true;
			await this.#options.suspend(reason);
			this.#error = undefined;
		} catch (error) {
			if (!persisted) await this.#options.suspend(reason).catch(() => {});
			this.#error = "Work could not be confirmed stopped. Review interrupted work before resuming.";
			throw error;
		} finally {
			this.#transitioning = false;
			this.#publish();
		}
		return this.state;
	}
	native(value: NativeLifecycle): Promise<LifecycleState> {
		if (this.#source !== undefined && this.#source !== value.sourceId)
			throw new ProtocolError("invalid_request", "Native lifecycle source changed");
		if (value.seq <= this.#seq) return Promise.resolve(this.state);
		this.#source = value.sourceId;
		this.#seq = value.seq;
		this.#ready = true;
		this.#native = { locked: value.locked, suspended: value.suspended, quitting: value.quitting };
		const reason = value.quitting ? "quitting" : value.suspended ? "suspended" : value.locked ? "locked" : undefined;
		if (reason) return this.pause(reason);
		this.#publish();
		const epoch = this.#epoch;
		return this.#serial(async () => {
			if (epoch === this.#epoch && !this.#record.userPaused && !this.#record.needsResume && !Object.values(this.#native).some(Boolean)) {
				if (this.#execution.signal.aborted) this.#execution = new AbortController();
				this.#latch = false;
				try {
					await this.#options.resume();
				} catch (error) {
					this.#latch = true;
					this.#execution.abort();
					this.#record = { ...this.#record, needsResume: true };
					this.#error = "Work could not resume. Review the lifecycle status.";
					this.#publish();
					await this.#options.store.write(this.#record);
					throw error;
				}
			}
			this.#publish();
			return this.state;
		});
	}
	resume(): Promise<LifecycleState> {
		const epoch = this.#epoch;
		return this.#serial(async () => {
			if (epoch !== this.#epoch) throw new ProtocolError("invalid_request", "The Mac is not ready to resume work.");
			if (!this.state.blocked) return this.state;
			if (!this.#ready || Object.values(this.#native).some(Boolean))
				throw new ProtocolError("invalid_request", "The Mac is not ready to resume work.");
			this.#transitioning = true;
			this.#publish();
			try {
				if (this.#error) await this.#options.suspend("recovery");
				const next: LifecycleRecord = { revision: this.#record.revision + 1, userPaused: false, needsResume: false };
				await this.#options.store.write(next);
				if (epoch !== this.#epoch || Object.values(this.#native).some(Boolean)) {
					await this.#options.store.write(this.#record);
					throw new ProtocolError("invalid_request", "The Mac is not ready to resume work.");
				}
				this.#record = next;
				if (this.#execution.signal.aborted) this.#execution = new AbortController();
				this.#latch = false;
				this.#error = undefined;
				await this.#options.resume();
			} catch (error) {
				this.#latch = true;
				this.#execution.abort();
				this.#record = { ...this.#record, needsResume: true };
				this.#error = "Work could not resume. Review the lifecycle status.";
				await this.#options.store.write(this.#record).catch(() => {});
				throw error;
			} finally {
				this.#transitioning = false;
				this.#publish();
			}
			return this.state;
		});
	}
	#publish() {
		this.#options.changed(this.state);
	}
	#serial<T>(work: () => Promise<T>): Promise<T> {
		const next = this.#line.then(work, work);
		this.#line = next.catch(() => {});
		return next;
	}
}

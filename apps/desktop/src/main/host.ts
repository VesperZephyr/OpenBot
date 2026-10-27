import { isCredentialRequest, type CredentialRequest, type CredentialResponse } from "@openbot/protocol";
import { observe } from "../shared/observation";
/**
 * Starts and supervises the Host Runtime as a child process with an IPC channel, correlates requests and responses,
 * and observes bounded state invalidations. Main is the only process that holds this connection.
 */
import { type ChildProcess, spawn } from "node:child_process";
import {
	type HostEvent,
	type HostMethod,
	type HostParams,
	type HostResult,
	type HostToDesktop,
	PROTOCOL_VERSION,
	ProtocolError,
	type RequestEnvelope,
} from "@openbot/protocol";
import type { HostState } from "../shared/api";

export type HostProcessOptions = {
	/** Node binary that runs the Host. Development uses Node from PATH; packaging bundles a pinned, signed Node. */
	readonly node: string;
	readonly credentials: { handle(message: CredentialRequest, active: () => boolean): Promise<CredentialResponse> };
	/** Host entry script. */
	readonly entry: string;
	readonly env: NodeJS.ProcessEnv;
	/** Receives everything the Host and its executor write to stdout and stderr, after it is echoed to main's own. */
	readonly onOutput: (chunk: Buffer) => void;
	readonly onEvent: (event: HostEvent) => void;
	readonly onState: (state: HostState) => void;
};

const REQUEST_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 5_000;
/** Restart after unexpected exits, but give up after this many within the window so a crash loop stays visible. */
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60_000;

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export class HostProcess {
	readonly #options: HostProcessOptions;
	readonly #pending = new Map<string, Pending>();
	readonly #restarts: number[] = [];
	#child: ChildProcess | undefined;
	#ready = Promise.withResolvers<void>();
	#state: HostState = { status: "starting" };
	#stopping = false;
	#nextId = 0;
	#stopObservation: (() => void) | undefined;

	constructor(options: HostProcessOptions) {
		this.#options = options;
	}

	get state(): HostState {
		return this.#state;
	}

	start(): void {
		this.#stopping = false;
		this.#setState({ status: "starting" });
		const child = spawn(this.#options.node, ["--disable-warning=ExperimentalWarning", this.#options.entry], {
			stdio: ["ignore", "pipe", "pipe", "ipc"],
			env: this.#options.env,
		});
		this.#child = child;
		this.#options.onOutput(Buffer.from(`--- ${new Date().toISOString()} Host Runtime: ${this.#options.node} ${this.#options.entry}\n`));
		child.stdout?.on("data", (chunk: Buffer) => {
			process.stdout.write(chunk);
			this.#options.onOutput(chunk);
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			process.stderr.write(chunk);
			this.#options.onOutput(chunk);
		});
		child.on("message", (message: HostToDesktop) => {
			if (this.#child !== child) return;
			if (isCredentialRequest(message)) {
				void this.#options.credentials
					.handle(message, () => this.#child === child && child.connected)
					.then((response) => {
						if (this.#child === child && child.connected) child.send(response, () => {});
					});
				return;
			}
			this.#receive(message);
		});
		child.on("error", (error) => this.#exited(child, `Could not start the Host Runtime: ${error.message}`));
		child.on("exit", (code, signal) => this.#exited(child, `Host Runtime exited (${signal ?? `code ${code}`})`));
	}

	async call<M extends HostMethod>(method: M, params: HostParams<M>): Promise<HostResult<M>> {
		await this.#whenReady();
		const child = this.#child;
		if (child === undefined || !child.connected) throw new ProtocolError("host_unavailable", "Host Runtime is not running");
		const messageId = `d${++this.#nextId}`;
		const { promise, resolve, reject } = Promise.withResolvers<unknown>();
		const timer = setTimeout(() => {
			this.#pending.delete(messageId);
			reject(new ProtocolError("host_unavailable", `${method} timed out`));
		}, REQUEST_TIMEOUT_MS);
		this.#pending.set(messageId, { resolve, reject, timer });
		const request: RequestEnvelope<M> = { protocolVersion: PROTOCOL_VERSION, kind: "request", messageId, method, params };
		child.send(request);
		// The Host answers each request with the result type of its method.
		const result = (await promise) as HostResult<M>;
		return result;
	}

	/** A failed offline recovery must remain visible without admitting a partially restored Host. */
	blockStartup(detail: string): void {
		this.#stopping = true;
		this.#setState({ status: "stopped", detail });
	}

	/** Disconnect the IPC channel, which makes the Host flush and exit; force it after a timeout. */
	async stop(): Promise<void> {
		this.#stopping = true;
		this.#stopObservation?.();
		const child = this.#child;
		if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
		const exited = Promise.withResolvers<void>();
		child.once("exit", () => exited.resolve());
		if (child.connected) child.disconnect();
		else child.kill("SIGTERM");
		const timer = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS);
		await exited.promise;
		clearTimeout(timer);
	}

	#receive(message: HostToDesktop): void {
		switch (message.kind) {
			case "ready":
				this.#setState({ status: "ready" });
				this.#ready.resolve();
				this.#stopObservation?.();
				this.#stopObservation = observe({
					wait: (cursor) => this.call("observation.wait", cursor ? { cursor } : {}),
					changed: async (reset, changes) => {
						if (reset || changes & 1) this.#options.onEvent({ type: "bots.changed", payload: {} });
					},
					error: () => {},
				});
				return;
			case "event":
				this.#options.onEvent(message);
				return;
			case "response": {
				const pending = this.#pending.get(message.messageId);
				if (pending === undefined) return;
				this.#pending.delete(message.messageId);
				clearTimeout(pending.timer);
				if (message.ok) pending.resolve(message.result);
				else pending.reject(new ProtocolError(message.error.code, message.error.message));
			}
		}
	}

	#exited(child: ChildProcess, detail: string): void {
		if (this.#child !== child) return;
		this.#stopObservation?.();
		this.#child = undefined;
		for (const [id, pending] of this.#pending) {
			clearTimeout(pending.timer);
			pending.reject(new ProtocolError("host_unavailable", detail));
			this.#pending.delete(id);
		}
		this.#ready = Promise.withResolvers<void>();
		this.#setState({ status: "stopped", detail });
		if (this.#stopping) return;

		const now = Date.now();
		while (this.#restarts.length > 0 && now - (this.#restarts[0] ?? now) > RESTART_WINDOW_MS) this.#restarts.shift();
		if (this.#restarts.length >= MAX_RESTARTS) return;
		this.#restarts.push(now);
		setTimeout(() => {
			if (!this.#stopping) this.start();
		}, 1_000 * this.#restarts.length);
	}

	async #whenReady(): Promise<void> {
		if (this.#state.status === "ready") return;
		const timer = Promise.withResolvers<void>();
		const handle = setTimeout(
			() => timer.reject(new ProtocolError("host_unavailable", this.#state.detail ?? "Host Runtime is starting")),
			READY_TIMEOUT_MS,
		);
		try {
			await Promise.race([this.#ready.promise, timer.promise]);
		} finally {
			clearTimeout(handle);
		}
	}

	#setState(state: HostState): void {
		this.#state = state;
		this.#options.onState(state);
	}
}

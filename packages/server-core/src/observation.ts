import { randomUUID } from "node:crypto";
import { ProtocolError, type ObservationUpdate, type ObservationCursor } from "@openbot/protocol";

/** One revision, no event history: a new poll is the consumer's next delivery credit. */
export class Observation {
	readonly streamId = randomUUID();
	#seq = 0;
	#closed = false;
	readonly #revisions = [0, 0, 0, 0];
	readonly #waiting = new Set<() => void>();
	get cursor(): ObservationCursor {
		return { streamId: this.streamId, seq: this.#seq };
	}
	changed(mask = 15): void {
		if (this.#closed) return;
		this.#seq++;
		for (let i = 0; i < 4; i++) if (mask & (1 << i)) this.#revisions[i] = this.#seq;
		for (const finish of [...this.#waiting]) finish();
	}
	wait(cursor?: ObservationCursor, waitMs = 5000): Promise<ObservationUpdate> {
		const result = (): ObservationUpdate => ({
			...this.cursor,
			changes:
				!cursor || cursor.streamId !== this.streamId || cursor.seq > this.#seq
					? 15
					: this.#revisions.reduce((mask, seq, i) => mask | (seq > cursor.seq ? 1 << i : 0), 0),
		});
		if (this.#closed || !cursor || cursor.streamId !== this.streamId || cursor.seq !== this.#seq || waitMs === 0)
			return Promise.resolve(result());
		if (this.#waiting.size >= 4) return Promise.reject(new ProtocolError("invalid_request", "Too many observation requests"));
		return new Promise((resolve) => {
			const finish = () => {
				clearTimeout(timer);
				this.#waiting.delete(finish);
				resolve(result());
			};
			const timer = setTimeout(finish, waitMs);
			this.#waiting.add(finish);
		});
	}
	close(): void {
		this.#closed = true;
		for (const finish of [...this.#waiting]) finish();
	}
}

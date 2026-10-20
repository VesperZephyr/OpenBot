/** Private executor transport contract; it carries no policy or retry authority. */
export interface McpSession {
	readonly closed: boolean;
	readonly sensitiveValues?: readonly string[];
	request(method: string, params: unknown, timeout: number, signal?: AbortSignal): Promise<unknown>;
	notify(method: string, params?: unknown, timeout?: number): void | Promise<void>;
	stop(): Promise<boolean>;
}
export class McpError extends Error {
	readonly sent: boolean;
	readonly retryAt: number | undefined;
	constructor(sent: boolean, message = "Connector response is unavailable", retryAt?: number) {
		super(message);
		this.sent = sent;
		this.retryAt = retryAt;
	}
}

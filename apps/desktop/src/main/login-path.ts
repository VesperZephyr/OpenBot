import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { isAbsolute } from "node:path";

const SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const MAX_OUTPUT_BYTES = 64 * 1024;

/** Resolve only PATH: shell startup output and other environment variables never reach the Host or its log. */
export async function resolveLoginPath(source: NodeJS.ProcessEnv, options: { timeoutMs?: number } = {}): Promise<string> {
	const fallback = source.PATH || SYSTEM_PATH;
	let shell = source.SHELL;
	if (shell === undefined || !isAbsolute(shell)) {
		try {
			shell = userInfo().shell ?? undefined;
		} catch {
			// Account lookup is optional; macOS always provides zsh.
		}
	}
	if (shell === undefined || !isAbsolute(shell)) shell = "/bin/zsh";
	const env: NodeJS.ProcessEnv = { PATH: fallback, SHELL: shell, TERM: "dumb" };
	for (const name of ["HOME", "USER", "LOGNAME", "TMPDIR"]) {
		if (source[name] !== undefined) env[name] = source[name];
	}
	const marker = `openbot-path-${randomUUID()}`;
	return new Promise((resolve) => {
		const child = spawn(shell, ["-ilc", `printf '\\000${marker}\\000%s\\000' "$PATH"`], {
			env,
			cwd: source.HOME || "/",
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let settled = false;
		let bytes = 0;
		const chunks: Buffer[] = [];
		const killGroup = (): void => {
			if (child.pid === undefined) return;
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {
				// The group may already have exited.
			}
		};
		const finish = (path: string): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			killGroup();
			child.stdout.destroy();
			child.stderr.destroy();
			resolve(path);
		};
		const timer = setTimeout(() => finish(fallback), options.timeoutMs ?? 5_000);
		const capture = (chunk: Buffer, keep: boolean): void => {
			if (settled) return;
			bytes += chunk.length;
			if (bytes > MAX_OUTPUT_BYTES) finish(fallback);
			else if (keep) chunks.push(chunk);
		};
		child.stdout.on("data", (chunk: Buffer) => capture(chunk, true));
		child.stderr.on("data", (chunk: Buffer) => capture(chunk, false));
		child.once("error", () => finish(fallback));
		// A background startup command can hold the pipes open after the shell exits.
		child.once("exit", () => { if (!settled) killGroup(); });
		child.once("close", (code) => {
			if (settled) return;
			const output = Buffer.concat(chunks).toString("utf8");
			const prefix = `\0${marker}\0`;
			const start = output.indexOf(prefix);
			const end = start < 0 ? -1 : output.indexOf("\0", start + prefix.length);
			const path = end < 0 ? "" : output.slice(start + prefix.length, end);
			const valid = path.length > 0 && !/[\r\n]/.test(path) && path.split(":").every((entry) => isAbsolute(entry));
			finish(code === 0 && valid ? path : fallback);
		});
	});
}

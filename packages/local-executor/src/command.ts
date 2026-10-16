/**
 * Supervised shell commands. Each runs in its own process group with no stdin and a scrubbed environment;
 * cancellation and timeouts signal the whole group (SIGTERM, then SIGKILL after a grace period), and the outcome is
 * `unknown` when the group could not be confirmed gone. Output goes to an `OutputLog`, which bounds what is kept in
 * memory and saves the full output when it is cut.
 */
import { spawn } from "node:child_process";
import type { ToolOutcome } from "@openbot/protocol";
import type { OutputLog } from "./output.ts";

const KILL_GRACE_MS = 3_000;
const SECRET_VARIABLE = /(API_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY)/i;
const KEEP_VARIABLES = new Set(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM"]);

/** `timeout_seconds` ends the command when reached, in the foreground or the background; without it there is none. */
export type CommandArgs = { command: string; cwd: string; timeout_seconds?: number };

/** How a command ended. `groupGone` is false when its group survived SIGKILL, so it may still be running. */
export type CommandExit = {
	readonly code: number | null;
	readonly signal: string | null;
	readonly reason: "cancelled" | "timeout" | undefined;
	readonly groupGone: boolean;
	/** Set when the shell could not start. */
	readonly startError?: string;
};

export type RunningCommand = {
	/** Process ID of the shell, which leads the command's process group; undefined when it could not start. */
	readonly pid: number | undefined;
	readonly exited: Promise<CommandExit>;
	cancel(): void;
};

/** The environment commands run with: the executor's own, minus anything that looks like a credential. */
export function commandEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [name, value] of Object.entries(source)) {
		if (value === undefined) continue;
		if (KEEP_VARIABLES.has(name) || !SECRET_VARIABLE.test(name)) env[name] = value;
	}
	return env;
}

export function runCommand(args: CommandArgs, log: OutputLog, onOutput: (chunk: string) => void): RunningCommand {
	const child = spawn("/bin/zsh", ["-c", args.command], {
		cwd: args.cwd,
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
		env: commandEnvironment(process.env),
	});
	const capture = (chunk: Buffer): void => {
		log.append(chunk);
		onOutput(chunk.toString("utf8"));
	};
	child.stdout.on("data", capture);
	child.stderr.on("data", capture);

	let reason: "cancelled" | "timeout" | undefined;
	let groupGone = true;
	/** Set once the leader exited and the group was told to end; its PID may then belong to an unrelated group. */
	let closed = false;
	const signalGroup = (signal: NodeJS.Signals): boolean => {
		if (child.pid === undefined) return false;
		try {
			process.kill(-child.pid, signal);
			return true;
		} catch {
			return false;
		}
	};
	const stop = (why: "cancelled" | "timeout"): void => {
		if (reason !== undefined || closed) return;
		reason = why;
		signalGroup("SIGTERM");
		// Within the grace period the group's ID stays its own while any member is alive, so escalating is safe.
		const killer = setTimeout(() => {
			if (signalGroup("SIGKILL")) {
				// Still alive after the grace period; if it survives SIGKILL too, the outcome is uncertain.
				setTimeout(() => {
					groupGone = !signalGroup(0 as unknown as NodeJS.Signals);
				}, 200).unref();
			}
		}, KILL_GRACE_MS);
		killer.unref();
	};
	const timer = args.timeout_seconds === undefined ? undefined : setTimeout(() => stop("timeout"), args.timeout_seconds * 1000);

	const exited = new Promise<CommandExit>((resolve) => {
		child.on("error", (error) => {
			clearTimeout(timer);
			closed = true;
			resolve({ code: null, signal: null, reason, groupGone: true, startError: error.message });
		});
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			// Background children left in the group would outlive the command; end them without changing the outcome.
			if (reason === undefined) signalGroup("SIGTERM");
			closed = true;
			resolve({ code, signal, reason, groupGone });
		});
	});
	return { pid: child.pid, exited, cancel: () => stop("cancelled") };
}

/** The tool outcome of a command that ended in the foreground; `body` is its bounded output. */
export function commandOutcome(exit: CommandExit, body: string, truncated: boolean, timeoutSeconds: number | undefined): ToolOutcome {
	if (exit.startError !== undefined) return { status: "failed", output: `Could not start the command: ${exit.startError}` };
	const text = body === "" ? "(no output)" : body;
	const details = { exit: { code: exit.code, signal: exit.signal }, truncated };
	if (exit.reason === "timeout") return { status: "failed", output: `${text}\n[timed out after ${timeoutSeconds}s]`, ...details };
	if (exit.reason === "cancelled") {
		return { status: exit.groupGone ? "cancelled" : "unknown", output: `${text}\n[cancelled]`, ...details };
	}
	const footer = exit.code === 0 ? "" : `\n[exit ${exit.code ?? exit.signal}]`;
	return { status: exit.code === 0 ? "succeeded" : "failed", output: `${text}${footer}`, ...details };
}

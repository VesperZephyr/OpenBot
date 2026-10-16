/**
 * Supervised shell commands. Each runs in its own process group with no stdin and a scrubbed environment;
 * cancellation and timeouts signal the whole group (SIGTERM, then SIGKILL after a grace period), and the outcome is
 * `unknown` when the group could not be confirmed gone.
 */
import { spawn } from "node:child_process";
import type { ToolOutcome } from "@openbot/protocol";
import { COMMAND_MAX_BYTES, headAndTailWithin } from "./output.ts";

const DEFAULT_TIMEOUT_SECONDS = 120;
const KILL_GRACE_MS = 3_000;
/** Raw output kept in memory; the model gets a bounded head and tail of it. */
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
const SECRET_VARIABLE = /(API_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY)/i;
const KEEP_VARIABLES = new Set(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM"]);

export type CommandArgs = { command: string; cwd: string; timeout_seconds?: number };

export type RunningCommand = { readonly outcome: Promise<ToolOutcome>; cancel(): void };

/** The environment commands run with: the executor's own, minus anything that looks like a credential. */
export function commandEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [name, value] of Object.entries(source)) {
		if (value === undefined) continue;
		if (KEEP_VARIABLES.has(name) || !SECRET_VARIABLE.test(name)) env[name] = value;
	}
	return env;
}

export function runCommand(args: CommandArgs, onOutput: (chunk: string) => void): RunningCommand {
	const child = spawn("/bin/zsh", ["-c", args.command], {
		cwd: args.cwd,
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
		env: commandEnvironment(process.env),
	});
	let captured = "";
	let capturedBytes = 0;
	const capture = (chunk: Buffer): void => {
		const text = chunk.toString("utf8");
		onOutput(text);
		if (capturedBytes >= MAX_CAPTURE_BYTES) return;
		captured += text;
		capturedBytes += chunk.length;
	};
	child.stdout.on("data", capture);
	child.stderr.on("data", capture);

	let reason: "cancelled" | "timeout" | undefined;
	let groupGone = true;
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
		if (reason !== undefined) return;
		reason = why;
		signalGroup("SIGTERM");
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
	const timeoutSeconds = args.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS;
	const timer = setTimeout(() => stop("timeout"), timeoutSeconds * 1000);

	const outcome = new Promise<ToolOutcome>((resolve) => {
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({ status: "failed", output: `Could not start the command: ${error.message}` });
		});
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			// Background children left in the group would outlive the call; end them without changing the outcome.
			if (reason === undefined) signalGroup("SIGTERM");
			const bounded = headAndTailWithin(captured, COMMAND_MAX_BYTES);
			const exit = { code, signal };
			const body = bounded.text === "" ? "(no output)" : bounded.text;
			if (reason === "timeout") {
				resolve({ status: "failed", output: `${body}\n[timed out after ${timeoutSeconds}s]`, exit, truncated: bounded.truncated });
			} else if (reason === "cancelled") {
				resolve({ status: groupGone ? "cancelled" : "unknown", output: `${body}\n[cancelled]`, exit, truncated: bounded.truncated });
			} else {
				const status = code === 0 ? "succeeded" : "failed";
				const footer = code === 0 ? "" : `\n[exit ${code ?? signal}]`;
				resolve({ status, output: `${body}${footer}`, exit, truncated: bounded.truncated });
			}
		});
	});
	return { outcome, cancel: () => stop("cancelled") };
}

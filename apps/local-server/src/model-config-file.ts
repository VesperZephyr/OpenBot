/**
 * The user's model configuration file, `~/.openbot/config.json` (or `$OPENBOT_HOME/config.json`), and the environment
 * its values resolve against. `!command` values run through `/bin/sh` with the Host's (credential-free) environment;
 * successful output is cached briefly so a key helper does not run on every model request.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelConfigFile } from "@openbot/server-core";

const COMMAND_TIMEOUT_MS = 10_000;
const COMMAND_CACHE_MS = 5 * 60_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

export function openBotHome(): string {
	return process.env.OPENBOT_HOME ?? join(homedir(), ".openbot");
}

/**
 * `variables` is the environment `$NAME` references resolve against. The Host passes a copy taken before it removed
 * provider key variables from its own environment, so a variable the user names explicitly still resolves while
 * nothing is picked up implicitly.
 */
export function modelConfigFile(path: string, variables: Readonly<Record<string, string | undefined>>): ModelConfigFile {
	const cache = new Map<string, { readonly value: Promise<string>; readonly expires: number }>();
	return {
		path,
		async read() {
			try {
				return await readFile(path, "utf8");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
				throw new Error(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
			}
		},
		environment: {
			env(name) {
				const value = variables[name];
				return value === undefined || value.trim() === "" ? undefined : value;
			},
			run(command) {
				const cached = cache.get(command);
				if (cached !== undefined && cached.expires > Date.now()) return cached.value;
				const value = runCommand(command);
				cache.set(command, { value, expires: Date.now() + COMMAND_CACHE_MS });
				// A failed command is retried on the next request instead of serving the failure for the cache period.
				value.catch(() => {
					if (cache.get(command)?.value === value) cache.delete(command);
				});
				return value;
			},
		},
	};
}

function runCommand(command: string): Promise<string> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	execFile(
		"/bin/sh",
		["-c", command],
		{ timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, env: process.env, cwd: homedir() },
		(error, stdout) => {
			// stderr and the output are left out of the message: either may contain the secret.
			if (error !== null) reject(new Error(`Key command failed (${error.killed ? "timed out" : `exit ${error.code ?? "?"}`})`));
			else resolve(stdout.trim());
		},
	);
	return promise;
}

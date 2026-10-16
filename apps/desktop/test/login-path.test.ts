import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveLoginPath } from "../src/main/login-path";

const directories: string[] = [];
const fallback = "/usr/bin:/bin:/usr/sbin:/sbin";

async function fixture(body: string): Promise<NodeJS.ProcessEnv> {
	const root = await mkdtemp(join(tmpdir(), "openbot-path-"));
	directories.push(root);
	const shell = join(root, "login-shell");
	await writeFile(shell, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
	return { HOME: root, SHELL: shell, PATH: fallback };
}

afterEach(async () => {
	await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("login shell PATH", () => {
	it("loads zsh login and interactive startup files from an isolated home", async () => {
		const env = await fixture("exit 1");
		await writeFile(join(env.HOME!, ".zprofile"), "export OPENBOT_PATH_TEST_LOGIN=loaded\n");
		await writeFile(join(env.HOME!, ".zshrc"), '[ "$OPENBOT_PATH_TEST_LOGIN" = loaded ] && export PATH="/fixture/login tools/bin:/usr/bin:/bin"\n');
		env.SHELL = "/bin/zsh";
		expect(await resolveLoginPath(env)).toBe("/fixture/login tools/bin:/usr/bin:/bin");
	});

	it("reads only the framed PATH despite startup noise, preserving directory order and spaces", async () => {
		const env = await fixture(`
[ "$1" = '-ilc' ] || exit 1
[ -z "$PRIVATE_VALUE$NODE_OPTIONS$OPENBOT_HOST_ENTRY" ] || exit 2
printf 'startup banner\n'
printf 'sensitive startup diagnostic\n' >&2
export SHELL_ONLY_SECRET=hidden
export PATH='/opt/custom tools/bin:/opt/homebrew/bin:/usr/bin:/bin'
/bin/sh -c "$2"
printf '\nlogout banner\n'
`);
		env.PRIVATE_VALUE = "must-not-reach-probe";
		env.NODE_OPTIONS = "--bad-node-option";
		env.OPENBOT_HOST_ENTRY = "/untrusted";
		expect(await resolveLoginPath(env)).toBe("/opt/custom tools/bin:/opt/homebrew/bin:/usr/bin:/bin");
		expect(env.PATH).toBe(fallback);
	});

	it.each(["", "relative:/bin", "/bin::/usr/bin", "/bin:.", "/bin\n/private"])("falls back for invalid PATH %j", async (path) => {
		const env = await fixture(`export PATH='${path}'\n/bin/sh -c "$2"`);
		expect(await resolveLoginPath(env)).toBe(fallback);
	});

	it.each(["exit 1", "echo unframed", '/bin/sh -c "$2"; exit 1'])("falls back for shell failure: %s", async (body) => {
		expect(await resolveLoginPath(await fixture(body))).toBe(fallback);
	});

	it("falls back when the shell cannot start, including an absent inherited PATH", async () => {
		expect(await resolveLoginPath({ SHELL: "/missing-openbot-shell", PATH: "/custom/bin" })).toBe("/custom/bin");
		expect(await resolveLoginPath({ SHELL: "/missing-openbot-shell" })).toBe(fallback);
	});

	it.each(["", " >&2"])("bounds startup output on either stream: %s", async (redirect) => {
		const env = await fixture(`{ /bin/dd if=/dev/zero bs=70000 count=1 2>/dev/null; }${redirect}\n/bin/sleep 30`);
		const started = Date.now();
		expect(await resolveLoginPath(env, { timeoutMs: 2_000 })).toBe(fallback);
		expect(Date.now() - started).toBeLessThan(2_000);
	});

	it.each([true, false])("cleans up probe descendants when hanging=%s", async (hanging) => {
		const env = await fixture(`/bin/sleep 30 &\nprintf '%s' "$!" > "$HOME/child.pid"\n${hanging ? "wait" : 'export PATH="/fixture/bin:/bin"; /bin/sh -c "$2"'}`);
		const started = Date.now();
		expect(await resolveLoginPath(env, { timeoutMs: 2_000 })).toBe(hanging ? fallback : "/fixture/bin:/bin");
		expect(Date.now() - started).toBeLessThan(4_000);
		const pid = Number(await readFile(join(env.HOME!, "child.pid"), "utf8"));
		await expect.poll(() => {
			try {
				process.kill(pid, 0);
				return false;
			} catch {
				return true;
			}
		}).toBe(true);
	});
});

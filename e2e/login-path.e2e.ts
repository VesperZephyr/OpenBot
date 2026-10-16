import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppHarness, createBot, launchApp } from "./harness.ts";

let h: AppHarness;

beforeAll(async () => {
	h = await launchApp("login-path", {
		prepare: async (run) => {
			const bin = join(run, "custom tools", "bin");
			const shell = join(run, "login-shell");
			await mkdir(bin, { recursive: true });
			await writeFile(join(bin, "openbot-path-fixture"), '#!/bin/sh\n[ -z "$SHELL_ONLY_SECRET$DESKTOP_SECRET" ] || exit 42\nprintf "login-path-command-ok\\n"\n', { mode: 0o755 });
			await writeFile(shell, `#!/bin/sh
[ "$1" = '-ilc' ] || exit 1
printf 'private-shell-banner\\n'
export SHELL_ONLY_SECRET=private-shell-secret
export PATH="$(/usr/bin/dirname "$0")/custom tools/bin:$PATH"
exec /bin/sh -c "$2"
`, { mode: 0o755 });
			return { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", SHELL: shell, OPENBOT_NODE: process.execPath, DESKTOP_SECRET: "private-desktop-secret" };
		},
	});
	await createBot(h, "Path Scout");
}, 60_000);

afterAll(async () => { await h?.close(); });

describe("Finder-style startup", () => {
	it("runs a tool from the login PATH without leaking shell output or environment", async () => {
		h.model.script(
			{ tool: "local_exec", args: { command: "openbot-path-fixture", description: "Check login shell command" } },
			{ text: "The login shell command worked." },
		);
		await h.send("Run the login shell command");
		await h.page().getByRole("group", { name: "Approval request" }).getByRole("button", { name: "Allow once" }).click();
		await h.page().getByText("The login shell command worked.").waitFor();
		const card = h.page().locator(".tool-card.tool-succeeded", { hasText: "Check login shell command" });
		await card.waitFor();
		expect(await card.locator(".tool-output").textContent()).toContain("login-path-command-ok");
		const log = await readFile(join(h.dataDirectory, "logs", "host.log"), "utf8");
		for (const secret of ["private-shell-banner", "private-shell-secret", "private-desktop-secret"]) {
			expect(log).not.toContain(secret);
			expect(JSON.stringify(h.model.requests)).not.toContain(secret);
		}
		await h.shot("01-login-path-command");
	});
});

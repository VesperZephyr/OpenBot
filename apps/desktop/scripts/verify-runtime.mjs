// Exercise bundled processes from an unrelated directory with no provider or owner data.
import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
export async function verifyRuntime(stage) {
	const root = await mkdtemp(join(await realpath(tmpdir()), "openbot-bundle-check-"));
	await mkdir(join(root, "home"));
	await mkdir(join(root, "workspace"));
	await mkdir(join(root, "backups"));
	const env = {
		PATH: process.env.PATH,
		HOME: process.env.HOME,
		OPENBOT_APP_VERSION: process.env.OPENBOT_VERSION ?? "bundle-check",
		OPENBOT_HOME: join(root, "home"),
		OPENBOT_DATA_DIR: join(root, "data"),
		OPENBOT_WORKSPACE: join(root, "workspace"),
		OPENBOT_KEYCHAIN_SERVICE: `ai.openbot.bundle-check.${process.pid}`,
		OPENBOT_EXECUTOR_ENTRY: resolve(stage, "host/executor.mjs"),
	};
	let host,
		sequence = 0;
	async function start() {
		host = fork(resolve(stage, "host/host.mjs"), [], { execPath: resolve(stage, "node"), execArgv: [], cwd: root, silent: true, env });
		host.on("message", (message) => {
			if (message.kind !== "credential.request") return;
			const status = { owner: "desktop-main", availability: "ready", configuredCount: 0, legacyCount: 0, migrationRequired: 0 };
			const result =
				message.operation === "list"
					? { ids: [], status }
					: message.operation === "status"
						? status
						: message.operation === "get"
							? { value: null }
							: undefined;
			if (host.connected)
				host.send(
					result === undefined
						? { kind: "credential.response", requestId: message.requestId, ok: false, code: "unavailable" }
						: { kind: "credential.response", requestId: message.requestId, ok: true, result },
				);
		});
		let stderr = "";
		host.stderr.on("data", (chunk) => {
			stderr = (stderr + chunk).slice(-4000);
		});
		host.stdout.resume();
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(Error("Bundled Host did not start")), 15000);
			host.once("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
			host.once("exit", (code) => {
				clearTimeout(timer);
				reject(Error(`Bundled Host exited ${code}: ${stderr}`));
			});
			host.on("message", (message) => {
				if (message.kind === "ready") {
					clearTimeout(timer);
					resolve();
				}
			});
		});
	}
	function call(method, params = {}) {
		return new Promise((resolve, reject) => {
			const messageId = `verify-${++sequence}`;
			const timer = setTimeout(() => {
				host.removeListener("message", listen);
				reject(Error(`${method} timed out`));
			}, 15000);
			function listen(message) {
				if (message.kind !== "response" || message.messageId !== messageId) return;
				clearTimeout(timer);
				host.removeListener("message", listen);
				message.ok ? resolve(message.result) : reject(Error(message.error.message));
			}
			host.on("message", listen);
			host.send({ protocolVersion: 1, kind: "request", messageId, method, params });
		});
	}
	async function stop() {
		if (!host || host.exitCode !== null || host.signalCode !== null) return;
		const ended = new Promise((resolve) => host.once("exit", resolve));
		host.kill("SIGTERM");
		const timer = setTimeout(() => host.kill("SIGKILL"), 5000);
		await ended;
		clearTimeout(timer);
	}
	function maintenance(action, directory) {
		const result = spawnSync(resolve(stage, "node"), ["--disable-warning=ExperimentalWarning", resolve(stage, "host/maintenance.mjs")], {
			cwd: root,
			env,
			input: JSON.stringify({ action, directory }),
			encoding: "utf8",
			timeout: 30000,
		});
		assert.equal(result.status, 0, result.stderr);
		return JSON.parse(result.stdout);
	}
	try {
		await start();
		const bot = await call("bots.create", { requestId: "bundle-backup-bot", name: "Bundle backup" });
		await call("bots.memory.update", { botId: bot.botId, expectedRevision: 0, content: "Bundled recovery canary" });
  for(let i=0;i<200&&(await call("conversations.indexStatus")).state!=="ready";i++)await new Promise(resolve=>setTimeout(resolve,20));
  const initial=await call("conversations.window",{conversationKey:`bot:${bot.botId}`,position:{kind:"latest"}});
  assert.equal(initial.status,"ready");assert.deepEqual(initial.window.rows,[]);
		await call("lifecycle.pause");
		await stop();
		const backup = maintenance("export", join(root, "backups"));
		const manifest = JSON.parse(await readFile(join(backup.path, "manifest.json"), "utf8"));
		assert.equal(manifest.producer.application, env.OPENBOT_APP_VERSION);
 assert(!manifest.files.some(file=>file.path.startsWith("cache/")));
		for (const name of ["openbot.sqlite", "openbot.sqlite-wal", "openbot.sqlite-shm", "executor", "attachments", "skills"])
			await rm(join(root, "data", name), { recursive: true, force: true });
		maintenance("restore", backup.path);
		await start();
		assert.equal((await call("bots.memory.get", { botId: bot.botId })).content, "Bundled recovery canary");
		assert.equal((await call("lifecycle.get")).userPaused, true);
  for(let i=0;i<200&&(await call("conversations.indexStatus")).state!=="ready";i++)await new Promise(resolve=>setTimeout(resolve,20));
  const restored=await call("conversations.window",{conversationKey:`bot:${bot.botId}`,position:{kind:"latest"}});assert.equal(restored.status,"ready");assert.notEqual(restored.window.generation,initial.window.generation);
		console.log("Bundled Host, executor and offline backup helpers verified: export, delete originals, restore, paused restart, disposable history worker generation");
	} finally {
		await stop();
		await rm(root, { recursive: true, force: true });
	}
}

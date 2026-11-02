import { mkdir, rm } from "node:fs/promises";

export default async function setup(): Promise<void> {
	const run = new URL("./.run/", import.meta.url);
	await mkdir(run, { recursive: true });
	await rm(new URL("runtime-launches.jsonl", run), { force: true });
}

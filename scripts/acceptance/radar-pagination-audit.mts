/** Offline audit of captured owner routine snapshots. No credentials, network or application mutations. */
import { readFile } from "node:fs/promises";
import { auditTrae, auditZcode, reconstruct, type CapturedFetch } from "./lib/changelog-pagination.ts";
const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/acceptance/radar-pagination-audit.mts <private-routine-evidence.json>");
const evidence = JSON.parse(await readFile(file, "utf8"));
const items: CapturedFetch[] = evidence.results.flatMap((r: { detail?: { snapshot?: { items?: CapturedFetch[] } } }) => r.detail?.snapshot?.items ?? []);
const documents = reconstruct(items);
console.log(JSON.stringify({ zcode: auditZcode(documents), trae: auditTrae(documents), scope: "Observed official catalogue only; dates retain source precision, not inferred publication timestamps." }, null, 2));

/** Public-response fixtures only; production Host, routing and fetching still run. */
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { traePage } from "../../scripts/test/changelog-fixtures.ts";
const lookup = dns.lookup;
dns.lookup = ((host: string, options: unknown) => ["www.trae.cn", "zcode.z.ai"].includes(host) ? Promise.resolve([{ address: "93.184.216.34", family: 4 }]) : lookup(host, options as never)) as typeof dns.lookup;
syncBuiltinESMExports();
const fetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
	const url = new URL(String(input)), page = Number(url.searchParams.get("page"));
	if (url.hostname === "www.trae.cn" && url.pathname === "/api/changelog") return new Response(JSON.stringify(traePage(page)), { headers: { "content-type": "application/json" } });
	if (url.hostname === "zcode.z.ai") return new Response(`<html><body><article><h1>Releases</h1><p>2.0.0 Released Oct 26, 2026</p><p>Release body</p>${page === 2 ? '<p>1.0.0 Released Oct 20, 2026</p><p>Earlier body</p>' : ''}</article><footer>${page === 2 ? "You've reached the end of the release history." : "Scroll to load more releases."}</footer></body></html>`, { headers: { "content-type": "text/html" } });
	return fetch(input, init);
};
await import("../../apps/local-server/src/main.ts");

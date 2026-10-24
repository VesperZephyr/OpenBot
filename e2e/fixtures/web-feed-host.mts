/** Isolated transport fixture; the production Host, policy and web_fetch still handle the call. */
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";

const lookup = dns.lookup;
dns.lookup = ((hostname: string, options: unknown) => hostname === "releases.example.org"
	? Promise.resolve([{ address: "93.184.216.34", family: 4 }])
	: lookup(hostname, options as never)) as typeof dns.lookup;
syncBuiltinESMExports();
const fetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
	if (String(input) === "https://releases.example.org/changelog") {
		return new Response('<html><body><aside>Release 1.2 — <time datetime="2026-10-23T01:00:00Z">23 Oct 01:00</time></aside><article><p>Resume interrupted work safely.</p></article></body></html>', { headers: { "content-type": "text/html" } });
	}
	if (String(input) === "https://releases.example.org/feed.atom") {
		return new Response('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Recovery 1.2</title><link href="https://releases.example.org/v1.2"/><published>2026-10-23T01:00:00Z</published><updated>2026-10-24T02:00:00Z</updated><content type="html">&lt;p&gt;Resume interrupted work safely.&lt;/p&gt;</content></entry></feed>', { headers: { "content-type": "application/atom+xml; charset=utf-8" } });
	}
	return fetch(input, init);
};
await import("../../apps/local-server/src/main.ts");

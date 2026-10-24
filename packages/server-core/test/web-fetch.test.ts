import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWebFetch } from "../src/index.ts";

const fixtures = join(import.meta.dirname, "fixtures");
const longArticle = `<!doctype html><html><head><title>Long read</title></head><body><article><h1>Long read</h1>${Array.from(
	{ length: 800 },
	(_, index) => `<p>Paragraph ${index} explains one more detail of the subject at a comfortable length for reading.</p>`,
).join("")}<p>THE-END</p></article></body></html>`;

/** Path → status and fixture; `/redirect-local` points at a hostname the test fetcher refuses. */
const routes: Record<string, { status: number; file?: string; body?: string; type?: string; location?: string }> = {
	"/article": { status: 200, file: "article.html" },
	"/challenge": { status: 403, file: "challenge.html" },
	"/login": { status: 200, file: "login.html" },
	"/shell": { status: 200, file: "shell.html" },
	"/missing": { status: 404, file: "missing.html" },
	"/broken": { status: 500, body: "<html><body><p>Internal error</p></body></html>" },
	"/long": { status: 200, body: longArticle },
	"/moved": { status: 301, location: "/article" },
	"/atom": { status: 200, body: '<feed><entry><title>v1.2</title><published>2026-10-23T01:00:00Z</published><updated>2026-10-24T02:00:00Z</updated><content type="html">&lt;p&gt;Recovery fix&lt;/p&gt;</content></entry></feed>', type: 'application/atom+xml; charset=utf-8' },
	"/rss": { status: 200, body: '<rss><channel><item><title>v1.2</title><pubDate>Fri, 23 Oct 2026 01:00:00 GMT</pubDate></item></channel></rss>', type: 'application/rss+xml' },
	"/atom-rate-limit": { status: 429, body: '<error>rate limited</error>', type: 'application/atom+xml' },
	"/binary": { status: 200, body: 'binary', type: 'application/octet-stream' },
	"/oversize": { status: 200, body: 'x'.repeat(2 * 1024 * 1024 + 1), type: 'text/plain' },
	"/exact-limit": { status: 200, body: 'x'.repeat(2 * 1024 * 1024), type: 'text/plain' },
	"/release": { status: 200, body: '<html><body><nav>Navigation</nav><div><aside>v3.4.4 <time datetime="2026-10-15"></time><relative-time datetime="2026-10-16T02:00:00Z">16 Oct 02:00</relative-time></aside><article><p>Resume interrupted tasks safely. <a href="/details">Release details</a></p></article></div><script>SECRET_SCRIPT</script></body></html>' },
	"/plain": { status: 200, body: "just text", type: "text/plain" },
};

let server: Server;
let origin: string;
// Unit tests serve fixtures from 127.0.0.1, so they refuse only `localhost`; production uses the default check.
const fetchPage = createWebFetch({ isBlockedHost: async (hostname) => hostname === "localhost" });
const signal = new AbortController().signal;

beforeAll(async () => {
	server = createServer((request, response) => {
		const path = request.url ?? "/";
		if (path === "/redirect-local") {
			response.writeHead(302, { location: `http://localhost:${(server.address() as AddressInfo).port}/article` });
			response.end();
			return;
		}
		const route = routes[path];
		if (route === undefined) {
			response.writeHead(404).end();
			return;
		}
		if (route.location !== undefined) {
			response.writeHead(route.status, { location: route.location }).end();
			return;
		}
		const send = (body: string) => {
			response.writeHead(route.status, { "content-type": route.type ?? "text/html; charset=utf-8" });
			response.end(body);
		};
		if (route.file === undefined) send(route.body ?? "");
		else void readFile(join(fixtures, route.file), "utf8").then(send);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("web_fetch", () => {
	it("returns the main content as Markdown with absolute links", async () => {
		const outcome = await fetchPage({ url: `${origin}/article` }, signal);
		expect(outcome.status).toBe("succeeded");
		expect(outcome.output).toContain("retrieval_outcome: usable_content");
		expect(outcome.output).toContain("Title: Tide Pools of the Pacific | Coast Notes");
		expect(outcome.output).toContain(`[tide tables](${origin}/tables/2026)`);
		expect(outcome.output).toContain("[tide pool etiquette guide](https://example.org/etiquette)");
		expect(outcome.output).toMatch(/^#+ What lives there$/m);
		expect(outcome.output).toMatch(/^- +Ochre sea stars/m);
		// Navigation and footer are not main content.
		expect(outcome.output).not.toContain("Privacy");
	});

	it.each([
		["/challenge", "access_challenge"],
		["/login", "auth_required"],
		["/shell", "dynamic_page"],
		["/missing", "not_found"],
		["/broken", "http_error"],
	])("labels %s as %s and fails", async (path, label) => {
		const outcome = await fetchPage({ url: `${origin}${path}` }, signal);
		expect(outcome.status).toBe("failed");
		expect(outcome.output).toContain(`retrieval_outcome: ${label}`);
	});

	it("reports the final URL after a redirect", async () => {
		const outcome = await fetchPage({ url: `${origin}/moved` }, signal);
		expect(outcome.output).toMatch(new RegExp(`^URL: ${origin}/article$`, "m"));
		expect(outcome.output).toContain("retrieval_outcome: usable_content");
	});

	it("pages long documents through offset without losing text", async () => {
		const first = await fetchPage({ url: `${origin}/long` }, signal);
		expect(first.truncated).toBe(true);
		const next = /Call web_fetch with offset (\d+) to continue/.exec(first.output)?.[1];
		expect(next).toBeDefined();
		expect(first.output).not.toContain("THE-END");
		const second = await fetchPage({ url: `${origin}/long`, offset: Number(next) }, signal);
		expect(second.output).toContain("THE-END");
		expect(second.output).not.toContain("Call web_fetch with offset");
		const body = (output: string) => output.slice(output.indexOf("\n\n") + 2).replace(/\n\n\[Characters[\s\S]*$/, "");
		const joined = `${body(first.output)}${body(second.output)}`;
		for (let index = 0; index < 800; index += 1) expect(joined.split(`Paragraph ${index} `)).toHaveLength(2);
	});

	it("passes plain text through", async () => {
		const outcome = await fetchPage({ url: `${origin}/plain` }, signal);
		expect(outcome.status).toBe("succeeded");
		expect(outcome.output).toContain("just text");
	});

	it("preserves feed publication and modification dates without treating XML as HTML", async () => {
		const atom = await fetchPage({ url: `${origin}/atom` }, signal);
		expect(atom.status).toBe("succeeded");
		expect(atom.output).toContain('<published>2026-10-23T01:00:00Z</published>');
		expect(atom.output).toContain('<updated>2026-10-24T02:00:00Z</updated>');
		expect(atom.output).toContain('&lt;p&gt;Recovery fix&lt;/p&gt;');
		const rss = await fetchPage({ url: `${origin}/rss` }, signal);
		expect(rss.status).toBe("succeeded");
		expect(rss.output).toContain('<pubDate>Fri, 23 Oct 2026 01:00:00 GMT</pubDate>');
		expect((await fetchPage({ url: `${origin}/atom-rate-limit` }, signal)).status).toBe("failed");
		expect((await fetchPage({ url: `${origin}/binary` }, signal)).status).toBe("failed");
	});

	it("refuses oversized bodies instead of presenting silent truncation as complete coverage", async () => {
		const oversized = await fetchPage({ url: `${origin}/oversize` }, signal);
		expect(oversized.status).toBe("failed");
		expect(oversized.output).toContain('content was not fully retrieved');
		const exact = await fetchPage({ url: `${origin}/exact-limit` }, signal);
		expect(exact.status).toBe("succeeded");
		expect(exact.truncated).toBe(true);
		expect(exact.output).toContain('of 2097152');
	});

	it("offers complete page context when article extraction loses adjacent release metadata", async () => {
		const page = await fetchPage({ url: `${origin}/release`, mode: "page" }, signal);
		expect(page.status).toBe("succeeded");
		expect(page.output).toContain("extraction_mode: page");
		expect(page.output).toContain("v3.4.4 2026-10-15");
		expect(page.output).toContain("16 Oct 02:00 (2026-10-16T02:00:00Z)");
		expect(page.output).toContain("Resume interrupted tasks safely.");
		expect(page.output).toContain(`[Release details](${origin}/details)`);
		expect(page.output).not.toContain("SECRET_SCRIPT");
	});

	it("refuses a blocked host reached through a redirect", async () => {
		const outcome = await fetchPage({ url: `${origin}/redirect-local` }, signal);
		expect(outcome).toEqual({ status: "failed", output: "Refused: localhost is a private or local address" });
	});

	it("refuses loopback and private addresses by default", async () => {
		const production = createWebFetch();
		expect((await production({ url: `${origin}/article` }, signal)).output).toBe("Refused: 127.0.0.1 is a private or local address");
		expect((await production({ url: "http://[::1]/" }, signal)).status).toBe("failed");
		expect((await production({ url: "http://192.168.1.1/" }, signal)).output).toContain("Refused");
		// The URL parser rewrites an IPv4-mapped address to hex (`[::ffff:7f00:1]`); it is still loopback.
		const port = new URL(origin).port;
		expect((await production({ url: `http://[::ffff:127.0.0.1]:${port}/article` }, signal)).output).toContain("Refused");
		expect((await production({ url: `http://[::ffff:c0a8:101]/` }, signal)).output).toContain("Refused");
		expect((await production({ url: "file:///etc/passwd" }, signal)).output).toBe("Only http and https URLs can be fetched");
	});
});

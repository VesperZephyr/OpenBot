/**
 * `web_fetch`: a Host tool that reads a public page as text. Private, loopback, and link-local addresses are refused,
 * including after redirects and DNS resolution, so a page cannot steer the Host into the local network.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { ToolOutcome } from "@openbot/protocol";

const TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_BYTES = 48 * 1024;
const MAX_REDIRECTS = 5;

export async function webFetch(args: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<ToolOutcome> {
	let url: URL;
	try {
		url = new URL(String(args.url));
	} catch {
		return { status: "failed", output: "Not a valid URL" };
	}
	const timeout = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
	try {
		for (let redirects = 0; ; redirects += 1) {
			if (url.protocol !== "http:" && url.protocol !== "https:") return { status: "failed", output: "Only http and https URLs can be fetched" };
			if (await isPrivateHost(url.hostname)) return { status: "failed", output: `Refused: ${url.hostname} is a private or local address` };
			const response = await fetch(url, { redirect: "manual", signal: timeout, headers: { "user-agent": "OpenBot/0.0", accept: "text/html, text/plain, application/json;q=0.9, */*;q=0.5" } });
			const location = response.headers.get("location");
			if (response.status >= 300 && response.status < 400 && location !== null) {
				if (redirects >= MAX_REDIRECTS) return { status: "failed", output: "Too many redirects" };
				url = new URL(location, url);
				continue;
			}
			const type = response.headers.get("content-type") ?? "";
			if (!/^(text\/|application\/(json|xml|xhtml))/.test(type)) {
				return { status: "failed", output: `${url.href} returned ${type || "an unknown type"}, which is not text` };
			}
			const body = await readCapped(response, MAX_BODY_BYTES);
			const text = type.includes("html") ? htmlToText(body) : body;
			const clipped = Buffer.byteLength(text) > MAX_TEXT_BYTES ? `${Buffer.from(text).subarray(0, MAX_TEXT_BYTES).toString("utf8")}\n[page text truncated]` : text;
			const header = `${response.status} ${url.href}`;
			return { status: response.ok ? "succeeded" : "failed", output: `${header}\n\n${clipped.trim() || "(no readable text; the page may need JavaScript)"}` };
		}
	} catch (error) {
		if (signal.aborted) throw error;
		return { status: "failed", output: `Fetch failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
	const reader = response.body?.getReader();
	if (reader === undefined) return "";
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		total += value.length;
		if (total >= maxBytes) {
			await reader.cancel();
			break;
		}
	}
	return Buffer.concat(chunks).toString("utf8");
}

async function isPrivateHost(hostname: string): Promise<boolean> {
	const host = hostname.replace(/^\[|\]$/g, "");
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
	const addresses = isIP(host) !== 0 ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
	return addresses.some(isPrivateAddress);
}

function isPrivateAddress(address: string): boolean {
	if (address.includes(":")) {
		const lower = address.toLowerCase();
		if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
		return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
	}
	const [a = 0, b = 0] = address.split(".").map(Number);
	return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Readable text of an HTML page: scripts, styles, and markup removed, block elements kept as line breaks. */
export function htmlToText(html: string): string {
	return html
		.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, "\n")
		.replace(/<li[^>]*>/gi, "- ")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s*\n\s*\n+/g, "\n\n");
}

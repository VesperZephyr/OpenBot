/**
 * `web_fetch`: a Host tool that reads a public page as Markdown. The main content is extracted with Mozilla
 * Readability and converted with Turndown, links made absolute. A `retrieval_outcome` line tells the model whether
 * the page was actually read or hit a login wall, a bot check, a JavaScript shell, or a missing page. Long pages are
 * paged with `offset`.
 *
 * Private, loopback, and link-local addresses are refused, including after redirects and DNS resolution, so a page
 * cannot steer the Host into the local network.
 */
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import type { ToolOutcome } from "@openbot/protocol";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import type { WebToolHandler } from "./web-search.ts";

const TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Characters of Markdown per page of output. */
const PAGE_CHARS = 40_000;
// Leave headroom below the routed runtime's 50 KiB / 2000-line output limit.
const PAGE_BYTES = 48 * 1024;
const PAGE_LINES = 1900;
const METADATA_BYTES = 4096;
const METADATA_LINES = 32;
const MAX_REDIRECTS = 5;
/** Below this much visible text a page with a barrier (login form, bot check) has nothing else worth reading. */
const SUBSTANTIAL_TEXT = 200;
/** A page with scripts and at most this much visible body text is an application shell. */
const SHELL_TEXT = 40;

export type RetrievalOutcome = "usable_content" | "not_found" | "access_challenge" | "auth_required" | "dynamic_page" | "http_error";

const NEXT_STEP: Record<Exclude<RetrievalOutcome, "usable_content">, string> = {
	not_found: "The page does not exist. Search for its current location instead of guessing URLs.",
	access_challenge: "The site answered with a bot check instead of the page. Try another source.",
	auth_required: "The page needs a login. Try a public source.",
	dynamic_page: "The page renders with JavaScript, which web_fetch does not run. Try another source or an API.",
	http_error: "The server returned an error instead of the page.",
};

export type WebFetchOptions = {
	/**
	 * Decides whether a hostname is refused. Defaults to refusing private, loopback, and link-local addresses. Only
	 * unit tests pass another check, to serve fixtures from a local server; the Host never does.
	 */
	readonly isBlockedHost?: (hostname: string) => Promise<boolean>;
};

/** The `web_fetch` Host tool handler. */
export function createWebFetch(options: WebFetchOptions = {}): WebToolHandler {
	const isBlockedHost = options.isBlockedHost ?? isPrivateHost;
	return async (args, signal) => {
		let url: URL;
		try {
			url = new URL(String(args.url));
		} catch {
			return { status: "failed", output: "Not a valid URL" };
		}
		const offset = typeof args.offset === "number" && Number.isInteger(args.offset) && args.offset > 0 ? args.offset : 0;
		const timeout = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
		try {
			for (let redirects = 0; ; redirects += 1) {
				if (url.protocol !== "http:" && url.protocol !== "https:") return { status: "failed", output: "Only http and https URLs can be fetched" };
				if (await isBlockedHost(url.hostname)) return { status: "failed", output: `Refused: ${url.hostname} is a private or local address` };
				const response = await fetch(url, {
					redirect: "manual",
					signal: timeout,
					headers: { "user-agent": "OpenBot/0.0", accept: "text/html, text/plain, application/json;q=0.9, application/atom+xml;q=0.9, application/rss+xml;q=0.9, */*;q=0.5" },
				});
				const location = response.headers.get("location");
				if (response.status >= 300 && response.status < 400 && location !== null) {
					await response.body?.cancel();
					if (redirects >= MAX_REDIRECTS) return { status: "failed", output: "Too many redirects" };
					url = new URL(location, url);
					continue;
				}
				const type = response.headers.get("content-type") ?? "";
				if (!/^(?:text\/[^;\s]+|application\/(?:json|xml|xhtml\+xml|atom\+xml|rss\+xml))(?:\s*;|$)/i.test(type)) {
					await response.body?.cancel();
					return { status: "failed", output: `${url.href} returned ${type || "an unknown type"}, which is not text` };
				}
				const body = await readCapped(response, MAX_BODY_BYTES);
				const page = /^(text\/html|application\/xhtml)/i.test(type)
					? readHtml(body, response.status, url, args.mode === "page")
					: { outcome: statusOutcome(response.status), markdown: body.trim() };
				return render(url, response.status, page, offset, args.mode === "page" ? "page" : "article", args.contentHash);
			}
		} catch (error) {
			if (signal.aborted) throw error;
			return { status: "failed", output: `Fetch failed: ${error instanceof Error ? error.message : String(error)}` };
		}
	};
}

type Page = { readonly outcome: RetrievalOutcome; readonly markdown: string; readonly title?: string; readonly fullPage?: boolean };

function render(url: URL, status: number, page: Page, offset: number, mode: "article" | "page", expectedHash: unknown): ToolOutcome {
	const hash = createHash("sha256").update(page.markdown).digest("hex");
	if (expectedHash !== undefined && expectedHash !== hash) return {
		status: "failed", output: "content_changed: The extracted document does not match contentHash. Coverage is unverified. Restart at offset 0; do not combine ranges from different documents.",
	};
	const total = page.markdown.length;
	if (offset > 0 && (offset >= total || /[\uDC00-\uDFFF]/.test(page.markdown[offset]!) && /[\uD800-\uDBFF]/.test(page.markdown[offset - 1]!))) {
		return { status: "failed", output: `Invalid offset ${offset} for ${total} characters. Use the exact next_offset from the previous response.` };
	}
	const end = pageEnd(page.markdown, offset);
	const more = end < total;
	const header = [`URL: ${url.href}`, `Status: ${status}`];
	if (page.title) header.push(`Title: ${page.title.replace(/\s+/g, " ")}`);
	header.push(`retrieval_outcome: ${page.outcome}`, `extraction_mode: ${mode}${page.fullPage ? " (includes navigation; verify dates and product context)" : ""}`);
	if (page.outcome !== "usable_content") header.push(NEXT_STEP[page.outcome]);
	header.push(
		`content_hash: ${hash}`,
		`Characters ${offset}–${end} of ${total} (UTF-16; end exclusive)`,
		`document_status: ${more ? "partial" : "end_of_extracted_document"}`,
		`next_offset: ${more ? end : "none"}`,
		more ? `Call web_fetch with offset ${end} to continue; use the same URL, mode "${mode}" and contentHash "${hash}".` : "No further text in this extraction; this does not prove complete site history or publication timing.",
		"Coverage: only the range below was returned. Follow relevant continuations and source links; incomplete coverage is not evidence of no update.",
	);
	const metadata = header.join("\n") + "\n\n";
	if (Buffer.byteLength(metadata) > METADATA_BYTES || metadata.split("\n").length > METADATA_LINES) {
		return { status: "failed", output: "Page metadata exceeds the output budget; content was not delivered. Coverage is unverified. Try a shorter source URL or another official endpoint." };
	}
	return {
		status: page.outcome === "usable_content" ? "succeeded" : "failed",
		output: metadata + (total === 0 ? "(no readable text)" : page.markdown.slice(offset, end)),
		...(more ? { truncated: true } : {}),
	};
}

/** Bound the body before composing metadata so no downstream truncation can skip undelivered text. */
function pageEnd(text: string, offset: number): number {
	let end = offset, bytes = 0, lines = 1, lastBreak = offset;
	while (end < text.length) {
		const char = String.fromCodePoint(text.codePointAt(end)!);
		const size = Buffer.byteLength(char);
		if (end + char.length - offset > PAGE_CHARS || bytes + size > PAGE_BYTES - METADATA_BYTES || (char === "\n" && lines >= PAGE_LINES - METADATA_LINES)) break;
		bytes += size;
		end += char.length;
		if (char === "\n") { lines += 1; lastBreak = end; }
	}
	return end < text.length && lastBreak > offset + (end - offset) * 0.75 ? lastBreak : end;
}

function readHtml(html: string, status: number, url: URL, fullPage: boolean): Page {
	const outcome = classify(status, html);
	// Readability mutates the document it reads, so classification and extraction each parse their own copy.
	const { document } = parseHTML(html);
	const title = document.title.replace(/\s+/g, " ").trim();
	for (const element of document.querySelectorAll("time[datetime], relative-time[datetime]")) {
		const datetime = element.getAttribute("datetime") ?? "";
		const label = element.textContent?.trim() ?? "";
		if (datetime && !label.includes(datetime)) element.textContent = label ? `${label} (${datetime})` : datetime;
	}
	for (const element of document.querySelectorAll("a[href], img[src]")) {
		const attribute = element.tagName === "A" ? "href" : "src";
		try {
			element.setAttribute(attribute, new URL(element.getAttribute(attribute) ?? "", url).href);
		} catch {
			element.removeAttribute(attribute);
		}
	}
	const body = document.body?.innerHTML ?? "";
	const content = fullPage ? body : new Readability(document).parse()?.content ?? body;
	return { outcome, markdown: turndown.turndown(content).trim(), ...(title === "" ? {} : { title }), ...(fullPage ? { fullPage: true } : {}) };
}

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
turndown.remove(["script", "style", "noscript", "template"]);
// Inline data images would flood the context; keep only images with a fetchable address.
turndown.addRule("webImages", {
	filter: "img",
	replacement: (_content, node) => {
		// Typed structurally: the package compiles without the DOM library.
		const image = node as unknown as { getAttribute(name: string): string | null };
		const src = image.getAttribute("src") ?? "";
		return /^https?:/.test(src) ? `![${image.getAttribute("alt") ?? ""}](${src})` : "";
	},
});

const CHALLENGE_MARKER =
	/cf-(?:challenge|chl|turnstile)|\/cdn-cgi\/challenge-platform\/|\bg-recaptcha\b|\bh-captcha\b|\bpx-captcha\b|\barkose|\bdatadome\b|\bperimeterx\b|_Incapsula_Resource/i;
const CHALLENGE_WORDING = /verify(?:ing)? (?:that )?you are (?:a )?human|checking your browser|security check|complete the challenge|enable javascript and cookies to continue/i;
const LOGIN_WORDING = /\b(?:sign|log) ?in\b|authentication required|请登录|需要登录/i;

/**
 * Whether the HTML is the page or a barrier in front of it. Heuristics after MCode's local web fetch: a barrier only
 * counts when little readable text exists outside it, so an article with a comment login form stays usable.
 */
function classify(status: number, html: string): RetrievalOutcome {
	if (status === 404 || status === 410) return "not_found";
	const { document } = parseHTML(html);
	const scripts = document.querySelectorAll("script").length;
	for (const element of document.querySelectorAll("script, style, noscript, template")) element.remove();
	const bodyText = visibleText(document.body?.textContent);
	const formsText = [...document.querySelectorAll("form")].map((form) => visibleText(form.textContent)).join(" ");
	const outsideForms = bodyText.length - formsText.length;
	if (CHALLENGE_MARKER.test(html) && (status === 403 || status === 429 || status === 503 || CHALLENGE_WORDING.test(bodyText)) && outsideForms < SUBSTANTIAL_TEXT) {
		return "access_challenge";
	}
	const loginForm = document.querySelector('form input[type="password" i], form input[autocomplete="current-password" i]') !== null;
	if ((loginForm || (status === 401 && LOGIN_WORDING.test(bodyText))) && outsideForms < SUBSTANTIAL_TEXT) return "auth_required";
	if (status < 200 || status >= 300) return "http_error";
	if (scripts > 0 && bodyText.length <= SHELL_TEXT) return "dynamic_page";
	return "usable_content";
}

function statusOutcome(status: number): RetrievalOutcome {
	if (status === 404 || status === 410) return "not_found";
	if (status === 401) return "auth_required";
	return status >= 200 && status < 300 ? "usable_content" : "http_error";
}

function visibleText(text: string | null | undefined): string {
	return (text ?? "").replace(/\s+/g, " ").trim();
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
	const reader = response.body?.getReader();
	if (reader === undefined) return "";
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new Error(`Response exceeds the ${maxBytes}-byte limit; content was not fully retrieved. Use a smaller source or feed page.`);
		}
		chunks.push(value);
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
		if (lower.startsWith("::ffff:")) {
			const mapped = lower.slice(7);
			// The URL parser writes `[::ffff:127.0.0.1]` as `::ffff:7f00:1`; turn the hex form back into a dotted quad.
			const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped);
			if (hex === null) return isPrivateAddress(mapped);
			const high = Number.parseInt(hex[1]!, 16);
			const low = Number.parseInt(hex[2]!, 16);
			return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
		}
		return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
	}
	const [a = 0, b = 0] = address.split(".").map(Number);
	return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

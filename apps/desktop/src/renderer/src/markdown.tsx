/**
 * GitHub-flavored Markdown for assistant messages. Model output is untrusted: the HTML is sanitized, raw HTML in the
 * source is dropped, and links open in the user's browser through main's window-open handler. Code blocks carry a Copy
 * button; clicks are handled by delegation, and the text goes to the clipboard through main.
 */
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { type MouseEvent, useMemo } from "react";
import { report } from "./store";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

const marked = new Marked({ gfm: true, breaks: true, async: false });
marked.use({
	renderer: {
		html: () => "",
		code: ({ text, lang }) => {
			const language = lang?.match(/^\S+/)?.[0];
			const code = `<code${language === undefined ? "" : ` class="language-${escapeHtml(language)}"`}>${escapeHtml(text)}</code>`;
			return `<div class="code-block"><button type="button" class="code-copy">Copy</button><pre>${code}</pre></div>\n`;
		},
	},
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
	if (node.tagName === "A") {
		node.setAttribute("target", "_blank");
		node.setAttribute("rel", "noreferrer");
	}
});

export function Markdown({ text }: { readonly text: string }) {
	const html = useMemo(
		() => DOMPurify.sanitize(marked.parse(text) as string, { FORBID_TAGS: ["style", "img"], FORBID_ATTR: ["style"] }),
		[text],
	);
	return <div className="markdown" onClick={copyCode} dangerouslySetInnerHTML={{ __html: html }} />;
}

function copyCode(event: MouseEvent<HTMLDivElement>): void {
	if (!(event.target instanceof Element)) return;
	const button = event.target.closest(".code-copy");
	const code = button?.parentElement?.querySelector("pre")?.textContent;
	if (button === null || button === undefined || code === undefined || code === null) return;
	window.openbot
		.copyText(code)
		.then(() => {
			button.textContent = "Copied";
			setTimeout(() => (button.textContent = "Copy"), 1500);
		})
		.catch(report);
}

import { openWebPage } from "./reader-store";
import { t } from "./i18n";
/**
 * GitHub-flavored Markdown for assistant messages. Model output is untrusted: the HTML is sanitized, raw HTML in the
 * source is dropped, and HTTP(S) links open in the right-hand reader. Code blocks carry a Copy
 * button; clicks are handled by delegation, and the text goes to the clipboard through main.
 */
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { type MouseEvent, memo, useMemo } from "react";
import { report, useStore } from "./store";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

const marked = new Marked({ gfm: true, breaks: true, async: false });
marked.use({
	renderer: {
		html: () => "",
		code: ({ text, lang }) => {
			const language = lang?.match(/^\S+/)?.[0];
			const code = `<code${language === undefined ? "" : ` class="language-${escapeHtml(language)}"`}>${escapeHtml(text)}</code>`;
			return `<div class="code-block"><button type="button" class="code-copy">${escapeHtml(t("Copy"))}</button><pre>${code}</pre></div>\n`;
		},
	},
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
	if (node.tagName === "A") {
		node.setAttribute("target", "_blank");
		node.setAttribute("rel", "noreferrer");
	}
});

/** Keep completed block DOM intact as a later block streams (selection and Copy survive). */
const MarkdownBlock = memo(function MarkdownBlock({ source, language, streaming }: { source: string; language: string; streaming: boolean }) {
    const html = useMemo(() => {
        const clean = DOMPurify.sanitize(marked.parse(source) as string, { FORBID_TAGS: ["style", "img"], FORBID_ATTR: ["style"] });
        if (!streaming) return clean;
        // A bare URL at the live edge may still be incomplete. Closed Markdown links remain usable.
        const template = document.createElement("template");
        template.innerHTML = clean;
        for (const link of template.content.querySelectorAll("a")) {
            const href = link.getAttribute("href");
            if (href && source.trimEnd().endsWith(href)) link.replaceWith(document.createTextNode(link.textContent ?? href));
        }
        return template.innerHTML;
    }, [source, language, streaming]);
    return <div className="markdown-block" dangerouslySetInnerHTML={{ __html: html }} />;
});

export function Markdown({ text, streaming = false }: { readonly text: string; readonly streaming?: boolean }) {
    const language = useStore((state) => state.settings?.language ?? "en");
    const blocks = useMemo(() => {
        // Reference definitions can affect earlier paragraphs; parse those documents as a unit.
        if (/^ {0,3}\[[^\]]+\]:/m.test(text)) return [text];
        return marked.lexer(text).filter(token => token.type !== "space").map(token => token.raw);
    }, [text]);
    return <div className="markdown" onClick={copyCode}>{blocks.map((source, index) =>
        <MarkdownBlock key={index} source={source} language={language} streaming={streaming && index === blocks.length - 1} />
    )}</div>;
}

function copyCode(event: MouseEvent<HTMLDivElement>): void {
	if (!(event.target instanceof Element)) return;
	const link = event.target.closest("a");
	if (link) { event.preventDefault(); openWebPage(link.href); return; }
	const button = event.target.closest(".code-copy");
	const code = button?.parentElement?.querySelector("pre")?.textContent;
	if (button === null || button === undefined || code === undefined || code === null) return;
	window.openbot
		.copyText(code)
		.then(() => {
			button.textContent = t("Copied");
			setTimeout(() => (button.textContent = t("Copy")), 1500);
		})
		.catch(report);
}

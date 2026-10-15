/**
 * GitHub-flavored Markdown for assistant messages. Model output is untrusted: the HTML is sanitized, raw HTML in the
 * source is dropped, and links open in the user's browser through main's window-open handler.
 */
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { useMemo } from "react";

const marked = new Marked({ gfm: true, breaks: true, async: false });
marked.use({ renderer: { html: () => "" } });

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
	return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

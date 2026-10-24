import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import { t } from "../i18n";
import { api, report } from "../store";
import { useReader } from "../reader-store";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [
	rehypeSlug,
	[rehypeHighlight, { detect: false, ignoreMissing: true }],
	[rehypeKatex, { throwOnError: false, strict: "ignore", trust: false }],
] as ComponentProps<typeof ReactMarkdown>["rehypePlugins"];
function relativePath(href: string, base: string): string | undefined {
	if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//") || href.startsWith("/")) return;
	try {
		const url = new URL(href, `https://workspace/${base}`);
		return decodeURIComponent(url.pathname.slice(1));
	} catch {
		return;
	}
}
function CodeBlock({ children, ...props }: ComponentProps<"pre">) {
	const pre = useRef<HTMLPreElement>(null),
		[copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const id = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(id);
	}, [copied]);
	return (
		<div className="reader-code">
			<button
				onClick={() =>
					void window.openbot
						.copyText(pre.current?.textContent ?? "")
						.then(() => setCopied(true))
						.catch(report)
				}
			>
				{t(copied ? "Copied" : "Copy")}
			</button>
			<pre {...props} ref={pre}>
				{children}
			</pre>
		</div>
	);
}
function LocalImage({ src, alt, load }: { src?: string | undefined; alt?: string | undefined; load: (src: string) => Promise<string> }) {
	const [url, setUrl] = useState<string>(),
		[failed, setFailed] = useState(false);
	useEffect(() => {
		let active = true;
		setUrl(undefined);
		setFailed(false);
		if (src)
			void load(src)
				.then((value) => {
					if (active) setUrl(value);
				})
				.catch(() => {
					if (active) setFailed(true);
				});
		return () => {
			active = false;
		};
	}, [src, load]);
	return url && !failed ? (
		<img src={url} alt={alt ?? ""} loading="lazy" onError={() => setFailed(true)} />
	) : (
		<span className="reader-image-placeholder">
			{alt || t("Image")} · {t(failed ? "Image unavailable offline" : "Loading image…")}
		</span>
	);
}
export default function MarkdownReader({ text, zoom, workspacePath }: { text: string; zoom: number; workspacePath?: string | undefined }) {
	const article = useRef<HTMLElement>(null),
		[outline, setOutline] = useState<{ id: string; label: string; depth: number }[]>([]);
	const loadImage = useMemo(() => {
		let line = Promise.resolve(),
			count = 0,
			bytes = 0;
		const cache = new Map<string, Promise<string>>();
		return (src: string): Promise<string> => {
			const previous = cache.get(src);
			if (previous) return previous;
			if (++count > 32) return Promise.reject(Error("Image limit"));
			const work = line.then(async () => {
				if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(src)) {
					bytes += src.length * 0.75;
					if (bytes > 8 * 1024 * 1024) throw Error("Image limit");
					return src;
				}
				const path = workspacePath ? relativePath(src, workspacePath) : undefined;
				if (!path) throw Error("Offline image");
				const file = await api["files.read"]({ path });
				bytes += file.bytes;
				if (!file.mediaType.startsWith("image/") || !file.base64 || bytes > 8 * 1024 * 1024) throw Error("Invalid image");
				return `data:${file.mediaType};base64,${file.base64}`;
			});
			line = work.then(
				() => {},
				() => {},
			);
			cache.set(src, work);
			return work;
		};
	}, [text, workspacePath]);
	useEffect(() => {
		setOutline(
			[...(article.current?.querySelectorAll("h1,h2,h3") ?? [])]
				.slice(0, 120)
				.map((node) => ({ id: node.id, label: node.textContent ?? "", depth: Number(node.tagName[1]) })),
		);
	}, [text]);
	const components = useMemo<ComponentProps<typeof ReactMarkdown>["components"]>(
		() => ({
			pre: ({ node, ...props }) => <CodeBlock {...props} />,
			table: ({ node, ...props }) => (
				<div className="reader-table-scroll">
					<table {...props} />
				</div>
			),
			img: ({ src, alt }) => <LocalImage src={src} alt={alt} load={loadImage} />,
			a: ({ node, href, children, ...props }) => (
				<a
					{...props}
					href={href}
					target={href?.startsWith("https://") ? "_blank" : undefined}
					rel="noreferrer"
					onClick={(event) => {
						if (href?.startsWith("#")) {
							event.preventDefault();
							try {
								const id = decodeURIComponent(href.slice(1));
								article.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
							} catch {}
							return;
						}
						const path = href && workspacePath ? relativePath(href, workspacePath) : undefined;
						if (path) {
							event.preventDefault();
							useReader.setState({ selection: { kind: "workspace", path, name: path.split("/").at(-1) ?? path } });
						} else if (!href?.startsWith("https://")) event.preventDefault();
					}}
				>
					{children}
				</a>
			),
		}),
		[loadImage, workspacePath],
	);
	return (
		<div className="markdown-reader">
			{outline.length > 1 && (
				<details className="reader-outline">
					<summary>{t("On this page")}</summary>
                    <nav aria-label={t("Document outline")}>
					{outline.map((item) => (
						<button
							key={item.id}
							className={`outline-depth-${item.depth}`}
							onClick={() => article.current?.querySelector(`[id="${CSS.escape(item.id)}"]`)?.scrollIntoView({ block: "start" })}
						>
							{item.label}
						</button>
					))}
                    </nav>
				</details>
			)}
			<article ref={article} className="reading-prose" style={{ fontSize: (16 * zoom) / 100 }}>
				<ReactMarkdown
					skipHtml
					remarkPlugins={remarkPlugins}
					rehypePlugins={rehypePlugins}
					components={components}
					urlTransform={(url) => (/^(?:javascript|vbscript|file|app|preview):/i.test(url) ? "" : url)}
				>
					{text}
				</ReactMarkdown>
			</article>
		</div>
	);
}

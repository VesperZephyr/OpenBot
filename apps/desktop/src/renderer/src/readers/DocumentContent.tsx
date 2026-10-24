import ImageReader from "./ImageReader";
import { lazy, Suspense } from "react";
import type { ReaderFile } from "@openbot/protocol";
import { ReaderLoading } from "../FileWorkspace";
const MarkdownReader = lazy(() => import("./MarkdownReader"));
const HtmlReader = lazy(() => import("./HtmlReader"));
const PdfReader = lazy(() => import("./PdfReader"));
const CsvReader = lazy(() => import("./CsvReader"));
export default function DocumentContent({
	file,
	source,
	zoom,
	workspacePath,
}: {
	file: ReaderFile;
	source: boolean;
	zoom: number;
	workspacePath?: string | undefined;
}) {
	const text = file.text ?? "";
	return (
		<Suspense fallback={<ReaderLoading />}>
			{source ? (
				<pre className="reader-source" style={{ fontSize: (14 * zoom) / 100 }}>
					{text}
				</pre>
			) : file.mediaType === "text/markdown" ? (
				<MarkdownReader text={text} zoom={zoom} workspacePath={workspacePath} />
			) : file.mediaType === "text/html" ? (
				<HtmlReader html={text} zoom={zoom} />
			) : file.mediaType === "application/pdf" ? (
				<PdfReader base64={file.base64 ?? ""} zoom={zoom} />
			) : file.mediaType.startsWith("image/") ? (
				<ImageReader file={file} zoom={zoom} />
			) : file.mediaType === "text/csv" ? (
				<CsvReader text={text} zoom={zoom} />
			) : (
				<pre className="reader-source" style={{ fontSize: (14 * zoom) / 100 }}>
					{text}
				</pre>
			)}
		</Suspense>
	);
}

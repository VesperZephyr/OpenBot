import { useMemo, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { t } from "../i18n";
import { ReaderLoading } from "../FileWorkspace";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const localAsset = (directory: string) => new URL(`/pdfjs/${directory}/`, window.location.href).href;
const options = {
	isEvalSupported: false,
	enableXfa: false,
	cMapUrl: localAsset("cmaps"),
	cMapPacked: true,
	standardFontDataUrl: localAsset("standard_fonts"),
	wasmUrl: localAsset("wasm"),
	iccUrl: localAsset("iccs"),
	useWasm: false,
};
export default function PdfReader({ base64, zoom }: { base64: string; zoom: number }) {
	// Effect-based PDF loading keeps binary ownership stable before the first page commits.
	const data = useMemo(() => ({ data: Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)) }), [base64]);
	const [pages, setPages] = useState(0),
		[page, setPage] = useState(1),
		[error, setError] = useState(false);
	return (
		<div className="pdf-reader">
			<div className="pdf-controls">
				<button aria-label={t("Previous page")} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
					←
				</button>
				<span>{t("Page {page} of {total}", { page, total: pages || "…" })}</span>
				<button aria-label={t("Next page")} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
					→
				</button>
			</div>
			{error ? (
				<p role="alert">{t("Could not render this PDF")}</p>
			) : (
				<Document
					suspense={false}
					file={data}
					options={options}
					loading={<ReaderLoading />}
					onLoadSuccess={({ numPages }) => {
						setPages(numPages);
						setPage(1);
					}}
					onLoadError={() => setError(true)}
					onPassword={(_callback, reason) => {
						if (reason) setError(true);
					}}
				>
					<Page
						suspense={false}
						pageNumber={page}
						scale={zoom / 100}
						loading={<ReaderLoading />}
						renderAnnotationLayer={false}
						renderTextLayer
					/>
				</Document>
			)}
		</div>
	);
}

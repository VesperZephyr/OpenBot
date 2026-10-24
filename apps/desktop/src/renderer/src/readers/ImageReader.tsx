import { useState } from "react";
import type { ReaderFile } from "@openbot/protocol";
import { t } from "../i18n";
import { ReaderLoading } from "../FileWorkspace";
export default function ImageReader({ file, zoom }: { file: ReaderFile; zoom: number }) {
	const [loaded, setLoaded] = useState(false),
		[failed, setFailed] = useState(false);
	return (
		<div className="reader-image">
			{failed ? (
				<p role="alert">{t("Could not display this image")}</p>
			) : (
				<>
					{!loaded && <ReaderLoading />}
					<img
						src={`data:${file.mediaType};base64,${file.base64}`}
						alt={file.name}
						style={{ zoom: zoom / 100, display: loaded ? undefined : "none" }}
						onLoad={() => setLoaded(true)}
						onError={() => setFailed(true)}
					/>
				</>
			)}
		</div>
	);
}

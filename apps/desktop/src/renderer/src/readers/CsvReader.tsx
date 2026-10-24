import { useMemo } from "react";
import Papa from "papaparse";
import { t } from "../i18n";
export default function CsvReader({ text, zoom }: { text: string; zoom: number }) {
	const result = useMemo(() => Papa.parse<string[]>(text, { preview: 501, skipEmptyLines: true }), [text]);
	return (
		<div className="csv-reader" style={{ fontSize: (14 * zoom) / 100 }}>
			{(result.meta.truncated || result.data.length > 500) && (
				<p role="status">{t("Showing the first 500 rows. Source view contains the complete file.")}</p>
			)}
			{result.errors.length > 0 && <p role="status">{t("Some CSV rows could not be parsed. Check Source for the original text.")}</p>}
			<div className="reader-table-scroll">
				<table>
					<tbody>
						{result.data.slice(0, 500).map((row, index) => (
							<tr key={index}>
								<th scope="row">{index + 1}</th>
								{row.slice(0, 100).map((cell, column) => (index === 0 ? <th key={column}>{cell}</th> : <td key={column}>{cell}</td>))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{result.data.some((row) => row.length > 100) && <p role="status">{t("Showing the first 100 columns.")}</p>}
		</div>
	);
}

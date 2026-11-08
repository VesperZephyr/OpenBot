/**
 * The wizard's optional personality is one trailing paragraph.
 * A later save replaces that paragraph instead of appending another copy.
 */
export function instructionsWithPersonality(current: string, personality: string, previouslyApplied: string): string {
	const line = personality.trim();
	const previous = previouslyApplied.trim();
	let baseline = current.replace(/\s+$/, "");
	if (previous !== "") {
		const suffix = `\n\n${previous}`;
		if (baseline.endsWith(suffix)) baseline = baseline.slice(0, -suffix.length).replace(/\s+$/, "");
	}
	if (line === "") return baseline;
	if (baseline === line || baseline.endsWith(`\n\n${line}`)) return baseline;
	return baseline === "" ? line : `${baseline}\n\n${line}`;
}

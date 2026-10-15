/** Byte budgets for what one invocation returns to the model. */
export const READ_MAX_BYTES = 24 * 1024;
export const COMMAND_MAX_BYTES = 24 * 1024;

/** Longest prefix of `text` that fits `maxBytes` in UTF-8, cut at a line end when one is near. */
export function headWithin(text: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
	if (Buffer.byteLength(text) <= maxBytes) return { text, truncated: false };
	const cut = Buffer.from(text).subarray(0, maxBytes).toString("utf8").replace(/\uFFFD$/, "");
	const lastLine = cut.lastIndexOf("\n");
	return { text: lastLine > maxBytes / 2 ? cut.slice(0, lastLine + 1) : cut, truncated: true };
}

/** Head and tail of `text` within `maxBytes`, keeping more of the tail where errors usually are. */
export function headAndTailWithin(text: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
	const bytes = Buffer.from(text);
	if (bytes.length <= maxBytes) return { text, truncated: false };
	const headBytes = Math.floor(maxBytes * 0.45);
	const tailBytes = maxBytes - headBytes;
	const head = bytes.subarray(0, headBytes).toString("utf8").replace(/\uFFFD$/, "");
	const tail = bytes.subarray(bytes.length - tailBytes).toString("utf8").replace(/^\uFFFD/, "");
	const omitted = bytes.length - headBytes - tailBytes;
	return { text: `${head}\n[... ${omitted} bytes omitted ...]\n${tail}`, truncated: true };
}

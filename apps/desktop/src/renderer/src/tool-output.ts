const MODEL_DENIAL_PREFIX = "The user denied this ";

/** The denial sentence is model-facing. The card shows Denied; the stored output is unchanged. */
export function displayToolOutput(
	tool: string,
	output: string | undefined,
	executionError: string | undefined,
	translate: (text: string) => string,
): string | undefined {
	let shown = output;
	if (isModelDenial(shown)) shown = translate("Denied");
	if (tool === "codemode" && executionError) shown = translate(executionError);
	if (!shown?.startsWith("{")) return shown;
	try {
		const result = JSON.parse(shown) as { ok?: unknown; error?: { message?: unknown } };
		const message = result.ok === false && typeof result.error?.message === "string" ? result.error.message : undefined;
		if (message && isModelDenial(message)) return translate("Denied");
		if (message && tool.startsWith("app_")) return translate(message);
	} catch {
		/* Interrupted tools may not have a complete result envelope. */
	}
	return shown;
}

function isModelDenial(text: string | undefined): boolean {
	return text?.startsWith(MODEL_DENIAL_PREFIX) === true;
}

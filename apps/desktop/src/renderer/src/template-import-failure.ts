const DEFINITE_TEMPLATE_IMPORT_CODES = new Set(["invalid_request", "request_conflict", "not_found"]);

/**
 * A definite import failure drops the pending request and re-inspects the template.
 * Any other failure stays uncertain so the same request can be reconciled.
 */
export async function recoverTemplateImportFailure<Review>(input: {
	readonly code: string | undefined;
	readonly uncertain: boolean;
	readonly clearPending: () => void;
	readonly reinspect: () => Promise<Review | undefined>;
}): Promise<{ readonly kind: "reinspect"; readonly review: Review | undefined } | { readonly kind: "uncertain" }> {
	if (input.code !== undefined && DEFINITE_TEMPLATE_IMPORT_CODES.has(input.code) && !input.uncertain) {
		input.clearPending();
		return { kind: "reinspect", review: await input.reinspect() };
	}
	return { kind: "uncertain" };
}

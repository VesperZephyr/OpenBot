/**
 * Adding a provider to the user's model configuration file from the app (onboarding's "Other" endpoint). The entry is
 * merged into the existing document: other providers and top-level fields stay as they are, an entry with the same ID
 * is replaced. Keys never enter the file; the Keychain holds them under the provider ID, and a stored key takes
 * precedence over any configured one.
 */
import { type HostParams, ProtocolError } from "@openbot/protocol";

export type CustomProvider = HostParams<"models.addProvider">;

export function mergeProvider(text: string | undefined, provider: CustomProvider): string {
	const baseUrl = checkedBaseUrl(provider.baseUrl);
	const modelIds = [...new Set(provider.modelIds.map((id) => id.trim()).filter((id) => id !== ""))];
	if (modelIds.length === 0) throw new ProtocolError("invalid_request", "Name at least one model ID");
	const name = provider.name.trim();
	if (name === "") throw new ProtocolError("invalid_request", "Name the provider");

	const document = parseDocument(text);
	const providers: unknown = document.providers ?? {};
	if (typeof providers !== "object" || providers === null || Array.isArray(providers)) {
		throw new ProtocolError("invalid_request", 'The model configuration\'s "providers" is not an object');
	}
	const entry = { name, baseUrl, api: provider.api, models: modelIds.map((id) => ({ id })) };
	return `${JSON.stringify({ ...document, providers: { ...providers, [provider.id]: entry } }, null, 2)}\n`;
}

function parseDocument(text: string | undefined): { readonly [key: string]: unknown } {
	if (text === undefined || text.trim() === "") return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
	} catch {
		// Rewriting would drop the user's comments; leave such a file to them.
		throw new ProtocolError(
			"invalid_request",
			"The model configuration file has comments or is not plain JSON; add the provider there by hand",
		);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new ProtocolError("invalid_request", "The model configuration file is not a JSON object");
	}
	return Object.fromEntries(Object.entries(parsed));
}

function checkedBaseUrl(raw: string): string {
	const url = URL.parse(raw.trim());
	if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) {
		throw new ProtocolError("invalid_request", "The base URL must start with http:// or https://");
	}
	if (url.username !== "" || url.password !== "") {
		throw new ProtocolError("invalid_request", "Put the key in the API key field, not in the base URL");
	}
	return raw.trim().replace(/\/+$/, "");
}

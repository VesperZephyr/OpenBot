import type { BotRuntime, ModelConfigStatus } from "@openbot/agent-runtime";
import { CONNECTOR_CREDENTIAL_PREFIX, ProtocolError, type HostParams, type RedactedSettings } from "@openbot/protocol";
import type { ModelConfigFile, SecretStore } from "./host-ports.ts";
import { mergeProvider } from "./model-providers.ts";
import { SEARCH_PROVIDER_PREFIX, TAVILY_PROVIDER_ID } from "./web-search.ts";

export type SettingsHost = {
	readonly runtime: BotRuntime;
	readonly secrets: SecretStore;
	readonly modelConfig: ModelConfigFile;
	readonly dataDirectory: string;
	readonly workspace: string;
	configStatus(): ModelConfigStatus;
	setConfigStatus(status: ModelConfigStatus): void;
	configWrites(): Promise<unknown>;
	setConfigWrites(writes: Promise<unknown>): void;
};

export async function reloadModelConfig(host: SettingsHost): Promise<void> {
	let text: string | undefined;
	try {
		text = await host.modelConfig.read();
	} catch (error) {
		host.runtime.reloadConfiguredProviders(undefined, host.modelConfig.environment);
		host.setConfigStatus({ providers: [], errors: [error instanceof Error ? error.message : String(error)] });
		return;
	}
	host.setConfigStatus(host.runtime.reloadConfiguredProviders(text, host.modelConfig.environment));
}

/** A built-in id that the file does not declare. Overlays are edits of a built-in, so they stay allowed. */
export function isBuiltinProviderId(host: SettingsHost, id: string): boolean {
	const declared = new Set(host.configStatus().providers.filter((entry) => !entry.overlay).map((entry) => entry.providerId));
	return host.runtime.listProviders().some(({ providerId }) => providerId === id && !declared.has(providerId));
}

export async function redactedSettings(host: SettingsHost): Promise<RedactedSettings> {
	await reloadModelConfig(host);
	const stored = await host.secrets.configuredProviders();
	const fromConfig = new Map(host.configStatus().providers.map((provider) => [provider.providerId, provider]));
	const defaultModel = await host.runtime.defaultModel();
	return {
		setupComplete: await host.runtime.setupComplete(),
		language: await host.runtime.language(),
		languageChosen: await host.runtime.languageChosen(),
		...(defaultModel === undefined ? {} : { defaultModel }),
		providers: host.runtime
			.listProviders()
			.filter(({ providerId }) => !providerId.startsWith(SEARCH_PROVIDER_PREFIX) && !providerId.startsWith(CONNECTOR_CREDENTIAL_PREFIX))
			.map(({ providerId, name }) => {
				const configured = fromConfig.get(providerId);
				const keyStored = stored.has(providerId);
				// An overlay without its own `apiKey` still needs a stored key: the Host clears provider variables.
				const keyFromConfig = configured?.keyAvailable === true && !(configured.overlay && !configured.keyConfigured);
				return {
					providerId,
					name,
					source: configured === undefined ? ("builtin" as const) : ("config" as const),
					overlay: configured?.overlay ?? false,
					configured: keyStored || keyFromConfig,
					keyStored,
				};
			}),
		dataDirectory: host.dataDirectory,
		modelConfig: { path: host.modelConfig.path, errors: host.configStatus().errors },
		workspace: host.workspace,
		webSearch: { provider: "tavily", configured: stored.has(TAVILY_PROVIDER_ID) },
	};
}

export async function updateSettings(host: SettingsHost, params: HostParams<"settings.update">): Promise<RedactedSettings> {
	const { defaultModel, setupComplete, language, languageChosen } = params;
	if (language !== undefined) await host.runtime.setLanguage(language, languageChosen === true);
	if (setupComplete !== undefined) await host.runtime.setSetupComplete(setupComplete);
	if (defaultModel !== undefined) await host.runtime.setDefaultModel(defaultModel);
	return redactedSettings(host);
}

export async function listModels(host: SettingsHost) {
	await reloadModelConfig(host);
	return host.runtime.listChatModels().filter((model) => !model.provider.startsWith(SEARCH_PROVIDER_PREFIX));
}

export function credentialStatus(secrets: SecretStore) {
	if (!secrets.status) throw new ProtocolError("host_unavailable", "Credential storage is unavailable");
	return secrets.status();
}

export function migrateCredentials(secrets: SecretStore) {
	if (!secrets.migrate) throw new ProtocolError("host_unavailable", "Credential storage is unavailable");
	return secrets.migrate();
}

export async function setCredential(host: SettingsHost, params: HostParams<"credentials.set">): Promise<RedactedSettings> {
	if (params.apiKey.trim() === "") throw new ProtocolError("invalid_request", "API key is empty");
	await host.secrets.setApiKey(params.providerId, params.apiKey.trim());
	return redactedSettings(host);
}

export async function deleteCredential(host: SettingsHost, params: HostParams<"credentials.delete">): Promise<RedactedSettings> {
	await host.secrets.deleteApiKey(params.providerId);
	return redactedSettings(host);
}

export async function testModel(host: SettingsHost, params: HostParams<"models.test">) {
	const { secret, ...model } = params;
	await reloadModelConfig(host);
	return host.runtime.testModel(model, undefined, secret);
}

export async function addModelProvider(host: SettingsHost, provider: HostParams<"models.addProvider">): Promise<RedactedSettings> {
	if (provider.secret !== undefined && provider.verify !== true) {
		throw new ProtocolError("invalid_request", "Send a key only when verifying a provider");
	}
	if (provider.verify === true) {
		await reloadModelConfig(host);
		if (isBuiltinProviderId(host, provider.id)) throw new ProtocolError("invalid_request", "This is a built-in provider; choose another ID");
		const modelId = provider.modelIds.map((id) => id.trim()).find((id) => id !== "");
		if (modelId === undefined) throw new ProtocolError("invalid_request", "Name at least one model ID");
		const tested = await host.runtime.testProvider(
			{
				id: provider.id,
				name: provider.name.trim(),
				baseUrl: provider.baseUrl.trim().replace(/\/+$/, ""),
				api: provider.api,
				modelId,
				...(provider.secret === undefined ? {} : { secret: provider.secret }),
			},
			host.modelConfig.environment,
		);
		if (!tested.ok) throw new ProtocolError("invalid_request", tested.error ?? "Connection failed. Check your model settings.");
	}
	const next = host.configWrites().catch(() => {}).then(async () => {
		await reloadModelConfig(host);
		if (isBuiltinProviderId(host, provider.id)) throw new ProtocolError("invalid_request", "This is a built-in provider; choose another ID");
		const merged = mergeProvider(await host.modelConfig.read(), provider);
		const secret = provider.verify === true && provider.secret !== undefined && provider.secret.trim() !== "" ? provider.secret.trim() : undefined;
		const previousKey = secret === undefined ? undefined : await host.secrets.getApiKey(provider.id);
		if (secret !== undefined) await host.secrets.setApiKey(provider.id, secret);
		try {
			await host.modelConfig.write(merged);
		} catch (error) {
			if (secret !== undefined) {
				if (previousKey === undefined) await host.secrets.deleteApiKey(provider.id);
				else await host.secrets.setApiKey(provider.id, previousKey);
			}
			throw error;
		}
		return redactedSettings(host);
	});
	host.setConfigWrites(next);
	return next;
}

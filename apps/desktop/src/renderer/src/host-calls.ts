import type { OpenBotApi } from "../../shared/api";

export type HostCalls = OpenBotApi["methods"];

/**
 * contextBridge deep-freezes `window.openbot.methods`, so assigning a method
 * there does not change the function the UI invokes. This table starts as a
 * forwarder and is what the renderer calls.
 */
export function hostCalls(real: HostCalls): HostCalls {
	const slots = new Map<PropertyKey, unknown>();
	for (const name of Object.keys(real)) {
		const call = real[name as keyof HostCalls] as (params: never) => Promise<unknown>;
		slots.set(name, (params: never) => call(params));
	}
	return new Proxy({} as HostCalls, {
		get: (_target, property) => slots.get(property),
		set: (_target, property, value) => {
			slots.set(property, value);
			return true;
		},
	});
}

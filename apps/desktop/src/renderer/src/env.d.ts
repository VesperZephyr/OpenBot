import type { OpenBotApi } from "../../shared/api";

declare global {
	interface Window {
		readonly openbot: OpenBotApi;
		/** Mutable forwarder the renderer calls. contextBridge freezes `openbot.methods`. */
		openbotCalls: OpenBotApi["methods"];
	}
}

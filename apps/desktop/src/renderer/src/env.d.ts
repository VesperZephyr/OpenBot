import type { OpenBotApi } from "../../shared/api";

declare global {
	interface Window {
		readonly openbot: OpenBotApi;
	}
}

/** Test overrides require isolated data and are never honored by an installed app. */
export function desktopTestMode(isPackaged: boolean, env: NodeJS.ProcessEnv): "background" | "headed" | undefined {
	if (isPackaged || !env.OPENBOT_DATA_DIR) return undefined;
	return env.OPENBOT_E2E_MODE === "background" || env.OPENBOT_E2E_MODE === "headed" ? env.OPENBOT_E2E_MODE : undefined;
}

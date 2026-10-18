import { defineDoc } from "@earendil-works/pi-durable";
import type { AppExecution } from "@openbot/protocol";
export const AppExecutionsDoc = defineDoc<{ executions: Record<string, AppExecution> }>({
	kind: "openbot.app-executions",
	version: 1,
	scope: "session",
	initial: () => ({ executions: {} }),
});

import type { ExecutionObservation, ActivityLabel } from "@openbot/protocol";

export function fixedActivity(observation?: ExecutionObservation): ActivityLabel {
	if (!observation || observation.phase === "preparing") return "preparing";
	if (observation.phase === "generating") return "generating";
	if (observation.phase === "dispatching") return observation.family ?? "waiting_result";
	return "waiting_result";
}

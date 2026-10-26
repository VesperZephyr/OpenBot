/** Shared schemas for the original management tools and their Code Mode aliases. */
import { Type, type TSchema } from "typebox";
import type { ToolDefinition } from "./index.ts";
const string = (description: string) => ({ type: "string", description });
const integer = (description: string) => ({ type: "integer", minimum: 1, description });
const object = (properties: Record<string, unknown>, required: readonly string[]) => ({
	type: "object",
	properties,
	required,
	additionalProperties: false,
});
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const botFields = {
	name: nullable({ type: "string", minLength: 1, maxLength: 100 }),
	role: nullable({ type: "string", maxLength: 500 }),
	instructions: nullable({ type: "string", maxLength: 32000 }),
	model: nullable(
		object({ provider: string("Configured provider ID."), modelId: string("Configured model ID.") }, ["provider", "modelId"]),
	),
	thinkingLevel: nullable({ type: "string", enum: ["off", "low", "medium", "high"] }),
};
const groupFields = {
	name: { type: "string", minLength: 1, maxLength: 100 },
	objective: { type: "string", maxLength: 4000 },
	memberIds: { type: "array", items: string("Existing Bot ID"), minItems: 2, maxItems: 6, uniqueItems: true },
	leadBotId: string("Member with the lead role; ordinary messages always go to Core"),
};
export const MANAGEMENT_TOOL_DEFINITIONS = [
	{
		name: "group_inspect",
		capability: "group.management",
		destination: "host",
		description:
			"Core direct chat only. List local groups and revisions, or inspect one group. Does not read private Bot conversations. Use bot_inspect to find existing members.",
		parameters: object({ groupId: nullable(string("Group ID, or null to list")) }, []),
	},
	{
		name: "group_create",
		capability: "group.management",
		destination: "host",
		description:
			"Core direct chat only. Create a group of 2–6 existing Bots at the user's explicit request. Requires exact user approval. Never create Bots automatically. Do not retry a denied change.",
		parameters: object(groupFields, Object.keys(groupFields)),
	},
	{
		name: "group_update",
		capability: "group.management",
		destination: "host",
		description:
			"Core direct chat only. Replace group details, members and lead at the user's request. Inspect first, supply current revision and complete fields. Removing a member stops its group tasks. Requires exact approval.",
		parameters: object({ ...groupFields, groupId: string("Group ID"), expectedRevision: integer("Current revision") }, [
			...Object.keys(groupFields),
			"groupId",
			"expectedRevision",
		]),
	},
	{
		name: "group_dissolve",
		capability: "group.management",
		destination: "host",
		description:
			"Core direct chat only. Dissolve a group at the user's request after inspecting its revision. Requires approval, stops group work and retains read-only local history. Does not delete Bots.",
		parameters: object({ groupId: string("Group ID"), expectedRevision: integer("Current revision") }, ["groupId", "expectedRevision"]),
	},

	{
		name: "bot_inspect",
		capability: "bot.management",
		destination: "host",
		description:
			"Core only. Inspect the user's Bots and current revisions. Listing omits instructions; select a Bot ID to read its full profile. Omit botId or pass null to list live Bots. Inspect before updating or deleting a Specialist.",
		parameters: object({ botId: nullable(string("Bot ID to inspect, or null to list.")) }, []),
	},
	{
		name: "bot_create",
		capability: "bot.management",
		destination: "host",
		description:
			"Core only. Create one Specialist when the user explicitly requests it. Waits for user approval. Never create Bots proactively. Name is required; null or omitted fields use defaults: empty role/instructions, default model/thinking. Starts with empty memory. Do not retry a denied request.",
		parameters: object({ ...botFields, name: { type: "string", minLength: 1, maxLength: 100 } }, ["name"]),
	},
	{
		name: "bot_update",
		capability: "bot.management",
		destination: "host",
		description:
			"Core only. Update a Specialist at the user's request, with approval. Inspect first and supply the current revision. Null or omitted fields are UNCHANGED; empty role/instructions clears that text. model selects an override; useDefaultModel=true removes the override. Cannot edit Core, memory, identity or permissions. Do not retry a denied request.",
		parameters: object(
			{
				...botFields,
				botId: string("Specialist ID from bot_inspect."),
				expectedRevision: integer("Current revision from bot_inspect."),
				useDefaultModel: nullable({ type: "boolean", description: "True removes the model override; false/null leaves it unchanged." }),
			},
			["botId", "expectedRevision"],
		),
	},
	{
		name: "bot_delete",
		capability: "bot.management",
		destination: "host",
		description:
			"Core only. Delete a Specialist at the user's request, with approval. Inspect first. Stops its work and background commands, removes it from the roster and retains local history. Cannot delete Core. Do not retry a denied request.",
		parameters: object(
			{ botId: string("Specialist ID from bot_inspect."), expectedRevision: integer("Current revision from bot_inspect.") },
			["botId", "expectedRevision"],
		),
	},
] as const satisfies readonly ToolDefinition[];

const strict = (properties: Record<string, TSchema>) => Type.Object(properties, { additionalProperties: false });
const text = Type.String();
const revision = Type.Integer({ minimum: 1 });
const profile = strict({
	defaultSkills: Type.Optional(Type.Array(strict({ name: text, revision, sha256: text }), { maxItems: 2 })),
	botId: text,
	name: text,
	role: text,
	instructions: Type.Optional(text),
	revision,
	kind: Type.Enum(["core", "specialist"]),
	status: Type.Enum(["active", "hidden", "deleted"]),
	pinned: Type.Boolean(),
	createdAt: Type.Number(),
	model: Type.Optional(strict({ provider: text, modelId: text })),
	thinkingLevel: Type.Optional(Type.Enum(["off", "low", "medium", "high"])),
});
const group = strict({
	groupId: text,
	name: text,
	objective: text,
	memberIds: Type.Array(text),
	leadBotId: Type.Union([text, Type.Null()]),
	revision,
	deliveryRevision: Type.Optional(revision),
	status: Type.Enum(["active", "dissolved"]),
	createdAt: Type.Number(),
});
export const legacyManagementName = (name: string) => name.replace(/^app_bots_/, "bot_").replace(/^app_groups_/, "group_");
export const APP_MANAGEMENT_CAPABILITIES = MANAGEMENT_TOOL_DEFINITIONS.map((d) => {
	const [family, action] = d.name.split("_") as ["bot" | "group", string];
	const value =
		action === "inspect"
			? Type.Array(family === "bot" ? profile : group)
			: family === "bot"
				? strict({ action: Type.Enum(["create", "update", "delete"]), bot: profile })
				: group;
	return {
		id: `${family}s.${action}`,
		version: 1,
		effect: action === "inspect" ? "read" : ["delete", "dissolve"].includes(action) ? "destructive" : "write",
		inputSchema: d.parameters as TSchema,
		outputSchema: Type.Union([
			strict({ ok: Type.Literal(true), value }),
			strict({
				ok: Type.Literal(false),
				error: strict({
					code: Type.Enum([
						"invalid_request",
						"permission_denied",
						"not_found",
						"conflict",
						"cancelled",
						"outcome_unknown",
						"resource_limit",
					]),
					message: Type.String({ maxLength: 200 }),
				}),
			}),
		]),
		audiences: ["core-direct"],
		approval: action === "inspect" ? "none" : "exact-change",
		replay: action === "inspect" ? "read-result" : "mutation-receipt",
		maxResultBytes: 32768,
		description: d.description,
	};
});
export const APP_MANAGEMENT_TOOL_DEFINITIONS: readonly ToolDefinition[] = MANAGEMENT_TOOL_DEFINITIONS.map((d, i) => ({
	...d,
	name: `app_${d.name.replace(/^bot_/, "bots_").replace(/^group_/, "groups_")}`,
	description: `${d.description} Returns {ok:true,value} or {ok:false,error}. Check ok. Each mutation waits for exact approval; failure closes management for this script. Completed changes are not rolled back.`,
	resultSchema: APP_MANAGEMENT_CAPABILITIES[i]!.outputSchema as unknown as Record<string, unknown>,
}));
export const appManagementCapability = (name: string) =>
	APP_MANAGEMENT_CAPABILITIES.find((d) => `app_${d.id.replaceAll(".", "_")}` === name);

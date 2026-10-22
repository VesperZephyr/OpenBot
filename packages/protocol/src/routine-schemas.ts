import { Type } from "typebox";
const strict = <T extends Parameters<typeof Type.Object>[0]>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128 });
const occurrenceId = Type.String({ minLength: 1, maxLength: 256 });
const revision = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const time = Type.String({ pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$" });
const timezone = Type.String({ minLength: 1, maxLength: 80 });
const fields = strict({
	reportInputs: Type.Optional(strict({
		sources: Type.Array(strict({ routineId: id, revision }), { minItems: 1, maxItems: 6, uniqueItems: true }),
		windowHours: Type.Integer({ minimum: 1, maximum: 72 }),
		waitMinutes: Type.Integer({ minimum: 0, maximum: 60 }),
	})),
	reportTo: Type.Optional(strict({ groupId: id, groupRevision: revision })),
	name: Type.String({ minLength: 1, maxLength: 80 }),
	instructions: Type.String({ minLength: 1, maxLength: 16384 }),
	schedule: Type.Union([
		strict({ kind: Type.Literal("interval"), minutes: Type.Integer({ minimum: 5, maximum: 10080 }) }),
		strict({ kind: Type.Literal("daily"), time, timezone }),
		strict({ kind: Type.Literal("weekly"), time, timezone, weekday: Type.Integer({ minimum: 1, maximum: 7 }) }),
	]),
	catchUpHours: Type.Integer({ minimum: 0, maximum: 72 }),
	skills: Type.Array(
		strict({
			name: Type.String({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 64 }),
			revision,
			sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
		}),
		{ maxItems: 2 },
	),
});
export const ROUTINE_SCHEMAS = {
	"routines.list": strict({}),
	"routines.get": strict({ routineId: id, occurrenceId: Type.Optional(occurrenceId) }),
	"routines.change": Type.Union([
		strict({ action: Type.Literal("create"), requestId: id, botId: id, fields }),
		strict({ action: Type.Literal("update"), requestId: id, routineId: id, expectedRevision: revision, fields }),
		strict({
			action: Type.Union([Type.Literal("pause"), Type.Literal("resume"), Type.Literal("delete")]),
			requestId: id,
			routineId: id,
			expectedRevision: revision,
		}),
	]),
	"routines.test": strict({ routineId: id, expectedRevision: revision, requestId: id }),
	"routines.stop": strict({ occurrenceId }),
	"routines.activity": strict({}),
	"routines.presence": strict({ absenceDays: Type.Integer({ minimum: 1, maximum: 30 }), resume: Type.Boolean() }),
};

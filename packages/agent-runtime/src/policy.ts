/** Host-only policy authority. Policy, grants and approval scopes commit in the same Pi transaction. */
import type { Context } from "@earendil-works/chord/context";
import { defineDoc, type Harness, type Tx } from "@earendil-works/pi-durable";
import {
	ProtocolError,
	type AlwaysAllowScope,
	type AskFirstRule,
	type CommandRule,
	type CommandSetting,
	type FolderGrant,
	type GrantAccess,
	type PolicySettings,
	type PolicyReconciliation,
} from "@openbot/protocol";

type Mutable<T> = T extends readonly (infer V)[] ? Mutable<V>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type SettingsData = {
	commandSetting: CommandSetting;
	readOnlyDefault: boolean;
	rules: Record<string, CommandRule>;
	targetId?: string;
	revision?: number;
	askFirst?: Record<string, AskFirstRule>;
	requests?: Record<string, string>;
	reconciliation?: PolicyReconciliation;
	operations?: Record<string, PolicyOperation>;
	before?: Mutable<AuthoritySnapshot>;
};
export type PolicyOperation = {
	id: string;
	botId: string;
	conversationId: string;
	runId?: string;
	tool: string;
	argsJson: string;
	revision: number;
	taskId?: string;
};
export type AuthoritySnapshot = { settings: PolicySettings; grants: readonly FolderGrant[] };
export const PolicyDoc = defineDoc<SettingsData>({
	kind: "openbot.policy",
	version: 1,
	scope: "session",
	initial: () => ({ commandSetting: "ask", readOnlyDefault: true, rules: {} }),
});
export const GrantsDoc = defineDoc<{ version: number; grants: Record<string, FolderGrant> }>({
	kind: "openbot.grants",
	version: 1,
	scope: "session",
	initial: () => ({ version: 0, grants: {} }),
});
export type SavedScope = { readonly scope: AlwaysAllowScope; readonly id: string; readonly createdAt: number };
export interface PolicyStore {
	bind(targetId: string): Promise<void>;
	operations(): Promise<PolicyOperation[]>;
	remember(operation: PolicyOperation): Promise<void>;
	forget(id: string, taskId?: string): Promise<void>;
	snapshot(): Promise<AuthoritySnapshot>;
	settings(): Promise<PolicySettings>;
	update(change: { readonly commandSetting?: CommandSetting; readonly readOnlyDefault?: boolean }): Promise<PolicySettings>;
	deleteRule(id: string): Promise<boolean>;
	grants(): Promise<readonly FolderGrant[]>;
	addGrant(grant: { readonly id: string; readonly path: string; readonly access: GrantAccess; readonly createdAt: number }): Promise<void>;
	revokeGrant(id: string): Promise<boolean>;
	createAsk(rule: AskFirstRule, requestId: string, expectedRevision: number): Promise<void>;
	deleteAsk(id: string, requestId: string, expectedRevision: number): Promise<void>;
	pendingChange(): Promise<{ before: AuthoritySnapshot; reconciliation: PolicyReconciliation } | undefined>;
	settleChange(id: string, confirmed: boolean): Promise<void>;
}
function settings(doc: SettingsData): PolicySettings {
	return {
		commandSetting: doc.commandSetting,
		readOnlyDefault: doc.readOnlyDefault,
		rules: Object.values(doc.rules).sort((a, b) => a.createdAt - b.createdAt),
		revision: doc.revision ?? 0,
		askFirst: Object.values(doc.askFirst ?? {}).sort((a, b) => a.createdAt - b.createdAt),
		...(doc.targetId ? { targetId: doc.targetId } : {}),
		...(doc.reconciliation ? { reconciliation: doc.reconciliation } : {}),
	};
}
function bump(doc: SettingsData): void {
	doc.revision = (doc.revision ?? 0) + 1;
}
export function policyStore(harness: Harness, context: Context): PolicyStore {
	const snapshot = () =>
		harness.commit(
			async (tx) =>
				JSON.parse(
					JSON.stringify({ settings: settings(await tx.doc(PolicyDoc)), grants: Object.values((await tx.doc(GrantsDoc)).grants) }),
				) as AuthoritySnapshot,
			context,
		);
	const mutate = async <T>(fn: (tx: Tx, doc: SettingsData) => Promise<T>): Promise<T> =>
		harness.commit(async (tx) => {
			const doc = await tx.doc(PolicyDoc);
			if (doc.reconciliation && doc.reconciliation.state !== "complete")
				throw new ProtocolError("request_conflict", "Permission changes need reconciliation first");
			const before = JSON.parse(
				JSON.stringify({ settings: settings(doc), grants: Object.values((await tx.doc(GrantsDoc)).grants) }),
			) as Mutable<AuthoritySnapshot>;
			const revision = doc.revision ?? 0,
				result = await fn(tx, doc);
			if ((doc.revision ?? 0) !== revision) {
				doc.before = before;
				doc.reconciliation = { id: `policy:${doc.revision}`, revision: doc.revision!, state: "pending", createdAt: Date.now() };
			}
			return result;
		}, context);
	const request = (doc: SettingsData, id: string, key: string, expected: number): boolean => {
		const previous = doc.requests?.[id];
		if (previous !== undefined) {
			if (previous !== key) throw new ProtocolError("request_conflict", "This policy request has different contents");
			return false;
		}
		if (Object.keys(doc.requests ?? {}).length >= 4096) throw new ProtocolError("invalid_request", "Policy request history is full");
		if ((doc.revision ?? 0) !== expected) throw new ProtocolError("request_conflict", "Policy changed. Reload before saving your draft.");
		return true;
	};
	return {
		bind: (targetId) =>
			harness.commit(async (tx) => {
				const doc = await tx.doc(PolicyDoc);
				if (doc.targetId && doc.targetId !== targetId) throw new ProtocolError("invalid_request", "Policy belongs to another target");
				doc.targetId = targetId;
				doc.revision ??= 0;
				doc.askFirst ??= {};
			}, context),
		operations: async () => Object.values((await harness.snapshot(PolicyDoc, context))?.operations ?? {}),
		remember: (operation) =>
			harness.commit(async (tx) => {
				const doc = await tx.doc(PolicyDoc);
				if ((doc.revision ?? 0) !== operation.revision) throw new ProtocolError("request_conflict", "Permission changed before dispatch");
				doc.operations ??= {};
				const ops = doc.operations;
				if (!ops[operation.id] && Object.keys(ops).length >= 4096)
					throw new ProtocolError("invalid_request", "Too many unreconciled operations");
				ops[operation.id] = operation;
			}, context),
		forget: (id, taskId) =>
			harness.commit(async (tx) => {
				const ops = (await tx.doc(PolicyDoc)).operations;
				if (!ops?.[id]) return;
				if (taskId) ops[id] = { ...ops[id], taskId };
				else delete ops[id];
			}, context),
		snapshot,
		settings: async () => (await snapshot()).settings,
		grants: async () => (await snapshot()).grants,
		update: async (change) => {
			await mutate(async (_tx, doc) => {
				if (
					(change.commandSetting !== undefined && change.commandSetting !== doc.commandSetting) ||
					(change.readOnlyDefault !== undefined && change.readOnlyDefault !== doc.readOnlyDefault)
				) {
					Object.assign(doc, change);
					bump(doc);
				}
			});
			return (await snapshot()).settings;
		},
		deleteRule: (id) =>
			mutate(async (_tx, doc) => {
				if (!doc.rules[id]) return false;
				delete doc.rules[id];
				bump(doc);
				return true;
			}),
		addGrant: (grant) =>
			harness.commit(
				(tx) =>
					saveScope(tx, { scope: { kind: "folder", path: grant.path, access: grant.access }, id: grant.id, createdAt: grant.createdAt }),
				context,
			),
		revokeGrant: (id) =>
			mutate(async (tx, policy) => {
				const doc = await tx.doc(GrantsDoc);
				if (!doc.grants[id]) return false;
				delete doc.grants[id];
				doc.version++;
				bump(policy);
				return true;
			}),
		createAsk: async (rule, requestId, expectedRevision) => {
			// Stable input excludes allocated metadata, so identical renderer retries return the original rule.
			const p = rule.predicate;
			const key = JSON.stringify([
				"create",
				rule.botId ?? null,
				p.tool === "local_exec" ? [p.tool, p.program, p.subcommand ?? null, p.exact ?? null, p.cwd ?? null] : [p.tool, p.path],
			]);
			const existing = (await harness.snapshot(PolicyDoc, context))?.requests?.[requestId];
			if (existing !== undefined) {
				if (existing !== key) throw new ProtocolError("request_conflict", "This policy request has different contents");
				return;
			}
			await mutate(async (_tx, doc) => {
				if (!request(doc, requestId, key, expectedRevision)) return;
				if (!doc.targetId || rule.targetId !== doc.targetId) throw new ProtocolError("invalid_request", "Policy target mismatch");
				if (Object.keys(doc.askFirst ?? {}).length >= 256)
					throw new ProtocolError("invalid_request", "At most 256 Ask first rules are supported");
				bump(doc);
				doc.askFirst ??= {};
				doc.askFirst[rule.id] = { ...rule, revision: doc.revision! };
				doc.requests ??= {};
				doc.requests[requestId] = key;
			});
		},
		deleteAsk: async (id, requestId, expectedRevision) => {
			const key = JSON.stringify(["delete", id]);
			const existing = (await harness.snapshot(PolicyDoc, context))?.requests?.[requestId];
			if (existing !== undefined) {
				if (existing !== key) throw new ProtocolError("request_conflict", "This policy request has different contents");
				return;
			}
			await mutate(async (_tx, doc) => {
				if (!request(doc, requestId, key, expectedRevision)) return;
				if (!doc.askFirst?.[id]) throw new ProtocolError("not_found", "This rule no longer exists");
				delete doc.askFirst[id];
				bump(doc);
				doc.requests ??= {};
				doc.requests[requestId] = key;
			});
		},
		pendingChange: async () => {
			const doc = await harness.snapshot(PolicyDoc, context);
			return doc?.before && doc.reconciliation && doc.reconciliation.state !== "complete"
				? { before: doc.before, reconciliation: doc.reconciliation }
				: undefined;
		},
		settleChange: (id, confirmed) =>
			harness.commit(async (tx) => {
				const doc = await tx.doc(PolicyDoc);
				if (doc.reconciliation?.id !== id) throw new ProtocolError("request_conflict", "Permission change identity changed");
				doc.reconciliation = { ...doc.reconciliation, state: confirmed ? "complete" : "attention" };
				if (confirmed) delete doc.before;
			}, context),
	};
}
/** Returns the resulting revision so Always allow can bind its approval atomically. */
export async function saveScope(tx: Tx, saved: SavedScope): Promise<void> {
	const policy = await tx.doc(PolicyDoc),
		{ scope } = saved;
	if (policy.reconciliation && policy.reconciliation.state !== "complete")
		throw new ProtocolError("request_conflict", "Permission changes need reconciliation first");
	if (scope.kind === "command") {
		const { program, subcommand, exact } = scope.rule;
		if (Object.values(policy.rules).some((rule) => rule.program === program && rule.subcommand === subcommand && rule.exact === exact))
			return;
		policy.rules[saved.id] = {
			id: saved.id,
			program,
			...(subcommand === undefined ? {} : { subcommand }),
			...(exact === undefined ? {} : { exact }),
			createdAt: saved.createdAt,
		};
		bump(policy);
		return;
	}
	const doc = await tx.doc(GrantsDoc),
		existing = Object.values(doc.grants).find((grant) => grant.path === scope.path);
	if (existing && (existing.access === "readwrite" || scope.access === "read")) return;
	doc.version++;
	bump(policy);
	if (existing) doc.grants[existing.id] = { ...existing, access: "readwrite", version: doc.version };
	else doc.grants[saved.id] = { id: saved.id, path: scope.path, access: scope.access, version: doc.version, createdAt: saved.createdAt };
}

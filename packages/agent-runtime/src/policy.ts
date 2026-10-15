/**
 * Command policy and folder grants as Pi session documents (`openbot.policy`, `openbot.grants`, Section 5.3), so they
 * commit atomically with the rest of Host state, including the approval that created a rule or grant. Only Host code
 * writes them, through `PolicyStore`; tools and model output never do.
 */
import type { Context } from "@earendil-works/chord/context";
import { defineDoc, type Harness, type Tx } from "@earendil-works/pi-durable";
import type {
	AlwaysAllowScope,
	CommandRule,
	CommandSetting,
	FolderGrant,
	GrantAccess,
	PolicySettings,
} from "@openbot/protocol";

export const PolicyDoc = defineDoc<{ commandSetting: CommandSetting; readOnlyDefault: boolean; rules: Record<string, CommandRule> }>({
	kind: "openbot.policy",
	version: 1,
	scope: "session",
	initial: () => ({ commandSetting: "ask", readOnlyDefault: true, rules: {} }),
});

/** `version` increases with every change, and each grant keeps the version that created or last widened it. */
export const GrantsDoc = defineDoc<{ version: number; grants: Record<string, FolderGrant> }>({
	kind: "openbot.grants",
	version: 1,
	scope: "session",
	initial: () => ({ version: 0, grants: {} }),
});

/** What **Always allow** saves: the confirmed scope plus the identity and time of the new rule or grant. */
export type SavedScope = { readonly scope: AlwaysAllowScope; readonly id: string; readonly createdAt: number };

/** Every write is one Pi commit. */
export interface PolicyStore {
	settings(): Promise<PolicySettings>;
	update(change: { readonly commandSetting?: CommandSetting; readonly readOnlyDefault?: boolean }): Promise<PolicySettings>;
	/** Returns false when no rule has this ID. */
	deleteRule(id: string): Promise<boolean>;
	grants(): Promise<readonly FolderGrant[]>;
	/** A grant for a folder that already has one widens it to `readwrite` when asked; it never narrows. */
	addGrant(grant: { readonly id: string; readonly path: string; readonly access: GrantAccess; readonly createdAt: number }): Promise<void>;
	/** Returns false when no grant has this ID. */
	revokeGrant(id: string): Promise<boolean>;
}

const defaults: PolicySettings = { commandSetting: "ask", readOnlyDefault: true, rules: [] };

export function policyStore(harness: Harness, context: Context): PolicyStore {
	const settings = async (): Promise<PolicySettings> => {
		const doc = await harness.snapshot(PolicyDoc, context);
		if (doc === undefined) return defaults;
		return {
			commandSetting: doc.commandSetting,
			readOnlyDefault: doc.readOnlyDefault,
			rules: Object.values(doc.rules).sort((a, b) => a.createdAt - b.createdAt),
		};
	};
	return {
		settings,
		update: async (change) => {
			await harness.commit(async (tx) => {
				const doc = await tx.doc(PolicyDoc);
				if (change.commandSetting !== undefined) doc.commandSetting = change.commandSetting;
				if (change.readOnlyDefault !== undefined) doc.readOnlyDefault = change.readOnlyDefault;
			}, context);
			return settings();
		},
		deleteRule: async (id) =>
			harness.commit(async (tx) => {
				const doc = await tx.doc(PolicyDoc);
				if (doc.rules[id] === undefined) return false;
				delete doc.rules[id];
				return true;
			}, context),
		grants: async () =>
			Object.values((await harness.snapshot(GrantsDoc, context))?.grants ?? {}).sort((a, b) => a.createdAt - b.createdAt),
		addGrant: async (grant) => {
			await harness.commit((tx) => saveScope(tx, { scope: { kind: "folder", path: grant.path, access: grant.access }, id: grant.id, createdAt: grant.createdAt }), context);
		},
		revokeGrant: async (id) =>
			harness.commit(async (tx) => {
				const doc = await tx.doc(GrantsDoc);
				if (doc.grants[id] === undefined) return false;
				delete doc.grants[id];
				doc.version += 1;
				return true;
			}, context),
	};
}

/** Write a rule or grant inside an open commit; an identical rule is not added twice. */
export async function saveScope(tx: Tx, saved: SavedScope): Promise<void> {
	const { scope } = saved;
	if (scope.kind === "command") {
		const doc = await tx.doc(PolicyDoc);
		const { program, subcommand, exact } = scope.rule;
		const same = Object.values(doc.rules).some(
			(rule) => rule.program === program && rule.subcommand === subcommand && rule.exact === exact,
		);
		if (same) return;
		doc.rules[saved.id] = {
			id: saved.id,
			program,
			...(subcommand === undefined ? {} : { subcommand }),
			...(exact === undefined ? {} : { exact }),
			createdAt: saved.createdAt,
		};
		return;
	}
	const doc = await tx.doc(GrantsDoc);
	const existing = Object.values(doc.grants).find((grant) => grant.path === scope.path);
	if (existing !== undefined && (existing.access === "readwrite" || scope.access === "read")) return;
	doc.version += 1;
	if (existing !== undefined) {
		doc.grants[existing.id] = { ...existing, access: "readwrite", version: doc.version };
		return;
	}
	doc.grants[saved.id] = { id: saved.id, path: scope.path, access: scope.access, version: doc.version, createdAt: saved.createdAt };
}

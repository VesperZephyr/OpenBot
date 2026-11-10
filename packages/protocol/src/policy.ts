

/** How commands are authorized when no rule or the read-only default applies (Section 5.3). */
export type CommandSetting = "ask" | "allow" | "never";

/**
 * What a command rule matches, per part of a command line. With `exact`, the part's words rendered canonically must
 * equal it; otherwise the program (and `subcommand`, when given, as the second word) with any further arguments.
 */
export type CommandRuleScope = { readonly program: string; readonly subcommand?: string; readonly exact?: string };

export type CommandRule = CommandRuleScope & { readonly id: string; readonly createdAt: number };

export type AskFirstPredicate =
 | { readonly tool: "local_exec"; readonly program: string; readonly subcommand?: string; readonly exact?: string; readonly cwd?: string }
 | { readonly tool: "artifact_publish" | "local_read" | "local_list" | "local_write" | "local_edit"; readonly path: string };
export type AskFirstInput = { readonly botId?: string; readonly predicate: AskFirstPredicate };
export type AskFirstRule = AskFirstInput & { readonly id: string; readonly targetId: string; readonly revision: number; readonly createdAt: number };
export type PolicyReconciliation = { readonly id: string; readonly revision: number; readonly state: "pending" | "complete" | "attention"; readonly createdAt: number };
export type PolicySettings = {
 readonly targetId?: string;
 readonly revision: number;
 readonly askFirst: readonly AskFirstRule[];
 readonly reconciliation?: PolicyReconciliation;
	readonly commandSetting: CommandSetting;
	/** Read-only commands (`rg`, `ls`, …) inside granted folders run without asking. */
	readonly readOnlyDefault: boolean;
	readonly rules: readonly CommandRule[];
};

export type GrantAccess = "read" | "readwrite";

/** A folder Bots may use with file tools without asking. The workspace is an implicit `readwrite` grant. */
export type FolderGrant = {
	readonly id: string;
	/** Canonical and absolute. */
	readonly path: string;
	readonly access: GrantAccess;
	/** Revision of the grants document that created it; increases with every grant change. */
	readonly version: number;
	readonly createdAt: number;
};

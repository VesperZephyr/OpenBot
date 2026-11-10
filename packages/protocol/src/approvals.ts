import type { BotId } from "./bots.ts";
import type { CommandRuleScope, GrantAccess } from "./policy.ts";
import type { ExecutionTarget } from "./target.ts";

/** A tool call stopped before dispatch until the user decides (Section 5.3). */
export type ApprovalBinding = { readonly runId?: string; readonly origin: "attended" | "unattended"; readonly argsDigest: string; readonly revision: number };
export type PendingApproval = {
 readonly binding?: ApprovalBinding;
	readonly deadline?: number;
	readonly conversationId?: string;
	readonly approvalId: string;
	readonly botId: BotId;
	/** The Pi tool call this approval is for; matches the transcript `tool` item's `id`. */
	readonly callId: string;
	readonly tool: string;
	readonly args: unknown;
	readonly target: ExecutionTarget;
	/** Why policy asked, in the user's terms, such as "Runs a command on this Mac". */
	readonly reason: string;
	readonly createdAt: number;
	/**
	 * Scopes the user may choose for **Always allow**, narrowest first. Absent when no single rule or grant would let
	 * this call through (for example a compound command with two unapproved parts, or input that cannot be parsed).
	 */
	readonly alwaysAllowOptions?: readonly AlwaysAllowOption[];
};

/** What **Always allow** creates: a command rule, or a folder grant. */
export type AlwaysAllowScope =
	| { readonly kind: "command"; readonly rule: CommandRuleScope }
	| { readonly kind: "folder"; readonly path: string; readonly access: GrantAccess };

/** One choice on the approval card; `label` is the exact rule or grant the user sees before saving. */
export type AlwaysAllowOption = { readonly label: string; readonly scope: AlwaysAllowScope };

/** `always_allow` answers this call and saves the scope in one step; the scope must be one of the offered options. */
export type ApprovalDecision = "allow_once" | "deny" | { readonly kind: "always_allow"; readonly scope: AlwaysAllowScope };

/**
 * Lifecycle of an approval in the Host's store (Section 5.3): `pending` until the user decides, `allowed` or `denied`
 * until the call's result is committed (`consumed`), or `withdrawn` when its Run was cancelled first.
 */
export type ApprovalState = "pending" | "allowed" | "denied" | "withdrawn" | "consumed" | "expired" | "revoked";

export type ApprovalRecord = PendingApproval & {
	readonly state: ApprovalState;
	/** The user's answer; kept when the record becomes `consumed`, so a rerun gets the same answer. */
	readonly decision?: ApprovalDecision;
	readonly decidedAt?: number;
};

/** Recorded approval button. `always_allow` is this string; `ApprovalDecision` carries an always-allow scope instead. */
export type ApprovalPress = "allow_once" | "deny" | "always_allow";

/** A user decision, readable after the Host restarts: `allow_once`, `deny`, or `always_allow`. */
export type ApprovalDecisionLog = {
	readonly approvalId: string;
	readonly decision: ApprovalPress;
	readonly at: number;
	readonly tool: string;
	readonly conversationId: string;
};

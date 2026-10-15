# B5: Always Allow and Folder Grants

Status: in review
Branch: task/b5-always-allow
Depends on: B1
Architecture: Sections 1.1 (commands cannot be confined), 5.2 (grants), 5.3 (policy order, Always allow, revocation)

## Goal

A daily user should not be asked the same thing twice. Before B5 every command asked and every file outside the workspace asked once per call. B5 adds the MVP subset of architecture 5.3: a command setting, read-only commands that run without asking inside granted folders, **Always allow** on approval cards (command rules and folder grants), and Settings to see and remove what was allowed.

## Scope

In:
- Command setting (Ask every time, Always allow, Never) and the read-only default (on by default), in Settings → **Commands** with the rule list.
- A conservative command lexer and matcher in `server-core`.
- Command rules and folder grants as Pi session documents `openbot.policy` and `openbot.grants`.
- `approvals.decide` with `always_allow` and a confirmed scope; the Host computes the choices.
- Read versus read-and-write grants, enforced by the executor.
- Settings → **Folders** with revoke and **Add folder** through a native picker in Electron main.
- Revocation and rule deletion re-check pending approvals.

Out:
- Ask-first rules, the model reviewer, approval expiry for unattended work: B12 (Phase 2).
- Per-Bot or per-target rules: later; one local target and global rules for now.
- Cancelling active work when a grant is revoked (architecture 5.3 "requests cancellation of affected active work"): a running command was approved for its whole run; file tools finish in milliseconds. Recorded as a known gap.

## Design

### Policy order

`decide(call, definition, policy: PolicySnapshot)` in `packages/server-core/src/approvals.ts` takes one snapshot object read fresh for every call (`loadPolicy` in `policy.ts`) instead of more positional arguments. Order, per architecture 5.3 without the Phase 2 steps:

1. **Hard rules.** A file tool without a path is denied.
2. **Never.** `commandSetting: "never"` denies every command, before rules and the read-only default.
3. **Allow.** Command setting `allow`; or every part of the command line matches a rule or is read-only inside grants; or the file path is inside a grant that allows the access (`readwrite` grants allow reads).
4. **Capability default.** Ask. The ask carries `alwaysAllowOptions` when one choice could let this call through.

Web and memory stay allowed. B3's `"tasks"` capability (merged separately) is a one-line `allow` case.

### Command lexer (`command-lexer.ts`)

A hand-written lexer, about 200 lines, for the line `/bin/zsh -c` runs. It reads words with single quotes, double quotes, and backslash escapes; the separators `|`, `&&`, `||`, `;`, and newlines; redirections `<`, `<&`, `>`, `>>`, `>|`, `>&`, `&>`, `&>>` with an optional file descriptor; and leading `NAME=value` assignments. A word is marked `expands` when it holds an unquoted glob (`* ? [ # ^`) or starts with `~`.

Anything else makes the line **not understood**, and a line that is not understood is never allowed automatically and offers no rule: `$` anywhere outside single quotes (parameter, arithmetic, and command substitution), backticks, `(`, `)`, `{`, `}` (subshells, groups, brace expansion, process substitution), `&` (background), `|&`, `;;`, here-documents, `<>`, `!`, comments, a leading `=` (zsh path expansion), unclosed quotes, and an operator without a command on one side.

`shell-quote` was considered and lost: it parses Bash-like syntax and silently turns what it does not know into tokens (for example `$VAR` becomes an empty string unless an env callback is given, and `{a,b}` is a plain word), so the "anything we do not fully understand asks" property would depend on how we post-process its output. zsh differs from Bash in exactly those corners (`=cmd`, extended globs, `${~x}`). A small lexer that refuses on sight is shorter to audit than an adapter, and adds no dependency.

### Matching (`command-policy.ts`)

A line is allowed when **every part** matches a rule or is read-only. Quoting cannot smuggle a second command: separators inside quotes stay in a word, and an exact rule compares the part's words rendered canonically (`renderPart`), so `echo 'hi; rm -rf ~'` is one part that does not equal `echo hi`.

- **Rules** `{ program, subcommand?, exact? }`. `exact` compares the canonical words; otherwise the program (and `subcommand` as the second word) with any arguments. Parts with assignments, a program containing `/` or a glob, and `eval`, `sudo`, `su`, `doas` never match. Programs that run other programs from their arguments (`sh`, `bash`, `zsh`, `env`, `xargs`, `exec`, `source`, …) match only an exact rule; the card offers no wildcard for them. A redirection in a part covered by a rule must read from a granted file or write into a `readwrite` grant (`2>&1` is fine).
- **Read-only default.** Allowlist exactly as backlog B5: `rg`, `grep`, `find`, `ls`, `cat`, `head`, `tail`, `wc`, `file`, `stat`, `pwd`, `which`, and `git status|diff|log|show|branch` (`git branch` only with listing options). The working directory must be inside a grant. Every non-option argument is checked as a path against the grants (stricter than the backlog's "absolute, `~`, or `..`"; a relative path without `..` stays inside the granted working directory anyway); options containing `/`, `~`, or `..` are refused rather than parsed per program. A globbed word is checked at its literal folder before the first pattern character, and `~user` is refused. Output redirection of any kind (including `2>/dev/null`), assignments, `find -exec/-execdir/-ok/-okdir/-delete/-fprint*`, `rg --pre/--pre-glob`, `file -C`, and `git --output/--ext-diff/--textconv` disqualify. Input redirection from a granted file is allowed.
- **Always allow choices** (narrow first) exist only when exactly one part is unapproved and that part could be ruled: the exact command, then `program subcommand *` (when the second word looks like a subcommand) or `program *`. A part whose redirections fall outside the grants gets no choice, so a saved rule always matches again.

### Documents

`packages/agent-runtime/src/policy.ts` defines two session documents and `PolicyStore` (exposed as `BotRuntime.policy()`), following B1's `ApprovalStore`. Every write is one Pi commit. `ApprovalStore.put(record, saved?)` writes the rule or grant in the **same commit** as the decided approval record, so "create the rule and answer the card" is one Host step that happens before the waiter wakes.

### Always allow

`ApprovalDecision` gains `{ kind: "always_allow", scope }` (B1's `ApprovalBook.decide(approvalId, decision)` keeps its signature). The scope must equal one of the `alwaysAllowOptions` the Host put on the pending approval; anything else is refused with `invalid_request`, so the renderer cannot save a wider rule than it was shown. The record stores the decision; a rerun after restart treats `always_allow` like `allow_once`, and the rule already exists. After an `always_allow`, the Host re-checks the other pending approvals: a new rule or grant may cover them too.

File cards offer the containing folder (for `local_list`, the listed folder itself) and then each ancestor up to, not including, `/`, with `read` access for read tools and `readwrite` for write tools. The renderer shows them as radio choices: no free text. Granting a folder that already has a `read` grant with `readwrite` widens it; a grant never narrows.

### Grants port

`apps/local-server/src/tools.ts` reads both documents for every call. `PolicyPort.grants` returns `{ readwrite, read }` (workspace first in `readwrite`), plus the one path an approved one-off call may touch, in the list its tool needs. `ToolInvocation` gains `readGrants`; the executor checks `local_read` and `local_list` against `grants` and `readGrants`, and `local_write` and `local_edit` against `grants` only.

### Revocation

`grants.revoke`, `policy.rules.delete`, and `policy.update` re-evaluate every pending approval under the new policy (`ApprovalBook.reevaluate`): one the policy now allows is settled `allow_once`, one it now refuses (Never) is denied, and the rest keep waiting with reason and **Always allow** options recomputed, so no card offers a choice computed from a grant that no longer exists. Calls already allowed are not affected: the executor received its grant list with the invocation, and later invocations receive the current list.

### Add folder (Electron main)

The renderer never supplies a path to grant. A new IPC handler `openbot:dialog.pickFolder` (trusted frame only) opens `dialog.showOpenDialog` attached to the sender's window and returns `{ selection, path }`: a random single-use token, bound to the sending web contents, expiring after five minutes. When the renderer calls `grants.add { selection, access }`, main exchanges the token for the path and forwards `grants.add { path, access }` to the Host. The Host canonicalizes the path and requires an existing folder. `RendererParams<"grants.add">` types the renderer side; all other methods pass through unchanged.

## Contracts

```ts
// packages/protocol
export type PendingApproval = { /* B1 fields */ readonly alwaysAllowOptions?: readonly AlwaysAllowOption[] };
export type AlwaysAllowScope =
	| { readonly kind: "command"; readonly rule: CommandRuleScope }
	| { readonly kind: "folder"; readonly path: string; readonly access: GrantAccess };
export type AlwaysAllowOption = { readonly label: string; readonly scope: AlwaysAllowScope };
export type ApprovalDecision = "allow_once" | "deny" | { readonly kind: "always_allow"; readonly scope: AlwaysAllowScope };
export type CommandSetting = "ask" | "allow" | "never";
export type CommandRuleScope = { readonly program: string; readonly subcommand?: string; readonly exact?: string };
export type CommandRule = CommandRuleScope & { readonly id: string; readonly createdAt: number };
export type PolicySettings = { readonly commandSetting: CommandSetting; readonly readOnlyDefault: boolean; readonly rules: readonly CommandRule[] };
export type GrantAccess = "read" | "readwrite";
export type FolderGrant = { readonly id: string; readonly path: string; readonly access: GrantAccess; readonly version: number; readonly createdAt: number };
export type ToolInvocation = { /* … */ readonly grants: readonly string[]; readonly readGrants: readonly string[] };

// Host methods, appended
"policy.get":          { params: {}; result: PolicySettings };
"policy.update":       { params: { commandSetting?: CommandSetting; readOnlyDefault?: boolean }; result: PolicySettings };
"policy.rules.delete": { params: { id: string }; result: PolicySettings };
"grants.list":         { params: {}; result: readonly FolderGrant[] };
"grants.revoke":       { params: { id: string }; result: readonly FolderGrant[] };
"grants.add":          { params: { path: string; access: GrantAccess }; result: readonly FolderGrant[] }; // renderer: { selection, access }

// Documents (session scope)
openbot.policy = { commandSetting: CommandSetting; readOnlyDefault: boolean; rules: Record<id, CommandRule> } // initial: ask, true, {}
openbot.grants = { version: number; grants: Record<id, FolderGrant> }                                        // version++ on every change

// tool-router
interface PolicyPort { grants(call, approvedOnce): Promise<{ readwrite: readonly string[]; read: readonly string[] }> }
```

Invariants:
- Model output never creates a rule or grant; only `approvals.decide` (with an offered scope), `grants.add` (with a picker token), and Settings write the documents.
- A rule or grant saved by **Always allow** commits together with the approval decision, before the call wakes.
- Writes never succeed under a `read` grant (Host policy and executor both check).
- A line the lexer does not fully understand is never allowed by rules or the read-only default.

## Steps

1. Protocol types and methods (`packages/protocol/src/index.ts`).
2. Lexer and matcher (`server-core/src/command-lexer.ts`, `command-policy.ts`), unit tests `command-policy.test.ts`.
3. Documents and `PolicyStore` (`agent-runtime/src/policy.ts`), `ApprovalStore.put(record, saved?)`.
4. `decide` with `PolicySnapshot`, `loadPolicy`, `ApprovalBook.decide` with `always_allow`, `reevaluate`, `PolicyService` Host methods; unit tests `always-allow.test.ts`.
5. Grants port and executor read/readwrite split (`apps/local-server/src/tools.ts`, `tool-router`, `local-executor/src/files.ts`); executor test.
6. Desktop: `dialog.pickFolder` (`main/folder-picker.ts`, `main/ipc.ts`, preload), `AlwaysAllow.tsx`, `PolicySettings.tsx`, mounts in `App.tsx`.
7. Prompt shell line (`agent-runtime/src/prompt.ts`).
8. E2E `e2e/always-allow.e2e.ts`.

## Acceptance

1. Compound command with one unapproved part asks; quoting cannot smuggle a second command. Unit `command-policy.test.ts › allows a command covered by a rule; a compound command with one unapproved part still asks`, `› quoting cannot smuggle a second command past an exact rule`.
2. Read-only default: `rg foo src` in the workspace runs; `cat ~/.ssh/id_rsa`, `find . -exec rm {} \;`, `grep x > out.txt` ask. Unit `› runs a read-only search in the workspace without asking`, `› asks for %s`.
3. Precedence: Never beats rules and the read-only default. Unit `› Never beats rules and the read-only default; Always allow skips the card`; Host-level `always-allow.test.ts › Never denies a waiting command`.
4. Always allow saves the rule in the same step; deleting it asks again; unoffered scopes are refused. Unit `always-allow.test.ts › saves the chosen rule…`, `› refuses an Always allow scope the card did not offer`.
5. Grant revocation re-checks pending approvals. Unit `always-allow.test.ts › revoking a grant re-checks pending approvals that relied on it`, `› granting a folder settles other waiting calls it covers`.
6. Executor refuses writes under a read grant. Unit `executor.test.ts › reads but never writes inside a read-only grant`.
7. E2E `always-allow.e2e.ts`: a read-only `rg` runs without a card; Always allow on `git status` → second `git status` runs without a card → delete the rule in Settings → the card comes back.
8. `pnpm run check` passes.

## Risks

- **Heuristic, not confinement.** A read-only program can still read anything its arguments reach indirectly (for example a file list in a granted file). Kept narrow; the toggle turns it off.
- **Rules are global.** A rule saved for one Bot applies to all; per-Bot rules are B12.
- **Wildcard rules and options.** `npm test *` allows any arguments, including ones a script interprets dangerously; the card shows the exact rule before saving and the exact command is the default choice.

## Open questions

- 2026-10-15: The integration owner ruled that e2e suites must not be run in this wave (no Electron windows). `always-allow.e2e.ts` is written and typechecks; it has not been run. Acceptance 7 stays open until the owner runs it.

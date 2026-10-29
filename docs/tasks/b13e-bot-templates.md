# B13e: Bot template import and export

Status: ready
Branch: task/b13e-bot-templates; pull request target: main
Depends on: B10, B17/B18/B19, B27b, D6 avatars, B14d and B14c (merged)
Architecture: sections 4.2, 5.7, 5.8, 6.1, 7.1 and 8.3
Design baseline: main `9898c0a` (October 29, 2026), including B14c/#64 and its documentation closeout #65

## Goal

Export a configured Bot as one inspectable local file, then import that file as a new Specialist with deliberate model and skill choices. Reuse a role and its instructions without copying its past conversations, personal memory or authority. The same file works in another local OpenBot installation even when its available models and skill revisions differ.

## Scope

In: one versioned JSON template; generated/uploaded avatar portability; exact skill references; export preview and native Save; native Open and import review; explicit dependency resolution; atomic, idempotent Specialist creation; English/Chinese UI; backup compatibility and isolated automated acceptance.

Out: skill document bundles or automatic skill installation; provider setup/credentials; tools, policy or grants; memory/history migration; group/routine templates; overwriting an existing Bot; template library/marketplace/cloud sharing; OS file association, URL or drag-and-drop import; model-facing template tools; changing ordinary Duplicate; auto-update or signed releases (B14f). General cross-machine backup remains outside B14d; a template is only the bounded profile format below.

## Design and existing integration points

- Use a plain UTF-8 JSON file, not an archive. Everything needed to display the exported profile fits in one bounded document. Exact skill references identify dependencies; procedure content stays in the separately reviewed local skill library.
- Template methods are owner desktop operations. They do not enter the Core management tools, application capability catalogue or Code Mode. They create no Run and invoke no model, connector or network service.
- `protocol` defines strict schemas and the portable format. `server-core` owns projection, dependency resolution and import orchestration. `agent-runtime` owns atomic profile/conversation/avatar/receipt persistence through Pi. `local-executor` reads and writes the native-selected file and validates image bytes. Desktop main owns the dialogs and frame checks; renderer owns review UI. No new package or Pi vendor change is needed.
- Reuse the current generated-avatar recipe, `validateAvatar`, `saveAvatar`, exact `SkillRef` validation and Bot creation transaction. Current `createBot` returns any existing profile with the same ID; that alone is insufficient for template argument binding. Add a dedicated import transaction/receipt contract, sharing creation helpers without changing ordinary create/duplicate semantics.
- File acquisition is independent of import confirmation: Open reads a bounded document but creates no Bot, asset, skill or grant. Review is ephemeral; there is no permanent imported-template library or source-path record.

## Contracts

### 1. Portable document and limits

The suggested extension is `.openbot.json`; picker filters also allow `.json`. Content validation is authoritative. Export defaults to a sanitized `<bot-name>.openbot.json` basename, falling back to `bot.openbot.json`; no path from template content is interpreted as a destination.

```ts
type TemplateAvatar = GeneratedAvatar | {
  kind: "png";
  base64: string;
};

type BotTemplateV1 = {
  format: "openbot-bot-template";
  version: 1;
  profile: {
    name: string;
    role: string;
    instructions: string;
    avatar: TemplateAvatar;
    model: ModelRef | null;        // null means inherit the destination default
    thinkingLevel: ThinkingLevel; // off | low | medium | high
    defaultSkills: SkillRef[];    // ordered, at most two distinct names
  };
};
```

All fields above are required; no additional keys are accepted at any level. Export projects this allowlist explicitly, never serializes a Bot record and removes a few keys afterwards. There is no source Bot ID, Core flag, profile revision, conversation ID, timestamp, provenance path, endpoint, credential, memory, grant, connector configuration, group membership, routine binding, usage, draft or read cursor in the format.

| Limit | Contract |
| --- | --- |
| Selected file | At most 1 MiB; regular file, no symlink components; bounded read with changed-file detection |
| Text decoding/parsing | Strict UTF-8; optionally remove one leading UTF-8 BOM; reject invalid bytes, duplicate JSON keys, comments, trailing data and nesting deeper than eight levels |
| Canonical document | At most 1 MiB minus one byte UTF-8 after serialization, reserving the saved final newline; validate before hashing or crossing IPC |
| Name / role | At most 200 Unicode code points each; name nonempty after trim; export/import normalize name only by trimming; role and instructions preserve text |
| Instructions | At most 64 KiB UTF-8, including an empty string; reject oversize export rather than truncate |
| Strings | Well-formed Unicode, no NUL; model IDs additionally nonempty and at most 256 code points; skill names use existing B10 rules |
| Skill pins | Zero to two distinct names, positive safe-integer revision and lowercase 64-hex SHA-256; order is retained |
| Generated avatar | Existing version 1, unsigned 32-bit seed and leaf/glasses/cap motif |
| PNG avatar | Canonical base64, at most 300 KiB decoded / 409,600 encoded characters; existing 256×256, noninterlaced, 8-bit RGB/RGBA PNG validation; CRC checked and metadata stripped |
| IPC request/response | At most 1 MiB + 16 KiB serialized per template method, including choices/review metadata; reject before dispatch, with schema field bounds checked before serialization |
| Concurrency | One active template action/dialog per renderer window; Host admits at most four template operations, rejecting overflow; executor uses the existing four-request/ten-second private file-operation bounds |

Never silently repair unsupported versions, unknown fields, invalid pins or oversized text. Error messages identify a field/failure class without echoing template content. Parse duplicate keys before ordinary JSON object materialization; do not use `eval` or a permissive JSONC parser.

Canonical serialization is recursive lexicographic sorting of object keys, array order preserved, `JSON.stringify` scalar encoding, no insignificant whitespace. There are only bounded strings, safe integers, null, arrays and objects in this format. Define this helper once with fixed golden fixtures. `templateDigest` is SHA-256 over its UTF-8 bytes after schema validation and name normalization, before PNG re-encoding. Saved export uses these canonical bytes plus one final newline. Import formatting/BOM/key order therefore does not change identity; a changed instruction, reference, image or selection does.

### 2. Export snapshot and review

Export is available for active or hidden Bots, including Core. It exports only the portable profile; importing Core's description never transfers its protected identity or management authority. Deleted Bots cannot be exported.

Read profile and referenced image in one runtime transaction/snapshot with `expectedRevision`. Missing source, changed revision, absent/corrupt image or exceeded limits fail before a Save dialog. Generated avatars retain their exact recipe, including the resolved legacy default; uploaded avatars carry validated PNG bytes, never an opaque digest that another installation cannot resolve. Missing local skills or models do not block export: retain their exact references and label their current unavailable state in review.

The read-only export review shows name, role, full scrollable instructions, avatar, model/inheritance, thinking level and skill name/revision/hash. Explain that memory, chats and permissions are excluded, and that the included instructions may contain information the user wrote manually. Structural exclusion is not automatic secret detection or text redaction. The user can cancel or choose Save. Saving uses the exact reviewed snapshot even if the source Bot is subsequently edited; a Refresh action obtains a new revision and replaces the review. No source object is mutated.

### 3. Import review and dependency decisions

A valid selected document opens a review before any persistent change. Show all portable fields, the full instructions, avatar, file name as escaped text, model availability and each exact skill reference. Instruction text is displayed as text, not executed HTML or a tool instruction to the app. Show “Creates a new Bot; existing Bots are unchanged.” Name is editable with the same limits. Role/instructions/avatar/thinking remain read-only in this dialog and can be edited through Profile after creation.

```ts
type ModelChoice =
  | { kind: "template" }
  | { kind: "default" }
  | { kind: "local"; model: ModelRef };

type SkillChoice = {
  name: string; // exactly one choice per source pin, in source order
  choice:
    | { kind: "template" }
    | { kind: "local"; ref: SkillRef }
    | { kind: "omit" };
};

type ImportChoices = {
  name: string;
  model: ModelChoice;
  skills: SkillChoice[];
};
```

- A configured source model may default to `template`; this means the exact provider/model ID is registered locally, not that a credential or connection test succeeded. When the template model is null, initialize `default` and reject `template` as a choice; a local override remains available. When an explicit model is missing, leave the choice unresolved: the user must choose an available local model or Use application default. Do not auto-add a provider, copy an endpoint or call a provider. A destination with no default model can still create a Bot via explicit `default`, with an inline “Set up a model before chatting” state.
- For each skill pin, initialize `template` only if the exact name/revision/hash is locally available and readable. No matching by name alone, by revision alone, or by silently taking latest. Missing, deleted, corrupted or different-hash versions are unresolved. The user must explicitly omit that dependency or choose and preview a valid local revision of the **same name**. The review shows changed revision/hash; even an identical hash at a different revision requires that explicit local choice. No procedure content is imported and no library state is changed.
- There must be exactly one decision for every original pin, with no additional names, duplicates or implicit omission. Final defaults contain zero to two distinct exact references in source order. The UI may render only retained choices as chips, but confirmation must submit explicit omissions too.
- Disable Import until all choices are resolved. Confirmation revalidates model registration and selected skill bytes. If dependencies changed, retain the review and name, mark the affected choice unresolved, and require another confirmation. Do not replace it with a default or omit it automatically.
- Dependency validity is sampled at the final resolution immediately before the atomic creation request; the validated immutable skill references are committed. A later library deletion/provider change is handled by existing B27b/model readiness at first send, with no automatic pin upgrade. This import does not promise to freeze the external skill library against later edits.
- “Import another copy” is an explicit action that starts a new request identity and review. Equal names are allowed, as with ordinary Bot creation; never merge or overwrite based on name or template digest.

### 4. Desktop, Host and executor interfaces

Use the following new names in `HostMethods`, strict parameter schemas and the renderer allowlist. These explicitly staged template methods are not model capabilities.

```ts
type DependencyState = "available" | "unavailable";
type TemplateReview = {
  template: BotTemplateV1;
  templateDigest: string;
  model: { ref: ModelRef | null; state: DependencyState };
  skills: { ref: SkillRef; state: DependencyState }[];
};
type ImportResult = { botId: string; state: "active" | "hidden" | "deleted" };

// Renderer-allowlisted owner methods:
"bots.templates.export": {
  params: { botId: string; expectedRevision: number };
  result: TemplateReview;
};
"bots.templates.inspect": {
  params: { template: BotTemplateV1 };
  result: TemplateReview;
};
"bots.templates.import": {
  params: {
    requestId: string; // UUID v4, persisted by the UI before dispatch
    template: BotTemplateV1;
    templateDigest: string;
    choices: ImportChoices;
  };
  result: ImportResult;
};
"bots.templates.status": {
  params: { requestId: string };
  result: ImportResult | null;
};

// Named preload functions; no renderer path parameter:
pickBotTemplate(): Promise<{ name: string; template: BotTemplateV1 } | null>;
saveBotTemplate(input: {
  requestId: string;
  template: BotTemplateV1;
  templateDigest: string;
}): Promise<{ outcome: "saved" | "cancelled" }>;
```

For a null template model, review state is available only when a default is configured; `default` remains a valid explicit creation choice either way. `inspect` is read-only and validates schema and PNG content as well as dependency metadata. Import repeats these checks; preview results are never authority to skip validation. No preview token or durable staging store is required: the import request contains the complete bounded reviewed document and choices, and the Host recomputes its digest. UI edits to choices invalidate its displayed resolved summary until recomputed locally; any edit after an unconfirmed submission requires resolving that submission first.

Main validates the owner main frame and window, checks again after dialogs/awaits, and expires native selection on navigation, window destruction or Host replacement. Reject guest webviews/iframes, unknown IPC keys and arbitrary paths. Picker cancellation returns null; Save cancellation returns cancelled. Neither is an error or a mutation. Main does not read or write template files itself: add main-only Host methods `templates.file.read({path}) -> {name, template}` and `templates.file.write({requestId, path, template, templateDigest}) -> null`, excluded from the renderer allowlist and every model surface.

Those methods use the existing target-bound private artifact transport with these bounded executor operations:

```ts
{ action: "template-read"; path: string }
{ action: "template-write"; path: string; utf8: string; sha256: string }
```

The operation request ID remains in the existing private envelope. Read validates bytes/schema before returning a document; Host validates again. Write serializes only a validated portable document, verifies the supplied hash and uses selected-path checks and existing durable file-export receipts. Do not register a template file as an artifact or a chat attachment. Template digest covers canonical JSON without newline; the executor write hash covers exact saved UTF-8 including its newline. These two hashes must have distinct names.

Save is **create-only**, consistent with current artifact export. Existing destination, including a symlink, fails without replacement; the UI explains “Choose a new filename.” Publish a same-directory temporary file with exclusive creation, flush, then exclusive link/publication and cleanup. A failed write cannot leave a partial final file. Persist intent before publication; a lost result is reconciled by destination length/hash under the same operation ID, never by blind overwrite. A changed destination/content under that ID conflicts. Reuse the existing bounded receipt quota and uncertain-outcome handling; no silent receipt eviction. Error/retry UI keeps the reviewed document. A later explicit Save to a different destination is a new export request and opens a new dialog. Do not automatically redisplay native dialogs after restart.

Use existing protocol errors: `invalid_request` for malformed/unsupported documents, unresolved dependencies, quota limits and unsafe file selections; `request_conflict` for changed export revisions, request argument reuse or identity collisions; `not_found` for an absent/deleted export source; `host_unavailable` for transport loss. An uncertain dispatched import/export is presented as unconfirmed until its owning receipt is reconciled, not as a guaranteed no-effect failure. Main/Host errors use fixed localized messages; the UI refreshes dependency inspection to identify affected rows. Native cancellation keeps its explicit non-error result.

### 5. Atomic creation and request recovery

`server-core` validates/normalizes the template and choices, verifies `templateDigest`, and computes `requestDigest = SHA256(canonical({templateDigest, choices}))`. No implicit current-default model value is added to this digest: `default` means inheritance, not a snapshot override. Generate `botId = "bot_template_" + requestId`; callers cannot supply an existing ID or choose Core kind.

Introduce one session-scoped, version-1 runtime document, `openbot.template-imports`, with an initially empty receipt map:

```ts
type TemplateImportReceipt = {
  requestId: string;
  requestDigest: string;
  botId: string;
  committedAt: number;
};
// At most 4,096 receipts; no eviction. A full map rejects new imports.
```

After structural validation/digest calculation, check for a committed receipt **before resolving today's dependencies**. Same request ID and digest returns the existing Bot's current active/hidden/deleted state even if its model/skills have since disappeared or its profile changed. Different digest is `request_conflict`. Recheck receipt/identity/quota inside the transaction to serialize concurrent identical or conflicting requests. A preexisting Bot at the generated ID without a matching receipt is a conflict, never a successful replay.

One Pi transaction creates the ownerless conversation, configured instructions, Specialist profile, avatar bytes/reference, empty conversation summary and receipt. Share existing creation/configuration helpers; do not create a Bot and then apply its avatar or skills through later UI calls. Store the executor-validated normalized PNG in the same transaction using the existing image quota. A validation failure, quota error or transaction rollback leaves no Bot, conversation, avatar or receipt. The completed profile has revision 1, active status, pinned false, the selected portable fields, exact resolved defaults and a fresh timestamp. It has no source memory, private history, groups, routines, connector attachments or Run. Existing shared memory, global policy/grants and default-model behavior still apply normally on future messages; Bots are not security boundaries.

Emit roster invalidation and start observation only after commit. A notification/observer/IPC failure after commit cannot change the durable result to an uncommitted import; status/replay must recover it. A replay after deleting the imported Bot returns deleted and never resurrects it. At the receipt quota, offer an actionable message that ordinary Bot creation remains available; do not prune identities or silently create an untracked import.

Before sending Import, persist only the pending request UUID in the renderer partition; do not put template text, dependency selections or PNG bytes in localStorage. Disable duplicate clicks. On uncertain IPC outcome, show “Checking import result” and query status with one request in flight, at most once per second for ten seconds. If still unresolved, offer Check again and keep the pending UUID; no unbounded polling loop. A recorded result navigates to the imported Bot, or explains its later hidden/deleted state. A null status is not proof that an in-flight transaction cannot commit: retain the UUID, retry only the same payload, and never automatically mint a new UUID. If the Host/renderer restarted and review bytes were lost, reselect the file and rebuild the review using the retained UUID; a changed payload conflicts if the earlier transaction committed. User cancellation of a pending result stops polling only, not a dispatched commit. Closing a review before dispatch has no effect. Once a recorded result is known, clear the pending UUID. If the user wants to abandon an unresolved submission, first establish that its Host process has stopped and the replacement Host reports no receipt; only then may the pending UUID be cleared without a result. Ordinary null status while the original Host is alive does not establish this. Import another copy requires an explicit new action.

### 6. Storage, privacy and compatibility

No model inference, connector connection, routine activation or permission grant occurs while inspecting, saving or importing. No template name, path, instructions, model IDs, image bytes or skill contents enter diagnostics; record generated correlation IDs, byte counts, duration and fixed failure codes only. Imported instructions become ordinary profile instructions on future user-started messages, subject to existing authorization.

A template is not a full data backup. New runtime receipts and imported avatars are covered by B14d's Host database snapshot; file-export intents stay in the existing executor-owned export ledger under its already covered root. No new backup root or external source-file dependency is introduced. Pre-B13e databases lazily initialize an empty receipt document; existing Bots and Duplicate behavior remain unchanged. Restore includes receipts, returns paused and invalidates old renderer pending-import IDs when main requests the existing post-restore UI reload. Never resend an old request automatically into a restored store; the user must begin a fresh review after restore. Deleting/moving the original template file does not affect an imported Bot.

Unsupported future template versions fail visibly before any side effect. This batch does not promise backward binary rollback once the new runtime document exists; keep B14f release compatibility decisions separate. Offline backup validation must accept the newly registered document and preserve its integrity/receipt bounds. Do not move any state outside its existing owner to avoid extending validation.

### 7. Desktop behavior

Add Export template to the existing Bot menu/profile actions and Import template beside Create new Bot in the existing New conversation dialog. Do not introduce a new Settings category. Keep ordinary Duplicate. After a successful import, select the new Bot and show its profile settings without sending a greeting or message. Review dialogs support keyboard navigation, Escape before submission, full instructions scrolling, visible dependency labels, busy/error/retry states and focus return to the invoker. English is default; provide equivalent Simplified Chinese copy.

Show missing dependencies inline; do not require a trip through provider/skill installation to cancel or explicitly omit/use default. Imported methods remain guidance, not grants. Test light/dark, both languages and the existing minimum supported window width; long names/hash values must wrap without widening the app. No template content is rendered in an HTML webview. File operations use hidden-test injected picker paths, never native dialogs on the owner's desktop.

## Implementation steps

1. Add `packages/protocol/src/templates.ts`, strict method/IPC schemas and format/canonicalization fixtures. Extend method maps, main-only exclusions and private artifact-operation validation. Keep protocol independent of Node/Pi/Electron.
2. Implement bounded template file read/write in `packages/local-executor`, compose actions in `apps/local-executor` and reuse target-bound Host transport. Add malformed-file, changed-file, exclusive-write and lost-response recovery tests.
3. Add snapshot export and atomic import/receipt helpers in `packages/agent-runtime`; add server-core template orchestration, dependency resolution and replay-first handling. Register the new document for normal/offline startup and validate backup round trips. Preserve existing create/duplicate behavior.
4. Add named preload/main picker/save methods with frame/window lifetime checks, then renderer import/export review and dependency selectors. Reuse profile/avatar/skill preview controls and add English/Chinese strings.
5. Extend ScriptedModel e2e with the acceptance fixtures below. Exercise the first user message after import to prove instructions and selected skills are used with normal policy and no imported history. Verify no request is made before that message.
6. Run full `pnpm run check`, full hidden `pnpm run e2e`, inspect screenshots and explore an isolated background app with agent-browser. Run staged Node/Host/executor startup and offline backup validation for the new document. Record exact implementation SHA, commands/counts, acceptance mapping and limitations; update the backlog/technical plan when it lands.

## Acceptance

The following are required test contracts; names may be split across files but no row may be replaced with manual owner steps. Planned paths below are new unless already present.

| # | Observable outcome | Required evidence |
| --- | --- | --- |
| 1 | Export contains exactly the allowed profile, including generated and normalized PNG avatars; no source identity or prohibited state; exporting Core imports only a Specialist | `protocol/test/templates.test.ts` strict allowlist/golden serialization; `server-core/test/templates.test.ts` sentinel memory/history/credential/grant/group/routine exclusion and Core export; hidden `e2e/bot-templates.e2e.ts` round trip |
| 2 | Invalid UTF-8/JSON, duplicate keys, unknown version/fields, depth/size overflow, invalid Unicode, invalid pins and malformed/decompression-abusive PNG fail before mutation | Protocol/executor table tests at each boundary and one byte over; include malicious path keys, fake Core flag, extra endpoint/secret fields, wrong image dimensions/CRC and mismatched digest |
| 3 | Native Open/Save is owner-frame-only, cancellation has no effect, symlinks/nonregular/changed files fail; Save never overwrites or leaves a partial final file | `local-executor/test/templates.test.ts` and main IPC tests for guest frame, navigation/Host replacement, picker cancel, changed input, existing/symlink destination, ENOSPC and publish failure; injected dialogs in e2e |
| 4 | Model inheritance, exact configured model and explicit replacement work; missing model cannot silently fall back; unconfigured default is a deliberate visible choice | Host dependency tests plus e2e missing-model review; assert zero provider/network calls during import and no provider/credential mutation |
| 5 | Exact skills survive; same-name wrong-hash/missing/deleted versions require explicit omit or reviewed same-name replacement; no silent latest; dependency loss before commit preserves review | Host tests for every resolution and forged/missing/duplicate decisions; e2e preview/replacement/omission, library disappearance and corrected retry; library hashes/receipts unchanged |
| 6 | Same ID/payload concurrently, after reply loss and after Host restart creates exactly one profile/conversation/avatar/receipt; changed payload conflicts; deleted result never resurrects | `agent-runtime/test/templates.test.ts` injected failures before commit and after commit/before response, concurrent requests and transaction rollback; Host replay after dependency deletion and profile changes; quota/bot-ID collision tests |
| 7 | A new ID deliberately creates a distinct copy with empty private memory/history and default status; no grants, memberships, routine runs or greetings appear | Host tests compare store objects and policy hashes; e2e explicit second copy and first user message via ScriptedModel, proving exact instructions/selected skills and no source messages in model input |
| 8 | Export pins its reviewed revision; source mutation before preparation fails, later mutation does not change saved bytes; missing source image/oversize instructions never clip | Runtime snapshot/CAS tests and e2e edit-after-preview/save; decode saved fixture and compare digest/fields |
| 9 | Pending import recovers across renderer/Host restart, retains UUID through unknown status, does not auto-resend after restore; receipt replay works after backup | e2e lost-response/reload/reselection; extend backup unit/e2e with imported PNG, exact pins and receipt, source file removed, pre-B13e fixture, paused restore and duplicate suppression |
| 10 | English/Chinese, light/dark and minimum-width review show all content and dependency errors; keyboard/cancel/retry preserve choices; import completion opens the correct Bot | Hidden e2e screenshots for export preview, unresolved import, resolved import, both avatar kinds, conflict/unknown outcome and narrow Chinese view; inspect screenshots and isolated agent-browser flow |
| 11 | Resource/privacy bounds and package ownership hold in development and bundled runtime | Four-operation saturation, 4,096-receipt cap without eviction, 128-image existing quota and bounded IPC payload tests; sentinel content absent from diagnostics; full check/e2e and staged runtime/backup smoke |

Use synthetic sentinels and local fixture files only. No real provider call is needed to prove this deterministic transfer feature; ScriptedModel verifies the eventual input/authority boundary. Native signing, notarization, distribution and cross-machine Keychain migration are not acceptance claims of B13e.

## Risks

- Import can preserve an instruction that contains manually entered private information. Review must expose the full exported text; field exclusion cannot guarantee arbitrary prose is secret-free.
- Models and skill libraries differ between installations. Explicit resolution and commit-time revalidation prevent silent substitutions, but later library changes still affect future admissions under existing rules.
- A new transactional creation path can diverge from existing Bot setup. Share configuration helpers and assert exact initial profile/conversation/summary state; keep receipts and avatar writes in the same commit.
- File result loss and import result loss have different owners. Executor receipts reconcile selected-file publication; Pi receipts reconcile Bot creation. Neither UI retries nor template digests alone establish completed effects.
- Fixed receipt/image limits bound storage and preserve replay identities. Quota exhaustion is a visible failure; automatic eviction/purge needs a separate retention design.

## Open questions

None. Template v1 deliberately includes bounded PNG data but only references skill procedures; unresolved model/skill choices require explicit confirmation, and imports always create a new Specialist. Execution must record a dated contract gap here before changing these decisions.

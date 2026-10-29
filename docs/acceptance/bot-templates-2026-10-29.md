# B13e Bot template acceptance — October 29, 2026

Status: merged in [#67](https://github.com/VesperZephyr/OpenBot/pull/67); merge revision `718fb35f06379c33389b749ed1323cb53cd5bc79`.

Design: [B13e](../tasks/b13e-bot-templates.md), merged in [#66](https://github.com/VesperZephyr/OpenBot/pull/66). Base: `e3647b6fc5868a314c8e065ad878b7e4a9366b5b`. Implementation revision: `a9fe3a0d5cf18c6614fd9eeb3126b6d8d3203a9b`.

## Main integration

PR #67 merged on October 29, 2026 at 10:38:51 UTC. The [macOS CI run](https://github.com/VesperZephyr/OpenBot/actions/runs/40854982647) passed its Check and e2e job at 10:20:20 UTC on PR head `730861ed12ac0bb7a7adfc57b37257a582890da6`. Main now includes the implementation and the acceptance documentation. The checks below describe the implementation verification; the merge closeout changes documentation only.

## Result

Bot menus export a frozen profile to a create-only `.openbot.json` file. New conversation imports it through review into a fresh Specialist, with generated or normalized PNG artwork and explicit configured-model and exact skill choices. The file excludes identity, memory, chats, credentials, grants, groups and routines. Imported instructions remain ordinary profile instructions for future user messages.

Main owns native selection and validates its frame, window and Host lifetime. The executor owns bounded file access and publication receipts. The Host validates dependencies; one Pi transaction creates the conversation, profile, avatar, summary and import receipt. Replay returns the recorded Bot's current state before consulting dependencies. A pending renderer request retains only its UUID, polls bounded status after an uncertain reply, survives restart/reselection, and is cleared on restore.

## Verification

- `pnpm run check`: 616 tests in 91 files, with package boundaries and both TypeScript projects.
- `pnpm run e2e`: 198 tests in 52 files, using hidden background windows, fixture databases, isolated Keychain services and ScriptedModel.
- Final template-only desktop rerun after keyboard focus and copy refinements: seven tests in `e2e/bot-templates.e2e.ts`.
- `node apps/desktop/scripts/stage-runtime.mjs`: checksum-verified bundled Node starts the bundled Host and executor from an unrelated directory; creates/reads/imports a template, deletes its source, exports and restores an offline backup, restarts paused and replays its receipt.
- Isolated agent-browser exploration: export review with long instructions, save, import under a new name, and opening the resulting profile. This exposed the dialog height/focus and unconfigured catalogue-model issues; regression assertions now cover viewport bounds, Escape/focus return and configured-model options.
- Screenshots inspected in `e2e/.run/bot-templates/`: export preview, resolved and missing dependencies, imported conversation, unconfirmed result, PNG preview, changed dependency and minimum-size Chinese dark view. Local screenshots and logs remain ignored test artifacts.

An earlier check run overlapped full desktop tests and staging and failed two existing timing assertions: the Code Mode ten-minute duration comparison by one millisecond, and the Host history-index polling deadline. Both files passed a focused rerun (34 tests). The final full check ran separately from desktop/staging work. No unrelated timing or authorization change is included in B13e.

## Acceptance mapping

| Spec item | Automated evidence |
| --- | --- |
| 1. Portable allowlist; Core becomes Specialist | [Protocol fixtures](../../packages/protocol/test/templates.test.ts) reject excluded fields and fix canonical key ordering. [Runtime tests](../../packages/agent-runtime/test/templates.test.ts) export Core and create only Specialists. [Host tests](../../packages/server-core/test/templates.test.ts) exclude private memory/source identity; desktop tests round-trip generated and PNG avatars. |
| 2. Malformed and oversized inputs | Protocol tests cover duplicate escaped keys, Unicode/NUL, depth, future versions, forbidden fields, unsafe pins, exact file/instruction/code-point/IPC limits and overflow. [Executor tests](../../packages/local-executor/test/templates.test.ts) reject invalid UTF-8, unsafe file types, bad hashes and PNG input; shared [avatar tests](../../packages/local-executor/test/avatars.test.ts) cover CRC, dimensions, interlace and normalization. |
| 3. Native boundary and create-only publication | Executor tests cover symlinks (including dangling destinations), directories, changed-file detection, existing destinations, injected ENOSPC/link failure, temporary cleanup and ledger reconciliation after lost completion. [Desktop tests](../../e2e/bot-templates.e2e.ts) reject guest frames, extra/path keys and renderer file methods; exercise cancellation, navigation and Host replacement with injected native dialogs. |
| 4. Deliberate model resolution | Host tests distinguish catalogue presence from configured availability, reject unavailable template/local choices, allow explicit inheritance and replay after configuration loss. Desktop missing-model review remains blocked until an explicit choice and lists only configured replacements. ScriptedModel sees no request before the first user message. |
| 5. Exact skill choices and changed dependencies | Host tests require verified exact references or explicit omission. Desktop tests preview a same-name local revision, adopt it deliberately, delete another dependency after preview, retain the review/name on rejection and complete only after explicit omission. The first imported chat includes the pinned procedure. |
| 6. Atomicity, request identity and recovery | Runtime tests cover concurrent replay, argument conflict, restart, deleted tombstones, identity collision, rollback on unavailable artwork, receipt integrity on reopen and both storage quotas. Host tests recover committed results after notification failure and replay before changed dependencies. Desktop injects a lost import reply and unknown status, retains the UUID, restarts and recovers exactly one Bot. |
| 7. Fresh copy without implicit activity | Host tests give distinct request IDs distinct Bot identities. Runtime and desktop assertions verify Specialist kind, empty private memory/history and no initial model call. The first user-started chat sees the exported instructions and exact skill text. No template method enters model tools or Code Mode. |
| 8. Frozen export snapshot | Runtime tests reject stale revisions, oversize instructions and missing stored artwork. Desktop edits the source after export review, saves, decodes the file and checks the original instructions. Runtime export projects and validates the complete bounded profile; missing/invalid artwork fails before a native Save. |
| 9. Backup and pending request behavior | [Backup desktop tests](../../e2e/backups.e2e.ts) preserve an imported PNG, exact pins and receipt after source deletion, backup, deletion of original data and paused restore; replay yields the same Bot and old renderer pending UUIDs are cleared. Bundled maintenance repeats the template/receipt path. Older stores initialize the empty document through ordinary runtime startup. |
| 10. Usable bilingual review | Desktop assertions cover long instructions, disabled unresolved choices, known/unknown errors, retry, correct profile navigation, keyboard Escape/focus return, no horizontal overflow and dialog bounds at 880×560. Inspected screenshots cover English light and Chinese dark; agent-browser exercised the isolated flow. |
| 11. Resource bounds, privacy and packaging | Host tests saturate four operations and verify content-free diagnostics. Runtime tests preserve replay at 4,096 receipts and reject a 129th distinct avatar without a receipt/profile. Protocol tests bound IPC; full boundary/type/unit/e2e checks and staged runtime/offline restore cover composition. |

## Limits

No live model/provider call was needed: template transfer is deterministic, and ScriptedModel verifies the eventual prompt. Instructions are exported as entered; the visible review does not redact arbitrary prose. Skill documents and provider credentials are not bundled. Import receipt retention is bounded with no automatic eviction. Native signing, notarization, distribution, cross-machine Keychain migration and B14f update/rollback compatibility remain separate release work. No release was published as part of B13e.

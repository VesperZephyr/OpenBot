# B14d: Consistent local backup and restore

Status: done (#61; merge 01f013a)
Branch: task/b14d-backup-restore
Depends on: B11d (#60), B14e, B15a and B10

## Goal

Export a consistent local snapshot and restore it without duplicating work or losing the previous data on a failed import. Provide the workflow in desktop Settings.

## Contract

- Desktop owns native selection, explicit interruption/replacement confirmation and application lifecycle. An offline maintenance entry in apps/local-server composes the backup service in server-core, using the bundled Node. A separate offline executor helper validates executor-owned stores without starting execution adapters. Desktop depends only on protocol. No model tool or remote API may initiate maintenance.
- Export and restore stop admission through the existing persisted user pause, confirm quiescence, stop the Host/executor and acquire the same exclusive Host store lock. Renderer mutations are blocked during maintenance; read refreshes wait until the Host is ready. Restart leaves work paused; interrupted effects are never replayed. Cancelling native selection/confirmation changes nothing.
- A version-1 directory snapshot includes openbot.sqlite, executor receipt/connector databases, saved input/output attachments and the reviewed skill library. Include SQLite and content together after checkpointing. Exclude credential stores, models.json, logs, browser/Electron profiles, locks, temporary output spills and user workspace/project files. Explain exclusions and local unencrypted sensitive data in Settings. No cloud upload.
- Manifest records format version, creation time, machine/account binding, explicit scope and per-file bytes/SHA-256, application/protocol/runtime provenance. Require the same Mac/account and supported format; this is recovery, not cross-machine migration. Maximum 20,000 files (40,000 total directory entries), 2 GiB total and 256 MiB per file. Reject symbolic links, special files, traversal, duplicate/case-colliding paths, unlisted payload files and malformed manifests. Validate SQLite integrity before replacement. Credentials remain in the existing Keychain and local configuration.
- Revalidate and stage selected content before touching active data. Force the staged Host lifecycle to user-paused using agent-runtime, without resuming Pi. Existing target-scoped grants and settled receipts survive; uncertain work requires explicit continuation. Reject snapshots retaining active process ownership or unfinished executor file mutations. Archive contents are data, never executable instructions.
- Restore keeps a valid pre-restore snapshot. Replace only the allowlisted managed roots, with a durable transaction journal and rollback copies. Interrupted uncommitted replacement rolls back before Host startup; a committed transaction finishes cleanup. Failure cannot silently start a partially restored store. Native selection and file hashes are validated again at use.
- Native UI has busy/error/result states and English/Chinese text. Successful restore reloads the renderer after the Host is ready so old conversation selections and cached data cannot be mistaken for restored state.

## Steps

1. Implement versioned backup service, integrity/limits and rollback recovery with invariant tests.
2. Compose an exclusive offline maintenance process and include it in packaged runtime verification.
3. Add trusted desktop picker/confirmation and Settings actions; no renderer-supplied paths.
4. Verify export, mutate/delete fixture data, restore and restart through the real desktop/Host/executor path. Check profiles, local/shared memory, groups/routines, artifact bytes, reviewed skill versions, receipts and paused admission.
5. Run check and full hidden e2e; inspect screenshots and explore the isolated app with agent-browser. Package and verify the bundled maintenance helper on isolated data. Do not restore over owner data or publish a release.
6. Record owner installation/radar acceptance separately, update plan/backlog and open this task's PR against main.

## Acceptance

- Restore after removing fixture originals preserves relationships and exact artifact/skill content; no automatic model or command execution.
- Corrupt/incompatible/foreign-machine archives, changed files, unsafe paths and live ownership fail before replacement.
- Failure during replacement recovers original data; successful restoration retains a valid rollback snapshot.
- Credentials/configuration/workspace originals are excluded and existing local credentials remain unchanged.
- Native cancellation is inert; UI shows progress, success, failure and paused recovery; hidden e2e and packaged maintenance verification pass.

## Verification — 2026-10-27

- `pnpm run check`: 564 tests passed. The final run used `pnpm run check --maxWorkers=4`, keeping all assertions and timeouts unchanged. Two preceding default-concurrency repeats hit existing artifact/spill filesystem timeouts; the artifact suite passed alone and the complete bounded-concurrency run passed.
- `pnpm run e2e`: all 182 cases in 48 files passed before the final two recovery cases were added. Final `e2e/backups.e2e.ts`: all seven passed, including startup rollback, damaged-journal fail-closed UI and interruption of a real approved command. CI runs the expanded 184-case suite on the PR.
- Restored after deleting all original managed fixture roots and the workspace report source. Compared complete local/shared memory state, Bot/group/routine identities, pinned skill revision/content and immutable report bytes. An already-due routine remained paused through restore and restart without a provider request.
- Unit fault injection exits an actual replacement child process without finally handlers; a fresh service rolls it back idempotently. Desktop startup independently recovered a partially replaced database. A damaged journal left the Host stopped with an explicit banner and retained original data.
- The active-command case wrote its first marker, was interrupted by native-confirmed backup, retained a cancelled receipt and never wrote its later marker or replayed after restart. Existing credentials/configuration canaries remained unchanged; sensitive/configuration and workspace roots were absent from the snapshot.
- Native selection/confirmation cancellation and renderer-navigation expiry were checked. Inspected `01-backup-exported.png`, `02-restored-paused.png`, `03-invalid-keeps-data.png`, `04-chinese-small.png` and `05-recovery-blocked.png` under `e2e/.run/backups/`. Agent-browser separately clicked export/restore in an isolated hidden app; the restored banner, recovery path and pause gate were visible.
- Packaged `0.0.0-b14d.20261027.1` with the pinned bundled Node. From an unrelated temporary directory, bundled Host/executor and offline helpers exported, deleted originals, restored and reopened the same Bot memory with user pause retained. `codesign --verify --deep --strict` passed the ad-hoc application bundle. No Developer ID, notarization or release publication is claimed.
- The owner's installed app remains merged #60, `0.0.0-b11d.20261027.1`; its real eleven-source acceptance is [recorded separately](../acceptance/radar-installed-2026-10-27.md). No B14d restore was performed on owner data.

## Open questions

None. Cross-machine migration, encrypted archives, cloud/periodic backups and incremental history compaction require separate specs.

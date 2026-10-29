# B14c baseline and draft groundwork — October 28, 2026

Status: historical baseline and initial groundwork, not final B14c acceptance. The owner approved the routine occurrence selector on October 28; production implementation and its final evidence are tracked in [the task spec](../tasks/b14c-history-scaling.md).

## Baseline measurement

Measured at documentation revision `9b4e953`, whose product code matches main `838b032`, before the new projection was used. Machine: Apple M3 Pro, 38,654,705,664 bytes physical memory; Node v22.22.2. System load was not captured, so this is an exploratory baseline, not the agreed comparative performance gate.

The initial fixture and diagnostic script were committed in `07cbaf0`, before production integration; the current fixture includes additional tool, compaction, artifact and large-row cases. The script creates and removes synthetic temporary state. It seeds 10,000 private messages, 10,000 group posts and 28 additional private conversations with 1,000 messages each. It reads only the first private conversation and group before timing search. It does not yet include the spec's complete tool/compaction/artifact/large-row fixture.

| Measurement | Result | Limit of this measurement |
| --- | ---: | --- |
| Private snapshot | 3,778,361 bytes; 10,019 display rows | Full legacy snapshot, including reset dividers |
| Group history | 3,801,903 bytes; 10,000 posts | Full canonical history |
| Private read | 66.60 ms | One adapter read; excludes renderer/IPC |
| Group read | 11.49 ms | One adapter read; excludes renderer/IPC |
| No-match search p95 | 2.85 ms | Five warm-ups, 30 samples; only the loaded 20,000-message private/group scope, not all 48,000 messages |
| Process RSS | 238,436,352 bytes | One sample including Pi and canonical group state |

The baseline establishes the full-history transport cost. It does not prove that the new worker, renderer or complete fixture meets the B14c thresholds.

## Draft implementation and regression checks

The draft adds a disposable SQLite store, worker request ownership, a Pi-side bounded projection queue, window/detail protocol types and reusable transcript projection. The store/projection are exercised directly by tests; Host composition, production RPC handlers, search consumers, settlement notifications, backup lifecycle and renderer migration are not connected yet. The existing application continues to use its existing history paths.

- `pnpm run check`: passes package boundaries, both TypeScript projects and 582 tests in 87 files.
- Seven new store/projection tests cover literal Unicode search parity, insertion-boundary pagination, scope/generation rejection, idempotent persistence, incomplete scope/cancellation, bounded anchor windows, row revision conflicts, transactional checkpoint rollback, tool-row updates, multi-megabyte Unicode detail reconstruction and projection checkpoint reopen. These are partial checks; the full failure/recovery/authority/operation-count matrix remains pending.
- `pnpm run e2e`: full background suite passes, 185 tests in 49 files (351.51 seconds). This is regression evidence for the existing application and transcript extraction, not end-to-end B14c acceptance.
- Screenshots inspected: `e2e/.run/routines/04-restored-en.png`, `e2e/.run/routines/06-history-zh-minimum.png`, and `e2e/.run/chat-streaming/06-compact-zh-dark.png`.
- Isolated agent-browser exploration connected to the background harness at port 9357, navigated Settings → Routines → History inspection, inspected controls/history, and captured `e2e/.run/b14c-inspect/routine-inspection.png`. The harness was closed afterward. No owner data or real provider was used.

Generated screenshots, execution logs and temporary inspection scripts remain ignored local artifacts. No native signing/TCC validation, packaged history-worker startup, full-fixture timing pass, or completed B14c acceptance is claimed.

# B14c history scaling acceptance — October 28, 2026

Initial implementation revision: `07a2cae`. Candidate: [PR #64](https://github.com/VesperZephyr/OpenBot/pull/64), branch `task/b14c-history-scaling`. Implements the [B14c spec](../tasks/b14c-history-scaling.md), including the approved routine occurrence selector. This is local automated acceptance, not a signed/native release gate.

## Environment and reproduction

Apple M3 Pro; 38,654,705,664 bytes physical memory; Node v22.22.2; Electron 44.7.2. The complete e2e suite uses two isolated background workers. The performance fixture recorded load averages of 5.58 / 5.41 / 5.15 at startup. No owner data, external provider or network/model timing is used.

Run `pnpm run check` and `pnpm run e2e`. For only the performance fixture, build the desktop and run `pnpm exec vitest run --config e2e/vitest.config.ts e2e/history-scaling.e2e.ts`. Machine-readable measurements, content-free worker counters and screenshots are generated under ignored `e2e/.run/history-scaling/`. `e2e/fixtures/history-host.mts` rejects production full-history snapshots and observers; it instruments public Pi reads and worker batches without recording messages or queries.

The deterministic corpus contains 10,000 direct messages, 10,000 group posts and 28 other conversations with 1,000 messages each. It includes tied timestamps, Chinese/English/emoji and combining characters, reset/compaction boundaries, 100 artifact references with tool calls/results, and one 2-MiB Unicode row. Artifacts deliberately have missing bytes so the fixture does not claim file-reader coverage from those references.

## Performance and bounds

Five warm-ups precede 30 samples. Switching measures selection through rendered frames; search includes repeated full-corpus no-match scans. Cold timing includes Electron/Host launch and sidecar rebuild, excluding fixture generation.

| Measurement | Result | Gate |
| --- | ---: | ---: |
| Warm conversation switching p95 | 52.15 ms | 500 ms |
| Literal search p95 | 667.71 ms | 1,000 ms |
| Live control-state reads during rebuild p95 | 1.12 ms | 250 ms |
| Cold launch and rebuild | 8.59 s | 60 s |
| Largest observed Pi batch | 256 entries | 256 |
| Largest worker write | 61,155 bytes / 129 records | 512 KiB / 256 records |
| Maximum simultaneous worker writes | 1 | 2 |
| Sampled renderer history cache | 3 conversations, 100 rows per conversation, 139,542 bytes total | 3 conversations × 3 windows × 100 rows; 8 MiB |
| Mounted history roots, 1,000 / 10,000 direct messages | 8 / 8 | 80 including overscan/tool children |
| Total DOM elements, sampled group view | 853 | Recorded separately from history roots |
| Host RSS high-water sample | 385,777,664 bytes | Recorded; not claimed constant |
| Renderer process RSS / peak RSS sample | 264,306,688 / 281,280,512 bytes | Electron process metrics, recorded separately |
| Renderer JS heap sample | 21,512,564 bytes | Recorded; not RSS |

Repeated warm windows do not increase public Pi entry-read counts. An additional Code Mode regression test verifies that a later ordinary message reads only its source checkpoint and new entries, without rereading settled tool-call/result bodies. Prepending exercises cache eviction, while structural assertions enforce window, cache, detail and DOM bounds. Search targets retain their offset within four CSS pixels after resize/theme changes. The historical baseline's 3.78-MB direct snapshot and 3.80-MB group history are replaced by at most 100 rows / 512 KiB per production window. The earlier baseline searched only 20,000 loaded messages; its search latency is not a comparable full-corpus benchmark.

## Correctness evidence

| Spec acceptance | Evidence |
| --- | --- |
| 1. Projection fidelity | `history-projection.test.ts` compares the complete windowed transcript against the legacy projection across reset/compaction and a tool call/result separated by 700 entries; checks stable tool IDs/statuses and checkpoint reopen. Existing artifact, Code Mode, group and routine suites exercise presentation and settlement. |
| 2. Bounded work | Instrumented full-corpus e2e rejects legacy production snapshots/observers and asserts Pi/write/window/cache/DOM bounds. Window schemas reject invalid limits/selectors; store tests bound serialized windows and UTF-8 detail chunks. |
| 3. Literal search parity | `history-store.test.ts` compares snippets/offsets against the previous JavaScript `/iu` oracle, including Unicode and chunk boundaries. Fixed insertion cursors, tied timestamps, scopes, restart and cancellation are tested; application/desktop suites cover hidden/deleted/dissolved conversations, unread filtering and group Core authority. |
| 4. Incremental correctness | Tests cover duplicate rows, transactional rollback, missed commits, commit-identity overflow, bounded waiting-search admission/cancellation, checkpoint catch-up, worker termination, one automatic restart, explicit Retry, an unwritable cache location and SQLite disk-full rollback. |
| 5. Reading state | Long-history e2e covers exact old hits, repeated prepend/eviction, resize/theme anchoring, drafts and Jump to latest. Existing streaming/conversation/files suites cover delayed layout, locale, compact readers and conversation switches. |
| 6. Controls and receipts | `history-controls.e2e.ts` approves and stops while window reads fail, preserves a draft and verifies one command effect after recovery. Existing Runs, collaboration, read-receipt, background and scheduled-summary suites cover cancellation, steering, nested settlement and source-bound acknowledgements. |
| 7. Restore/privacy | Backup unit/e2e tests verify cache exclusion/invalidation, reused identities, replacement/rollback recovery, paused restore, attachments/skills/report identity and no replay. Routine tests reject mismatched occurrence/Bot bindings and exclude private execution text from public search. |
| 8. Large-row safety | A 2-MiB Unicode row has an explicit preview and complete ordered parts. Tests reconstruct the display text, reject stale/mismatched detail references, and exercise the three-part plain-text reader, previous/next and copying displayed parts. |
| 9. Performance | Fixed fixture and measured gates above; 1,000/10,000-row views retain bounded caches and mounted rows. |
| 10. Integration | Final command totals and inspection record below. |

## Integration results

`pnpm run check` passed package boundaries, both TypeScript projects and 591 tests in 87 files (test duration 29.47 seconds). The final `pnpm run e2e` passed all 190 tests in 51 files (320.83 seconds), including the unavailable-history recovery and consecutive Bot management approvals. `node apps/desktop/scripts/stage-runtime.mjs` passed the bundled runtime check. `git diff --check` passed.

The bundled runtime check starts the staged Node/Host/executor/history worker, exports without the sidecar, deletes fixture originals, restores, verifies a new cache generation and a paused restart, then closes the processes.

Screenshots inspected include long-history exact search in dark mode, unavailable-history approval controls, the large-message reader, group execution details, and Chinese routine/streaming layouts at minimum width. An isolated background copy of the synthetic corpus was explored through agent-browser on port 9357: select History 0, search `Record 517:`, open the exact old row, and Jump to latest. Its screenshot is `e2e/.run/b14c-final-inspect/01-returned-latest.png`; that harness was closed.

## Main integration and CI readiness

The candidate incorporates main `4c64a43`, including merged B4a/#62 and I7/#63. The initial measurements and command totals above belong to `07a2cae`; the PR records the latest integrated check results.

The missed-commit correctness test explicitly delays its first worker start by 1.5 seconds, reproducing a CI failure caused by the default one-second polling deadline. Worker lifecycle assertions now wait up to 10 seconds for their expected state, including restart and explicit Retry. The seven projection tests pass with this delay, and the integrated `pnpm run check` passes 596 tests across 87 files. Cold rebuild, switching, search and control-response performance thresholds remain unchanged in `history-scaling.e2e.ts`.

## Remaining limits

Literal search still has linear worst-case CPU. Canonical Pi active context, the existing group/execution documents and lightweight source/settlement identity metadata remain sources of total Host memory growth; these are not moved into disposable storage. Large legacy entries must still be materialized by the public Pi read API before bounded projection. Search acceleration or canonical group-storage migration needs a separate spec.

No real-model spot check, new native permission test, signing/notarization or installed release acceptance is claimed. B4a/#62 and I7/#63 are merged into the integration base. The owner merges the candidate.

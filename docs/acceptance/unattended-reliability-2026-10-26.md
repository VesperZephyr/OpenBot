# B11d unattended reliability acceptance

Date: 2026-10-26 (Asia/Singapore)
Spec: [B11d](../tasks/b11d-unattended-reliability.md)
Base: `f07ded9` (main after D10 / #59)

## Automated checks

`pnpm run check` passed boundary validation, type checking and 542 tests in 81 files. `pnpm run e2e` passed 177 tests in 47 files (319.75 seconds). The full desktop suite uses isolated state, background windows and a scripted provider.

The new process-level scenario injects an invalid timezone into one isolated saved routine, admits two healthy source routines and their summary through the ordinary timer, and verifies that all three publish exactly once. It exercises group rename, source rename through the desktop editor, lock state, fault visibility in English and Chinese, repair through the version-checked API and restart. All healthy schedules remain enabled; the summary captures 2/2 sources.

Lifecycle coverage also interrupts a real supervised command after its first write, confirms cancellation, wakes the scheduler and verifies that neither the model nor the command is repeated. Explicit continuation remains a separate action. Unit coverage includes uncertain stop, persisted resume eligibility, stale native events, user pause racing with wake, semantic versus edit revision conflicts, lost publication responses and per-record retry backoff.

## Bounded real-provider run

Command:

```sh
node --experimental-transform-types scripts/acceptance/unattended-reliability.mts \
  --run --provider mafia --model claude-opus-5-5 \
  --name b11d-real-20261026-v2 --inspect-ms 180000
```

The runner loads the configured endpoint, resolves its key helper in memory and forwards a maximum of eight inference requests through a loopback proxy. It uses isolated Bots, a group, credentials namespace, database and workspace. No owner schedule, conversation or installed app is changed. Temporary model configuration is removed on exit; reports and evidence remain in ignored `e2e/.run/` paths.

Observed results:

| Check | Result |
| --- | --- |
| Timer admission, without sending a chat message or pressing Test run | Two research reports and one summary completed |
| Real inference | Five Opus 5.5 requests, within the eight-request budget |
| Official sources | One successful fetch each for the WorkBuddy changelog and Claude Code repository changelog |
| Group and source rename during the first inference request | Work remained authorized; all three reports reached the renamed group |
| Native lock event active during reporting | Background work completed without a manual resume |
| Independent invalid schedule | Retry fault remained visible while healthy reports completed |
| Summary input snapshot | 2/2 ready; both primary-source URLs retained |
| Successful suspend/wake transition | New work gate reopened automatically |
| Repair invalid schedule | Scheduler fault cleared |
| Restart | Exact three posts retained, with no duplicate publication or additional model request |

The source reports distinguished the latest visible release from a release known to occur that day; the summary preserved unknown and conflicting dates. This is a two-source spot check, not a quality claim about the complete daily monitoring roster.

The first runner attempt failed before inference because its temporary model configuration used an unsupported model-level credential field. The runner now uses the provider-level field and validates configuration before admission. That attempt made zero upstream requests. The corrected run above passed.

## Desktop inspection

Inspected the rendered failure status, retry time and recovered schedule list, including Chinese copy. In the real-model app, opened the completed summary from the group, inspected its captured inputs and followed a source-report link back to the corresponding group post. The renamed routines remained scheduled after restart. The screenshots showed readable report content, input status and controls without clipping in the tested window.

Local evidence (ignored, not committed):

- `e2e/.run/unattended-reliability/01-independent-failure.png`
- `e2e/.run/unattended-reliability/02-independent-failure-zh.png`
- `e2e/.run/unattended-reliability/03-recovered.png`
- `e2e/.run/b11d-real-20261026-v2/real-scheduled-chain.png`
- `e2e/.run/b11d-real-20261026-v2/real-restarted-chain.png`
- `e2e/.run/b11d-real-20261026-v2/manual-source-navigation.png`
- `e2e/.run/b11d-real-20261026-v2/evidence.json` and `reports.json`

## Limits

Native events were emitted through Electron's `powerMonitor` in the isolated app. The owner's Mac was not physically locked or suspended. Physical sleep/wake delivery, overnight availability and packaged identity/signing remain native acceptance checks. The current batch covers non-interactive tools; future browser/desktop input needs its own lock-sensitive permission gate.

Fault isolation contains rejected operations and malformed individual schedules. Shared storage failure prevents safe scheduling; it is not treated as permission to continue. Retry diagnostics are process-local and rebuilt after restart; durable occurrence and execution identities remain the source of truth. This change does not claim to recover an indefinitely hung shared storage or runtime operation.

Previously disabled schedules remain disabled. An old installation's legacy recovery latch is not silently cleared, and no interrupted command is replayed automatically.

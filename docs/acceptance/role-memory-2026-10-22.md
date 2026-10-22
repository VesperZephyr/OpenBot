# Local Role and Memory Smoke Acceptance — 2026-10-22

Scope: [I4](../tasks/i4-role-memory-acceptance.md), on merged B27a/B27b (`main` at `0d34b31`). Real execution used a hidden isolated desktop, synthetic invoices, the real Host/executor and `mafia / claude-opus-5-5`. The owner limited further model spending; no additional real-model calls were made after the observed skill-selection defect.

## Real-model observations

The useful Claude trial made 13 inference requests across three stages in approximately 96 seconds. This is a bounded smoke check, not a memory-quality benchmark.

| Check | Observed result |
| --- | --- |
| Learn two local notes | Passed: a collection policy and a separate role-local synthetic code were persisted with model provenance |
| New topic and full desktop restart | Passed: without restating the policy, the Bot read six invoice rows and published an actual Markdown report plus JSON |
| Initial arithmetic | Correct: unpaid total USD 3,500; strictly over 14 days USD 2,200; IDs A101/A103/A105; paid and exact-boundary rows excluded |
| Conversational correction | Passed: the existing policy topic changed from 14 to 20 days, without adding a conflicting topic |
| Corrected work after restart/new topic | Arithmetic correct: USD 1,600, IDs A101/A105; source CSV unchanged |
| Skill selection with a newer library revision | Failed: accepted input still contained pinned v1, but the model loaded catalog v2 and used it in the report |
| Owner-protected correction, shared-role review, real group collaboration | Not reached; further real-model execution was stopped under the reduced spending scope |

The skill failure was not a storage/admission upgrade: captured input supplied v1, while the shared catalog advertised v2. The model explicitly chose the latter. The fix makes the catalog describe availability rather than task selection, gives the attached exact revision precedence, and repeats that instruction alongside the accepted skill document. Tool grants, library inspection and stored snapshots are unchanged. This is prompt guidance, not a new enforcement or security boundary. Its real-model effectiveness has **not** been retested; deterministic coverage verifies the corrected input contract.

Earlier GPT trials did not qualify as successful acceptance: one timed out after overload responses and a partial memory write; another ended with an upstream inference error. The first Claude attempt was rejected by the test proxy before inference because the proxy did not accept the SDK's query parameters; the runner was corrected before the successful useful trial. Infrastructure/test-harness failures are separate from the observed skill behavior.

## Deterministic coverage

`e2e/role-memory-workflow.e2e.ts` adds three combined scenarios:

- Owner correction plus a new topic/restart keeps the current policy and original accepted method despite a newer catalog entry.
- Another role receives owner-shared context and its own method without automatically receiving the analyst's local note. Reading a shared report can legitimately reveal that report's method version; this is distinct from automatic instruction injection.
- A bounded Core → analyst → reviewer → result chain explicitly loads group procedures, preserves group memory scope and does not repeat after restart.

The initial combined unit/Host check passed 495 tests in 75 suites; the focused integration passed 3/3. Final checks after the prompt correction and exact revision are recorded in the I4 PR. Scripted tests verify runtime/input contracts and file effects, not independent model reasoning. Native release validation is outside this task.

## Reproduction and cleanup

After building the desktop, the opt-in runner is:

```sh
node scripts/acceptance/role-memory.mts --run --provider mafia --model claude-opus-5-5
```

The selected model must already exist in the supplied user configuration. Default execution includes learning, restart recall and correction only, with an 8,192-token per-response ceiling; it still incurs provider usage. `--extended` explicitly adds owner/shared/group trials. Each stage has a bounded deadline. The proxy captures synthetic request bodies and status metadata, never credential headers. Raw evidence remains under ignored `e2e/.run/role-memory-real-*` directories. Temporary model configurations from all four attempted runs were removed and their desktops closed. Owner application state, settings and files were not used as task data.

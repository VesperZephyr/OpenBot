# OpenBot Changes to Vendored Pi

Baseline: `b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb` (see `.openbot-vendor.json` and `BASELINE.json`).

Every file under `third_party/pi/` matches `BASELINE.json` except for the entries below. Each change has an ID, a reason, the affected files, and how it was validated.

## Generated Assets

| ID | Change | Files | Validation |
| --- | --- | --- | --- |
| OB-ASSET-1 | Generated `pi-ai` provider model data with this revision's `generate-models.ts --strict --data-only` (`pnpm run hydrate-model-data` in `packages/ai`) on 2026-10-14. Upstream ignores this directory in Git and generates it at build time; vendoring it lets `build:offline` run without network access. The upstream Nix catalog pin (2026-10-07) was not used because it predates generator fixes in this revision and fails 10 `pi-ai` metadata tests. | `packages/ai/src/providers/data/*` (hashes in `BASELINE.json` under `generated`) | `check-model-data.ts` reports valid data; `pi-ai` tests pass |

## Workspace Adaptations

These are OpenBot workspace settings, not edits to vendored files.

| ID | Change | Where | Reason |
| --- | --- | --- | --- |
| OB-DEP-1 | Publicly hoist `@smithy/types` | `.npmrc` | `pi-ai`'s `bedrock-converse-stream.ts` imports types from `@smithy/types` without declaring it. Upstream npm hoists it through `@aws-sdk/client-bedrock-runtime`; pnpm's strict layout does not. |
| OB-DEP-2 | Link exact-version Pi dependencies to the workspace | `.npmrc` (`link-workspace-packages`, `prefer-workspace-packages`) | Upstream manifests pin each other as `"1.2.0"` rather than `workspace:*`. |

## Source Patches

None.

## Known Test Differences

| Test | Result | Reason |
| --- | --- | --- |
| `codemode/test/worker-lifetime.test.ts`, three `Bun process lifetime` cases | Fail with Bun 1.3.14 when `bun` is on `PATH`; skipped otherwise | The fixture prints its exit line only when Bun terminates the worker; upstream notes Bun-specific `terminate()` behavior. OpenBot runs Pi on Node, where the matching cases pass. |

## Runtime patches

| ID | Change | Files | Validation |
| --- | --- | --- | --- |
| OB-CODEMODE-1 | Optional bridge budgets enforced inside the QuickJS VM before messages cross into the Host: total/tool/pending calls, argument bytes, output bytes/items, return bytes and scratch writes. Overflow latches a failure and interrupts even if script code catches it. Budgets enter the replay fingerprint; defaults retain upstream behavior. | `packages/codemode/src/{types,index}.ts`, `packages/codemode/src/runtime/{execution,protocol,vm}.ts`, `packages/codemode/test/bridge-limits.test.ts` | Bridge flood, allocation, empty-output, interrupt and physical-worker-exit tests; durable Code Mode replay/model tests; OpenBot B25 Host integration. |

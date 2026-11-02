# I9: Fast Correctness Checks with Oxlint

Status: in progress
Branch: task/i9-oxlint
Depends on: I8 (stacked review; owner merges I8 first)
Architecture: verification tooling; product boundaries and contracts unchanged

## Goal

Catch inexpensive JavaScript/TypeScript correctness mistakes before unit/e2e execution, with a reproducible pinned linter and no reduction in existing verification.

## Scope

In: pinned Oxlint, explicit root configuration, lint and fast-check package commands, CI enforcement through check, narrowly reviewed cleanup of existing diagnostics, and measured acceptance.
Out: formatter adoption, all-rule activation, type-aware lint, ESLint migration (there is no ESLint configuration), vendor edits, global hook installation/replacement, Linux migration, paid resources, test removal/skipping/retries, and behavior redesign.

## Design

Adopt Oxlint's correctness category with the built-in TypeScript/Oxc/Unicorn plugins. Pin the exact version so changes in recommended rules are deliberate. Scan product code, tests, scripts and e2e; exclude vendored sources, dependency trees, generated outputs and test artifacts. The existing boundary checker remains authoritative for application dependency rules.

Resolve unused imports/bindings and equivalent expressions without removing side effects, assertions or DOM-prop filtering. Intentional collection snapshots protect iteration when callbacks mutate collections; preserve those snapshots with local rule exceptions. Intentional control-character regexes protect inputs; preserve them with a local rule exception explaining their purpose. Do not globally disable useful rules to clear existing diagnostics. Full React/Vitest plugin sets and type-aware rules need a separately reviewed increment rather than introducing hundreds of unrelated changes.

Provide a fast local command for lint, boundaries and whole-project type checking. Keep the existing machine-global hooks untouched; CI enforcement does not depend on a local hook being installed.

## Contracts

- lint returns nonzero for selected-rule violations and has no automatic fix mode in CI.
- check invokes lint before the existing boundaries/types/unit checks; e2e, history isolation and required gate remain intact.
- All existing tests, assertions and synthetic fixtures remain covered. Unused expressions with deliberate side effects retain those effects.
- Use only standard GitHub-hosted runners. No subscription, paid runner, billing change or global machine configuration is required.

## Steps

1. Claim a separate task branch/PR based on the verified I8 candidate and record the stacked dependency.
2. Pin Oxlint, configure selected rules and ignores, resolve reviewed diagnostics and wire lint/fast checks into package scripts. Update the agent guide to describe actual enforcement.
3. Validate deliberate invalid/valid lint fixtures, run full check and e2e, and inspect relevant screenshots.
4. Run CI after the final implementation and compare exact baseline/I8/I9 revisions, including lint's measured cost and unchanged e2e coverage. Keep results separate from claims of statistically established speedup.

## Acceptance

1. lint passes the repository; a temporary forbidden unused import fails and intentional sanitizer patterns stay intact. Generated/vendor paths remain ignored.
2. `pnpm run check:quick`, `pnpm run check` and full `pnpm run e2e` pass; no tests are deleted, skipped or weakened.
3. The lockfile is updated, a frozen install succeeds, and existing product-package boundary checks still run.
4. Standard-runner CI passes and evidence includes exact run URLs, timings, coverage and limitations. No product behavior changes are inferred solely from lint cleanup.

## Risks

Removing unused bindings can accidentally remove initializer side effects; review each edit. React Markdown destructuring intentionally removes AST props before DOM forwarding. Sanitizing regexes intentionally match control characters. CI cache misses caused by lockfile changes must be separated from lint runtime in comparison.

## Open questions

None.

## Evidence

Pending. The preliminary local audit of pinned Oxlint 1.90.0 found 44 warnings in 391 files in approximately 0.10 seconds after installation; this is not a CI result.

# B27b: Per-Role Skill Defaults

Status: ready
Branch: task/b27b-role-skills; pull request target: main
Depends on: B10/B19; owner-approved D6 role direction
Architecture: Sections 5.7 and 5.9

## Goal

Let each local Bot use a deliberate set of reviewed procedures in its direct user conversations, with exact versions and durable accepted inputs. Keep one shared skill library and independent tool authorization.

## Scope

In: optional exact skill references on Bot profiles; owner-only configuration and explicit revision adoption; default/message composition; immutable accepted skill snapshots; bilingual profile/composer presentation; duplicate/settings compatibility.

Out: private skill libraries, automatic skill creation/upgrades, new tool grants, model-edited role associations, group default propagation, changing routine pins, cloud services, embeddings and capability restriction claims.

## Contracts

- Add optional `defaultSkills: SkillRef[]` to Bot profiles/records. Legacy profiles have no defaults. Limit two distinct names, each pinned by name/revision/SHA-256. Keep existing profile CAS and update events. Duplication copies settings and pins with empty memory/history. Model management schemas do not gain this field.
- The owner selects defaults in Profile from the shared library, inspects the exact procedure, and explicitly saves. Existing stale/unavailable pins remain visible and removable. Never silently upgrade a pin; choosing a newer revision is an explicit selection after preview. Validate every newly submitted selection against the executor-backed library before the profile commit. Invalid references fail without losing the draft. No tool authorization changes.
- Compose defaults only for new direct user message admission, inside the Run scheduler's serial admission path. Group, peer, background and routine admission use their existing explicit references; routine pins remain authoritative.
- Merge profile defaults and explicit message skills in stable order. Identical references deduplicate. Same name/different version or a union over two names fails visibly before creating a Run; no silent omission or upgrade. The composer shows current role defaults and explains how to resolve a conflict by editing profile defaults or message attachments. This increment does not add a per-message override switch.
- Read the current profile once at admission and resolve the exact combined references to immutable documents. Persist the defaults used and the explicit request references alongside existing accepted skill snapshots. A profile edit while resolution is in progress affects later admissions, not that selected snapshot. Queued/steered accepted inputs, restart and continuation use recorded documents even if the library/profile changes later.
- Replay compares the original explicit request references, not today's defaults, then returns the accepted Run. Legacy messages without composition metadata retain old comparison behavior. Changed text/attachments/explicit references under the same request ID still fail. A failed fresh admission creates no Run or accepted identity.
- Missing/deleted/corrupt exact versions fail admission visibly. Already accepted documents remain usable under the original permission boundary. No latest-version fallback. Changing defaults does not remove procedures already present in conversation history; a new topic starts fresh context.
- Stored references identify methods, not capability grants, learned facts or model training. Shared library revisions remain reusable by other Bots. All state and execution stay on the local Mac; configurable inference endpoints are unchanged.

## Steps

1. Add profile fields and strict schemas; preserve runtime profile revision and duplication contracts.
2. Validate owner configuration via the shared skill service; retain model management restrictions.
3. Compose and freeze role defaults during direct admission with replay-safe request metadata.
4. Add exact-version preview/select/remove controls to Profile and visible role defaults in the composer; translate new text.
5. Add unit/Host coverage for merge conflicts, missing versions, scope, request replay, queue/restart/continuation and model schema rejection. Add ScriptedModel e2e for selection, preview/adoption, distinct roles, durable defaults and conflict-preserved drafts.
6. Run full check/e2e, inspect screenshots and explore an isolated hidden app. Record acceptance and submit one PR.

## Acceptance

1. Legacy Bots remain unchanged; owner edits are revision checked and exact pins survive restart and duplication. Model tools cannot configure defaults.
2. Direct user requests receive exact selected procedure text; another Bot, groups and routines do not inherit it accidentally.
3. Identical pins deduplicate; differing revisions, excess names and missing versions fail before acceptance. Drafts stay editable.
4. Accepted/queued inputs retain snapshots after profile/library edits and restart; replay matches original explicit inputs and continuation retains accepted methods.
5. Bilingual profile/composer controls support exact-version preview, deliberate adoption/removal and small windows.
6. Full check/e2e pass, screenshot inspection and isolated agent-browser exploration are recorded. Scripted tests prove context composition, not real-model procedure quality.

## Open questions

None. Per-message overrides, project-specific skill sets, group defaults, capability readiness and semantic method evaluation remain separate work.

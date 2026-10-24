# B11b: Scheduled reports in group conversations

Status: done, merged into main in [PR #53](https://github.com/VesperZephyr/OpenBot/pull/53)
Branch: task/b11b-group-routine-reports
Depends on: B11a, B13c, D7

## Goal

Let two specialist Bots research domestic and international Agent changelogs on schedules and deliver attributable reports to one group. Keep creation, inspection and follow-up close to that conversation. This is the owner's next delivery priority, authorized on 2026-10-22.

## Evidence and scope

Read-only inspection of the owner's Grok Bot desktop on 2026-10-22 showed two regional researchers publishing into a common group, daily schedules in Bot details, linked primary sources, an explicit reporting window, stable/prerelease distinctions, corrections and a coordinator summary. Private transcripts and screenshots are not repository fixtures. These observations establish interaction requirements, not the accuracy of competitor claims or Grok's backend guarantees. [Official collaboration documentation](https://docs.x.ai/grok-bot/chat-and-collaboration) separately documents groups and directed follow-ups.

OpenBot already creates groups, routes mentions, runs isolated scheduled workflows and publishes private reports. The missing contract is an owner-selected group destination. Reuse the scheduler and publication machinery; do not add an unrestricted messaging tool, browser control, remote scheduling or automatic peer wakeups.

## Contracts

- `RoutineFields.reportTo?: { groupId: string; groupRevision: number }` selects an active group containing the owning Bot. Omission retains private delivery for legacy records. The confirmation screen names the destination. Selection is user-only through existing routine methods.
- Each occurrence freezes `reportTo` and the group's revision at creation. Validation runs on create/update/resume/test, before admission and during tool authorization. Group deletion, membership change or any group revision change invalidates pending work and publication. A renamed/edited group requires an explicit routine edit/reconfirmation for future work; the routine itself is paused when the destination becomes invalid.
- The routine stores its confirmed group revision. A stale group does not silently authorize later re-addition or new membership. Private history and group history are excluded from routine inference as before; current profile/memory behavior remains unchanged. A group destination is output sharing, not group collaboration authority.
- Terminal publication atomically reads the stored occurrence and routine, validates destination and current member identity, adds one attributed `GroupPost` keyed by occurrence identity, and marks the occurrence published in the same Host-owned transaction. The model cannot choose the group, author, metadata or wake recipients. A report contains existing bounded text, confirmed artifact references and `routine?: RoutineReport` metadata. Publication updates unread/search projections and never creates a delivery/root.
- An invalid destination pauses its routine and marks the occurrence's delivery blocked with a visible fixed explanation in routine history. It does not reroute to another chat or leak a partially completed report. Completed external actions remain completed. Historical already-published reports remain available. No model text is used as an authority claim.
- Routine edits/pause/delete invalidate pending occurrences as in B11a. Editing destinations never redirects an old occurrence. Stable publication identities and terminal markers survive restart and history retention.
- Renderer exposes the destination in edit/review/detail, a contextual list and New routine entry in group details, and a report-to-run-history link. Group entry preselects the group and one of its active members. Existing Settings entry and private routines remain supported. All product copy is English with Simplified Chinese translations.

## Steps

1. Add optional destination/revision and delivery status contracts, schemas and atomic runtime publication; test destination authority and deduplication.
2. Integrate destination validation and cancellation into existing scheduling without new tool authority.
3. Add destination selection, contextual group routines, report metadata and navigation. Preserve drafts and current chat interactions.
4. Add deterministic two-hunter desktop acceptance using ScriptedModel: create group/schedules, report sources and missing retrieval honestly, inspect reports, ask Core to summarize, restart without duplicate posts, and remove a member during pending work.
5. Document the reproducible competitor workflow and verification; run full check/e2e, inspect screenshots and explore an isolated app. Separately label live retrieval or real-model checks.

## Acceptance

1. Legacy private routines still publish once; malformed/unknown/non-member destinations fail.
2. Destination confirmation, revisions and immutable occurrences prevent publication after group edits, deletion, member removal/re-addition or destination changes. No inferred group authority or peer wakeup exists.
3. Two independently scheduled Bots post exactly once under their own identities to one group; reports remain searchable/readable after Host and desktop restart. No private conversation text appears in routine input.
4. Group details opens prefilled routine creation and existing routine history; report links open the exact occurrence. English/Chinese layouts and source links remain usable.
5. Sources distinguish verified releases, prereleases, no update and unavailable retrieval; scripts verify runtime contracts, not model reasoning. A follow-up group request can summarize the reports through existing Core routing.
6. Full `pnpm run check`, `pnpm run e2e`, screenshot inspection and isolated agent-browser exploration pass. Native release gates remain separate.

## Verification (2026-10-23)

- `pnpm run check`: 512 tests in 77 files, package boundaries and both TypeScript projects. Destination tests cover unknown/stale/non-member groups, scheduled publication, no private copy or peer wakeups, restart identity, remove/re-add revocation, explicit reconfirmation, group dissolution after settlement, destination changes and twenty-occurrence retention.
- One full-check attempt timed out in the existing spill-file test cleanup hook while desktop compilation was also running; the complete rerun passed all 512 tests without a code or timeout change.
- `pnpm run e2e`: 157 tests in 44 files. `e2e/group-routines.e2e.ts` adds four combined scenarios for UI creation/review, two attributed reports, a refused retrieval, user-requested Core summary, Host/desktop restart, search/history navigation, Chinese layout and membership changes during approval. Existing private-routine acceptance remains passing.
- Inspected the English destination review, Chinese group details and blocked-destination screenshots under ignored `e2e/.run/group-routines/`. Agent-browser explored the isolated real-provider app through CDP, inspected both report authors and sources, opened group details and confirmed that contextual creation preselects the group and a member.
- Separate real-provider acceptance used the configured `claude-sonnet-5-5` model in an isolated app: WorkBuddy and Claude Code official changelogs each required two requests, four requests total. Both `web_fetch` calls succeeded, both reports completed and were published under the correct Bot, no group tasks were created, and a full relaunch preserved exactly two posts. WorkBuddy's report qualified the lack of a listed update; Claude Code's undated source was explicitly insufficient to verify a 24-hour window. This validates two source/report paths, not every product in the catalogue or all model claims.
- The live trial exercised the implementation working tree based on specification commit `f60cba2`; the ignored evidence records that base commit. Later changes added explicit current-member display, disabled blocked Test/Resume controls and enforced finished-history retention; automated checks cover the final candidate. No owner conversation data was changed. Temporary model configuration was removed after the trial.
- A direct retrieval probe found that GitHub release HTML can return a navigation shell; the official Kimi Code releases API returned actual release content. The [workflow](../workflows/competitor-radar.md) requires actual release bodies, pagination, source fallback and explicit uncertainty.

Repeat the bounded live trial only when needed, after building the desktop:

```sh
node scripts/acceptance/group-radar.mts --run --provider <configured-provider> --model <configured-model>
```

The runner caps upstream inference at twelve requests and 4,096 output tokens per request, with per-report deadlines. It writes ignored evidence and supports optional bounded background inspection through `--inspect-ms`. It is not part of deterministic CI.

Native permissions, signing, clean installation and physical lifecycle acceptance remain separate release gates. Automatic coordinator summaries, conversational routine proposals and browser control are not implemented by this batch.

## Open questions

None.

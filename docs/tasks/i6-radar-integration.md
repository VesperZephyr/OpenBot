# I6: Integrated daily radar acceptance

Status: in progress
Branch: task/i6-radar-integration
Depends on: B11b (main), reviewed B11c and D8
Architecture: local deployment, routines, report composition and lifecycle

## Goal

Deliver the reviewed scheduled summaries and chat experience together on current main, update the owner's local application, and verify a useful source-backed daily radar using the existing generic capabilities.

## Scope and contracts

- Integrate the B11c and D8 contracts without changing their authority, persistence or product boundaries. Preserve I5's isolated parallel regression coverage.
- Keep two researcher Bots, the existing Core, group membership, monitored products, sources and daily times as owner configuration. Do not create built-in radar Bots or a special-purpose scheduler.
- Audit all eleven configured products using live official sources. Prefer dated full release bodies, public feeds and documented endpoints. Never infer no update from extraction failure, missing dates, rate limits or incomplete pagination. Keep CLI, IDE, desktop and prerelease variants distinct.
- Improve the editable workflow and source catalogue from this evidence. Changes to generic retrieval behavior require a documented contract before implementation; browser/computer control, OAuth and cloud scheduling are excluded.
- Back up owner state while no Host owns it, update to the tested integration commit, preserve model configuration and existing Bot/group identities, and reconfirm exact routine revisions after editing inputs.
- Exercise the actual scheduled admission, both researcher publications and Core's summary with a bounded real-provider run. A temporary near-future daily schedule may validate the same calendar path, but must be labelled acceptance and restored to the owner's daily times. Do not claim this proves multi-day availability.
- Inspect app lifecycle availability and restart deduplication. Local schedules require the Mac awake and OpenBot running; report remaining native gates explicitly.

## Steps

1. Merge the reviewed feature branch into current main on this task branch; resolve documentation only unless regression reveals a contract-preserving defect.
2. Run check and hidden e2e, inspect screenshots, and exercise the integrated UI with agent-browser.
3. Audit official sources and update workflow instructions with traceable retrieval outcomes.
4. Back up, update and launch the owner's app. Verify existing configuration and run a real scheduled chain, inspect citations and failure classification, then restore daily schedules and check restart behavior.
5. Record exact automated and real evidence separately; update plan/backlog and open a PR targeting main.

## Acceptance

1. Main plus B11c/D8 pass boundaries, type checking, unit tests and the complete hidden desktop suite.
2. Existing owner group/Bots/default model persist; mixed chats, compact settings and streamed activity are visible in the running candidate.
3. Every configured product has a checked official source or an explicit unresolved failure; daily reports distinguish dated updates from unknown coverage.
4. Real scheduled occurrences publish the two researcher reports and one Core summary with captured provenance, without a chat message or test-run trigger; no duplicate after restart.
5. Original daily times, enabled state and confirmed input revisions are verified after acceptance.

## Evidence

Pending.

## Risks

Public sources and inference can fail. Coverage must remain explicit; a successful model response alone does not prove news accuracy. App termination or Mac sleep prevents exact-time local execution. State backups and private reports stay outside Git.

## Open questions

None.

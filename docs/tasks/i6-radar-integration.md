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

## Live-audit retrieval correction (ready, 2026-10-24)

The Host currently rejects official GitHub Atom feeds as non-text while the public API returns a rate limit on this Mac. Extend existing `web_fetch` MIME recognition to Atom (`application/atom+xml`) and RSS (`application/rss+xml`); preserve the feed as source XML, including original published/updated fields and links, through existing bounded character pagination. Do not equate an Atom updated timestamp with original publication, interpret feed content as instructions, execute XML/HTML, expand external entities, fetch linked resources or add credentials. Existing public-address checks, redirects, timeout, error statuses and policy routing remain unchanged. A source feed may be incomplete; instructions must not claim full-window coverage without reaching its boundary.

A second live-audit defect is context loss: article extraction strips TRAE's date/version column while retaining its release prose. Add optional `mode: "article" | "page"` to the existing web_fetch tool schema, default article. Page mode converts the complete server-rendered body with the same absolute-link normalization, script/style removal and pagination; it never executes JavaScript. Include `extraction_mode: page` in output. Preserve source datetime attributes for standard `time[datetime]` and `relative-time[datetime]` elements alongside their visible label, including nonempty labels that omit the year or UTC offset. The first real scheduled run exposed this precision loss on GitHub release pages. Do not assign publication semantics to arbitrary time elements. The researcher may request page mode only when article mode loses version/date context; navigation text remains untrusted. Unit tests must preserve metadata alongside bodies and absolute links, and desktop coverage must route the optional argument through the model tool contract.

The body byte cap must not silently return a successful complete document: reject an oversized HTTP body with a clear size-limit error before parsing. Exactly-at-limit responses remain readable. This prevents a cropped feed from supporting a false no-release claim. Verify feed MIME/dates, pagination, error statuses and byte-limit handling in unit tests; verify a routed feed read and dated answer through the desktop using ScriptedModel.

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

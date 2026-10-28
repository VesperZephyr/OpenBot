# B4a: Reliable web pagination and research coverage

Status: done (#62; merge 4c64a43)
Branch: task/b4a-web-pagination
Depends on: B4, I6, B11d
Architecture: sections 5.1–5.2 (routed Host research tools)

## Goal
Keep long-page continuation instructions and every delivered character intact through the model output boundary. Verify the installed eleven-source radar without describing incomplete research as no update.

## Scope
In: bounded web_fetch pages, explicit coverage metadata, content-change detection, generic research guidance, regression tests and installed owner workflow acceptance.
Out: browser execution, vendor changes, historical release crawling services and a built-in radar product. Bots, sources and routines remain user configuration.

## Design
Bound the complete tool response below Pi's existing 50 KiB / 2000-line envelope, keeping the 40,000 UTF-16-unit ceiling. Reserve space for bounded metadata; limit body bytes and lines, split only at Unicode code-point boundaries, and prefer nearby line breaks. Metadata precedes the body, not a removable footer. Raising Pi's cap would only move the failure boundary.

Each response reports the exclusive character range, extracted document length, extraction mode, SHA-256 content identity and either an exact next offset or end of extracted document. A continuation is a fresh HTTP read. Optional `contentHash` binds it to the previously extracted content; mismatch fails with instructions to restart, preventing mixed-version coverage claims. No cache or persistence schema is added. A numeric offset retains compatibility but cannot alone prove document stability.

Complete extraction does not prove complete site history, dynamically loaded entries, linked release pages or publication timing. Model guidance requires checking relevant continuations, separating publication/updated/date-only evidence, and naming incomplete coverage. The workflow keeps a bounded call budget and must report unknown coverage on exhaustion.

## Contracts
- Existing `offset` counts UTF-16 code units, inclusive start and exclusive end. Returned offsets never divide surrogate pairs. Reject an input pointing inside a pair.
- Optional `contentHash`: 64 lowercase hex characters; include the returned hash on every continuation. Fail closed on mismatch, with no body and no completeness claim.
- Successful rendered output is at most 48 KiB and 1900 lines including metadata. Oversized metadata fails explicitly. The extracted body remains byte-for-byte reconstructible from contiguous pages.
- `truncated: true` means more extracted content remains, not an unreadable source. End metadata explicitly limits completeness to this extracted response. Failed reads cannot establish absence of updates.
- Tool Router, permissions, receipts and Pi ownership remain unchanged.

## Steps
1. Implement metadata and bounded slicing in server-core; document the optional parameter in protocol and research guidance in agent-runtime.
2. Add multilingual, line-limit, boundary, changed-content and timestamp unit tests; route large fixture pages through the actual Host and Pi in desktop e2e.
3. Run check and full hidden e2e, inspect rendered output, package/install with a stopped-data backup.
4. Run the existing two hunters and Core on the real group with all eleven sources. Audit ranges, publication evidence and reports; restore normal schedules and record sanitized evidence.

## Acceptance
1. Contiguous multilingual/emoji and many-line pages reconstruct the entire source within the declared response bounds (web-fetch unit tests).
2. Changed content, invalid offsets and excessive metadata fail explicitly; publication/updated/date-only values survive (unit tests).
3. Actual model input retains both range/continuation and final text across multiple pages without Pi truncation (web desktop e2e).
4. `pnpm run check` and full `pnpm run e2e` pass; screenshots inspected.
5. Installed real group produces both full-catalogue reports and the automatic summary; per-product source coverage and publication uncertainty recorded, never collapsed into no update. Private evidence stays outside Git.

## Risks
Live sources can change between reads; the content hash makes that visible and may require restarting or a smaller official endpoint. Finite feeds and dynamic pages remain incomplete evidence for whole-site absence. Smaller pages use more tool calls; exhaustion must remain explicit.

## Open questions
None.

## Verification (2026-10-27)

- `pnpm run check --maxWorkers=4`: boundaries, type checking, 569 unit/Host tests across 84 files passed.
- `pnpm run e2e`: all 185 desktop tests across 48 files passed on the final full run. The new routed pagination case reconstructs three multilingual output pages including the final publication timestamp. Screenshots inspected; installed group explored with agent-browser.
- Packaged and installed `0.0.0-b4a.20261027.1` after stopped-data/application backup; ad-hoc signature verified.
- Existing real group completed both calendar-triggered hunter reports (16 + 26 successful fetches, full eleven-source extracted content) and Core's automatic zero-tool summary. Source hashes and contiguous ranges were checked. Each report remained below the summary input limit and both snapshots were ready/untruncated.
- Original 07:08 / 07:10 / 07:47 schedules restored and enabled with refreshed source bindings. Restart retained identical report text and occurrence history, exactly one group post per occurrence, open lifecycle and zero scheduler faults.
- [Per-source acceptance](../acceptance/web-pagination-2026-10-27.md) records precise publication evidence, static/dynamic coverage and remaining limits. Dynamic load-more content and exhaustive site history remain unverified, explicitly stated in the delivered summary.

## Integration verification (2026-10-28)

Validated with main at `838b032`, including merged I7/#63. Both pagination acceptance records are retained; the configured radar budget is 48 domestic and 32 international `web_fetch` calls. `pnpm run check` passed boundaries, TypeScript and 580 tests across 85 files. The full background `pnpm run e2e` passed 186 tests across 49 files in 340.45 seconds, including multilingual output continuation and official HTML/JSON catalogue pagination. Both pagination screenshots were inspected. `git diff --check` and 195 relative documentation links passed. This integration check used isolated scripted fixtures; it did not repeat the installed real-provider acceptance above.

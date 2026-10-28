# I7: Official changelog pagination

Status: done (#63), merged into main
Branch: task/i7-official-changelog-pagination
Depends on: I6; installed B4a candidate for safe multibyte output continuation
Architecture: sections 5.2 and 5.8; existing web_fetch and configured routines

## Goal
Complete the configured ZCode and TRAE China changelog sources through their own public pagination, without adding browser execution or product-specific runtime integrations. Verify delivery through the owner's existing group and automatic summary.

## Design and scope
Both sites expose public GET paths supported by existing web_fetch. ZCode's client increments the official changelog `page` query; the server returns cumulative release HTML and a visible end marker. TRAE China's client calls `/api/changelog?page=N&page_size=10`, returning document blocks and explicit page/count/has_more metadata. Keep these as editable researcher workflow inputs, not built-in Bots or Host adapters.

Distinguish two independent continuations: OpenBot's character offset within a response, and the website's page parameter. Finish the response before evaluating its remote pagination metadata. Retain exact mode/URL/contentHash for output continuation on the installed B4a candidate. Never treat the end of one extracted response as the end of the remote catalogue.

The acceptance pass exhausts the current official catalogue. Normal runs retain explicit bounds: at most 16 remote TRAE pages, eight cumulative ZCode pages and 48 domestic web calls. Budget exhaustion, repeated pages, inconsistent totals, changed content or missing terminal markers remain partial/unverified. Do not relax permissions or introduce arbitrary HTTP methods, headers or credentials.

## Contracts
- ZCode: start at `https://zcode.z.ai/_next/changelog?page=1` with page extraction; increase page by one while the official load-more marker remains. Each cumulative page must preserve preceding version/date/body records. Deduplicate by version, reject conflicting duplicate bodies, and require the visible release-history end marker before claiming the current catalogue was read.
- TRAE: start at `https://www.trae.cn/api/changelog?page=1&page_size=10`. Require code zero, matching page/page_size, stable document_id and totals, unique block IDs, all version headings counted, and terminal has_more=false matching total_pages. Preserve the block tree's date/version/tag cells and product distinctions. A count of content blocks below total_blocks is disclosed; verify child/parent closure and distinguish the document root from returned content rather than silently dropping a mismatch.
- Source dates remain date-only unless explicitly labelled original publication timestamps exist. Neither response retrieval nor API metadata supplies publication time implicitly. Official source completeness is not a universal no-release guarantee.
- Repository changes are workflow documentation, bounded read-only acceptance/audit tooling and scripted Host/desktop coverage. No product code, schema, new dependencies, vendor import or new capability.
- Keep personal instructions, reports, identifiers, raw live responses and snapshots outside Git. Synthetic fixtures protect reproducible pagination behavior.

## Steps
1. Record official client provenance and public response contracts in the workflow source reference.
2. Add a reusable offline audit of captured routed results: reconstruct output pages, verify content identity, remote page progression, stable counts and terminal evidence. Add synthetic tests and a real Host/desktop scripted remote-pagination scenario.
3. Run check and full hidden e2e; inspect screenshots and the public site flow with agent-browser.
4. Preserve the current owner routines, update the two source instructions and summary coverage guidance, temporarily schedule a real full eleven-source chain, audit actual receipts and delivered text, then restore normal times and verify restart without duplicates.
5. Update plan/backlog and create the independent PR. B4a remains a separate PR; do not merge it or downgrade the installed candidate.

## Acceptance
1. Synthetic valid, missing/repeated page, changed totals/body, missing terminal, duplicate IDs and date/product-preservation checks pass.
2. Scripted desktop model reads multiple official-style pages and preserves remote continuation and date-only uncertainty through Host and Pi.
3. Check and full e2e pass; screenshots inspected.
4. Existing real group completes both researchers and automatic summary. ZCode's terminal cumulative document and every TRAE API page are verified from actual tool receipts; all eleven configured products remain in the ledger.
5. Normal enabled schedules and summary bindings restored; restart retains one published post per occurrence. Record verified catalogue size and remaining uncertainty rather than promising unlimited future coverage.

## Risks
These are observed official website interfaces, not a versioned API SLA. Changes must fail explicit completeness checks. TRAE's raw document blocks consume more model context than rendered HTML; the bounded workflow keeps the initial implementation light. A future generic document-block reader needs its own spec if live evidence shows it is necessary.

## Open questions
None.

## Verification (2026-10-27)

- `pnpm run check --maxWorkers=4`: boundaries, type checking and 575 tests across 85 files passed.
- Final full `pnpm run e2e`: 185 tests across 49 files passed. The new official-pagination scenario and screenshots were inspected; actual public pages and the installed group were explored with agent-browser.
- Existing installed B4a candidate retained. Real calendar-triggered eleven-source chain: 38 domestic + 28 international successful reads, both reports published, automatic zero-tool Core summary with exact ready/untruncated snapshots.
- Offline audit of actual model-visible receipts: ZCode two cumulative pages / 13 versions, and TRAE twelve API pages / 115 headings / 1,900 unique content blocks plus the declared root. All requested source response ranges reconstructed and hashes verified, with no missing/repeated page or unresolved content reference.
- A separate group note reports the acceptance tool's independent validation, distinct from the researchers' own claims. Publication precision and the partial auxiliary OpenCode page remain explicit.
- Restored enabled 07:08 / 07:10 / 07:47 schedules and current summary bindings. Full installed restart retained exact reports/history, one post per occurrence, open lifecycle and zero scheduler faults. App returned to normal launch without a debugging port.
- [Detailed acceptance and remaining limits](../acceptance/official-pagination-2026-10-27.md). No new runtime capability, installation dependency or release publication.

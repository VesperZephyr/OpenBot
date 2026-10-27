# Official changelog pagination for the radar

This is researcher configuration, not a built-in Bot or a new application adapter. Existing web_fetch supports the public GET responses. The installed B4a candidate additionally preserves safe character continuations and content identity; [PR #62](https://github.com/VesperZephyr/OpenBot/pull/62) remains a separate change.

## Source discovery and provenance

Verified on October 27, 2026 from the official pages and their own client code:

- [ZCode changelog](https://zcode.z.ai/_next/changelog): its `ChangelogInfiniteLoader` increments `page` and navigates to the same path. The server renders cumulative HTML. The currently served [client chunk](https://zcode.z.ai/_next/static/chunks/app/%5Blang%5D/changelog/page-44adc420aa638c4f.js) is discovery evidence, not a stable dependency.
- [TRAE China changelog](https://www.trae.cn/changelog): its currently served [client chunk](https://lf-cdn.trae.com.cn/obj/trae-com-cn/trae_website_prod_cn/static/js/async/changelog/page.0bac78a862.js) explicitly calls `GET /api/changelog?page=N&page_size=10`. This is the China website's own public content endpoint. No authentication, copied cookies, app token or international fallback is needed. The endpoint is an observed website interface, not a documented versioned API SLA.

## Two different kinds of pagination

`web_fetch` offset pages split one HTTP response to fit the model output budget. Finish those pages using the same URL, mode, exact next_offset and content_hash as contentHash. Check `content_changed` before combining pages.

The website's `page` parameter requests another source response. An `end_of_extracted_document` marker says nothing about whether another website page exists. Check the remote terminal marker or has_more separately. A failed, missing, repeated or changed page is incomplete evidence, never no update.

## ZCode procedure

1. Fetch [page 1](https://zcode.z.ai/_next/changelog?page=1) with mode page, preserving dates and footer. Complete any character continuation.
2. While the text says `Scroll to load more releases.`, increment the URL page by one, reset offset to zero and discard the previous response's contentHash. Keep mode page.
3. Pages are cumulative. Retain one record per version and verify previous records still occur with the same date/body; do not count the repeated prefix as new releases. Fail the completeness claim on conflicting duplicates, a repeated page without new entries, or missing earlier records.
4. Stop only at `You've reached the end of the release history.`; cap remote pages at eight and declare partial coverage if reached without that marker.
5. The observed [page 2](https://zcode.z.ai/_next/changelog?page=2) includes all 13 currently listed versions. This count is acceptance evidence, not a hardcoded future limit. The displayed release dates lack an hour and timezone; preserve date-only precision.

## TRAE China procedure

1. Fetch [API page 1](https://www.trae.cn/api/changelog?page=1&page_size=10). Complete any character continuation before interpreting the JSON. The visible page initially contains only the first ten version entries.
2. Require `code=0`, requested `page` and `page_size=10`, a stable `document_id`, and consistent `total_pages`, `total_entries` and `total_blocks`. Increment page while `has_more=true`, resetting character offset/hash. Cap at 16 remote pages and the researcher's total call budget.
3. Require `has_more=false` on the declared final page. Count unique block IDs and version headings across all pages; detect duplicates, missing references and inconsistent totals. Do not assume an empty or failed response is the end.
4. Blocks retain a document tree. Each version heading has a metadata table: date, version and sometimes tag. Read table cells in their declared order. Preserve TRAE, TraeCode, TraeWork and TRAE APP separately. Legacy rows lack tag: report unspecified product instead of inventing one.
5. The observed catalogue has 12 pages, 115 version headings and 1,900 unique content blocks. Its `total_blocks=1901` includes one document root not present in the returned content list: all child references resolve and the only outside parent is `document_id`. The audit reports this distinction explicitly. Any other deficit remains an error.
6. Dates are date-only. Do not convert them to midnight or a timezone, infer publication from retrieval time, or use table metadata as a timestamp. For ordinary reporting say what the checked catalogue lists; whole-site release absence remains unverified.

## Runtime instructions and budgets

Keep all eleven configured products. Read each primary source before optional cross-checks, then complete the two remote catalogues and any remaining output continuations. Domestic research has a maximum of 48 web_fetch calls; international research retains its existing 32-call budget. Do not retry failed URLs repeatedly. Reserve the final report below 6 KiB and include one row per product, source link, source precision and a truthful coverage status. Explicitly report a changed catalogue, count mismatch or budget exhaustion.

The Core summary uses only Host-confirmed reports. It must distinguish ready input reports, complete HTTP extraction, complete currently exposed official catalogues, and exact-window original publication. It must not carry forward stale dynamic-gap warnings after terminal pages are actually verified, or turn unverified dates into no-update claims.

## Offline acceptance audit

Save the actual routine snapshots locally, then run:

```sh
node scripts/acceptance/radar-pagination-audit.mts /absolute/path/to/private-routine-evidence.json
```

The input shape is `{results:[{detail:{snapshot:{items:[...]}}}]}` from the existing routines.get desktop method. The audit does not contact the internet, alter configuration or fill gaps on the researcher's behalf. It reconstructs the model-visible B4a output, validates hashes and contiguous ranges, then checks cumulative ZCode records and TRAE page/count/tree/terminal invariants. Synthetic tests protect the observed contracts. Source drift requires inspecting the official client again and updating the procedure deliberately.

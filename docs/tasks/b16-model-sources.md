# B16: Built-in and Custom Model Setup

Status: done (product foundation merged through B26; see task index)
Branch: task/b16-model-sources
Depends on: B7, B8, D1
Architecture: Sections 5.9, 6.1, 6.5, 8.3

## Goal
Offer two explicit model setup paths in onboarding and Settings, with safe local configuration and understandable source/readiness information.

## Scope
In: shared model setup UI; every bundled provider in the catalog; API-key authentication; custom endpoints with the three existing protocols; model tests and default selection; JSONC-preserving provider addition; provenance; safe operation diagnostics; local-data disclosure.
Out: OAuth/subscription login (not implemented by this UI), automatic model discovery, provider deletion/editor (advanced file editing remains supported), new inference APIs, Bun runtime migration.

## Design
Use one reusable setup component in onboarding and Settings. Built-in models come from Pi; custom providers come from the user file. A built-in overlay remains a built-in provider with an override badge. Show key readiness separately from connection-test success. Test only on explicit user action. Neither catalog browsing nor provider creation sends conversation content. A failed test must not change the default. Settings keeps a separate existing default selector and permits saving credentials for file-defined providers.

Add custom providers without overwriting existing IDs. Advanced updates/removal remain file operations with Reload. This deliberately avoids a lossy full-provider editor. Use jsonc-parser edits so comments, unrelated fields, and trailing-comma syntax survive. Serialize Host config mutations; reject duplicate IDs and built-in IDs even if an overlay exists. Store UI keys only in Keychain. Existing credential precedence remains unchanged.

## Contracts
- ProviderSummary retains source builtin/config for compatibility and adds optional overlay:boolean to distinguish built-in overrides.
- ModelSummary adds optional source:builtin|custom, overridden:boolean, endpoint:string. Endpoint is display-safe origin only (no path, query, fragment, or userinfo); never expose headers/credential expressions.
- Existing models.addProvider is create-only; duplicate provider ID returns invalid_request without changing the file.
- models.test keeps {ok,error?}; classify errors to fixed safe messages, never forward raw provider bodies/headers.
- HostService accepts an optional audit callback. Events contain generated operationId, operation from the Host method allowlist, timestamp, durationMs, outcome (succeeded/failed); no arguments, result bodies, names, paths, model identifiers, or secrets. The Host writes JSON events to its existing local bounded diagnostics stream. Log failures must not turn a committed operation into a retry.
- Unknown or externally removed model references remain visible as unavailable; no silent provider fallback.
- Local conversations, memory, settings, receipts and diagnostics stay on the Mac. The UI explains that selected remote model/search services receive task-relevant input. No analytics or automatic diagnostic upload is added.

## Steps
1. Add provenance projection in protocol/runtime and settings overlay status in Host.
2. Implement safe additive JSONC editing and serialized configuration writes; add invariant tests.
3. Share a built-in/custom form across onboarding and Settings; support all three protocols and explicit tests.
4. Add safe diagnostics and local-data copy. Preserve existing credential/config paths.
5. Extend ScriptedModel e2e coverage, explore an isolated background instance with agent-browser, inspect screenshots.

## Acceptance
1. Unit: custom addition preserves comments/advanced fields; collision and malformed input leave bytes unchanged; parallel additions both survive.
2. Unit: built-in overlay provenance is distinct from custom provider, and renderer metadata contains no endpoint credential data.
3. Unit: model-test errors and audit events exclude secret/body sentinels; success and failure are distinguishable.
4. Background e2e: Settings and onboarding expose both sources; add/test/select a custom endpoint; choose protocol; saved key absent from models.json.
5. Background e2e: failed test leaves prior default intact; key/catalog availability alone is not reported as a successful connection; removed selection is marked unavailable.
6. pnpm run check and pnpm run e2e pass; screenshots inspected.

## Risks
A successful tiny test proves text connectivity, not every tool/vision capability. Built-in OAuth-only providers may need a custom endpoint; the UI must disclose API-key-only setup. Concurrent external file edits are not coordinated with the Host; the atomic rename protects against torn writes, not external editor races.

## Open questions
None. Advanced provider editing/removal and OAuth are explicitly separate follow-ups.

## Verification record

2026-10-17: `pnpm run check` passed (183 tests); `pnpm run e2e` passed (27 tests, 11 suites, background mode). Settings/onboarding screenshots inspected and an isolated background desktop explored with agent-browser. JSONC edits preserve comments and field values; formatting of the edited object may change. Real-provider and bilingual visual acceptance follows the integrated product pass.

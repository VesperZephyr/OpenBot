# B14e: Desktop-Owned Keychain Credentials

Status: in progress
Branch: task/b14e-main-credentials; PR target: main
Depends on: verified B9a `f37c673` (#37), including lifecycle/policy gates
Architecture: Sections 3, 5.9, 6.2 and 6.4

## Goal and ownership decision

Electron main owns macOS Keychain reads/writes through a small Node-API native binding to Security.framework. Host requests credentials through its existing private parent IPC connection; it no longer runs `/usr/bin/security` or owns native Keychain identity. Renderers have no credential read API. Executor and model tools never receive the credential broker channel.

Use a native binding in the main process rather than a separately callable credential helper: a general-purpose child binary must not become a reusable read oracle. The packaged main executable and native binding are sealed by the application signature. Existing fuses disable RunAsNode, Node options and alternate app loading. A development Electron executable is not a supported live-credential identity; development/e2e use synthetic accounts in isolated services. A consistent Developer ID signature remains required for release, including updates.

No OAuth, secret browser fill, responsibility-disclaiming executor, remote service, telemetry, or new connector transport. User-authored model configuration retains its explicit existing semantics. This batch does not silently rewrite or encrypt `models.json`.

## Native boundary

- Add `apps/desktop/native/keychain.cc`, built as a Node-API addon using pinned official Node-API headers and Apple Security/CoreFoundation frameworks. It loads only in desktop main from a fixed development build path or signed Resources path. No dynamic path supplied by Host/renderer/model; no downloaded prebuilt native binary.
- Expose bounded async `get`, `set` and `delete` operations over generic password service/account pairs. Validate UTF-8, operation, service/account lengths and a 16 KiB secret limit in native code as well as TypeScript. Native work uses Node-API async work so Keychain I/O does not block the renderer/main event loop. Errors return fixed codes, never native diagnostics or secret text.
- Disable Keychain user interaction before access. A locked Keychain or denied ACL returns an actionable unavailable result; verification must never raise a system prompt. Never weaken an ACL or add a broad trusted application to make a test pass.
- New items explicitly trust only the calling application using `SecAccessCreate` with a null trusted-app list. Secrets are not command arguments, environment variables, files, transcripts, hashes or logs. The temporary native buffer is cleared before release; JavaScript strings remain short-lived but cannot be claimed securely erased.
- Use a new versioned service (`<configured-service>.v2`) to avoid inheriting legacy command-line ACLs. Packaged builds use the fixed OpenBot service; only development/test mode can select an isolated service. Do not overwrite or weaken legacy items in place.
- Build the addon before dev/build/e2e, copy it into Resources for packaging, preserve its source/header licenses and let application signing cover the binary. No new OpenBot package or Pi vendor changes.

## Main-owned metadata and migration

Main owns a bounded, atomically replaced `credentials-v2.json` containing IDs only (maximum 256), under the existing local data directory with 0600 permissions. Legacy `credentials.json` remains an ID index, never a secret store. Only valid model IDs, `search:tavily` and `connector:<slug>` may be addressed. Serialize writes across the whole index to prevent lost updates between providers.

- List returns configured IDs and redacted storage status. Get reads only the new service. A legacy-only ID returns `migration_required`; it must not silently fall back to command-line access or an unrelated provider.
- Set writes the new owned item, verifies it by reading in the same main process, then commits its ID. Explicit replacement may replace an existing new item. Attempt legacy cleanup only after the new value and index are durable. A cleanup failure preserves the old index and is reported; never claim the old credential is removed.
- Delete removes both scoped versions and updates each index only after the corresponding native removal succeeds. An unconfirmed deletion remains visible/retryable. No broad Keychain enumeration or deletion.
- An explicit **Migrate saved credentials** action processes only IDs in the existing local index. Reuse an existing new-service value rather than overwriting it with a stale legacy value. Otherwise read the legacy value silently, write/verify the new item and index, then remove the legacy item/index. A blocked legacy ACL is not bypassed: report the affected count and let the user re-enter the value in existing credential forms. Existing model selection, provider configuration and connector definitions remain unchanged.
- Restart after any migration boundary is safe: confirmed new storage is preferred; incomplete cleanup is retried only by explicit user migration/delete. Missing/corrupt metadata fails closed with a safe diagnostic instead of silently discarding known IDs.

## Private credential broker

Protocol defines private `credential.request` / `credential.response` messages distinct from `HostMethod`. Exact validation permits `list`, `status`, `get`, `set`, `delete`, and explicit `migrate`; no caller-selected service, path, target or arbitrary Keychain query. Maximum eight pending Host requests, 10-second response deadline, bounded IDs/values and a bounded main queue. Unknown request/result shapes fail closed.

Desktop accepts requests only on the currently supervised Host child object; stale-child replies cannot reach a replacement Host. Main replies only on that private child IPC channel. Host correlates responses before runtime startup; no public/preload `get` operation is added. Host exit/disconnect rejects pending requests. A write timeout is unconfirmed, not successful; retries of set/delete are idempotent replacements/removals without automatic background retries.

`apps/local-server` implements both `SecretStore` and Pi's credential interface over the private broker. Preserve the B9a exclusion of search/connector namespaces from all model credential methods. There is no production CLI fallback. Standalone diagnostic Host startup may use an explicitly empty broker in its test parent; it cannot access real keys. Bundled runtime verification must exercise this parent contract.

Public user-only methods `credentials.status` and `credentials.migrate` return owner/availability and migration counts, never IDs with values. Existing credentials.set/delete and connector credential methods keep their public contracts. Settings shows storage state and an explicit migration control in English/Chinese; no automatic dialog or focus change.

## Verification and release evidence

1. Unit tests cover strict private messages, reserved namespaces, bounded pending/queue behavior, stale-child replies, timeout, metadata corruption, concurrent writes and migration interruptions. Fake native ports prove ordering: verify/store index before legacy deletion, blocked read cannot destroy an item, retry cannot overwrite a newer value.
2. Hidden e2e uses isolated synthetic Keychain services for model/search/connector set/read/delete, connector token injection and redaction, restart, migration status/actions, and a locked/denied native response where reproducibly injectable through a test port. Test fixtures never change the owner's login Keychain state or ACLs.
3. Build an ad-hoc packaged app on this Mac. Launch it hidden with isolated data and a synthetic item, check read/write/relaunch and a separate ordinary Node process denied access to that item's value without UI. Clean up only the synthetic account. If macOS cannot confirm a property, record it explicitly rather than weakening access controls or treating mocked tests as native evidence.
4. Run `pnpm run check`, full background `pnpm run e2e`, inspect bilingual screenshots, verify the bundled Host/executor and perform an isolated real-model request through the broker-held synthetic/configured test path. Preserve local-only, metadata-only logs.
5. Record Developer ID/update identity separately. This machine currently reports zero valid signing identities. Ad-hoc native acceptance cannot satisfy the consistent Developer ID/notarized update release gate; do not publish or mark that gate passed. Development of subsequent B9b against synthetic credentials may proceed after the implementation/tests pass.

## Sources

Checked 2026-10-19: [Apple SecAccessCreate](https://developer.apple.com/documentation/security/secaccesscreate(_:_:_:)) documents that a null trusted-app list trusts only the calling app; [Apple Keychain implementations](https://developer.apple.com/documentation/Technotes/tn3137-on-mac-keychains) distinguishes file-based and data-protection Keychains; [Electron code-signing guidance](https://www.electronjs.org/docs/latest/tutorial/code-signing) documents consistent Keychain identity requirements. The implementation uses Security.framework directly in main, not safeStorage ciphertext files or a shell wrapper.

## Open questions

None for implementation. Developer ID release acceptance is blocked by the absent signing identity and must remain an explicit release gate, not an implicit claim of this PR.

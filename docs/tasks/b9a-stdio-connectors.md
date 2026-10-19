# B9a: Supervised Local Stdio Connectors

Status: in progress
Branch: task/b9a-stdio-connectors; PR target: main
Depends on: verified B15b `2dfdc1c` (#36), including B12a, B14b and B10
Architecture: Sections 5.1–5.3, 5.6, 5.9 and 6.2

## Goal

A user can install a local MCP server, review its tools, supply its token privately, let any Bot discover and call an approved tool, and disconnect or remove the connector. Reuse Pi's deferred tool registry and tool search. Every connector call still traverses OpenBot policy, target binding and executor receipts.

## Scope

Local stdio MCP tools, explicit desktop setup, supervised child processes, token environment injection, deferred discovery, current-schema approval and truthful failure/recovery. No marketplace or automatic downloads, HTTP/OAuth, arbitrary Pi extensions, remote execution, model-initiated install/credential changes, resources/prompts/sampling/elicitation, or connector Code Mode bridge. Composer connector attachment is deferred; installed tools are available to all Bots through discovery. Installing a connector is trust in its local program, not an OS sandbox.

## Protocol baseline and Pi reuse

Pin the supported MCP tools subset to protocol revision `2025-11-25`; reject incompatible initialization instead of claiming full MCP support. A bounded stdio client belongs in `local-executor`, not in Pi or the Host. No Pi vendor changes. `agent-runtime` installs a named connector extension with deferred `mcp__<connectorId>__<toolName>` registrations, replacing that extension when the validated catalog changes. Existing configured conversations refer to its stable extension name. Unavailable or removed registrations cannot dispatch a fresh call.

Reuse Pi's `createToolSearchTool`/`createToolSearchExtension` behavior and registry notifications. Wrap discovery through the regular OpenBot tool invocation path before running Pi's metadata search/control operation. Query length is at most 512 characters; at most eight tools load per search. Discovery is a local metadata operation and grants no execution permission. Each deferred tool uses the ordinary routed adapter and memoizes the connector revision/schema identity before its first invocation. No unrestricted Pi environment or CodingTools.

Sources, checked 2026-10-19: [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [initialization and shutdown](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [tools and tool-list changes](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), and vendored `third_party/pi/packages/durable/src/tool-search/` and `src/harness/registry.ts`. The implementation supports the bounded subset below; unsupported protocol features fail explicitly.

## Local state and desktop API

- Host owns an additive Pi document containing connector definitions, revisions, last validated catalog, mutation receipts and removal tombstones. Executor owns active process/session facts and process recovery records in its own database; it never opens Pi storage.
- Definition: immutable slug ID (`[a-z][a-z0-9-]{0,31}`), display name (1–80), absolute executable path, up to 32 literal arguments (each at most 2,048 characters, total 16 KiB), optional credential environment variable name, revision, targetId and status. Working directory is the shared workspace. Use `spawn` with `shell:false`; do not interpolate a shell command. Configuration is local, unencrypted non-secret metadata; secrets belong only in the credential field/Keychain, never command arguments.
- Limits: 10 installed connectors, 512 retained identities/removal tombstones and 4,096 configuration-operation receipts. Fail closed at capacity. Reinstalling a removed ID requires a new ID; namespace reuse cannot revive approvals. No credentials, raw tool output or process stderr enter this document.
- Explicit methods: `connectors.list`, `connectors.install`, `connectors.connect`, `connectors.disconnect`, `connectors.remove`, and `connectors.credential.set/delete`. Mutations validate exact fields, local target and expected revision. Install/remove/connect/disconnect have stable request IDs and fingerprinted intent/result records; conflicting retries fail. Credential set is a reversible revision-checked replacement with no stored secret fingerprint. It never starts a server implicitly.
- Installation records the reviewed definition before starting its first connection. A lost/failed startup remains disconnected/needs attention; replay returns the same configuration receipt and does not blindly relaunch. Reconnect is an explicit user operation. After Host/executor restart, persisted definitions/catalog remain inspectable, but fresh calls require explicit Connect and a new validated session. Existing invocation receipts remain readable before considering fresh dispatch. A queued old call is never silently redirected to a new server revision.
- Disconnect/remove first invalidate the durable definition, cancel pending approvals and fence executor dispatch, then stop the supervised session. Removal retains its identity tombstone and deletes its namespaced Keychain credential. A failure to confirm process termination is visible as needs attention, not successful rollback. Stop/quit/lifecycle quiescence also stop connector sessions and reconcile in-flight calls.

## Credentials and process supervision

- Reserve a credential namespace distinct from model/search provider IDs. Existing Host Keychain access is the development path; exclude connector keys from Pi's model credential list and renderer settings. Renderer receives only `credentialConfigured`. Secret entry is a password field; clear it after success/close. No secret is persisted in install arguments, Run inputs, approval records or diagnostic payloads.
- Host loads a credential only for an explicit connection and sends it through a private target-bound control request. Executor keeps it only in that session and injects it into that connector's own environment. Begin from a small safe environment allowlist; never inherit model tokens, connector tokens, Node/Electron loader options or arbitrary parent variables. Reject reserved credential environment names (`PATH`, `HOME`, loader/runtime options, `OPENBOT_*`, etc.). Other connectors and shell commands receive no injected value.
- Before exposing metadata/results, redact exact known credential values from connector-provided strings, including descriptions, schema descriptions, errors and text output. Discard raw stderr; bounded metadata may count bytes. Never log incoming protocol frames or arguments. This prevents accidental echo of injected values; it is not isolation from a malicious local program with the user's OS access.
- A connector runs in its own process group. Persist PID and process-start identity before handshake. On executor reopen, reconcile journaled groups and terminate a still-matching orphan; never signal a reused PID. On disconnect/shutdown, close stdin, send TERM, then KILL after a bounded grace period and report whether the group is gone. Reuse existing process supervision patterns, without claiming a signed responsibility-disclaiming helper is implemented.
- B14e still gates supported packaged live-credential identity. B9a acceptance uses synthetic credentials in an isolated Keychain service; it does not request production service accounts or claim packaged secret isolation/TCC acceptance.

## Bounded MCP client

- Initialize with protocol `2025-11-25`, client info and empty optional capabilities; require a matching version and tools capability, then send `notifications/initialized`. Support ping, tools/list (bounded pagination), tools/call and cancellation notifications. Reject server-initiated requests for unsupported features with a generic method-not-found response; never start model sampling, read arbitrary roots or open URLs.
- Newline-delimited UTF-8 JSON-RPC frames: maximum 1 MiB buffered frame, 10-second handshake/catalog deadline, 60-second call deadline, four in-flight requests per session and a bounded write buffer. Reject malformed/oversized frames, duplicate response identities and impossible shapes. Drain/discard stderr without accumulating it. No retry loop, child restart loop or automatic replay of tools/call.
- At most 100 tools per connector, five catalog pages and 256 KiB total normalized catalog; tool names use `[A-Za-z0-9_-]{1,64}` and descriptions at most 2,048 characters. Reject collisions and unsupported names rather than silently renaming. A tool schema is at most 16 KiB and 12 nesting levels; admit a documented JSON Schema object subset that can be validated consistently in Pi, Host and executor. The supported keywords are type (object/array/string/number/integer/boolean/null), properties, required, boolean additionalProperties, items, enum, const, title, description, minimum/maximum, minLength/maxLength, minItems/maxItems and anyOf (at most four variants); allow only the standard draft-07 or 2020-12 schema identifier. Limit each schema to 256 nodes. No remote/local references, regex execution or unrecognized keywords; unsupported schemas make the catalog unavailable with a clear error. Arguments are at most 32 KiB, 12 levels and 1,024 nodes. Tool annotations are display metadata and never proof that a tool is safe/read-only.
- Support bounded text tool content and optional JSON structured content. Do not render remote HTML/icons or auto-fetch resource links. Unsupported content types are explicitly reported. At most 32 KiB of normalized result enters a receipt/model response; truncation is marked. A malformed/missing response after call dispatch is `unknown`, even if the server claims read-only.
- A tools/list-changed notification invalidates the session catalog for new dispatch. Expose Refresh/Connect in the UI; a fresh catalog/revision requires new approval. Do not carry a pending approval across a schema or executable change.

## Authorization and receipts

- Dynamic tool lookup is a narrow Tool Router port. Protocol types remain independent of Pi/MCP SDK types. Add connector invocation identity (connector ID, revision and schema digest) from trusted adapter state, never model arguments. Validate the argument schema and bounded JSON both in Host and executor.
- Fresh invocation requires an installed, connected local definition matching the captured catalog/schema, current Run context, lifecycle gate, policy revision and target. Every connector tool defaults to exact approval; no Always allow choice is added in this increment. Existing Ask first and unattended approval expiry remain in force. Descriptions/annotations/content cannot create grants, change audience or obtain Core management authority.
- Include the trusted connector identity in the invocation/approval digest. Recheck after approval and before the actual `tools/call`; executor independently verifies its session identity and authority revision. Catalog invalidation/disconnect/remove refuses new calls and cancels active session work. Integrate dynamic definition lookup with approval reevaluation and authority reconciliation so missing tools fail closed instead of bypassing policy.
- The normal executor ledger records accepted intent before sending `tools/call`, then persists the bounded redacted result. Same invocation + digest returns the recorded result; changed digest fails. After process/Host loss or response loss, accepted-without-result becomes unknown. Never automatically repeat a possible external write. Known receipts can be returned after disconnect/removal without launching a server. A cancellation can stop the process but cannot prove an external effect was rolled back.
- Metadata-only operational records include connector/invocation/Run IDs, revision, tool name, state and duration. No arguments, token values, text output or stderr.

## Product surface

Use the existing quiet sidebar/panel pattern for **Connect apps**. Empty state explains that a local MCP program exposes tools; Add connector shows executable, literal argument list and optional token variable, with an explicit **Install and connect** action. Do not make the user edit raw JSON. A detail view shows connection state, reviewed launch definition, tools and their descriptions, credential configured state, Connect/Refresh, Disconnect and Remove. Failures preserve the draft and show a bounded actionable message. There are no default connectors.

Tool activity/approval cards show connector/tool identity and normal Deny/Allow once controls. Connection metadata refresh preserves composer drafts/focus. English default and Chinese translations cover application-owned labels/status/errors. All verification windows remain hidden/non-focusable; no notifications or browser opening.

## Implementation sequence

1. Save this spec and PR dependency before product changes. Define schemas/limits, Host document contracts and fixture protocol.
2. Implement bounded stdio session, process journal, private control envelope, credential redaction and normal executor dispatch/receipt integration. Test frame limits, malicious server requests, cancellation and response-loss uncertainty.
3. Implement Host connector lifecycle, revision fencing, credential namespace, dynamic policy/approval lookup and startup reconciliation. Test removal during approval/call and stale catalog identity.
4. Reuse Pi deferred registrations and routed tool discovery; preserve current Core/private/group boundaries. Test search loading, next-request schema availability and old receipt replay after removal.
5. Add bilingual Connect apps UI and scripted hidden desktop flows: install, credential setup, discover, deny/allow, use, restart/reconnect and remove. Inspect screenshots and local operational logs.
6. Run check, full hidden e2e and bundled startup. Use one isolated real model to discover/call the synthetic local fixture with exact approval; verify the fixture's file/result, no duplicate write, token isolation and cleanup. Record native release limitations separately.
7. Update backlog/technical plan/roadmap and push one PR targeting main; owner merges.

## Acceptance

- A deterministic local fixture exposes a read and write tool; discovery loads only matching deferred tools and all calls are routed/target-bound/approved.
- A synthetic sentinel reaches its intended connector only, not another connector, shell environment, renderer projection, model request, transcripts or operational logs, including deliberate raw-echo attempts.
- Wrong target, stale revision/schema, malformed/oversized inputs, unsupported server requests and schema changes fail closed before a new effect.
- Remove/disconnect while approval or work is pending blocks late dispatch and terminates the supervised group; crash/lost response remains unknown, while known receipt replay never repeats a write.
- Restart preserves local configuration but does not silently restart an unconfirmed server; explicit reconnect revalidates metadata. UI works in English/Chinese with no automatic connector creation.
- Full automated evidence, inspected screenshots, bundled startup and isolated real-model fixture use are recorded; no live credential/TCC/signing release claim.

## Open questions

None for this bounded tools-only increment. Record a contract problem here before changing the design.

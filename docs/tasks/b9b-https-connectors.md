# B9b: HTTPS MCP Sessions

Status: implemented; ready for review
Branch: task/b9b-https-connectors; PR target: main
Depends on: merged B9a (#37) and B14e (#38), baseline `b95ade7`
Architecture: Sections 5.3, 5.6, 5.9 and 6.2

## Goal and scope

Connect apps can install an explicitly configured HTTPS MCP endpoint, save a bearer token privately, review its tools and call them through the existing exact approvals and durable receipts. Add no OAuth, legacy HTTP+SSE fallback, webhook listener, application Code Mode exposure, custom headers, proxy configuration or automatic tool retries. Supported packaged live credentials still depend on B14e's Developer ID evidence; this task uses synthetic connector credentials.

## Configuration and authority

Keep existing B9a records readable: absent transport means stdio. Add a strict union: stdio retains command/args/credentialEnv; HTTPS requires `transport: "https"`, `endpoint` and `auth: "none" | "bearer"`, with no executable fields. Endpoint is an absolute HTTPS URL, at most 2,048 characters, without userinfo, query, fragment, control characters or backslashes. Users may explicitly configure internal HTTPS services. TLS certificate and hostname validation remain mandatory; no renderer setting disables TLS or supplies a CA. Endpoint/auth are immutable for an installed ID; replacement needs a new connector identity.

Bearer credentials use the existing namespaced Keychain path and private target-bound connect request. Send Authorization only to the exact configured endpoint. Never follow redirects, accept cookies, discover alternate endpoints or inherit proxy credentials. Session IDs remain in executor memory, never in public profiles, logs or durable records. Raw HTTP bodies, headers and errors are not surfaced. Existing exact credential and session-ID echo redaction applies to metadata/results. Existing stdio data needs no rewrite; add only an executor cooldown table, with no destructive migration.

## Transport contract

Use the tools-only MCP revision `2025-11-25`. A small transport interface shares the existing supervisor's handshake, catalog validation, namespacing, receipts and authority fencing. HTTPS performs outbound requests only, using Node HTTPS with a bounded header size and normal TLS verification. Each JSON-RPC message is a separate POST with JSON content type and Accept for JSON and SSE. Await the initialized notification's 202 before tools/list. Negotiate the existing pinned version, include MCP-Protocol-Version subsequently, and retain a validated visible-ASCII session ID (at most 1,024 bytes) from initialization for later requests.

Support a single JSON response or an SSE POST response containing bounded notifications/server requests and the matching response. Bound every response to 1 MiB, 128 SSE events, strict UTF-8, one matching JSON-RPC identity, and four active requests per session. Unsupported server requests receive -32601; ping receives an empty result. No sampling or model execution. Tool-list changes immediately invalidate the catalog and require explicit Connect with a newly validated revision/schema. No optional idle GET stream, stream resumption or event replay in this increment; a broken stream is visible and requires reconnection. Servers requiring resumable polling are outside this bounded subset.

Use one absolute ten-second deadline for initialization, initialized notification and all catalog pages, and sixty seconds per tool request including headers/body/server-message responses. Preserve existing catalog/schema/argument/output limits. All failures settle promptly; do not await an unbounded body or remote shutdown.

## Failures, reconnect and cancellation

- No automatic POST retries, including read-annotated tools. Each new connection is an explicit user mutation and increments the definition revision; start/restart never reconnects. Session 404 clears the old session and asks the user to Connect, which initializes without the expired ID. Authentication 401/403 asks for credential replacement; TLS, redirects, invalid responses and transport failures have bounded static messages.
- 429 invalidates the session and records Retry-After as a local reconnect-not-before time in executor SQLite. Accept nonnegative integer seconds or an IMF-fixdate HTTP date; missing/invalid values use sixty seconds, past values use one second. Accept only representable dates. Display the retry time and disable Connect until it passes, enforce it again in the executor across restart. No worker sleeps for this cooldown and no call is queued for retry. A user may disconnect/remove during it; reinstall cannot reuse a removed identity.
- Every dispatched tool lacking a valid tool result is `unknown`, including HTTP errors, timeout, cancellation, malformed/oversized responses and response loss after an effect. A call rejected before sending is `failed`. Server annotations and HTTP status alone do not prove that a write did not occur. Existing executor receipts prevent re-execution of both known and unknown invocations after reconnect/restart.
- Stop/disconnect, credential replacement, revoke and lifecycle quiescence abort active HTTP requests. Best-effort cancelled notifications and session DELETE share a one-second cleanup deadline. Local request/session closure is confirmed independently of remote effects; DELETE success or rejection never converts an unknown tool outcome into cancellation/rollback. Clear retained credentials and session identifiers when local cleanup completes. Disconnect cannot terminate an independent remote server.

## Desktop

Extend the existing form with Local program / HTTPS endpoint selection, endpoint and None / Bearer token authentication. Preserve stdio defaults and literal arguments. Show the installed endpoint/auth, redacted credential state, connected/disconnected/attention status, bounded connection progress, actionable auth/session/network errors and retry time. Every new fixed string has English and Simplified Chinese coverage. Tokens stay in a separate password form and clear after save/navigation. Explain that data goes to the configured service and that disconnect stops local requests without undoing remote effects.

## Implementation sequence

1. Strict protocol union/validators and compatible Host persistence/credential routing.
2. Executor HTTPS transport, supervisor integration, durable cooldown and honest cancellation/recovery.
3. Bilingual Connect apps form/status, isolated HTTPS fixtures and automated checks.
4. Inspect screenshots, explore the hidden isolated app with agent-browser, update current state/backlog and open a PR with acceptance evidence.

## Acceptance

- [x] Old stdio definitions reopen; strict public/private validation rejects mixed transports, unsafe URLs, forged target and credential-bearing configuration.
- [x] A local TLS fixture proves JSON and SSE success, session/version headers, private bearer auth, invalid schemas, expired token/session, redirect refusal, TLS failure, rate limits across reconnect/reopen, deadlines, malformed/oversized bodies and changed catalogs.
- [x] Cancel/disconnect abort locally within bounds and attempt cancellation/DELETE; an effect followed by lost response remains unknown and a repeated invocation returns its receipt without another write.
- [x] Host tests prove HTTPS credential routing, revision fencing and compatible persistence; credential values/session IDs never enter public state, model input or logs.
- [x] Hidden ScriptedModel e2e covers form install, credential replacement, deferred discovery, exact deny/allow, expired auth/session, rate-limit status, reconnect, unknown write, restart and removal, with English/Chinese screenshots inspected.
- [x] `pnpm run check` and `pnpm run e2e` pass. One isolated real-model synthetic workflow is checked against fixture effects/receipts if the provider is available; native release claims remain separate.

## Sources and open questions

Checked 2026-10-19: [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), and the B9a protocol/lifecycle/catalog contract. The supported subset explicitly excludes optional stream resumption; explicit connection after expiration never retries a prior tool call.

No open design questions for this batch. OAuth, optional idle notifications/stream resumption, endpoint edits, automatic grants and the packaged Developer ID gate remain separate work.

## Acceptance evidence

- `pnpm run check`: 461 tests in 69 suites passed, including HTTPS protocol/Host persistence and executor failure fixtures.
- `pnpm run e2e`: 120 tests in 33 suites passed. After the final recovery changes, both connector suites passed again (9 tests), including cooldown visibility across restart. The nested server-response dispatch regression and malformed Retry-After cases are covered by executor tests.
- The local HTTPS service generates a temporary certificate. Executor unit tests explicitly trust only that certificate; hidden desktop tests forward NODE_EXTRA_CA_CERTS only in unpackaged test mode. TLS verification remains enabled, with a negative untrusted-certificate check. No test certificates, private keys or raw logs are committed.
- Real-model acceptance used the configured gateway (`mafia`, `gpt-6.1-sol`) with a synthetic HTTPS service and isolated credential service. Run `run_f91cb387-b592-4f50-8537-b244b6594205` discovered the tool, requested one exact approval and produced exactly one confirmed write over SSE. It recorded 30,224 tokens. Restart preserved the definition/credential and required explicit Connect; removal deleted the synthetic connector credential, and the isolated model credential was also deleted. Transcript/log checks and hidden-window assertions passed.
- Agent-browser inspected the isolated hidden real-model app, switched the setup form between Local program and HTTPS, checked None/Bearer selection and observed invalid HTTP input with installation disabled. English installation/authentication and Chinese expired-session/rate-limit screenshots were inspected.
- B14e's Developer ID/update continuity gate remains open. This task does not establish native packaged release identity, OAuth support or general MCP compatibility beyond the specified subset.

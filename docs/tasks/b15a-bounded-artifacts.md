# B15a: Bounded File Inputs and Result Artifacts

Status: ready
Branch: task/b15a-bounded-artifacts; pull request target: main
Depends on: G0, existing B3/B7/B21/B26 contracts
Architecture: Sections 4.2, 5.1, 6.1–6.2 and 8.2

## Goal

Attach selected local files to a private Bot message, receive durable result files, preview their content safely and export a copy. File content stays on this Mac except for the selected content sent to the configured model. Losing the original file, reloading Desktop or restarting the Host must not silently replace an accepted input.

## Scope

In: private-chat attachments, bounded immutable local copies and metadata, Pi multimodal input, input/result cards, explicit export/removal, executor spill limits, English/Chinese text and isolated acceptance. Existing group tasks may publish result artifacts through their ordinary authorized tools; group input attachments and propagation through collaboration need a separate contract and are not added here. Out: Office/PDF parsing, arbitrary binary attachments, document-generation services, HTML execution, external previews, drag-and-drop paths, model-selected import/export/delete, and cloud storage.

This is independent of B14a and branches from merged main. B14a PR #29 stays independent and is not merged by the execution agent. Integration conflicts, if any, must preserve its observation guards.

## User flow

1. The private composer has Attach files. A native picker selects up to four files. Import finishes before a chip appears; cancel leaves the draft unchanged. The chip displays the name, size and removable draft reference. Attachment-only messages are supported.
2. Send freezes text and ordered attachment identities in the existing immutable send attempt. A later draft edit cannot change a pending or uncertain attempt. Retry reuses its original request ID and identities. Reload restores chips and marks unresolved sends uncertain without dispatching them.
3. The accepted user message displays file cards. The model receives bounded text or image parts, not arbitrary original paths. Text is explicitly labeled as user-provided file content rather than trusted instructions. Incompatible image models fail clearly before new admission; dispatch checks compatibility again if model settings changed while queued.
4. A Bot can publish a file it can already read with `artifact_publish`. The executor freezes that file; later edits to the source do not alter the result card. A successful card appears only after a committed executor receipt. It offers Preview, Export copy and Remove local copy. Removal asks in-app confirmation and explains that it affects every card for that copy, while prior model requests and conversation records may retain content.
5. Previews render text as escaped text and PNG/JPEG as bounded image data. HTML result files render as plain text. No iframe, script, external resource, file URL, arbitrary navigation or document execution is permitted. Missing/corrupt/removed copies display an explicit unavailable state.

## Limits and retention

| Resource | Fixed limit |
| --- | --- |
| Input formats | UTF-8 `.txt`, `.md`, `.csv`; `.png`, `.jpg`, `.jpeg` with matching signatures |
| Input count | Four per message, unique IDs, fixed order |
| Text input | 256 KiB per file and 256 KiB combined per message; strict UTF-8, no NUL |
| Image input | 4 MiB per file; 8 MiB combined file bytes per message; dimensions at most 4096 per side and 16 million pixels |
| Published result | Same formats plus `.html`/`.htm` as text; 8 MiB per file; image dimension bounds remain |
| Preview | 64 KiB UTF-8 text with truncation indication, or one validated image at its file limit |
| Durable artifact storage | 256 MiB of live file bytes; 4096 metadata records; quota failure never evicts accepted content |
| Names | Basename only, at most 180 Unicode characters; control characters removed; no path authority |
| Lifetime | No automatic expiry for durable inputs/results. Explicit removal deletes the blob and leaves a bounded tombstone; a full metadata quota requires a later maintenance operation, not silent history loss |
| Spill output | 10 MiB per spill file, 64 MiB combined spill files; existing seven-day startup cleanup; retained head/tail remains bounded and states when full output was not saved |

The quota covers OpenBot's artifact blob store, not copies already embedded in Pi journals, exports or backups. This is not a complete data-erasure feature. Draft detachment only removes the reference; it does not delete the shared local copy. Empty text files are valid inputs; invalid image content is rejected. File sizes and signatures are checked before allocation beyond the limits.

## Boundaries and protocol

`packages/local-executor` owns all artifact file reads, writes, validation, previews, export, removal and its separate SQLite metadata/operation ledger under `<data>/attachments`. This directory is distinct from `<data>/artifacts`, which remains the short-lived spill directory. The Host never opens these blobs or the executor database. It accesses an `ArtifactPort` through `apps/local-server` composition. No Pi imports leave `agent-runtime`.

Public types in `protocol`:

- `ArtifactRef`: opaque `artifactId`, display name, media type, byte count, SHA-256, created time, source (`input` or `result`) and availability. No original absolute path.
- `ArtifactContent`: ref plus a bounded UTF-8 text or base64 image payload. Preview responses include a truncation flag; unavailable responses include a stable reason.
- `MessageAttachment`: immutable ref carried by a draft, accepted input and transcript projection. The Host resolves submitted IDs; renderer-supplied names/hashes/content are not authoritative.
- `messages.submit` adds optional ordered `artifactIds`. Existing text-only calls and stored documents retain their behavior.
- User and pending transcript items add optional attachment refs. Tool outcomes can contain an artifact ref; the Pi adapter projects it into the tool card without parsing model prose.

Host methods: `artifacts.import({requestId,path})`, `artifacts.export({requestId,artifactId,path})`, `artifacts.get({artifactId})`, `artifacts.preview({artifactId})`, and `artifacts.remove({requestId,artifactId})`. All have strict bounded schemas. Only get/preview/remove are renderer methods. Import/export are invoked by main's named picker handlers after a native user selection. The preload exposes `attachFiles()` and `exportArtifact({artifactId,requestId})`; it never exposes a renderer-supplied source/destination path. An attachment ID is not a filesystem grant.

Private Host/executor requests use an explicitly typed `artifact.request` / `artifact.response` envelope with request identity, operation and local `targetId`; wrong targets and malformed requests fail before filesystem access. The Host transport bounds outstanding artifact requests and timeouts, rejects old-child replies and reports uncertain mutation outcomes after process loss. Native selection authority is carried only over the trusted main→Host→executor path, never in a model tool argument. A new renderer frame cannot reuse another frame's selection.

Model-facing `artifact_publish({path,name?})` is an executor tool. It goes through Tool Router and ordinary read-grant policy, binds the existing target and invocation identity, and validates grants again in the executor. It cannot grant a source path, export to a destination, remove content or operate a different target. It returns an immutable artifact ref as structured receipt detail. It is not added to local app Code Mode in this batch.

## Storage and recovery

- Serialize artifact mutations; reserve quota before copying. Open only regular files, cap reads, reject symlink components and traversal, verify descriptors and file identity, and validate format/signature. Grant checks use the canonical source for model publication. Bots share the Mac; these checks do not claim an OS sandbox against arbitrary shell access.
- Blob filenames are generated from validated opaque IDs, never display names. Directory/file modes are 0700/0600. Blob writes use exclusive temporary files and atomic publication; interrupted temporary files are reclaimed at startup.
- Record operation identity and argument digest before side effects. Import/publish records enough staged metadata to reconcile a published blob if the process dies before returning. Same identity/digest returns the committed ref; changed arguments conflict. The model publication receipt remains authoritative across retries.
- Export writes to a new filename only; existing destinations are never overwritten. Stage in the selected canonical parent and atomically publish without replacement. An interrupted export reconciles the recorded destination/hash before retrying; mismatched or unverifiable effects remain uncertain. A save-dialog cancellation creates no intent. Return no secret/source content in diagnostics.
- Removal is idempotent and retains a tombstone. Preview/import hydration detects missing content or a changed digest and fails explicitly. No automatic resurrection on retry.
- The Run stores immutable attachment references along with each original message and aggregated input. Deduplication compares text, channel/origin and ordered IDs/digests. Existing retained request receipts are checked before re-reading files, so a retry does not depend on the original source file. Attachment contents are hydrated from the immutable store for Pi admission; failure before admission records a clear failure, not an empty input.
- Pi's existing input content and custom application-entry support carry text/image parts and display metadata. Use an `openbot.user-input` entry with original user text and immutable refs; the transcript projection must not echo base64 or the entire injected text. Update history/search projections to understand the new entry; search indexes user text and display names, not attachment bodies. No vendor patch is required.
- Preserve ordered attachments when queued messages combine and when inputs steer a Run. Recovered inputs use the original identities and Pi request IDs. Image bytes are encoded only inside `agent-runtime`'s Pi boundary. Public protocol types never reference Pi types.
- Composer storage adds optional refs without discarding version-1 text drafts. Frozen attempts carry refs independently of newer edits. Clearing a sent draft clears only the version that was sent.

## Diagnostics and privacy

Record operation/request identity, target, artifact ID, MIME, size, duration and outcome in local diagnostics. Never log file content, original selected paths, image base64, model credentials or attachment text. Rendered model answers and authorized receipt details stay in the existing local conversation stores. No telemetry or external content loading is added.

## Implementation steps

1. Implement typed contracts, strict schemas, executor artifact store/validation/recovery and bounded spill files; add invariant tests before UI wiring.
2. Add the private executor port and Host methods; wire native selection through allowlisted main/preload handlers. Verify arbitrary renderer paths and cross-frame/expired selection use fail.
3. Extend durable Run inputs, Pi admission and transcript/search projections. Preserve legacy text-only documents and replay identities.
4. Add composer attachment chips, input/result cards, safe preview/export/removal and English/Chinese strings. Preserve current drafts, search targets and read acknowledgement rules.
5. Extend ScriptedModel and background e2e with native-dialog stubs in the isolated test app. Run check/full background e2e, inspect screenshots, and perform an isolated real-model text/image-capability spot check. Native dialogs must not actually open during validation.

## Acceptance

1. Unit tests cover path traversal, symlinks, special files, MIME/signature mismatch, bad UTF-8, image dimensions, count/size/quota limits, corrupt/missing blobs, identity conflicts, export non-overwrite and crash reconciliation. Concurrent operations cannot exceed storage limits.
2. Spill tests exceed the per-file and total quota, prove bounded disk/memory retention and show honest truncation markers; old-file cleanup does not touch durable attachments.
3. Runtime/Host tests cover text/image admission, incompatible models, queue/steer/restart, uncertain-send replay, changed ordered refs and legacy text records. No raw file content or credentials appear in audit records or transcript metadata.
4. Background e2e imports text and an image through stubbed native selection, deletes originals, sends/retries once, reloads/restarts and sees the same cards. A model publishes a granted result; an ungranted source is denied. Reopen/preview/export works; existing destinations and malicious HTML remain safe. Removal leaves an unavailable card. English/Chinese and minimum-width views remain usable.
5. `pnpm run check` and full background `pnpm run e2e` pass. Real-model input/result checks use synthetic files, an isolated inactive app and the user's existing endpoint; no owner data or visible native dialogs. An endpoint without image capability is recorded as such and cannot be claimed to pass image inference.

## Open questions

None. Private-chat input is deliberate first scope; collaboration attachment propagation, Office/PDF extraction, global artifact browsing and complete journal erasure remain separate tasks. Native signed-picker acceptance is release evidence and does not authorize foreground validation here.

# D9: Files and read-only document previews

Status: done — merged in [PR #58](https://github.com/VesperZephyr/OpenBot/pull/58)
Branch: task/d9-file-reading
Depends on: I6 (merged in #57), B15a

## Goal

Make local files and conversation results easy to discover and read inside OpenBot, especially Markdown and HTML. Reuse maintained open-source renderers; do not add editing or a second document store.

## Product contract

- A compact Files entry opens a file workspace with Workspace and Shared files sections, filename filtering, folder breadcrumbs, refresh, explicit loading/error/empty states and Open file through a native picker. Keep the chat list on the left, the live conversation in the middle and the reader docked on the right. Both vertical dividers support pointer and keyboard resizing, with remembered widths and bounded minimum sizes. Closing the reader restores the two-column chat layout without remounting the conversation.
- Workspace browsing is read-only and confined to the configured workspace. Shared files lists existing immutable artifact metadata; opening validates the saved copy. Native Open file reads a selected file without importing it into a chat, model context or durable history.
- Clicking a filename or Preview on an AI result card opens the same right-hand reader, with the file list collapsed by default. The file picker expands inside the reader, without adding a fourth application column. The Files entry is a secondary way to browse. Markdown defaults to formatted reading with a heading outline, GFM tables/tasks/footnotes, syntax highlighting, math, code copy, zoom and an optional read-only source view. Use react-markdown, remark-gfm, remark-math, rehype-katex and rehype-highlight; use react-resizable-panels for the application split layout. Keep the existing streaming chat renderer unchanged in this batch.
- HTML and web pages use Electron WebContentsView, an embedded Chromium browser with compact back/forward, reload, zoom and loading/error states. Local HTML may load HTTP(S) scripts, styles, images and data; normal web pages open directly without iframe embedding restrictions. The browser has a separate in-memory session, no Node/preload/OpenBot bridge or local file access. New-window links navigate the same reader; downloads and device permissions are denied. No model-driven browser control or managed browser profile is introduced. Relative local-file bundles remain a separate contract.
- PDF uses React-PDF/PDF.js with a locally bundled worker, text selection, page navigation and zoom. PNG/JPEG/WebP/GIF use native image rendering; text/code uses escaped or highlighted text. CSV uses Papa Parse with bounded rows and a table. Unsupported files remain visible with a clear explanation; no Office/cloud preview service is added.
- Reading never writes the source, runs a Bot or consumes model credits. File preview is distinct from Attach files. Existing input formats and model admission remain unchanged. Published results also support bounded PDF; immutable artifact semantics remain unchanged.

## Tabbed reader extension

- The right-hand panel holds up to 12 independently closeable file/page tabs. Opening an already-open workspace path, artifact ID, native file selection identity or canonical HTTP(S) URL selects its existing tab. Distinct native files with the same filename remain distinct. The limit is explicit and never evicts an open tab silently.
- In-session tab switching preserves document scroll, zoom/source mode, PDF page, browser navigation and page interaction state. Inactive panels are hidden and not keyboard-focusable. Browser views are retained but invisible and background-throttled. Closing a tab destroys its view and revokes its preview URL; late asynchronous loads cannot recreate a closed tab.
- Tabs support arrow keys, Home/End and Delete. Closing the selected tab selects the next neighbor, then the previous; closing the last shows the file/page chooser. A horizontally scrollable tab bar handles long names and narrow panes. The plus button opens the existing file chooser and an HTTP(S) page-address form. Chat and document web links open in right-hand tabs.
- Closing the panel releases document/browser instances and keeps tab selections (including bounded native-picked content in memory) for reopening in this app session; restarting the app does not restore private file contents or web pages. No editor, browser profile management, downloads or model browser tools.
- Extend desktop tests for multiple document types, scroll/zoom/page state, native-page state and visibility, duplicate detection, close/focus/resource cleanup, URL validation, tab overflow and Chinese layouts.

## Boundaries and limits

- Add typed `files.list({path})` and `files.read({path})` for workspace-relative paths; executor validates containment and rejects symlink components and special files. Paths are at most 4096 characters, no absolute paths or lexical parent traversal. Directory listing is bounded to 500 entries with an explicit limit indicator; only one directory is read at a time.
- Main-only `files.open({path})` is called after native selection with current main-frame lifetime checks. It is not in the renderer method allowlist. `openFile()` accepts no renderer path. A picker grants only that file read, not a persistent model grant or directory capability.
- Reuse the existing target-bound private artifact operation transport for read-only file operations; executor owns filesystem reads. Add metadata-only `artifacts.list({offset,query})` (200 records/page, existing 4096-record cap) and `artifacts.read({artifactId})` for complete bounded reader content. Keep legacy `artifacts.preview` behavior for old clients.
- Reader files are at most 8 MiB; text at most 2 MiB, strict UTF-8/no NUL; images require matching signatures and bounded dimensions where available. Reads verify descriptor identity/size/mtime and never silently show a truncated HTML/PDF. Unsupported or oversized files fail with a local, actionable message. Contents and paths never enter operational logs.
- HTML preview uses an ephemeral, unguessable URL in a dedicated custom protocol, capped to twelve documents per app window without silent eviction and revoked on close/navigation/window destruction. Only the owner reader session can serve these URLs. Local HTML response CSP allows normal web resources while denying privileged resources. Native WebContentsView runs with sandbox, context isolation and no preload; requests and navigation reject app/file/custom protocols. Main IPC requires the trusted application main frame. Browser controls accept only a window-owned opaque reader ID and validated bounds/URLs. Native views track resized panel bounds, hide during divider dragging and application modal dialogs, and are destroyed on close or owner navigation. No file:// URLs.
- PDF worker and optional reading dependencies are lazy-loaded. Markdown/PDF rendering libraries, PDF worker, CMaps, fonts, decoders and dependency license notices are bundled locally. HTML may load its linked web resources. Shared reader selection ignores stale requests after switching files. The reader is non-modal: chat stays usable while reading, Escape in the reader closes it, and keyboard focus is restored to the opener. Disabled/busy controls and minimum-width/dark/Chinese layouts remain usable.

## Open-source decision

[react-markdown](https://github.com/remarkjs/react-markdown) and its unified plugins provide a mature React syntax tree and GFM extension model (MIT). [React-PDF](https://github.com/wojtekmaj/react-pdf) (MIT), backed by [PDF.js](https://github.com/mozilla/pdf.js) (Apache-2.0), provides local PDF rendering. [Papa Parse](https://github.com/mholt/PapaParse) (MIT) supplies CSV parsing. [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) (MIT) supplies accessible split panes and layout persistence. Chromium supplies HTML layout; [Electron guidance](https://www.electronjs.org/docs/latest/tutorial/security) and the [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view) define isolation.

[Streamdown](https://streamdown.ai/docs) is appropriate for streaming messages but replacing the accepted D8 streaming implementation is unnecessary for static files. [react-doc-viewer](https://github.com/cyntler/react-doc-viewer) has a broader format abstraction, but some formats depend on externally accessible documents/services; individual local renderers fit OpenBot's offline ownership and UI better. Shiki is another strong syntax renderer; rehype-highlight avoids a second asynchronous grammar pipeline for this bounded reader.

## Steps and acceptance

1. Implement executor file reads/listing and immutable artifact listing/full reading with strict protocol schemas. Test traversal, symlinks, byte bounds, changed/missing files, malformed content, metadata pagination and no mutation/model authority.
2. Add native picker, isolated HTML delivery and lazy open-source readers. Extend file cards and the file workspace; keep editing absent and language/theme behavior aligned.
3. Extend ScriptedModel desktop coverage for workspace browsing, native selection, formatted Markdown/outline/code/math, HTML layout/interaction, real remote resource loading, embedded HTTP(S) navigation and blocked privilege escalation, PDF pages, CSV/images, error/loading/switching/close states, immutable artifacts and no inference while reading.
4. Run `pnpm run check` and full hidden `pnpm run e2e`; inspect screenshots and explore an isolated app with agent-browser. Preserve owner running routines while validating. Update plan/backlog and open a PR targeting main, explicitly dependent on #57 if it is still unmerged.
5. After automated acceptance, package and update the owner's installed app while idle, preserve routine configuration, and open an actual local report to verify the installed reader. Keep private evidence outside Git. Do not merge or publish a release.

## Open questions

None. The owner confirmed an embedded browser that opens pages. This is a user-operated reading surface, not Phase 3 model browser control. Office formats, local folder bundles and persistent browser profiles remain separate work.

## Acceptance evidence

- `pnpm run check` passed 537 tests across 81 files. The full hidden `pnpm run e2e` passed 174 tests across 46 files for the tabbed three-column layout.
- Inspected generated-file, resized three-column, Markdown, PDF and Chinese dark/minimum-window screenshots. Isolated agent-browser exploration verified the divider, embedded HTML interaction and page state after switching file tabs.
- ScriptedModel cases cover both pointer/keyboard dividers and width persistence, simultaneous chat streaming and reading, drafts, generated file cards, responsive Markdown/PDF, HTML resize/modal ownership, formats/errors and Chinese/dark/minimum-width layouts. Multi-tab coverage verifies Markdown scroll/zoom, PDF page, two native page states and visibility, duplicate workspace/native/web opens, keyboard navigation/closure, URL validation, chat/document links and narrow tab overflow.
- Built and installed `0.0.0-d9.20261024.3` after backing up the previous app and local data; deep/strict signature verification passed. Opened the real AI-published radar Markdown from its message filename and an official Electron documentation page in separate right-hand tabs. The page loaded inside the app; switching back retained the report and both tabs beside the conversation/composer. Earlier installed acceptance verified both dividers.
- Rechecked all three enabled daily schedules (07:08, 07:10 and 07:47 Asia/Singapore), unchanged revisions/report dependencies, exactly one copy of each accepted report and unchanged model configuration after restart.
- Native installed acceptance covers the real Markdown and live HTTP(S) page. Automated desktop acceptance separately covers multiple local HTML interactions, independent browser state/visibility and PDF page retention; no new model call was needed for preview verification.
- The package remains ad-hoc signed for local acceptance, not a Developer ID/notarized release. Owner data and screenshots stay outside Git.

## Follow-up

[D10: Reader polish and real report acceptance](d10-reader-polish.md) tracks control alignment, adaptive file tabs and the subsequent real Markdown/HTML delivery check.

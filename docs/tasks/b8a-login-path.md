# B8a: Login Shell Command Path

Status: in review
Branch: task/b8a-login-path
Depends on: B8, B7a (background verification)
Architecture: Sections 3 (desktop owns Host startup), 5.9 (credential isolation)

## Goal

Close the release gap recorded in the technical plan: a Finder launch must find the user's command-line tools through their login shell's PATH, even when launchd supplies only system directories.

## Scope

In: resolve PATH once before starting the Host, bounded startup and fallback, regression tests through the desktop, Host, and executor.

Out: importing other shell environment variables, model `$NAME` credential resolution, changes to tool policy, runtime selection, protocols, or persistence; Phase 2 features.

## Design

Desktop main launches the user's absolute `SHELL` (falling back to the account shell, then `/bin/zsh`) as an interactive login shell. It receives only the existing minimal environment plus `SHELL`, `LOGNAME`, and `TERM=dumb`. Its command prints PATH between unique NUL-delimited markers. Startup output is bounded to 64 KiB, never logged, and never forwarded to the Host. Only a nonempty PATH whose components are absolute directories is accepted; ordering and spaces are preserved. Malformed output, shell failure, excessive output, or a five-second timeout retains the inherited PATH (or the standard system PATH if absent).

Run the probe in its own process group with no stdin. Kill the group on completion or failure, including descendants that keep output pipes open. The promise settles without waiting for pipes to close on timeout. This is ordinary user shell initialization, not a sandbox; shell startup files can run user-configured commands. Descendants that detach into a different session are outside process-group cleanup.

The window can open while resolving PATH. The Host starts only after resolution and uses the same environment on automatic restarts. Quitting during resolution prevents Host startup. Packaged Node, Host, and executor paths stay fixed to bundle resources. Never capture the shell's full environment or forward arbitrary desktop environment variables.

## Contracts

`resolveLoginPath(source: NodeJS.ProcessEnv, options?: { timeoutMs?: number }): Promise<string>` in `apps/desktop/src/main/login-path.ts` returns a PATH and does not mutate `source`. The optional timeout supports deterministic tests. The caller supplies the desktop launch environment; the resolver constructs a minimal probe environment internally.

## Steps

1. Implement the resolver and integrate it before `host.start()` in desktop main.
2. Add tests for PATH discovery, noisy startup, isolation, malformed/failing shells, output limits, and timeout cleanup.
3. Add a ScriptedModel e2e regression launching with a system-only PATH and a fixture login shell. Execute a fixture command through an approval and assert that shell-only secrets do not reach the command or log.
4. Run `pnpm run check`, `pnpm run e2e`, inspect screenshots, explore the new flow with agent-browser, and build and smoke-test the ad-hoc package. Update the technical plan and backlog with results and remaining acceptance limits.

## Acceptance

1. A login-shell-only executable runs after **Allow once**, starting from a system-only desktop PATH. `e2e/login-path.e2e.ts`.
2. Startup banners and secrets are absent from Host logs and command environments. Resolver unit tests and the e2e regression.
3. Unavailable, failing, malformed, noisy, or hanging shells fall back within the startup bound, and ordinary probe descendants are terminated. Resolver unit tests.
4. Existing checks and all desktop suites pass. `pnpm run check`, `pnpm run e2e`; screenshots inspected.
5. The packaged Host and executor run the fixture executable through the resolved PATH after approval. Scripted IPC smoke on the bundled Node; code-signature verification on the built app. The owner requested background-only verification on 2026-10-16, so this check does not launch the installed Electron UI. Clean-Mac acceptance, visible packaged startup, Developer ID signing, and notarization remain separate B8 acceptance limits.

## Risks

Shell startup may need a terminal or exceed five seconds; fallback preserves app availability. Custom shells that cannot print the framed PATH fall back. Shell initialization executes the user's startup files once per desktop launch.

## Open questions

- 2026-10-16: Visible packaged startup has not been rerun because the owner requested background-only verification. The packaged app intentionally ignores development test flags. Bundled Host/executor execution and package signatures are checked independently; full clean-Mac acceptance remains with B8.

## Validation

2026-10-16: `pnpm run check` passed (178 tests). All 25 e2e tests across 10 suites passed in background; the final process-group cleanup adjustment also passed the targeted login-PATH and background suites (3 tests). Screenshots were inspected. Agent-browser completed model selection, Bot creation, approval, and command completion against an isolated hidden app; Electron reported `visible: false` and `focused: false` before shutdown.

`pnpm run package` produced an ad-hoc arm64 DMG. `codesign --verify --deep --strict` passed for the app and the bundled Node; Node has `allow-jit`. An isolated scripted IPC smoke on the packaged Node 24.22.0 verified the bundled Host, bundled executor, login-PATH fixture command after approval, and absence of shell-only secrets in model requests and process output. No real provider, visible packaged window, Developer ID signing, notarization, or clean-Mac installation was exercised.

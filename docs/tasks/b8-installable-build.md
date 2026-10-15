# B8: Installable Build

Status: in review
Branch: task/b8-installable-build
Depends on: none to build; B3–B7 to ship (B8 packages whatever is merged)
Architecture: Sections 3 (bundled Node, Host and executor outside `app.asar`), 6.4 (fuses, `app://`, signing)

## Goal

Produce a DMG that a user can download and run on a Mac that never had the development setup. Today OpenBot runs only from a checkout: Electron main starts the Host with `node` from `PATH`, the Host and executor are TypeScript run by Node's type stripping, and the renderer loads from `file://`. The MVP acceptance list in the backlog is checked against a packaged build, so packaging has to be real and repeatable before that check can happen.

## Scope

In:
- `pnpm run package` → `apps/desktop/dist/OpenBot-<version>-arm64.dmg` (electron-builder 26, macOS arm64).
- Host Runtime and local executor bundled into single ESM files, shipped in `Contents/Resources/host/`, run by a pinned, checksum-verified Node 24 in `Contents/Resources/node`.
- Hardened runtime with `com.apple.security.cs.allow-jit`; Electron fuses from Section 6.4.
- The renderer served from a privileged `app://` scheme in built and packaged runs; `file://` is gone.
- Developer ID signing and notarization when CI secrets exist; an ad-hoc local build otherwise.
- `.github/workflows/release.yml`: a `v*` tag packages, signs, notarizes, and publishes the DMG to a GitHub Release.
- A bounded diagnostics log of Host and executor output at `<data>/logs/host.log`.

Out:
- Universal (x64) build: later; needs an x64 Node tarball and checksum, and `arch: universal`.
- Auto-update (electron-updater, update manifests): later, when there is a release channel.
- An application icon, DMG background, and About metadata: design work, not packaging.
- Native helpers (computer use) and the managed browser: Phase 3; they add `mac.binaries` entries.

## Design

### Process layout in the app bundle

```text
OpenBot.app/Contents/
  MacOS/OpenBot                       Electron main (fuses applied)
  Resources/
    app.asar                          package.json, out/main, out/preload, out/renderer (no node_modules)
    node                              official Node v24.22.0 darwin-arm64, re-signed with the app's identity
    node-LICENSE
    host/host.mjs                     Host Runtime, one ESM bundle
    host/executor.mjs                 local executor, one ESM bundle
    host/host.mjs.LEGAL.txt           licenses of bundled code
```

Electron main chooses paths with `app.isPackaged`:

| Run | Node | Host entry | Executor entry |
| --- | --- | --- | --- |
| Packaged | `process.resourcesPath/node` | `…/host/host.mjs` | `…/host/executor.mjs`, passed as `OPENBOT_EXECUTOR_ENTRY` |
| Development, e2e (built, unpackaged) | `OPENBOT_NODE` or `node` | `OPENBOT_HOST_ENTRY` or `apps/local-server/src/main.ts` | `OPENBOT_EXECUTOR_ENTRY` if set, else the Host's sibling default |

Packaged runs ignore the `OPENBOT_NODE`/`OPENBOT_HOST_ENTRY` overrides: the code that runs with the user's Keychain access must be the signed code in the bundle. The Host spawns the executor with `process.execPath`, so the executor also runs on the bundled Node without further changes.

### Bundling the Host and executor

`apps/desktop/scripts/stage-runtime.mjs` runs esbuild (0.28.2, already in the lockfile through Vite) over `apps/local-server/src/main.ts` and `apps/local-executor/src/main.ts` into `out/runtime/host/`. Workspace packages and vendored Pi resolve from the workspace exactly as in development (Pi through its built `dist/`, which `pnpm run build:pi` produces).

Findings that shape the configuration:

- **Pi runtime assets.** Pi Durable lists `@silvia-odwyer/photon` (WebAssembly image processing) and `@earendil-works/pi-codemode` (QuickJS WebAssembly) as dependencies, but OpenBot reaches neither: `agent-runtime` imports `@earendil-works/pi-durable`, `…/storage/sqlite/node`, `@earendil-works/chord/context`, and pi-ai providers and lazy APIs, never `pi-durable/images` or `pi-durable/codemode`. The bundle metafile contains no Photon, QuickJS, or `.wasm` input, and pi-ai's model catalogs are TypeScript modules that bundle as code. Nothing is copied beside the bundle.
- **Opaque dynamic imports.** pi-ai loads the Bedrock implementation and OAuth flows through variable specifiers (`import(runtimeSpecifier)`) so browser bundlers cannot follow them. A single-file bundle has no sibling file to import. Bedrock is a listed built-in provider that a user can configure with a stored key, so an esbuild `onLoad` plugin rewrites that one call to a static `import("./bedrock-converse-stream.js")` (still lazy; the script fails loudly if Pi's source changes). OAuth flows stay opaque: OpenBot stores only API keys (`keychain.ts`), and the OAuth entry points (`login`, `refresh`, `toAuth`) are never called.
- **CommonJS inside ESM.** Bundled CommonJS dependencies (Google and AWS SDK transitive deps) call `require()` for Node built-ins; a banner defines `require` with `createRequire(import.meta.url)`.
- **Optional native peers.** `canvas` (linkedom, from B4's web research), `bufferutil` and `utf-8-validate` (ws) are marked external. Each is loaded inside `try/catch` with a pure-JS fallback, so the bundle never loads a native module. Verified: a linkedom bundle with `canvas` external parses HTML on the bundled Node and `HTMLCanvasElement.getContext()` returns `null` from the shim.
- **`node:sqlite`.** Present and unflagged in Node 24; verified by running the bundled Host (it opens `openbot.sqlite`).

Alternatives considered:
- **Copy workspace sources and `node_modules` and run with type stripping.** Rejected: hundreds of MB of pnpm symlink trees, type stripping depends on file extensions inside `node_modules`, and it ships every Pi dev dependency.
- **`utilityProcess` or Electron's Node (`ELECTRON_RUN_AS_NODE`).** Rejected by Section 3: the `runAsNode` fuse is off, and the Host must spawn the executor.
- **Node single-executable applications.** Rejected for now: SEA still needs a code-signature reset after injection and gives nothing over one ESM file run by a signed Node.

### The bundled Node

`stage-runtime.mjs` downloads `https://nodejs.org/dist/v24.22.0/node-v24.22.0-darwin-arm64.tar.gz` once, verifies its SHA-256 against the value pinned in the script (from `SHASUMS256.txt`), extracts `bin/node` and `LICENSE` into `apps/desktop/.cache/node/` (gitignored), and copies them to `out/runtime/`. A mismatched checksum aborts the build. Upgrading Node means changing `NODE_VERSION` and `NODE_SHA256` together.

electron-builder signs every Mach-O in the bundle, including `Contents/Resources/node`, with the hardened runtime and `entitlementsInherit`. Both entitlement sets contain `com.apple.security.cs.allow-jit`; without it the hardened runtime kills V8 at startup.

### Fuses

Set by electron-builder's `electronFuses` before signing:

| Fuse | Value |
| --- | --- |
| `runAsNode` | off |
| `enableNodeOptionsEnvironmentVariable` | off |
| `enableNodeCliInspectArguments` | off |
| `enableEmbeddedAsarIntegrityValidation` | on |
| `onlyLoadAppFromAsar` | on |
| `enableCookieEncryption` | on |
| `grantFileProtocolExtraPrivileges` | off |

### `app://` renderer loading

`apps/desktop/src/main/app-protocol.ts` registers `app` as a standard, secure, fetch-capable scheme before `ready` and serves `out/renderer` at `app://openbot/`. Requests are decoded, resolved under the renderer root, and refused (404) when they leave it, including encoded separators (`%2f`) and malformed escapes. The page keeps its `<meta>` Content-Security-Policy (`default-src 'self'`), and `'self'` now means `app://openbot`.

Built-but-unpackaged runs (the e2e suite, `electron-vite preview`) use `app://` too, so e2e exercises the same loading path as the DMG. Only the electron-vite dev server (`ELECTRON_RENDERER_URL`, unpackaged) loads over HTTP. `isTrustedRendererUrl` accepts exactly `app://openbot/index.html` (`app:` is not a special URL scheme, so `URL.origin` is `"null"`; the check compares scheme, host, and path).

### Signing and notarization

`apps/desktop/scripts/package.mjs` calls electron-builder's API with `electron-builder.yml`:

- `CSC_LINK` (+ `CSC_KEY_PASSWORD`) or `CSC_NAME` present: Developer ID signing, `forceCodeSigning`, entitlements `build/entitlements.mac.plist` (only `allow-jit`). Notarization runs when `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` or `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` are set; electron-builder reads them directly.
- Otherwise: `CSC_IDENTITY_AUTO_DISCOVERY=false`, `identity: "-"` (ad-hoc), no notarization, and `build/entitlements.adhoc.plist`, which adds `com.apple.security.cs.disable-library-validation`. Ad-hoc signatures carry no Team ID, and the hardened runtime's library validation otherwise refuses to load the Electron Framework (observed: dyld "mapping process and mapped file (non-platform) have different Team IDs"). That build is for local testing and is never published.

### Release workflow

`.github/workflows/release.yml` on `push` of `v*` tags, `macos-15`: install, `build:pi`, `check`, download Electron, write the App Store Connect key to a temp file, `pnpm run package` with `CSC_LINK`/`CSC_KEY_PASSWORD` and `APPLE_API_KEY*` from secrets, verify (`codesign --verify --deep --strict` on the app and `Resources/node`, `spctl --assess`, `stapler validate`), then `gh release create` with the DMG. It refuses to run without the certificate secret, so it can never publish an ad-hoc build.

### Diagnostics log

Electron main pipes the Host's stdout and stderr (which the executor inherits) instead of inheriting them. Each chunk is echoed to main's own stdout/stderr (development output is unchanged) and appended to `<data>/logs/host.log`, where `<data>` is `OPENBOT_DATA_DIR` or `~/Library/Application Support/OpenBot`, the Host's data directory. Each Host start writes a marker line with the Node binary and entry. When a write would push the file past 5 MB, it is renamed to `host.log.1` (replacing the previous one) and a new file starts; an existing oversized file from an earlier launch rotates on the first write. Write failures drop the chunk rather than affect the app.

## Contracts

```text
apps/desktop/
  electron-builder.yml            appId ai.openbot.desktop, productName OpenBot, mac dmg arm64, fuses, extraResources
  build/entitlements.mac.plist    allow-jit (Developer ID)
  build/entitlements.adhoc.plist  allow-jit + disable-library-validation (ad-hoc only)
  scripts/stage-runtime.mjs       out/runtime/{node,node-LICENSE,host/host.mjs,host/executor.mjs}
  scripts/package.mjs             signing mode from env, then electron-builder
  .cache/node/                    downloaded Node (gitignored)
  dist/                           DMG and unpacked app (gitignored)
```

Environment: `CSC_LINK`, `CSC_KEY_PASSWORD`, `CSC_NAME`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`. Release secrets: `MAC_CERTIFICATE_P12_BASE64`, `MAC_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.

```ts
// apps/desktop/src/main/host.ts
export type HostProcessOptions = {
	readonly node: string;
	readonly entry: string;
	readonly env: NodeJS.ProcessEnv;
	/** Receives everything the Host and its executor write to stdout and stderr, after it is echoed to main's own. */
	readonly onOutput: (chunk: Buffer) => void;
	readonly onEvent: (event: HostEvent) => void;
	readonly onState: (state: HostState) => void;
};

// apps/desktop/src/main/app-protocol.ts
export const APP_ENTRY_URL = "app://openbot/index.html";
export function registerAppScheme(): void; // before app ready
export function serveAppScheme(root: string): void; // after app ready
export function resolveAppRequest(root: string, url: string): string | undefined;

// apps/desktop/src/main/host-log.ts
export class RotatingLog {
	constructor(path: string, limitBytes: number);
	write(chunk: Uint8Array): void;
}
```

No protocol, persistence, or Host behavior changes.

## Steps

1. Electron main: packaged runtime paths, `app://` scheme, piped Host output into `RotatingLog`. Files: `apps/desktop/src/main/{index,host,app-protocol,host-log}.ts`, `apps/desktop/test/*.test.ts`, `apps/desktop/tsconfig.json`. Check: `pnpm run check`, `pnpm run e2e`.
2. Packaging: `stage-runtime.mjs`, `package.mjs`, `electron-builder.yml`, entitlements, `package` scripts (desktop and root), devDependencies `electron-builder@26.15.3` and `esbuild@0.28.2`, `.gitignore`. Check: `pnpm run package`, then the packaged smoke below.
3. Release workflow. Check: YAML review; not triggered.

## Acceptance

1. `pnpm run package` with no signing environment produces `apps/desktop/dist/OpenBot-0.0.0-arm64.dmg`; `codesign --verify --deep --strict` passes on the app inside the mounted DMG. (Scripted smoke.)
2. `codesign -d --entitlements -` on `Contents/Resources/node` shows the hardened runtime flag and `com.apple.security.cs.allow-jit`. (Scripted smoke.)
3. `@electron/fuses read --app` shows every fuse in the table. (Scripted smoke.)
4. Launched with `open -n --env OPENBOT_DATA_DIR=<tmp> …`, the process list shows `Contents/Resources/node … Contents/Resources/host/host.mjs` as a child of `Contents/MacOS/OpenBot`, and `<tmp>/logs/host.log` has the start marker. A tool call adds `Contents/Resources/node … host/executor.mjs` as the Host's child. (Packaged smoke.)
5. Over CDP, the window URL is `app://openbot/index.html`, `hostState()` is `ready`, `host.status` reports Node `24.22.0`, and `fetch` of a path outside the renderer returns 404. (Packaged smoke.)
6. `app://` resolution refuses encoded traversal, malformed escapes, foreign hosts, and the bare root. (`apps/desktop/test/app-protocol.test.ts`.)
7. The diagnostics log stays under its limit, keeps one previous file, and counts a pre-existing file toward the limit. (`apps/desktop/test/host-log.test.ts`.)
8. The e2e suite passes against the built, unpackaged app over `app://`. (`pnpm run e2e`.)

## Risks

- **Pi adds another opaque import or a runtime asset.** The bundled Host would fail only on the code path that needs it. Notice: the packaged smoke, or errors in `host.log`. Response: extend the esbuild plugin or copy the asset beside the bundle, as for Bedrock.
- **A new native dependency.** esbuild cannot bundle `.node` files. Notice: the build warns or the Host fails to start. Response: ship it under `Resources/host/` and add it to `mac.binaries` for signing.
- **Notarization rejects a nested binary.** Notice: `notarytool` log in the release job. Response: every Mach-O must be signed with the hardened runtime and a timestamp; electron-builder handles `Resources/node`, and new binaries go through `mac.binaries`.
- **Ad-hoc builds relax library validation.** Acceptable only because they are never published; the release workflow refuses to run without a certificate.

## Open questions

- 2026-10-15: No Developer ID certificate is available locally (`security find-identity -v -p codesigning` lists 0), so Developer ID signing, notarization, and `spctl` acceptance are wired but unexercised. Before the first release: add the five repository secrets, push a test tag on a fork or run the workflow's steps locally with the certificate, and confirm `spctl --assess` and `stapler validate` pass.

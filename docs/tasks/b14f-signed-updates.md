# B14f: Signed update artifacts

Status: in review
Branch: feat/unsigned-dmg-signed-updates-4579
Depends on: B14d, B14e
Architecture: Section 3 update artifacts; Section 6.4 packaging

## Goal

Reject an update DMG whose manifest was not signed by the app's embedded key, before any copy is staged. The DMG itself stays without Developer ID signing and without notarization.

## Scope

In:

- User-facing install steps for that DMG: Gatekeeper, System Settings **Open Anyway**, `xattr -dr com.apple.quarantine`, `shasum -a 256`, and `pnpm run package`.
- An ed25519 signature over a canonical manifest. Desktop main verifies it with `EMBEDDED_UPDATE_PUBLIC_KEY` before copying a DMG from `update-inbox/` to `update-staging/`.
- A signer that reads `OPENBOT_UPDATE_SIGNING_KEY` and writes no signature when that variable is missing.
- Release-workflow signing that skips when the secret is unset and fails the job when the secret is set but signing fails. Existing Apple certificate checks stay in place.

Out:

- Apple Developer ID signing, notarization, and `electron-updater`. Those remain the native release gate in the [roadmap](../development-roadmap.md#6-p2-broader-access-and-maintainability).
- Replacing the installed app, migrating conversations or other local data, rolling back a failed migration, and preserving Keychain access across a packaged upgrade. B14d still owns backup and restore. B14e still owns credential storage. This task does not claim those acceptance items from the planning brief.

## Design

The planning brief asked for artifact verification, migration failure recovery, and rollback, and it listed signing certificates as a prerequisite. The owner authorized implementation on 2026-11-11 with a hard constraint that the DMG stays unsigned in the Apple sense. The part that does not need a Developer ID is integrity of the update bytes: sign the manifest with an application ed25519 key and refuse to stage the DMG unless the embedded public key accepts that signature and the file hash matches.

The private key is never committed. `scripts/generate-update-signing-key.mjs` refuses `--private-out` inside the repository. The public key checked in with this task has no retained private half, so every signature fails closed until the owner replaces `EMBEDDED_UPDATE_PUBLIC_KEY` and stores the matching PKCS#8 PEM in the GitHub Actions secret `OPENBOT_UPDATE_SIGNING_KEY`.

electron-updater was the earlier packaging note. It is not a dependency. Its macOS flow expects a code-signed update, which this constraint does not allow.

## Contracts

Source: `apps/desktop/src/main/update-artifact.ts` and `apps/desktop/src/main/sign-update-cli.ts`.

The manifest is schema 1, product `OpenBot`, platform `darwin`, arch `arm64`, version as a semantic version, artifact name `OpenBot-<version>-arm64.dmg`, lowercase SHA-256, and byte size. The signature is standard base64 of the 64-byte ed25519 signature over the UTF-8 canonical JSON of those fields in sorted key order. The bundle file is `OpenBot-<version>-arm64-update.json` with exactly `manifest` and `signature`.

`acceptUpdateArtifact` returns `missing-signature`, `invalid-signature`, `tampered-artifact`, or `malformed` without creating or replacing the staged DMG. `invalid-signature` covers a wrong key and a changed manifest. `tampered-artifact` covers a manifest whose signature checks out but whose DMG bytes or size differ. Success copies the DMG and writes `receipt.json` with `applied: false`. It does not launch the DMG or modify the running app.

Startup calls `verifyInboxUpdate` on `<data>/update-inbox`. No inbox is a no-op. One bundle is verified. Several `*-update.json` files are `ambiguous` and stage nothing.

`OPENBOT_UPDATE_SIGNING_KEY` missing or blank: the signer exits 2 and writes nothing. A key that is not ed25519 PKCS#8, a bad version, or a DMG whose filename does not match the version: exit 1 and write nothing.

No protocol or server-core export changes.

## Steps

1. Document the unnotarized DMG install path from `package.mjs`, `electron-builder.yml`, and the root `package` script.
2. Verify and stage update bundles in desktop main. Test the four refusal and acceptance cases.
3. Sign from the release workflow only as an additional step after the existing Apple checks.

## Acceptance

1. A matching ed25519 signature and SHA-256 stages the DMG and records `applied: false`. (`apps/desktop/test/update-artifact.test.ts`, "accepts a valid signature…")
2. A changed DMG is `tampered-artifact` and the previous staged files stay. (same file, "rejects a tampered artifact…")
3. A signature from another key is `invalid-signature` and no stage directory is created. (same file, "rejects a signature from the wrong key")
4. A bundle with no signature, or a blank signature, is `missing-signature`. (same file, "rejects a missing signature")
5. The signer exits 2 when `OPENBOT_UPDATE_SIGNING_KEY` is unset and writes no manifest. A set key produces a bundle the verifier accepts. (same file, "signs through the CLI…")
6. `pnpm run check` passes. This task does not change a user-visible window, so it does not add an e2e case. CI still runs the existing desktop e2e.

## Risks

- The embedded public key does not match a secret the owner has not created yet. Symptom: every real update is `invalid-signature`. Recovery: generate a key outside the repo, replace the public constant, and set `OPENBOT_UPDATE_SIGNING_KEY`.
- A release tag with the secret unset publishes the DMG and no manifest, which is the previous release behavior. A set but unusable secret fails the release job before `gh release create`.
- Staging is not installation. Users can still open a DMG manually. The inbox check does not stop that.

## Open questions

- 2026-11-11: The planning brief's acceptance for preserving state and credentials across a packaged upgrade, and for a restorable snapshot after failed migration, needs Developer ID continuity plus a migration design. Those are not implemented here. Revisit when a Developer ID release and a data-migration spec exist. Do not treat a staged DMG as that upgrade.

## Evidence

- 2026-11-11: `pnpm run check` passed (lint, package boundaries, typecheck, 912 tests). `apps/desktop/test/update-artifact.test.ts` covers a valid signature, a tampered DMG, a wrong key, a missing signature, the embedded key, and the signer exiting 2 when `OPENBOT_UPDATE_SIGNING_KEY` is unset.
- `shasum -a 256` matches the documented checksum command. The signer, run with no key, exits 2 and writes nothing. `electron-vite build` embeds the public key in desktop main.
- The full desktop package script was not run here (it needs macOS `xcrun` for the Keychain binding). No packaged upgrade, Keychain continuity, notarization, or e2e run is claimed. The pull request's macOS CI runs the existing e2e suites.

#!/usr/bin/env node
// Packages the built app (out/) into dist/OpenBot-<version>-arm64.dmg with electron-builder.yml.
//
// Signing follows the environment:
// - CSC_LINK (+ CSC_KEY_PASSWORD) or CSC_NAME: Developer ID signing with the hardened runtime. Notarization runs when
//   APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER,
//   are set (electron-builder reads them directly).
// - Otherwise: an ad-hoc signed build for local testing that must never be published. Keychain identities are not
//   auto-discovered, so the result does not depend on what certificates this Mac happens to have.
import { build } from "electron-builder";

const developerId = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const notarize = Boolean(
	(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID) ||
		(process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER),
);
if (!developerId) process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
console.log(
	developerId
		? `Signing with a Developer ID; notarization ${notarize ? "on" : "off (no Apple credentials in the environment)"}`
		: "No signing identity in the environment: building an ad-hoc signed DMG for local testing only",
);

// Ad-hoc signatures carry no Team ID, so the hardened runtime's library validation would refuse the Electron Framework;
// only the ad-hoc build relaxes it (build/entitlements.adhoc.plist).
const adHocEntitlements = "build/entitlements.adhoc.plist";
await build({
	publish: "never",
	config: developerId
		? { mac: { forceCodeSigning: true, notarize } }
		: { mac: { identity: "-", notarize: false, entitlements: adHocEntitlements, entitlementsInherit: adHocEntitlements } },
});

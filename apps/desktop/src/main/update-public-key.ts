/** SPKI ed25519 public key embedded in the desktop app.
 *
 * No matching private key is stored in this repository. Replace this constant with the
 * public half of the `OPENBOT_UPDATE_SIGNING_KEY` secret before a signed update can be
 * accepted. Until that replacement, verification fails closed.
 */
export const EMBEDDED_UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEANLiJZ3so7ldBOuC2clfCUvP0vhCBbjMm9IuAIxQADHM=
-----END PUBLIC KEY-----
`;

// Writes .dev.vars with a fresh VAPID key and send token. Prints nothing secret.
import { existsSync, writeFileSync } from "node:fs";

const out = new URL("../.dev.vars", import.meta.url);
if (existsSync(out)) {
  console.error(".dev.vars already exists; delete it first to rotate keys (existing subscriptions will stop working).");
  process.exit(1);
}
const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", privateKey);
const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
writeFileSync(out, `VAPID_PRIVATE_JWK='${JSON.stringify(jwk)}'\nSEND_TOKEN='${token}'\n`, { mode: 0o600 });
console.log("wrote .dev.vars");

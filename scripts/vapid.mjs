// Generates the key pair for phone push notifications.
// Usage: node scripts/vapid.mjs
// Put VAPID_PUBLIC_KEY in wrangler.jsonc vars (it is public) and store VAPID_PRIVATE_KEY as a secret.
const { subtle } = globalThis.crypto;
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = await subtle.exportKey('raw', pair.publicKey);
const jwk = await subtle.exportKey('jwk', pair.privateKey);
console.log(`VAPID_PUBLIC_KEY=${b64url(pub)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);

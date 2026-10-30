// Web Push (RFC 8291 payload encryption + RFC 8292 VAPID) using only WebCrypto, so phone
// notifications work on iPhone home-screen apps and other browsers without a paid service.
import type { Env } from '../env';

const enc = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** Encrypts `payload` for one subscription (aes128gcm content coding, single record). */
export async function encryptPayload(payload: string, p256dh: string, auth: string): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = unb64url(p256dh);
  const authSecret = unb64url(auth);
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as EcdhKeyDeriveParams, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

async function vapidAuth(env: Env, endpoint: string): Promise<string> {
  const pub = unb64url(env.VAPID_PUBLIC_KEY!);
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:admin@nmsusportsforum.com' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

export function pushEnabled(env: Env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

/** Sends a notification to every device the member registered. Expired subscriptions are removed. */
export async function sendPush(env: Env, userId: number, title: string, body: string, link: string): Promise<void> {
  if (!pushEnabled(env)) return;
  const subs = (await env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').bind(userId).all<{ id: number; endpoint: string; p256dh: string; auth: string }>()).results;
  const payload = JSON.stringify({ title, body: body.slice(0, 180), link });
  await Promise.all(subs.map(async (s) => {
    try {
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: { Authorization: await vapidAuth(env, s.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' },
        body: await encryptPayload(payload, s.p256dh, s.auth),
        signal: AbortSignal.timeout(6000),
      });
      if (res.status === 404 || res.status === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(s.id).run();
      else if (!res.ok) await env.DB.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?').bind(s.id).run();
    } catch {
      await env.DB.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?').bind(s.id).run();
    }
  }));
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND failures >= 5').bind(userId).run();
}

import { describe, expect, it } from 'vitest';
import { b64url, encryptPayload, unb64url } from '../../src/worker/lib/push';
import { mapPortal, mapRecruit } from '../../src/worker/lib/recruiting';
import { parseHtmlPreview, parseTweetOembed } from '../../src/worker/lib/previews';
import { cleanTags, hideSpoilers, parseTweetUrl, parseYouTubeId, rankFor } from '../../src/shared/forum';

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

describe('web push encryption (RFC 8291)', () => {
  it('produces a payload the browser can decrypt', async () => {
    // Play the browser: create a subscription key pair and auth secret.
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const uaPublic = new Uint8Array((await crypto.subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer);
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const body = await encryptPayload('{"title":"Go Aggies"}', b64url(uaPublic), b64url(auth));

    const salt = body.slice(0, 16);
    const rs = new DataView(body.buffer).getUint32(16);
    const idlen = body[20];
    const asPublic = body.slice(21, 21 + idlen);
    const cipher = body.slice(21 + idlen);
    expect(rs).toBe(4096);
    const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
    const enc = new TextEncoder();
    const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
    const ikm = await hkdf(auth, shared, info, 32);
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
    expect(plain[plain.length - 1]).toBe(2);
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe('{"title":"Go Aggies"}');
    expect(unb64url(b64url(auth))).toEqual(auth);
  });
});

describe('recruiting mappers', () => {
  it('maps a CollegeFootballData recruit committed to NM State', () => {
    expect(mapRecruit({ id: 77, year: 2027, name: 'Sample Recruit', school: 'Sample HS', committedTo: 'New Mexico State', position: 'WR', stars: 3, rating: 0.85, city: 'El Paso', stateProvince: 'TX', ranking: 1200 }))
      .toMatchObject({ source_key: 'cfbd-r-77', kind: 'recruit', status: 'committed', hometown: 'El Paso, TX', stars: 3 });
  });
  it('keeps only portal moves involving NM State', () => {
    expect(mapPortal({ season: 2026, firstName: 'A', lastName: 'B', origin: 'Other U', destination: 'Elsewhere' })).toBeNull();
    expect(mapPortal({ season: 2026, firstName: 'Test', lastName: 'Player', origin: 'New Mexico State', destination: null })).toMatchObject({ kind: 'transfer_out', status: 'in_portal' });
    expect(mapPortal({ season: 2026, firstName: 'Test', lastName: 'Transfer', origin: 'Other U', destination: 'New Mexico State', position: 'QB' })).toMatchObject({ kind: 'transfer_in', status: 'committed', school: 'Other U' });
  });
});

describe('link previews', () => {
  it('reads tweet text and date from X oEmbed HTML', () => {
    const html = '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Committed! Go Aggies &amp; thanks <a href="https://t.co/x">@coach</a></p>&mdash; Sample Player (@sample) <a href="https://twitter.com/sample/status/1">October 30, 2026</a></blockquote>';
    expect(parseTweetOembed(html)).toEqual({ description: 'Committed! Go Aggies & thanks @coach', published: 'October 30, 2026' });
  });
  it('reads Open Graph metadata', () => {
    const html = '<html><head><title>Fallback</title><meta property="og:title" content="Aggies win opener"><meta property="og:site_name" content="Local Paper"><meta name="description" content="Recap of the game"></head>';
    expect(parseHtmlPreview(html)).toEqual({ title: 'Aggies win opener', description: 'Recap of the game', site: 'Local Paper' });
  });
  it('recognizes tweet and YouTube links', () => {
    expect(parseTweetUrl('https://x.com/NMStateFootball/status/1851234567890123456?s=46')).toEqual({ canonical: 'https://twitter.com/NMStateFootball/status/1851234567890123456', id: '1851234567890123456', user: 'NMStateFootball' });
    expect(parseTweetUrl('https://example.com/a/status/1')).toBeNull();
    expect(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5')).toBe('dQw4w9WgXcQ');
  });
});

describe('forum helpers', () => {
  it('hides spoilers in excerpts', () => {
    expect(hideSpoilers('Final was ||31-14|| wow and [spoiler]OT win[/spoiler]')).toBe('Final was [spoiler] wow and [spoiler]');
  });
  it('limits tags to known values, max 3', () => {
    expect(cleanTags(['recruiting', 'bogus', 'rumor', 'injury', 'highlight'])).toBe('recruiting,rumor,injury');
  });
  it('assigns Aggie ranks by post count', () => {
    expect(rankFor(0)).toBe('Walk-on');
    expect(rankFor(25)).toBe('Starter');
    expect(rankFor(1200)).toBe('Aggie Legend');
  });
});

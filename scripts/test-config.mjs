// Writes .wrangler.test.jsonc: the real config minus the Workers AI binding, which only runs on Cloudflare
// (local `wrangler dev` would need a Cloudflare login for it). Used by local end-to-end testing.
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync('wrangler.jsonc', 'utf8');
writeFileSync('.wrangler.test.jsonc', src.replace(/^\s*"ai":\s*\{[^}]*\},?\s*$/m, ''));

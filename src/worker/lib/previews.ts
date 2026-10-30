import type { Env } from '../env';
import { first, run } from '../db';
import { DAY, now } from '../util';
import { parseTweetUrl, parseYouTubeId } from '../../shared/forum';

export interface Preview {
  url: string;
  kind: 'x' | 'youtube' | 'link';
  ok: boolean;
  title: string | null;
  description: string | null;
  site: string | null;
  author: string | null;
  author_url: string | null;
  published: string | null;
}

const decode = (s: string) => s
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&mdash;/g, '—').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .trim();

/** Tweet text via X's free oEmbed service (no API key, no tracking script). */
export function parseTweetOembed(html: string, authorName?: string): Pick<Preview, 'description' | 'published'> {
  const p = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const anchors = [...html.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)];
  return { description: p ? decode(p[1]) : null, published: anchors.length ? decode(anchors[anchors.length - 1][1]) : null };
}

function meta(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decode(content).slice(0, 400) : null;
}

export function parseHtmlPreview(html: string): Pick<Preview, 'title' | 'description' | 'site'> {
  const title = meta(html, 'og:title') ?? meta(html, 'twitter:title') ?? (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ? decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1]).slice(0, 200) : null);
  return { title, description: meta(html, 'og:description') ?? meta(html, 'description'), site: meta(html, 'og:site_name') };
}

async function fetchPreview(url: string): Promise<Omit<Preview, 'url'>> {
  const empty = { title: null, description: null, site: null, author: null, author_url: null, published: null };
  const tweet = parseTweetUrl(url);
  if (tweet) {
    const res = await fetch(`https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(tweet.canonical)}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return { kind: 'x', ok: false, ...empty, site: 'X', author: `@${tweet.user}` };
    const data = (await res.json()) as { html: string; author_name?: string; author_url?: string };
    return { kind: 'x', ok: true, ...empty, ...parseTweetOembed(data.html), site: 'X', author: data.author_name ?? `@${tweet.user}`, author_url: data.author_url ?? null };
  }
  if (parseYouTubeId(url)) {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6000) }).catch(() => null);
    const data = res?.ok ? ((await res.json()) as { title?: string; author_name?: string }) : {};
    return { kind: 'youtube', ok: true, ...empty, title: data.title ?? 'YouTube video', site: 'YouTube', author: data.author_name ?? null };
  }
  const res = await fetch(url, { headers: { 'User-Agent': 'NMSUSportsForum/1.0 (+https://nmsusportsforum.com) link preview', Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(6000) });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html')) return { kind: 'link', ok: false, ...empty, site: new URL(url).hostname };
  // Read at most ~300 KB; the metadata lives in <head>.
  const reader = res.body!.getReader();
  let html = '';
  const dec = new TextDecoder();
  while (html.length < 300_000) {
    const { done, value } = await reader.read();
    if (done) break;
    html += dec.decode(value, { stream: true });
    if (html.includes('</head>')) break;
  }
  reader.cancel().catch(() => {});
  return { kind: 'link', ok: true, ...empty, ...parseHtmlPreview(html), site: parseHtmlPreview(html).site ?? new URL(url).hostname.replace(/^www\./, '') };
}

/** Cached link preview (refreshed weekly; tweet cards re-checked daily so deleted tweets show as unavailable). */
export async function getPreview(env: Env, url: string): Promise<Preview> {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only web links can be previewed.');
  const key = parseTweetUrl(url)?.canonical ?? u.toString();
  const cached = await first<Omit<Preview, 'ok'> & { ok: number; fetched_at: number }>(env, 'SELECT * FROM link_previews WHERE url = ?', key);
  const maxAge = cached?.kind === 'x' ? DAY : 7 * DAY;
  if (cached && now() - cached.fetched_at < maxAge) return { ...cached, ok: Boolean(cached.ok) };
  let p: Omit<Preview, 'url'>;
  try {
    p = await fetchPreview(key);
  } catch {
    if (cached) return { ...cached, ok: Boolean(cached.ok) };
    p = { kind: parseTweetUrl(key) ? 'x' : parseYouTubeId(key) ? 'youtube' : 'link', ok: false, title: null, description: null, site: u.hostname, author: null, author_url: null, published: null };
  }
  await run(env, `INSERT OR REPLACE INTO link_previews (url, kind, ok, title, description, site, author, author_url, published, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    key, p.kind, p.ok ? 1 : 0, p.title, p.description, p.site, p.author, p.author_url, p.published, now());
  return { url: key, ...p };
}

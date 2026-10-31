// Forum-wide constants shared by the server and the client.

export const TAGS: Record<string, string> = {
  recruiting: 'Recruiting',
  portal: 'Transfer Portal',
  rumor: 'Rumor',
  injury: 'Injury',
  highlight: 'Highlight',
  gameday: 'Game Day',
  tickets: 'Tickets',
  offtopic: 'Off-Topic',
};

export function cleanTags(tags: string[] | undefined | null): string {
  return [...new Set((tags ?? []).filter((t) => t in TAGS))].slice(0, 3).join(',');
}

export function splitTags(tags: string | null | undefined): string[] {
  return tags ? tags.split(',').filter((t) => t in TAGS) : [];
}

/** Aggie-themed ranks by forum post count. */
export const RANKS: { min: number; label: string }[] = [
  { min: 1000, label: 'Aggie Legend' },
  { min: 500, label: 'All-American' },
  { min: 250, label: 'All-Conference' },
  { min: 100, label: 'Letterman' },
  { min: 25, label: 'Starter' },
  { min: 0, label: 'Walk-on' },
];

export function rankFor(postCount: number): string {
  return (RANKS.find((r) => postCount >= r.min) ?? RANKS[RANKS.length - 1]).label;
}

/** Matches an X/Twitter post link and returns a canonical URL plus the post id. */
export function parseTweetUrl(url: string): { canonical: string; id: string; user: string } | null {
  const m = url.match(/^https?:\/\/(?:www\.|mobile\.)?(?:twitter\.com|x\.com)\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/i);
  return m ? { canonical: `https://twitter.com/${m[1]}/status/${m[2]}`, id: m[2], user: m[1] } : null;
}

/** Matches a public Facebook post, photo, video or reel link (including the app's "Copy link" share links). */
export function parseFacebookUrl(url: string): { canonical: string; video: boolean } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m|web|mobile|mbasic)\./, '');
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (host === 'fb.watch') return u.pathname.length > 2 ? { canonical: `https://fb.watch${u.pathname}`, video: true } : null;
  if (host !== 'facebook.com' && host !== 'fb.com') return null;
  const path = u.pathname;
  const video = /\/(videos?|reel|watch)\b|\/share\/(v|r)\//i.test(path) || u.searchParams.has('v') && path.startsWith('/watch');
  const isPost = video || /\/(posts|permalink|photos?|story\.php|permalink\.php|photo\.php)\b|\/share\/p\/|^\/groups\/[^/]+\/(posts|permalink)\//i.test(path);
  if (!isPost) return null;
  // Keep only the query keys Facebook needs to find the post.
  const keep = new URLSearchParams();
  for (const k of ['story_fbid', 'id', 'fbid', 'v', 'set']) { const v = u.searchParams.get(k); if (v) keep.set(k, v); }
  const q = keep.toString();
  return { canonical: `https://www.facebook.com${path}${q ? `?${q}` : ''}`, video };
}

export function parseYouTubeId(url: string): string | null {
  const m = url.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
  return m ? m[1] : null;
}

/** Replaces spoiler text (||text|| or [spoiler]text[/spoiler]) for excerpts and notifications. */
export function hideSpoilers(s: string): string {
  return s.replace(/\|\|[\s\S]+?\|\||\[spoiler\][\s\S]*?\[\/spoiler\]/gi, '[spoiler]');
}

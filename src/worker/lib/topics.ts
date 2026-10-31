// Automatic topics that keep the Board active when members don't start threads:
// Aggie News Desk (headlines from news feeds), conversation starters on quiet days, and recurring weekly topics.
// Each runs from the 30-minute job, is capped, never repeats, and can be switched off in Admin → Settings.
import type { Env } from '../env';
import { all, first, getSetting, run, setSetting } from '../db';
import { DAY, now, sha256 } from '../util';
import { DEFAULT_PROMPTS } from '../../shared/prompts';
import { TIME_ZONE } from '../../shared/sports';
import { detectSport, zonedToUtc } from './ics';
import { weekStartMT } from './sports';

export const DEFAULT_NEWS_FEEDS = [
  'https://nmstatesports.com/rss.aspx',
  'https://www.bing.com/news/search?q=%22NM+State%22+OR+%22New+Mexico+State%22+Aggies&format=rss',
];
const NEWS_EVERY_MS = 2 * 3_600_000;
/** Sports whose news gets topics: the ones Aggie fans actually discuss (owner decision). */
export const NEWS_SPORTS = ['fb', 'mbb', 'base'];
/** Automatic topics nobody replied to are cleared from the Board after this long. */
const UNANSWERED_MS = 2 * DAY;
const NMSU_RE = /\b(NM State|New Mexico State|NMSU)\b/i;

export interface NewsItem { title: string; url: string; source: string; published: number | null; summary: string }

function decode(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/** News sites' tracking redirects (e.g. Bing's apiclick) carry the real article in a url= parameter. */
export function articleUrl(link: string): string {
  try {
    const u = new URL(link);
    const inner = u.searchParams.get('url');
    if (inner && /^https?:\/\//i.test(inner)) return inner;
    return u.toString();
  } catch {
    return link;
  }
}

/** Reads an RSS feed into news items. Pure, so it can be unit-tested. */
export function parseRss(xml: string): NewsItem[] {
  const channel = decode(xml.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const items: NewsItem[] = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const block = m[0];
    const tag = (name: string) => block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] ?? '';
    const title = decode(tag('title'));
    const rawLink = decode(tag('link')) || decode(tag('guid'));
    if (!title || !/^https?:\/\//i.test(rawLink)) continue;
    const url = articleUrl(rawLink);
    const date = Date.parse(decode(tag('pubDate')) || decode(tag('dc:date')));
    let source = decode(tag('source')) || decode(tag('News:Source'));
    if (!source) { try { source = new URL(url).hostname.replace(/^www\./, ''); } catch { source = channel; } }
    items.push({ title, url, source, published: Number.isNaN(date) ? null : date, summary: decode(tag('description')).slice(0, 300) });
  }
  return items;
}

/**
 * Which sport a story is about, from its title, summary and link (official links name the sport,
 * e.g. /news/2026/10/30/volleyball-aggies-fall…). Plain "basketball" or "hoops" counts as men's basketball.
 */
export function newsSport(item: NewsItem): string | null {
  let slug = '';
  try { slug = new URL(item.url).pathname.replace(/[-_/]+/g, ' '); } catch { /* not a URL */ }
  const text = `${item.title} ${item.summary} ${slug}`;
  const sport = detectSport(text);
  if (sport) return sport;
  if (/\bwom[ae]n'?s?\b|\blady\b/i.test(text)) return null;
  if (/\bbasketball\b|\bhoops\b/i.test(text)) return 'mbb';
  return null;
}

/** Whether a story belongs on the Board: about NM State (always true for the official site) and about football, men's basketball or baseball. */
export function isRelevant(item: NewsItem, feedUrl: string): boolean {
  if (!/nmstatesports\.com/i.test(feedUrl) && !NMSU_RE.test(`${item.title} ${item.summary}`)) return false;
  const sport = newsSport(item);
  return sport !== null && NEWS_SPORTS.includes(sport);
}

/** Clears automatic topics (news, topic of the day, weekly) that nobody answered within two days. Game threads stay. */
export async function clearUnansweredAutoTopics(env: Env, t = now()): Promise<number> {
  const r = await run(env,
    `UPDATE threads SET deleted = 1 WHERE deleted = 0 AND user_id IS NULL AND reply_count = 0 AND created_at < ?
       AND id IN (SELECT thread_id FROM news_items WHERE thread_id IS NOT NULL UNION SELECT thread_id FROM auto_topics WHERE thread_id IS NOT NULL)`, t - UNANSWERED_MS);
  return r.meta.changes ?? 0;
}

async function generalForumId(env: Env): Promise<number> {
  return (await first<{ id: number }>(env, "SELECT id FROM forums WHERE slug = 'general'"))?.id ?? 1;
}

/** Starts a topic posted by the site itself (shown as "NMSU Sports Forum"). */
async function siteTopic(env: Env, title: string, description: string, body: string): Promise<number> {
  const t = now();
  const r = await run(env, 'INSERT INTO threads (forum_id, user_id, title, description, created_at, last_post_at) VALUES (?, NULL, ?, ?, ?, ?)',
    await generalForumId(env), title.slice(0, 140), description.slice(0, 240), t, t);
  const threadId = r.meta.last_row_id;
  const p = await run(env, 'INSERT INTO posts (thread_id, user_id, body, created_at) VALUES (?, NULL, ?, ?)', threadId, body, t);
  await run(env, 'UPDATE threads SET last_post_id = ? WHERE id = ?', p.meta.last_row_id, threadId);
  return threadId;
}

const lines = (raw: string) => raw.split('\n').map((l) => l.trim()).filter(Boolean);

/** Aggie News Desk: turns new NM State stories into topics (headline and link only), a few a day at most. */
export async function runNewsDesk(env: Env, force = false): Promise<{ posted: number; checked: number; errors: string[] }> {
  const out = { posted: 0, checked: 0, errors: [] as string[] };
  if ((await getSetting(env, 'news_desk')) === '0') return out;
  const t = now();
  if (!force && t - (Number(await getSetting(env, 'news_last_run')) || 0) < NEWS_EVERY_MS) return out;
  await setSetting(env, 'news_last_run', String(t));
  const perDay = Math.min(10, Number(await getSetting(env, 'news_per_day')) || 3);
  const today = (await first<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM news_items WHERE thread_id IS NOT NULL AND created_at > ?', t - DAY))?.n ?? 0;
  let room = perDay - today;
  if (room <= 0) return out;
  const feeds = lines(await getSetting(env, 'news_feeds'));
  const fresh: NewsItem[] = [];
  for (const feed of feeds.length ? feeds : DEFAULT_NEWS_FEEDS) {
    try {
      const res = await fetch(feed, { headers: { 'User-Agent': 'NMSUSportsForum/1.0 (+https://nmsusportsforum.com)', Accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`responded ${res.status}`);
      const items = parseRss(await res.text());
      out.checked += items.length;
      fresh.push(...items.filter((i) => isRelevant(i, feed) && (i.published === null || t - i.published < 2 * DAY)));
    } catch (e) {
      out.errors.push(`${feed}: ${(e as Error).message}`);
    }
  }
  fresh.sort((a, b) => (b.published ?? 0) - (a.published ?? 0));
  const seenTitles = new Set<string>();
  for (const item of fresh) {
    if (room <= 0) break;
    const titleKey = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);
    const hash = await sha256(item.url);
    const titleHash = await sha256(`title:${titleKey}`);
    if (await first(env, 'SELECT url_hash FROM news_items WHERE url_hash IN (?, ?)', hash, titleHash)) continue;
    const threadId = await siteTopic(env, `📰 ${item.title}`, `News · ${item.source}`, `${item.url}\n\nVia ${item.source}. What do you make of it?`);
    await run(env, 'INSERT INTO news_items (url_hash, url, title, source, thread_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', hash, item.url, item.title, item.source, threadId, t);
    await run(env, 'INSERT OR IGNORE INTO news_items (url_hash, url, title, source, thread_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)', titleHash, item.url, item.title, item.source, t);
    out.posted++;
    room--;
  }
  return out;
}

export async function starterPrompts(env: Env): Promise<string[]> {
  const custom = lines(await getSetting(env, 'starter_prompts'));
  return custom.length ? custom : DEFAULT_PROMPTS;
}

function mtHour(t: number): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(new Date(t)));
}

/** On a quiet day (no member started a topic in 24 hours), post one conversation starter between 9 AM and 8 PM. */
export async function runStarter(env: Env, t = now(), force = false): Promise<number | null> {
  // force: an admin's "Post a topic now" skips the quiet-day and time-of-day checks.
  if (!force) {
    if ((await getSetting(env, 'starters')) === '0') return null;
    const h = mtHour(t);
    if (h < 9 || h >= 20) return null;
    if (await first(env, 'SELECT id FROM threads WHERE user_id IS NOT NULL AND deleted = 0 AND created_at > ?', t - DAY)) return null;
    if (await first(env, "SELECT key FROM auto_topics WHERE kind = 'starter' AND created_at > ?", t - DAY)) return null;
  }
  const prompts = await starterPrompts(env);
  const used = new Set((await all<{ key: string }>(env, "SELECT key FROM auto_topics WHERE kind = 'starter'")).map((r) => r.key));
  const keyed = await Promise.all(prompts.map(async (p) => ({ p, key: `starter:${await sha256(p)}` })));
  let pool = keyed.filter((k) => !used.has(k.key));
  if (!pool.length) {
    // Every topic has been used: start the list over.
    await run(env, "DELETE FROM auto_topics WHERE kind = 'starter'");
    pool = keyed;
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const threadId = await siteTopic(env, `🎲 ${pick.p}`, 'Topic of the day', `${pick.p}\n\nRandom topic of the day. Jump in!`);
  await run(env, "INSERT INTO auto_topics (key, kind, thread_id, created_at) VALUES (?, 'starter', ?, ?)", pick.key, threadId, t);
  return threadId;
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Parses "Mon | 6:00 PM | Radio Show Tonight" (or 18:00). Returns null for lines it can't read. */
export function parseRecurring(line: string): { day: number; minutes: number; title: string } | null {
  const [d, time, ...rest] = line.split('|').map((x) => x.trim());
  const title = rest.join('|').trim();
  const day = DAYS.indexOf((d ?? '').slice(0, 3).toLowerCase());
  const m = (time ?? '').match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (day < 0 || !m || !title) return null;
  let hour = Number(m[1]);
  const ap = m[3]?.toLowerCase();
  if (hour > (ap ? 12 : 23) || Number(m[2] ?? 0) > 59) return null;
  if (ap === 'pm' && hour < 12) hour += 12;
  if (ap === 'am' && hour === 12) hour = 0;
  const minutes = hour * 60 + Number(m[2] ?? 0);
  return minutes < 24 * 60 ? { day, minutes, title: title.slice(0, 120) } : null;
}

/** Recurring weekly topics (Admin → Settings): each line posts once a week at its Mountain Time day and time. */
export async function runRecurring(env: Env, t = now()): Promise<number> {
  let posted = 0;
  const weekStart = weekStartMT(t);
  for (const line of lines(await getSetting(env, 'recurring_topics'))) {
    const r = parseRecurring(line);
    if (!r) continue;
    // Monday-based week: Monday = 0 … Sunday = 6.
    const offset = (r.day + 6) % 7;
    const monday = new Date(weekStart + 12 * 3_600_000);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(monday).map((x) => [x.type, x.value]));
    const target = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offset));
    const at = zonedToUtc(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), Math.floor(r.minutes / 60), r.minutes % 60, 0, TIME_ZONE);
    if (t < at || t > at + 6 * 3_600_000) continue;
    const key = `recurring:${weekStart}:${await sha256(line)}`;
    if (await first(env, 'SELECT key FROM auto_topics WHERE key = ?', key)) continue;
    const label = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'numeric', day: 'numeric' }).format(new Date(at));
    const threadId = await siteTopic(env, `${r.title} (${label})`, 'Weekly topic', `${r.title}\n\nWeekly topic. Talk about it here.`);
    await run(env, "INSERT INTO auto_topics (key, kind, thread_id, created_at) VALUES (?, 'recurring', ?, ?)", key, threadId, t);
    posted++;
  }
  return posted;
}

/** Runs all automatic topic sources; a failure in one never blocks the others. */
export async function runAutoTopics(env: Env): Promise<void> {
  for (const job of [() => clearUnansweredAutoTopics(env), () => runNewsDesk(env), () => runRecurring(env), () => runStarter(env)]) {
    try { await job(); } catch (e) { console.error('auto topic job failed', e); }
  }
}

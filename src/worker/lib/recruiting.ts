// Football recruits and transfer portal moves from CollegeFootballData.com (free API key).
// Basketball and anything else is added by members with a source link.
import type { Env, SessionUser } from '../env';
import { first, run } from '../db';
import { now } from '../util';
import { SPORT_BY_KEY } from '../../shared/sports';
import { createPost } from './threads';

export const CFBD_TEAM = 'New Mexico State';

export interface CfbdRecruit {
  id: number | string;
  year: number;
  ranking?: number | null;
  name: string;
  school?: string | null;
  committedTo?: string | null;
  position?: string | null;
  stars?: number | null;
  rating?: number | null;
  city?: string | null;
  stateProvince?: string | null;
}

export interface CfbdPortal {
  season: number;
  firstName: string;
  lastName: string;
  position?: string | null;
  origin?: string | null;
  destination?: string | null;
  stars?: number | null;
  rating?: number | null;
}

export interface PlayerUpsert {
  source_key: string;
  kind: 'recruit' | 'transfer_in' | 'transfer_out';
  name: string;
  position: string | null;
  class_year: number;
  school: string | null;
  hometown: string | null;
  stars: number | null;
  rating: number | null;
  ranking: number | null;
  status: string;
  other_school: string | null;
}

export function mapRecruit(r: CfbdRecruit): PlayerUpsert {
  return {
    source_key: `cfbd-r-${r.id}`,
    kind: 'recruit',
    name: r.name,
    position: r.position ?? null,
    class_year: r.year,
    school: r.school ?? null,
    hometown: [r.city, r.stateProvince].filter(Boolean).join(', ') || null,
    stars: r.stars ?? null,
    rating: r.rating ?? null,
    ranking: r.ranking ?? null,
    status: r.committedTo === CFBD_TEAM ? 'committed' : r.committedTo ? 'committed_elsewhere' : 'tracking',
    other_school: r.committedTo && r.committedTo !== CFBD_TEAM ? r.committedTo : null,
  };
}

/** Portal entries involving NM State only; others return null. */
export function mapPortal(p: CfbdPortal): PlayerUpsert | null {
  const out = p.origin === CFBD_TEAM;
  const into = p.destination === CFBD_TEAM;
  if (!out && !into) return null;
  const name = `${p.firstName} ${p.lastName}`.trim();
  return {
    source_key: `cfbd-p-${p.season}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${(p.origin ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    kind: into ? 'transfer_in' : 'transfer_out',
    name,
    position: p.position ?? null,
    class_year: p.season,
    school: p.origin ?? null,
    hometown: null,
    stars: p.stars ?? null,
    rating: p.rating ?? null,
    ranking: null,
    status: into ? 'committed' : p.destination ? 'transferred' : 'in_portal',
    other_school: out ? p.destination ?? null : null,
  };
}

async function cfbd<T>(env: Env, path: string): Promise<T> {
  const base = (env.CFBD_BASE || 'https://api.collegefootballdata.com').replace(/\/$/, '');
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${env.CFBD_API_KEY}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`CollegeFootballData responded ${res.status}`);
  return (await res.json()) as T;
}

async function upsert(env: Env, p: PlayerUpsert): Promise<'added' | 'updated' | 'same'> {
  const t = now();
  const existing = await first<PlayerUpsert & { id: number }>(env, 'SELECT * FROM players WHERE source_key = ?', p.source_key);
  if (!existing) {
    await run(env, `INSERT INTO players (sport, kind, source, source_key, name, position, class_year, school, hometown, stars, rating, ranking, status, other_school, created_at, updated_at)
                    VALUES ('fb', ?, 'cfbd', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.kind, p.source_key, p.name, p.position, p.class_year, p.school, p.hometown, p.stars, p.rating, p.ranking, p.status, p.other_school, t, t);
    return 'added';
  }
  const fields = ['kind', 'position', 'school', 'hometown', 'stars', 'rating', 'ranking', 'status', 'other_school'] as const;
  const changed = fields.filter((f) => existing[f] !== p[f]);
  if (!changed.length) return 'same';
  await run(env, `UPDATE players SET ${changed.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...changed.map((f) => p[f] as string | number | null), t, existing.id);
  return 'updated';
}

/** Daily football recruiting + portal sync (a handful of API calls, well inside the free tier). */
export async function syncRecruiting(env: Env): Promise<{ ok: boolean; added?: number; updated?: number; error?: string; skipped?: string }> {
  if (!env.CFBD_API_KEY) return { ok: false, skipped: 'CFBD_API_KEY is not configured.' };
  const year = new Date().getUTCFullYear();
  let added = 0;
  let updated = 0;
  try {
    const rows: PlayerUpsert[] = [];
    for (const y of [year, year + 1]) {
      const recruits = await cfbd<CfbdRecruit[]>(env, `/recruiting/players?year=${y}&team=${encodeURIComponent(CFBD_TEAM)}`);
      rows.push(...recruits.map(mapRecruit));
    }
    const portal = await cfbd<CfbdPortal[]>(env, `/player/portal?year=${year}`);
    rows.push(...portal.map(mapPortal).filter((x): x is PlayerUpsert => Boolean(x)));
    for (const r of rows) {
      const res = await upsert(env, r);
      if (res === 'added') added++;
      else if (res === 'updated') updated++;
    }
    await run(env, `INSERT INTO data_sync (key, last_ok_at, last_error, last_counts) VALUES ('cfbd', ?, NULL, ?)
                    ON CONFLICT(key) DO UPDATE SET last_ok_at = excluded.last_ok_at, last_error = NULL, last_counts = excluded.last_counts`, now(), JSON.stringify({ total: rows.length, added, updated }));
    return { ok: true, added, updated };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await run(env, `INSERT INTO data_sync (key, last_error, last_error_at) VALUES ('cfbd', ?, ?)
                    ON CONFLICT(key) DO UPDATE SET last_error = excluded.last_error, last_error_at = excluded.last_error_at`, msg.slice(0, 300), now());
    return { ok: false, error: msg };
  }
}

const KIND_LABEL: Record<string, string> = { recruit: 'Recruiting', transfer_in: 'Transfer in', transfer_out: 'Transfer out' };

/** Every player gets one discussion thread, created the first time someone posts about them. */
export async function ensurePlayerThread(env: Env, playerId: number): Promise<number> {
  const p = await first<{ id: number; sport: string; kind: string; name: string; position: string | null; school: string | null; class_year: number | null; thread_id: number | null }>(env,
    'SELECT id, sport, kind, name, position, school, class_year, thread_id FROM players WHERE id = ?', playerId);
  if (!p) throw new Error('Player not found');
  if (p.thread_id && (await first(env, 'SELECT id FROM threads WHERE id = ? AND deleted = 0', p.thread_id))) return p.thread_id;
  const forumSlug = SPORT_BY_KEY[p.sport]?.forum ?? 'other-sports';
  const f = await first<{ id: number }>(env, 'SELECT id FROM forums WHERE slug = ?', forumSlug);
  const t = now();
  const title = `${KIND_LABEL[p.kind]}: ${p.name}${p.position ? ` (${p.position})` : ''}`;
  const r = await run(env, `INSERT INTO threads (forum_id, user_id, title, description, sport, created_at, last_post_at, tags) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
    f!.id, title, [p.school, p.class_year ? `Class of ${p.class_year}` : null].filter(Boolean).join(' · ') || 'Player tracker', p.sport, t, t, p.kind === 'recruit' ? 'recruiting' : 'portal');
  const threadId = r.meta.last_row_id;
  const post = await run(env, 'INSERT INTO posts (thread_id, user_id, body, created_at) VALUES (?, NULL, ?, ?)', threadId,
    `Discussion and news for ${p.name}. Player card: /recruiting/${p.id}\n\nShare tweets and links about ${p.name} here. They also appear on the player card.`, t);
  await run(env, 'UPDATE threads SET last_post_id = ? WHERE id = ?', post.meta.last_row_id, threadId);
  await run(env, 'UPDATE players SET thread_id = ? WHERE id = ?', threadId, p.id);
  return threadId;
}

/** Posts a tweet/link into the player's thread and records it on the card. */
export async function addPlayerNews(env: Env, user: SessionUser, playerId: number, url: string, note: string | null): Promise<{ thread_id: number; post_id: number }> {
  const threadId = await ensurePlayerThread(env, playerId);
  const thread = await first<{ id: number; title: string; user_id: number | null }>(env, 'SELECT id, title, user_id FROM threads WHERE id = ?', threadId);
  const postId = await createPost(env, user, thread!, note ? `${note}\n\n${url}` : url, {});
  await run(env, 'INSERT INTO player_news (player_id, user_id, url, note, post_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', playerId, user.id, url, note, postId, now());
  await run(env, 'UPDATE players SET updated_at = ? WHERE id = ?', now(), playerId);
  return { thread_id: threadId, post_id: postId };
}

export async function recruitingStatus(env: Env) {
  return first<{ last_ok_at: number | null; last_error: string | null; last_error_at: number | null; last_counts: string | null }>(env, "SELECT * FROM data_sync WHERE key = 'cfbd'");
}


import type { Env } from '../env';
import { all, first, getSetting, notify, run } from '../db';
import { now } from '../util';
import { TIME_ZONE } from '../../shared/sports';
import { zonedToUtc } from './ics';

/** Owner decision: Founding Members are the first 30 people to join through Thanksgiving (Nov 26, 2026). Both are adjustable in Admin → Settings. */
export const FOUNDING_DEFAULTS = { until: '2026-11-26', limit: 30 };

export interface MemberSummary {
  id: number;
  username: string;
  display_name: string | null;
  avatar_key: string | null;
  role: string;
  reputation: number;
  post_count: number;
  badges: { badge: string; reason: string; awarded_at: number }[];
}

/** The Founding Members: the first N accounts created by the end of the deadline day (Mountain Time). Deleted accounts don't count. */
export async function foundingMembers(env: Env): Promise<{ ids: Set<number>; until: string; limit: number }> {
  const raw = await getSetting(env, 'founding_until');
  const until = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : FOUNDING_DEFAULTS.until;
  const limit = Number(await getSetting(env, 'founding_limit')) || FOUNDING_DEFAULTS.limit;
  const [y, m, d] = until.split('-').map(Number);
  const cutoff = zonedToUtc(y, m, d, 23, 59, 59, TIME_ZONE);
  const rows = await all<{ id: number }>(env, 'SELECT id FROM users WHERE created_at <= ? AND deleted_at IS NULL ORDER BY created_at, id LIMIT ?', cutoff, limit);
  return { ids: new Set(rows.map((r) => r.id)), until, limit };
}

export async function memberSummaries(env: Env, ids: (number | null | undefined)[]): Promise<Map<number, MemberSummary>> {
  const unique = [...new Set(ids.filter((x): x is number => typeof x === 'number'))];
  const out = new Map<number, MemberSummary>();
  if (!unique.length) return out;
  const ph = unique.map(() => '?').join(',');
  const [users, reps, counts, badges, cutoff] = await Promise.all([
    all<{ id: number; username: string; display_name: string | null; avatar_key: string | null; role: string; created_at: number }>(env,
      `SELECT id, username, display_name, avatar_key, CASE WHEN role = 'admin' THEN 'admin' WHEN moderator = 1 THEN 'moderator' ELSE 'member' END AS role, created_at FROM users WHERE id IN (${ph})`, ...unique),
    all<{ user_id: number; n: number }>(env,
      `SELECT p.user_id, COUNT(*) AS n FROM reactions r JOIN posts p ON p.id = r.post_id
        WHERE r.value = 1 AND p.deleted = 0 AND p.user_id IN (${ph}) GROUP BY p.user_id`, ...unique),
    all<{ user_id: number; n: number }>(env, `SELECT user_id, COUNT(*) AS n FROM posts WHERE deleted = 0 AND user_id IN (${ph}) GROUP BY user_id`, ...unique),
    all<{ user_id: number; badge: string; reason: string; awarded_at: number }>(env,
      `SELECT user_id, badge, reason, awarded_at FROM badges WHERE revoked = 0 AND user_id IN (${ph}) ORDER BY awarded_at`, ...unique),
    foundingMembers(env),
  ]);
  const deadline = new Date(`${cutoff.until}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const repMap = new Map(reps.map((r) => [r.user_id, r.n]));
  const countMap = new Map(counts.map((r) => [r.user_id, r.n]));
  for (const u of users) {
    const b = badges.filter((x) => x.user_id === u.id).map(({ badge, reason, awarded_at }) => ({ badge, reason, awarded_at }));
    if (cutoff.ids.has(u.id)) b.unshift({ badge: 'founding', reason: `One of the first ${cutoff.limit} members, joined by ${deadline}.`, awarded_at: u.created_at });
    out.set(u.id, { id: u.id, username: u.username, display_name: u.display_name, avatar_key: u.avatar_key, role: u.role,
      reputation: repMap.get(u.id) ?? 0, post_count: countMap.get(u.id) ?? 0, badges: b });
  }
  return out;
}

export async function awardBadge(env: Env, userId: number, badge: string, reason: string, awardedBy: number | null): Promise<void> {
  await run(env, 'INSERT INTO badges (user_id, badge, reason, awarded_by, awarded_at) VALUES (?, ?, ?, ?, ?)', userId, badge, reason, awardedBy, now());
  await notify(env, userId, 'badge', `You received a recognition: ${reason}`, `/members/${userId}`, awardedBy);
}

/** Awards Honorary Founding Member automatically when the configured threshold of distinct appreciators is reached. */
export async function checkHonorary(env: Env, userId: number): Promise<void> {
  const threshold = Number(await getSetting(env, 'honorary_threshold')) || 0;
  if (threshold <= 0) return;
  if (await first(env, "SELECT id FROM badges WHERE user_id = ? AND badge = 'honorary_founding' AND revoked = 0", userId)) return;
  // Honorary founders are for members who aren't already Founding Members.
  if ((await foundingMembers(env)).ids.has(userId)) return;
  const r = await first<{ n: number }>(env,
    `SELECT COUNT(DISTINCT r.user_id) AS n FROM reactions r JOIN posts p ON p.id = r.post_id WHERE r.value = 1 AND p.user_id = ? AND p.deleted = 0`, userId);
  if ((r?.n ?? 0) >= threshold) await awardBadge(env, userId, 'honorary_founding', `Appreciated by ${threshold} different members.`, null);
}

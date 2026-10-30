import type { Env } from '../env';
import { all, first, getSetting, notify, run } from '../db';
import { DAY, now } from '../util';

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

export async function foundingCutoff(env: Env): Promise<number | null> {
  const launch = await getSetting(env, 'launch_date');
  if (!launch) return null; // Before launch every member is a founder.
  const t = Date.parse(launch);
  return Number.isNaN(t) ? null : t + 30 * DAY;
}

export async function memberSummaries(env: Env, ids: (number | null | undefined)[]): Promise<Map<number, MemberSummary>> {
  const unique = [...new Set(ids.filter((x): x is number => typeof x === 'number'))];
  const out = new Map<number, MemberSummary>();
  if (!unique.length) return out;
  const ph = unique.map(() => '?').join(',');
  const [users, reps, counts, badges, cutoff] = await Promise.all([
    all<{ id: number; username: string; display_name: string | null; avatar_key: string | null; role: string; created_at: number }>(env,
      `SELECT id, username, display_name, avatar_key, role, created_at FROM users WHERE id IN (${ph})`, ...unique),
    all<{ user_id: number; n: number }>(env,
      `SELECT p.user_id, COUNT(*) AS n FROM reactions r JOIN posts p ON p.id = r.post_id
        WHERE r.value = 1 AND p.deleted = 0 AND p.user_id IN (${ph}) GROUP BY p.user_id`, ...unique),
    all<{ user_id: number; n: number }>(env, `SELECT user_id, COUNT(*) AS n FROM posts WHERE deleted = 0 AND user_id IN (${ph}) GROUP BY user_id`, ...unique),
    all<{ user_id: number; badge: string; reason: string; awarded_at: number }>(env,
      `SELECT user_id, badge, reason, awarded_at FROM badges WHERE revoked = 0 AND user_id IN (${ph}) ORDER BY awarded_at`, ...unique),
    foundingCutoff(env),
  ]);
  const repMap = new Map(reps.map((r) => [r.user_id, r.n]));
  const countMap = new Map(counts.map((r) => [r.user_id, r.n]));
  for (const u of users) {
    const b = badges.filter((x) => x.user_id === u.id).map(({ badge, reason, awarded_at }) => ({ badge, reason, awarded_at }));
    if (cutoff === null || u.created_at <= cutoff) b.unshift({ badge: 'founding', reason: 'Joined during the founding period.', awarded_at: u.created_at });
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
  const cutoff = await foundingCutoff(env);
  const u = await first<{ created_at: number }>(env, 'SELECT created_at FROM users WHERE id = ?', userId);
  if (!u || cutoff === null || u.created_at <= cutoff) return;
  const r = await first<{ n: number }>(env,
    `SELECT COUNT(DISTINCT r.user_id) AS n FROM reactions r JOIN posts p ON p.id = r.post_id WHERE r.value = 1 AND p.user_id = ? AND p.deleted = 0`, userId);
  if ((r?.n ?? 0) >= threshold) await awardBadge(env, userId, 'honorary_founding', `Appreciated by ${threshold} different members.`, null);
}

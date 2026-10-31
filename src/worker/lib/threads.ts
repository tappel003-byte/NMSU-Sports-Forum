import type { Env, SessionUser } from '../env';
import { all, first, notify, run, userPrefs } from '../db';
import { DAY, HttpError, excerpt, extractMentions, now } from '../util';
import { memberSummaries } from './members';
import { getSetting } from '../db';
import { splitTags } from '../../shared/forum';

export const ARCHIVE_AFTER = 90 * DAY;
export const UNREAD_LOOKBACK = 14 * DAY;
export const PAGE_SIZE = 40;

export interface ThreadRow {
  id: number;
  forum_id: number;
  user_id: number | null;
  title: string;
  description: string;
  sport: string | null;
  created_at: number;
  last_post_at: number;
  last_post_id: number;
  last_post_user_id: number | null;
  reply_count: number;
  pinned: number;
  locked: number;
  reopened_at: number;
  deleted: number;
  game_id: number | null;
  game_phase: string | null;
  suggestion_status: string | null;
  tags: string;
  pending: number;
  forum_slug: string;
  forum_name: string;
  forum_sport_label: string;
  forum_icon: string;
  archive_exempt: number;
  last_read_post_id: number | null;
}

export function isArchived(t: { last_post_at: number; reopened_at: number; archive_exempt: number }, at = now()): boolean {
  return !t.archive_exempt && Math.max(t.last_post_at, t.reopened_at) < at - ARCHIVE_AFTER;
}

export function unreadBaseline(user: SessionUser): number {
  return Math.max(user.created_at - UNREAD_LOOKBACK, user.marked_read_at);
}

export function isUnread(t: ThreadRow, user: SessionUser): boolean {
  if (t.last_post_at <= unreadBaseline(user)) return false;
  return t.last_read_post_id === null || t.last_read_post_id < t.last_post_id;
}

export const THREAD_SELECT = `
  SELECT t.*, f.slug AS forum_slug, f.name AS forum_name, f.sport_label AS forum_sport_label, f.icon AS forum_icon,
         f.archive_exempt, tr.last_read_post_id
    FROM threads t
    JOIN forums f ON f.id = t.forum_id
    LEFT JOIN thread_reads tr ON tr.thread_id = t.id AND tr.user_id = ?`;

/** Shapes thread rows for the client, including author/last poster summaries and unread state. */
export async function presentThreads(env: Env, user: SessionUser, rows: ThreadRow[]) {
  const members = await memberSummaries(env, rows.flatMap((r) => [r.user_id, r.last_post_user_id]));
  const ids = rows.map((r) => r.id);
  const thumbs = ids.length
    ? await all<{ thread_id: number; up: number }>(env,
        `SELECT p.thread_id, COUNT(*) AS up FROM reactions r JOIN posts p ON p.id = r.post_id
          WHERE r.value = 1 AND p.thread_id IN (${ids.map(() => '?').join(',')}) GROUP BY p.thread_id`, ...ids)
    : [];
  const thumbMap = new Map(thumbs.map((t) => [t.thread_id, t.up]));
  const t = now();
  return rows.map((r) => {
    const a = r.user_id ? members.get(r.user_id) : undefined;
    const l = r.last_post_user_id ? members.get(r.last_post_user_id) : undefined;
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      sport: r.sport,
      forum: { slug: r.forum_slug, name: r.forum_name, sport_label: r.forum_sport_label, icon: r.forum_icon },
      author: a ? { id: a.id, username: a.username, display_name: a.display_name, avatar_key: a.avatar_key } : null,
      last_poster: l ? { id: l.id, username: l.username } : null,
      created_at: r.created_at,
      last_post_at: r.last_post_at,
      reply_count: r.reply_count,
      thumbs_up: thumbMap.get(r.id) ?? 0,
      pinned: Boolean(r.pinned),
      locked: Boolean(r.locked),
      archived: isArchived(r, t),
      unread: isUnread(r, user),
      game_id: r.game_id,
      game_phase: r.game_phase,
      suggestion_status: r.suggestion_status,
      tags: splitTags(r.tags),
      pending: Boolean(r.pending),
    };
  });
}

export async function loadThread(env: Env, user: SessionUser, id: number): Promise<ThreadRow> {
  const t = await first<ThreadRow>(env, `${THREAD_SELECT} WHERE t.id = ?`, user.id, id);
  if (!t || (t.deleted && user.role !== 'admin') || (t.pending && user.role !== 'admin' && t.user_id !== user.id)) throw new HttpError(404, 'Discussion not found.');
  return t;
}

export function assertWritable(t: ThreadRow, user: SessionUser): void {
  if (user.role === 'admin') return;
  if (t.deleted) throw new HttpError(404, 'Discussion not found.');
  if (t.locked) throw new HttpError(403, 'This discussion is locked.');
  if (isArchived(t)) throw new HttpError(403, 'This discussion is archived (no replies for 90 days). An administrator can reopen it.');
}

/** True when this member's posts must be approved by an admin first (setting `approve_first_post`). */
export async function needsApproval(env: Env, user: SessionUser): Promise<boolean> {
  if (user.role === 'admin' || user.trusted) return false;
  // Newcomers from open sign-up always have their first post reviewed.
  if (user.joined_open) return true;
  return (await getSetting(env, 'approve_first_post')) === '1';
}

/** Inserts a post, links attachments, updates thread counters and sends notifications. Pending posts wait for approval. */
export async function createPost(env: Env, user: SessionUser, thread: { id: number; title: string; user_id: number | null }, body: string,
  opts: { quotePostId?: number | null; replyToPostId?: number | null; attachmentIds?: string[]; isFirst?: boolean; pending?: boolean }): Promise<number> {
  const t = now();
  const pending = Boolean(opts.pending);
  const r = await run(env, 'INSERT INTO posts (thread_id, user_id, body, quote_post_id, reply_to_post_id, created_at, pending) VALUES (?, ?, ?, ?, ?, ?, ?)',
    thread.id, user.id, body, opts.quotePostId ?? null, opts.replyToPostId ?? null, t, pending ? 1 : 0);
  const postId = r.meta.last_row_id;
  if (opts.attachmentIds?.length) {
    for (const id of opts.attachmentIds.slice(0, 6)) {
      await run(env, "UPDATE attachments SET post_id = ? WHERE id = ? AND user_id = ? AND post_id IS NULL AND kind = 'post'", postId, id, user.id);
    }
  }
  if (userPrefs(user.prefs).auto_follow !== false) {
    await run(env, 'INSERT OR IGNORE INTO follows (user_id, thread_id, created_at) VALUES (?, ?, ?)', user.id, thread.id, t);
  }
  if (pending) {
    if (opts.isFirst) await run(env, 'UPDATE threads SET last_post_id = ?, last_post_user_id = ? WHERE id = ?', postId, user.id, thread.id);
    return postId;
  }
  await publishPost(env, user, thread, postId, body, opts.quotePostId ?? null, Boolean(opts.isFirst), t);
  return postId;
}

/** Makes a post visible: thread counters, read marker, notifications and live update. */
export async function publishPost(env: Env, user: SessionUser, thread: { id: number; title: string }, postId: number, body: string, quotePostId: number | null, isFirst: boolean, t = now()) {
  await run(env, `UPDATE threads SET last_post_at = ?, last_post_id = MAX(last_post_id, ?), last_post_user_id = ?, reply_count = reply_count + ? WHERE id = ?`,
    t, postId, user.id, isFirst ? 0 : 1, thread.id);
  await run(env, `INSERT INTO thread_reads (user_id, thread_id, last_read_post_id) VALUES (?, ?, ?)
                  ON CONFLICT(user_id, thread_id) DO UPDATE SET last_read_post_id = MAX(last_read_post_id, excluded.last_read_post_id)`, user.id, thread.id, postId);
  await sendPostNotifications(env, user, thread, postId, body, quotePostId, isFirst);
  await broadcastThread(env, thread.id, { type: 'post', id: postId });
}

/** Tells everyone viewing a thread that it changed (live-updating threads). */
export async function broadcastThread(env: Env, threadId: number, msg: Record<string, unknown>): Promise<void> {
  try {
    const stub = env.CHAT.get(env.CHAT.idFromName(`thread-${threadId}`));
    await stub.fetch('https://chat/broadcast', { method: 'POST', body: JSON.stringify(msg) });
  } catch (e) {
    console.error('thread broadcast failed', e);
  }
}

async function sendPostNotifications(env: Env, user: SessionUser, thread: { id: number; title: string }, postId: number, body: string, quotePostId: number | null, isFirst: boolean) {
  const link = `/t/${thread.id}?post=${postId}`;
  const name = user.display_name || user.username;
  const notified = new Set<number>([user.id]);
  const mutedBy = new Set((await all<{ user_id: number }>(env, "SELECT user_id FROM mutes WHERE target_type = 'user' AND target_id = ?", user.id)).map((m) => m.user_id));
  const send = async (uid: number, type: string, pref: string, text: string) => {
    if (notified.has(uid) || mutedBy.has(uid)) return;
    const u = await first<{ prefs: string; status: string }>(env, 'SELECT prefs, status FROM users WHERE id = ?', uid);
    if (!u || u.status !== 'active' || userPrefs(u.prefs)[pref] === false) return;
    notified.add(uid);
    await notify(env, uid, type, text, link, user.id);
  };
  if (quotePostId) {
    const q = await first<{ user_id: number }>(env, 'SELECT user_id FROM posts WHERE id = ?', quotePostId);
    if (q?.user_id) await send(q.user_id, 'quote', 'notify_quotes', `${name} quoted you in “${thread.title}”`);
  }
  const mentions = extractMentions(body);
  if (mentions.length) {
    const users = await all<{ id: number }>(env, `SELECT id FROM users WHERE lower(username) IN (${mentions.map(() => '?').join(',')})`, ...mentions);
    for (const u of users) await send(u.id, 'mention', 'notify_mentions', `${name} mentioned you in “${thread.title}”: ${excerpt(body, 80)}`);
  }
  if (!isFirst) {
    const followers = await all<{ user_id: number }>(env, 'SELECT user_id FROM follows WHERE thread_id = ?', thread.id);
    for (const f of followers) await send(f.user_id, 'reply', 'notify_replies', `${name} replied in “${thread.title}”`);
  }
}

export async function mutedSets(env: Env, userId: number) {
  const rows = await all<{ target_type: string; target_id: number }>(env, 'SELECT target_type, target_id FROM mutes WHERE user_id = ?', userId);
  return {
    users: new Set(rows.filter((r) => r.target_type === 'user').map((r) => r.target_id)),
    forums: new Set(rows.filter((r) => r.target_type === 'forum').map((r) => r.target_id)),
  };
}

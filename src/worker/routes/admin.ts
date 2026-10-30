import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { requireAdmin } from '../auth';
import { all, first, getSetting, logMod, notify, run, setSetting } from '../db';
import { emailEnabled, sendEmail } from '../email';
import { DAY, HttpError, now, parse, randomToken, sha256 } from '../util';
import { BADGES, SPORT_BY_KEY } from '../../shared/sports';
import { awardBadge } from '../lib/members';
import { createResetToken } from './auth';
import { publishPost, broadcastThread } from '../lib/threads';
import type { SessionUser } from '../env';
import { runGameLifecycle, syncAllFeeds, type GameRow } from '../lib/sports';
import { presentGame } from './games';

export const admin = new Hono<AppEnv>();
admin.use('*', requireAdmin);

const num = (v: string | undefined) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid id.');
  return n;
};

admin.get('/overview', async (c) => {
  const [members, reports, pendingPosts, invites, feeds, log] = await Promise.all([
    first<{ total: number; admins: number; suspended: number }>(c.env,
      "SELECT COUNT(*) AS total, SUM(role = 'admin') AS admins, SUM(status = 'suspended') AS suspended FROM users"),
    first<{ n: number }>(c.env, "SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
    first<{ n: number }>(c.env, 'SELECT COUNT(*) AS n FROM posts WHERE pending = 1 AND deleted = 0'),
    first<{ n: number }>(c.env, 'SELECT COUNT(*) AS n FROM invites WHERE revoked = 0 AND uses < max_uses AND expires_at > ?', now()),
    all(c.env, 'SELECT id, sport, url, enabled, last_ok_at, last_error, last_error_at, failing, last_counts FROM data_feeds ORDER BY sport'),
    all(c.env, 'SELECT l.*, u.username AS actor FROM mod_log l LEFT JOIN users u ON u.id = l.actor_id ORDER BY l.id DESC LIMIT 25'),
  ]);
  return c.json({ members, open_reports: reports?.n ?? 0, pending_posts: pendingPosts?.n ?? 0, open_invites: invites?.n ?? 0, feeds, log, emailEnabled: emailEnabled(c.env) });
});

// ---------- Invitations ----------

admin.get('/invites', async (c) => {
  const rows = await all(c.env,
    `SELECT i.id, i.email, i.note, i.max_uses, i.uses, i.expires_at, i.revoked, i.created_at, u.username AS created_by,
       (SELECT group_concat(nu.username, ', ') FROM invite_uses iu JOIN users nu ON nu.id = iu.user_id WHERE iu.invite_id = i.id) AS used_by
     FROM invites i LEFT JOIN users u ON u.id = i.created_by ORDER BY i.id DESC LIMIT 200`);
  return c.json({ invites: rows });
});

admin.post('/invites', async (c) => {
  const user = c.get('user');
  const body = parse(z.object({
    email: z.string().trim().email().max(200).optional().or(z.literal('')),
    note: z.string().trim().max(200).optional(),
    days: z.number().int().min(1).max(60).default(14),
    max_uses: z.number().int().min(1).max(50).default(1),
  }), await c.req.json());
  const token = randomToken(24);
  const t = now();
  await run(c.env, 'INSERT INTO invites (token_hash, created_by, email, note, max_uses, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    await sha256(token), user.id, body.email || null, body.note || null, body.max_uses, t + body.days * DAY, t);
  const link = `${new URL(c.req.url).origin}/join/${token}`;
  let emailed = false;
  if (body.email && emailEnabled(c.env)) {
    emailed = await sendEmail(c.env, body.email, "You're invited to NMSU Sports Forum",
      `${user.display_name || user.username} invited you to join NMSU Sports Forum, a private community for Aggie fans.\n\nCreate your account here (link expires in ${body.days} days):\n${link}\n\nNMSU Sports Forum is an independent fan community, not affiliated with New Mexico State University.`);
  }
  await logMod(c.env, user.id, 'create_invite', 'invite', null, body.note ?? body.email ?? '');
  // The link is shown once; only its hash is stored.
  return c.json({ link, emailed });
});

admin.delete('/invites/:id', async (c) => {
  await run(c.env, 'UPDATE invites SET revoked = 1 WHERE id = ?', num(c.req.param('id')));
  await logMod(c.env, c.get('user').id, 'revoke_invite', 'invite', num(c.req.param('id')));
  return c.json({ ok: true });
});

// ---------- Members ----------

admin.get('/members', async (c) => {
  const rows = await all(c.env,
    `SELECT id, username, email, display_name, role, status, suspended_until, created_at, last_seen_at,
       (SELECT COUNT(*) FROM posts p WHERE p.user_id = users.id AND p.deleted = 0) AS posts
     FROM users WHERE deleted_at IS NULL ORDER BY username COLLATE NOCASE`);
  return c.json({ members: rows });
});

admin.patch('/members/:id', async (c) => {
  const actor = c.get('user');
  const id = num(c.req.param('id'));
  const body = parse(z.object({ role: z.enum(['member', 'admin']).optional(), status: z.enum(['active', 'suspended']).optional(), days: z.number().int().min(1).max(365).optional(), reason: z.string().max(300).optional() }), await c.req.json());
  const target = await first<{ id: number; role: string; status: string; username: string }>(c.env, 'SELECT id, role, status, username FROM users WHERE id = ?', id);
  if (!target) throw new HttpError(404, 'Member not found.');
  const losingAdmin = target.role === 'admin' && target.status === 'active' && (body.role === 'member' || body.status === 'suspended');
  if (losingAdmin) {
    const admins = await first<{ n: number }>(c.env, "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'");
    if ((admins?.n ?? 0) <= 1) throw new HttpError(400, 'The forum must always have at least one active administrator.');
  }
  if (body.role) await run(c.env, 'UPDATE users SET role = ? WHERE id = ?', body.role, id);
  if (body.status) {
    // A suspension with `days` lifts itself automatically.
    await run(c.env, 'UPDATE users SET status = ?, suspended_until = ? WHERE id = ?', body.status, body.status === 'suspended' && body.days ? now() + body.days * DAY : null, id);
    if (body.status === 'suspended') await run(c.env, 'DELETE FROM sessions WHERE user_id = ?', id);
  }
  await logMod(c.env, actor.id, body.status ? `set_status_${body.status}${body.days ? `_${body.days}d` : ''}` : `set_role_${body.role}`, 'user', id, body.reason ?? target.username);
  return c.json({ ok: true });
});

admin.post('/members/:id/reset-link', async (c) => {
  const id = num(c.req.param('id'));
  const u = await first<{ id: number; email: string; username: string }>(c.env, 'SELECT id, email, username FROM users WHERE id = ?', id);
  if (!u) throw new HttpError(404, 'Member not found.');
  const token = await createResetToken(c.env, u.id, c.get('user').id);
  const link = `${new URL(c.req.url).origin}/reset/${token}`;
  let emailed = false;
  if (emailEnabled(c.env)) emailed = await sendEmail(c.env, u.email, 'Reset your NMSU Sports Forum password', `An administrator created a password reset link for you (expires in 3 days):\n${link}`);
  await logMod(c.env, c.get('user').id, 'create_reset_link', 'user', id, u.username);
  return c.json({ link, emailed });
});

// ---------- Threads ----------

admin.patch('/threads/:id', async (c) => {
  const actor = c.get('user');
  const id = num(c.req.param('id'));
  const body = parse(z.object({
    pinned: z.boolean().optional(), locked: z.boolean().optional(), deleted: z.boolean().optional(), reopen: z.boolean().optional(),
    forum: z.string().optional(),
    suggestion_status: z.enum(['under_consideration', 'planned', 'implemented', 'declined']).nullable().optional(),
  }), await c.req.json());
  const t = await first<{ id: number; title: string; user_id: number | null; suggestion_status: string | null }>(c.env, 'SELECT id, title, user_id, suggestion_status FROM threads WHERE id = ?', id);
  if (!t) throw new HttpError(404, 'Discussion not found.');
  const actions: string[] = [];
  if (body.pinned !== undefined) { await run(c.env, 'UPDATE threads SET pinned = ? WHERE id = ?', body.pinned ? 1 : 0, id); actions.push(body.pinned ? 'pin' : 'unpin'); }
  if (body.locked !== undefined) { await run(c.env, 'UPDATE threads SET locked = ? WHERE id = ?', body.locked ? 1 : 0, id); actions.push(body.locked ? 'lock' : 'unlock'); }
  if (body.deleted !== undefined) { await run(c.env, 'UPDATE threads SET deleted = ? WHERE id = ?', body.deleted ? 1 : 0, id); actions.push(body.deleted ? 'remove_thread' : 'restore_thread'); }
  if (body.reopen) { await run(c.env, 'UPDATE threads SET reopened_at = ? WHERE id = ?', now(), id); actions.push('reopen_archived'); }
  if (body.forum) {
    const f = await first<{ id: number; sports: string }>(c.env, 'SELECT id, sports FROM forums WHERE slug = ?', body.forum);
    if (!f) throw new HttpError(400, 'Unknown forum.');
    const sports = f.sports ? f.sports.split(',') : [];
    await run(c.env, 'UPDATE threads SET forum_id = ?, sport = ? WHERE id = ?', f.id, sports.length === 1 ? sports[0] : null, id);
    actions.push(`move_to_${body.forum}`);
  }
  if (body.suggestion_status !== undefined) {
    await run(c.env, 'UPDATE threads SET suggestion_status = ? WHERE id = ?', body.suggestion_status, id);
    actions.push(`suggestion_${body.suggestion_status ?? 'cleared'}`);
    // Implemented ideas earn their proposer the Idea Contributor recognition.
    if (body.suggestion_status === 'implemented' && t.suggestion_status !== 'implemented' && t.user_id) {
      await awardBadge(c.env, t.user_id, 'idea', `Suggested “${t.title}”, which was implemented.`, actor.id);
    }
  }
  for (const a of actions) await logMod(c.env, actor.id, a, 'thread', id, t.title);
  return c.json({ ok: true });
});

// Merge a duplicate discussion into another: posts move over, the duplicate is removed.
admin.post('/threads/:id/merge', async (c) => {
  const actor = c.get('user');
  const src = num(c.req.param('id'));
  const { into } = parse(z.object({ into: z.number().int() }), await c.req.json());
  if (into === src) throw new HttpError(400, 'Choose a different discussion.');
  const a = await first<{ id: number; title: string }>(c.env, 'SELECT id, title FROM threads WHERE id = ? AND deleted = 0', src);
  const b = await first<{ id: number; title: string }>(c.env, 'SELECT id, title FROM threads WHERE id = ? AND deleted = 0', into);
  if (!a || !b) throw new HttpError(404, 'Discussion not found.');
  await run(c.env, 'UPDATE posts SET thread_id = ? WHERE thread_id = ?', into, src);
  await run(c.env, 'INSERT OR IGNORE INTO follows (user_id, thread_id, created_at) SELECT user_id, ?, created_at FROM follows WHERE thread_id = ?', into, src);
  const last = await first<{ id: number; user_id: number | null; created_at: number; n: number }>(c.env,
    'SELECT id, user_id, created_at, (SELECT COUNT(*) FROM posts WHERE thread_id = ?1 AND pending = 0) AS n FROM posts WHERE thread_id = ?1 AND pending = 0 ORDER BY id DESC LIMIT 1', into);
  if (last) await run(c.env, 'UPDATE threads SET last_post_id = ?, last_post_user_id = ?, last_post_at = MAX(last_post_at, ?), reply_count = ? WHERE id = ?', last.id, last.user_id, last.created_at, Math.max(0, last.n - 1), into);
  await run(c.env, 'UPDATE threads SET deleted = 1 WHERE id = ?', src);
  await logMod(c.env, actor.id, 'merge_thread', 'thread', src, `“${a.title}” into “${b.title}” (#${into})`);
  await broadcastThread(c.env, into, { type: 'post', id: last?.id ?? 0 });
  return c.json({ ok: true });
});

// ---------- First-post approval queue ----------

admin.get('/pending', async (c) => {
  const rows = await all(c.env,
    `SELECT p.id, p.body, p.created_at, p.thread_id, t.title, t.pending AS new_thread, u.id AS user_id, u.username
       FROM posts p JOIN threads t ON t.id = p.thread_id JOIN users u ON u.id = p.user_id
      WHERE p.pending = 1 AND p.deleted = 0 ORDER BY p.id`);
  return c.json({ pending: rows });
});

admin.post('/pending/:id', async (c) => {
  const actor = c.get('user');
  const { approve } = parse(z.object({ approve: z.boolean() }), await c.req.json());
  const p = await first<{ id: number; thread_id: number; user_id: number; body: string; quote_post_id: number | null; created_at: number }>(c.env,
    'SELECT id, thread_id, user_id, body, quote_post_id, created_at FROM posts WHERE id = ? AND pending = 1', num(c.req.param('id')));
  if (!p) throw new HttpError(404, 'Nothing to review.');
  const t = await first<{ id: number; title: string; pending: number }>(c.env, 'SELECT id, title, pending FROM threads WHERE id = ?', p.thread_id);
  const author = await first<SessionUser>(c.env, 'SELECT id, username, role, status, display_name, avatar_key, prefs, marked_read_at, created_at, trusted FROM users WHERE id = ?', p.user_id);
  if (!t || !author) throw new HttpError(404, 'Nothing to review.');
  if (approve) {
    await run(c.env, 'UPDATE posts SET pending = 0 WHERE id = ?', p.id);
    await run(c.env, 'UPDATE threads SET pending = 0 WHERE id = ?', t.id);
    // One approval is enough: the member's later posts appear immediately.
    await run(c.env, 'UPDATE users SET trusted = 1 WHERE id = ?', author.id);
    await run(c.env, 'UPDATE posts SET pending = 0 WHERE user_id = ? AND pending = 1 AND id != ?', author.id, p.id);
    await run(c.env, 'UPDATE threads SET pending = 0 WHERE user_id = ? AND pending = 1', author.id);
    await publishPost(c.env, author, t, p.id, p.body, p.quote_post_id, Boolean(t.pending), p.created_at);
    await notify(c.env, author.id, 'approved', 'Your first post was approved. Welcome! Your posts now appear right away.', `/t/${t.id}?post=${p.id}`, actor.id);
  } else {
    await run(c.env, 'UPDATE posts SET deleted = 1, deleted_by = ?, pending = 0 WHERE id = ?', actor.id, p.id);
    if (t.pending) await run(c.env, 'UPDATE threads SET deleted = 1 WHERE id = ?', t.id);
  }
  await logMod(c.env, actor.id, approve ? 'approve_post' : 'reject_post', 'post', p.id, `${author.username}: ${p.body.slice(0, 200)}`);
  return c.json({ ok: true });
});

// ---------- Reports ----------

admin.get('/reports', async (c) => {
  const status = c.req.query('status') ?? 'open';
  const rows = await all(c.env,
    `SELECT r.*, u.username AS reporter, ru.username AS resolver, p.thread_id
       FROM reports r LEFT JOIN users u ON u.id = r.reporter_id LEFT JOIN users ru ON ru.id = r.resolved_by LEFT JOIN posts p ON p.id = r.post_id
      WHERE r.status = ? ORDER BY r.id DESC LIMIT 200`, status);
  return c.json({ reports: rows });
});

admin.patch('/reports/:id', async (c) => {
  const body = parse(z.object({ status: z.enum(['resolved', 'dismissed', 'open']), note: z.string().max(500).optional() }), await c.req.json());
  const id = num(c.req.param('id'));
  await run(c.env, 'UPDATE reports SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = ? WHERE id = ?', body.status, body.note ?? null, c.get('user').id, now(), id);
  await logMod(c.env, c.get('user').id, `report_${body.status}`, 'report', id, body.note ?? '');
  return c.json({ ok: true });
});

// ---------- Recognition ----------

admin.post('/badges', async (c) => {
  const body = parse(z.object({ user_id: z.number().int(), badge: z.string(), reason: z.string().trim().min(3).max(300) }), await c.req.json());
  if (!(body.badge in BADGES) || body.badge === 'founding') throw new HttpError(400, 'Unknown recognition.');
  if (!(await first(c.env, 'SELECT id FROM users WHERE id = ?', body.user_id))) throw new HttpError(404, 'Member not found.');
  await awardBadge(c.env, body.user_id, body.badge, body.reason, c.get('user').id);
  await logMod(c.env, c.get('user').id, 'award_badge', 'user', body.user_id, `${body.badge}: ${body.reason}`);
  return c.json({ ok: true });
});

admin.delete('/badges/:id', async (c) => {
  await run(c.env, 'UPDATE badges SET revoked = 1 WHERE id = ?', num(c.req.param('id')));
  await logMod(c.env, c.get('user').id, 'revoke_badge', 'badge', num(c.req.param('id')));
  return c.json({ ok: true });
});

// ---------- Settings ----------

const SETTING_KEYS = ['launch_date', 'honorary_threshold', 'chat_window', 'announcement', 'approve_first_post'] as const;

admin.get('/settings', async (c) => {
  const out: Record<string, string> = {};
  for (const k of SETTING_KEYS) out[k] = await getSetting(c.env, k);
  return c.json({ settings: out });
});

admin.put('/settings', async (c) => {
  const body = parse(z.object({
    launch_date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'use YYYY-MM-DD').optional(),
    honorary_threshold: z.string().regex(/^\d{0,4}$/).optional(),
    chat_window: z.string().regex(/^\d{2,3}$/).optional(),
    announcement: z.string().max(500).optional(),
    approve_first_post: z.enum(['0', '1']).optional(),
  }), await c.req.json());
  for (const [k, v] of Object.entries(body)) if (v !== undefined) await setSetting(c.env, k, v);
  await logMod(c.env, c.get('user').id, 'update_settings', 'settings', null, JSON.stringify(body).slice(0, 500));
  return c.json({ ok: true });
});

// ---------- Sports data feeds ----------

admin.post('/feeds', async (c) => {
  const body = parse(z.object({ sport: z.string(), url: z.string().url() }), await c.req.json());
  const u = new URL(body.url);
  // Feeds must use HTTPS; plain HTTP is allowed only for local development.
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) throw new HttpError(400, 'Feed URLs must use https.');
  if (body.sport !== 'auto' && !(body.sport in SPORT_BY_KEY)) throw new HttpError(400, 'Unknown sport.');
  await run(c.env, 'INSERT INTO data_feeds (sport, url) VALUES (?, ?)', body.sport, body.url);
  await logMod(c.env, c.get('user').id, 'add_feed', 'feed', null, body.url);
  return c.json({ ok: true });
});

admin.patch('/feeds/:id', async (c) => {
  const body = parse(z.object({ enabled: z.boolean() }), await c.req.json());
  await run(c.env, 'UPDATE data_feeds SET enabled = ? WHERE id = ?', body.enabled ? 1 : 0, num(c.req.param('id')));
  return c.json({ ok: true });
});

admin.delete('/feeds/:id', async (c) => {
  await run(c.env, 'DELETE FROM data_feeds WHERE id = ?', num(c.req.param('id')));
  await logMod(c.env, c.get('user').id, 'remove_feed', 'feed', num(c.req.param('id')));
  return c.json({ ok: true });
});

admin.post('/feeds/sync', async (c) => {
  const results = await syncAllFeeds(c.env);
  await runGameLifecycle(c.env);
  return c.json({ results });
});

// Emergency override only: corrects a field while a feed is wrong. Overridden fields
// are flagged and protected from the next sync until cleared.
admin.patch('/games/:id', async (c) => {
  const id = num(c.req.param('id'));
  const g = await first<GameRow>(c.env, 'SELECT * FROM games WHERE id = ?', id);
  if (!g) throw new HttpError(404, 'Game not found.');
  const body = parse(z.object({
    starts_at: z.number().int().optional(), time_tba: z.boolean().optional(), status: z.enum(['scheduled', 'final', 'postponed', 'canceled']).optional(),
    venue: z.string().max(200).optional(), tv: z.string().max(120).optional(), radio: z.string().max(120).optional(),
    result: z.enum(['W', 'L', 'T']).nullable().optional(), nmsu_score: z.number().int().nullable().optional(), opp_score: z.number().int().nullable().optional(),
    clear: z.boolean().optional(),
  }), await c.req.json());
  if (body.clear) {
    await run(c.env, "UPDATE games SET override_fields = '{}' WHERE id = ?", id);
    await logMod(c.env, c.get('user').id, 'clear_game_override', 'game', id);
    return c.json({ ok: true });
  }
  const { clear: _clear, ...fields } = body;
  const overrides = { ...JSON.parse(g.override_fields || '{}'), ...fields };
  const sets = Object.keys(fields).map((k) => `${k} = ?`);
  const vals = Object.values(fields).map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v ?? null));
  await run(c.env, `UPDATE games SET ${[...sets, 'override_fields = ?', 'updated_at = ?'].join(', ')} WHERE id = ?`, ...vals, JSON.stringify(overrides), now(), id);
  await logMod(c.env, c.get('user').id, 'override_game', 'game', id, JSON.stringify(fields));
  return c.json({ game: presentGame((await first<GameRow>(c.env, 'SELECT * FROM games WHERE id = ?', id))!) });
});

admin.get('/log', async (c) => {
  const rows = await all(c.env, 'SELECT l.*, u.username AS actor FROM mod_log l LEFT JOIN users u ON u.id = l.actor_id ORDER BY l.id DESC LIMIT 200');
  return c.json({ log: rows });
});

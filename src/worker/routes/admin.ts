import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { requireAdmin } from '../auth';
import { all, first, getSetting, logMod, notify, run, setSetting } from '../db';
import { emailEnabled, sendEmail } from '../email';
import { DAY, HttpError, now, parse, randomToken, sha256 } from '../util';
import { BADGES, SPORT_BY_KEY } from '../../shared/sports';
import { awardBadge } from '../lib/members';
import { createInvite } from '../lib/invites';
import { createResetToken } from './auth';
import { publishPost, broadcastThread } from '../lib/threads';
import { BAN_APPROVALS_REQUIRED, MAX_SUSPENSION_DAYS, assertNotLastModerator, issueWarning, moderatorIds, notifyModerators, overturn, removePost, suspend, tellMember, voteBan } from '../lib/moderation';
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
    first<{ n: number }>(c.env, "SELECT (SELECT COUNT(*) FROM reports WHERE status = 'open' AND kind = 'report') + (SELECT COUNT(*) FROM posts WHERE hidden = 1 AND deleted = 0) AS n"),
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
    // When set, only this email address can use the invitation; otherwise the email is just where it was sent.
    lock_email: z.boolean().optional(),
    name: z.string().trim().max(60).optional(),
    note: z.string().trim().max(200).optional(),
    days: z.number().int().min(1).max(60).default(14),
    max_uses: z.number().int().min(1).max(50).default(1),
  }), await c.req.json());
  const r = await createInvite(c.env, new URL(c.req.url).origin, user, { email: body.email || undefined, lockEmail: body.lock_email, name: body.name, note: body.note, days: body.days, maxUses: body.max_uses });
  await logMod(c.env, user.id, 'create_invite', 'invite', null, r.note ?? '');
  // The link is shown once; only its hash is stored.
  return c.json({ link: r.link, emailed: r.emailed, emailEnabled: r.emailEnabled, days: r.days });
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
  const body = parse(z.object({
    role: z.enum(['member', 'admin']).optional(),
    status: z.enum(['active', 'suspended']).optional(),
    days: z.number().int().min(1).max(MAX_SUSPENSION_DAYS).optional(),
    reason: z.string().trim().max(500).optional(),
  }), await c.req.json());
  const target = await first<{ id: number; role: string; status: string; username: string; banned_at: number | null }>(c.env, 'SELECT id, role, status, username, banned_at FROM users WHERE id = ?', id);
  if (!target) throw new HttpError(404, 'Member not found.');
  if (id === actor.id && body.status === 'suspended') throw new HttpError(400, "You can't suspend yourself.");
  if (body.role) {
    if (body.role === 'member') await assertNotLastModerator(c.env, id);
    await run(c.env, 'UPDATE users SET role = ? WHERE id = ?', body.role, id);
    await logMod(c.env, actor.id, `set_role_${body.role}`, 'user', id, body.reason || target.username, id);
  }
  if (body.status === 'suspended') {
    // One moderator can only suspend temporarily; permanent bans need three moderators.
    if (!body.days) throw new HttpError(400, `Choose a suspension length (1 to ${MAX_SUSPENSION_DAYS} days). Permanent bans need three moderators.`);
    if (!body.reason || body.reason.length < 3) throw new HttpError(400, 'Give a reason. The member sees it and can appeal.');
    await suspend(c.env, actor.id, id, body.days, body.reason);
  } else if (body.status === 'active') {
    if (!body.reason || body.reason.length < 3) throw new HttpError(400, 'Give a reason for lifting the suspension.');
    await run(c.env, "UPDATE users SET status = 'active', suspended_until = NULL, banned_at = NULL, suspension_reason = NULL WHERE id = ?", id);
    await logMod(c.env, actor.id, target.banned_at ? 'lift_ban' : 'lift_suspension', 'user', id, body.reason, id);
  }
  return c.json({ ok: true });
});

admin.post('/members/:id/warn', async (c) => {
  const { reason, post_id } = parse(z.object({ reason: z.string().trim().min(3).max(500), post_id: z.number().int().nullable().optional() }), await c.req.json());
  const id = num(c.req.param('id'));
  if (!(await first(c.env, 'SELECT id FROM users WHERE id = ?', id))) throw new HttpError(404, 'Member not found.');
  await issueWarning(c.env, c.get('user').id, id, reason, post_id ?? null);
  return c.json({ ok: true });
});

// Abusive flagging: a moderator can switch off a member's ability to flag (reporting still works).
admin.post('/members/:id/flagging', async (c) => {
  const { enabled, reason } = parse(z.object({ enabled: z.boolean(), reason: z.string().trim().min(3).max(500) }), await c.req.json());
  const id = num(c.req.param('id'));
  await run(c.env, 'UPDATE users SET can_flag = ? WHERE id = ?', enabled ? 1 : 0, id);
  await logMod(c.env, c.get('user').id, enabled ? 'restore_flagging' : 'revoke_flagging', 'user', id, reason, id);
  if (!enabled) await notify(c.env, id, 'moderation', `A moderator turned off troll flagging for your account: ${reason}`, '/settings#moderation');
  return c.json({ ok: true });
});

admin.get('/flaggers', async (c) => {
  const rows = await all(c.env,
    `SELECT u.id, u.username, u.can_flag, COUNT(r.id) AS flags,
            SUM(r.status = 'resolved') AS upheld, SUM(r.status = 'dismissed') AS dismissed, SUM(r.status = 'open') AS pending,
            MAX(r.created_at) AS last_flag
       FROM reports r JOIN users u ON u.id = r.reporter_id WHERE r.kind = 'troll' GROUP BY u.id ORDER BY dismissed DESC, flags DESC`);
  return c.json({ flaggers: rows });
});

// ---------- Permanent bans: three moderators must approve ----------

admin.get('/bans', async (c) => {
  const proposals = await all<{ id: number; user_id: number; username: string; proposed_by_name: string; reason: string; status: string; created_at: number; decided_at: number | null }>(c.env,
    `SELECT b.*, u.username, p.username AS proposed_by_name FROM ban_proposals b JOIN users u ON u.id = b.user_id LEFT JOIN users p ON p.id = b.proposed_by
      ORDER BY (b.status = 'open') DESC, b.id DESC LIMIT 50`);
  const votes = proposals.length ? await all<{ proposal_id: number; moderator: string; moderator_id: number; vote: string; reason: string; created_at: number }>(c.env,
    `SELECT v.proposal_id, v.moderator_id, v.vote, v.reason, v.created_at, u.username AS moderator FROM ban_votes v JOIN users u ON u.id = v.moderator_id
      WHERE v.proposal_id IN (${proposals.map(() => '?').join(',')})`, ...proposals.map((p) => p.id)) : [];
  return c.json({ required: BAN_APPROVALS_REQUIRED, moderators: (await moderatorIds(c.env)).length, proposals: proposals.map((p) => ({ ...p, votes: votes.filter((v) => v.proposal_id === p.id) })) });
});

admin.post('/bans', async (c) => {
  const actor = c.get('user');
  const { user_id, reason } = parse(z.object({ user_id: z.number().int(), reason: z.string().trim().min(10, 'explain the reason (at least a sentence)').max(1000) }), await c.req.json());
  if (user_id === actor.id) throw new HttpError(400, "You can't propose banning yourself.");
  const target = await first<{ username: string; banned_at: number | null }>(c.env, 'SELECT username, banned_at FROM users WHERE id = ?', user_id);
  if (!target) throw new HttpError(404, 'Member not found.');
  if (target.banned_at) throw new HttpError(400, 'This member is already banned.');
  if (await first(c.env, "SELECT id FROM ban_proposals WHERE user_id = ? AND status = 'open'", user_id)) throw new HttpError(409, 'There is already an open ban proposal for this member.');
  const r = await run(c.env, 'INSERT INTO ban_proposals (user_id, proposed_by, reason, created_at) VALUES (?, ?, ?, ?)', user_id, actor.id, reason, now());
  await logMod(c.env, actor.id, 'ban_proposed', 'ban_proposal', r.meta.last_row_id, reason, user_id);
  const result = await voteBan(c.env, actor.id, r.meta.last_row_id, 'approve', reason);
  await notifyModerators(c.env, `${actor.username} proposed permanently banning ${target.username}. ${BAN_APPROVALS_REQUIRED} moderators must approve.`, '/admin/bans', actor.id);
  return c.json({ id: r.meta.last_row_id, ...result });
});

admin.post('/bans/:id/vote', async (c) => {
  const { vote, reason } = parse(z.object({ vote: z.enum(['approve', 'reject']), reason: z.string().trim().min(3).max(500) }), await c.req.json());
  return c.json(await voteBan(c.env, c.get('user').id, num(c.req.param('id')), vote, reason));
});

// ---------- Appeals: decided by a different moderator than the one who acted ----------

admin.get('/appeals', async (c) => {
  const rows = await all(c.env,
    `SELECT a.*, u.username, l.action, l.detail, l.actor_id, l.created_at AS action_at, m.username AS acted_by, d.username AS decided_by_name
       FROM appeals a JOIN users u ON u.id = a.user_id JOIN mod_log l ON l.id = a.log_id LEFT JOIN users m ON m.id = l.actor_id LEFT JOIN users d ON d.id = a.decided_by
      ORDER BY (a.status = 'open') DESC, a.id DESC LIMIT 100`);
  return c.json({ appeals: rows });
});

admin.post('/appeals/:id', async (c) => {
  const actor = c.get('user');
  const { decision, note } = parse(z.object({ decision: z.enum(['upheld', 'overturned']), note: z.string().trim().min(3).max(1000) }), await c.req.json());
  const a = await first<{ id: number; user_id: number; log_id: number; status: string }>(c.env, 'SELECT * FROM appeals WHERE id = ?', num(c.req.param('id')));
  if (!a || a.status !== 'open') throw new HttpError(400, 'This appeal is already decided.');
  const log = await first<{ action: string; actor_id: number | null; target_id: number | null; subject_user_id: number | null }>(c.env, 'SELECT action, actor_id, target_id, subject_user_id FROM mod_log WHERE id = ?', a.log_id);
  if (!log) throw new HttpError(404, 'Decision not found.');
  if (log.actor_id === actor.id) throw new HttpError(403, 'A different moderator must decide this appeal.');
  if (log.action === 'ban') {
    const voters = await all<{ moderator_id: number }>(c.env, "SELECT v.moderator_id FROM ban_votes v JOIN ban_proposals b ON b.id = v.proposal_id WHERE b.user_id = ? AND b.status = 'approved' AND v.vote = 'approve'", a.user_id);
    if (voters.some((v) => v.moderator_id === actor.id)) throw new HttpError(403, 'A moderator who did not vote for the ban must decide this appeal.');
  }
  if (decision === 'overturned') await overturn(c.env, log);
  await run(c.env, 'UPDATE appeals SET status = ?, decided_by = ?, decision_note = ?, decided_at = ? WHERE id = ?', decision, actor.id, note, now(), a.id);
  await logMod(c.env, actor.id, `appeal_${decision}`, 'appeal', a.id, note, a.user_id);
  await tellMember(c.env, a.user_id, decision === 'overturned' ? `Your appeal was granted: ${note}` : `Your appeal was reviewed and the decision stands: ${note}`, '/settings#moderation', 'Your NMSU Sports Forum appeal was decided');
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

// ---------- Troll flags ----------

admin.get('/flagged', async (c) => {
  const posts = await all<{ id: number; thread_id: number; body: string; hidden: number; created_at: number; user_id: number | null; username: string | null; title: string; flags: number }>(c.env,
    `SELECT p.id, p.thread_id, p.body, p.hidden, p.created_at, u.id AS user_id, u.username, t.title, COUNT(DISTINCT r.reporter_id) AS flags
       FROM reports r JOIN posts p ON p.id = r.post_id JOIN threads t ON t.id = p.thread_id LEFT JOIN users u ON u.id = p.user_id
      WHERE r.kind = 'troll' AND r.status = 'open' AND p.deleted = 0 GROUP BY p.id ORDER BY p.hidden DESC, flags DESC`);
  const out = [];
  for (const p of posts) {
    // Context for spotting coordinated flagging: each flagger's history with this author and overall accuracy.
    const flaggers = await all(c.env,
      `SELECT u.id, u.username, u.can_flag, r.created_at,
              (SELECT COUNT(*) FROM reports r2 JOIN posts p2 ON p2.id = r2.post_id WHERE r2.kind = 'troll' AND r2.reporter_id = u.id AND p2.user_id = ? AND r2.created_at > ?) AS on_author_30d,
              (SELECT COUNT(*) FROM reports r3 WHERE r3.kind = 'troll' AND r3.reporter_id = u.id AND r3.status = 'dismissed') AS dismissed,
              (SELECT COUNT(*) FROM reports r4 WHERE r4.kind = 'troll' AND r4.reporter_id = u.id) AS total
         FROM reports r JOIN users u ON u.id = r.reporter_id WHERE r.post_id = ? AND r.kind = 'troll' AND r.status = 'open' ORDER BY r.created_at`,
      p.user_id ?? 0, now() - 30 * DAY, p.id);
    const priorWarnings = p.user_id ? (await first<{ n: number }>(c.env, 'SELECT COUNT(*) AS n FROM warnings WHERE user_id = ? AND withdrawn = 0', p.user_id))?.n ?? 0 : 0;
    out.push({ ...p, flaggers, prior_warnings: priorWarnings });
  }
  return c.json({ flagged: out });
});

admin.post('/flagged/:id', async (c) => {
  const actor = c.get('user');
  const postId = num(c.req.param('id'));
  const body = parse(z.object({ action: z.enum(['restore', 'remove']), reason: z.string().trim().min(3, 'give a short reason').max(500), warn: z.boolean().optional() }), await c.req.json());
  const p = await first<{ id: number; user_id: number | null; body: string; thread_id: number }>(c.env, 'SELECT id, user_id, body, thread_id FROM posts WHERE id = ?', postId);
  if (!p) throw new HttpError(404, 'Post not found.');
  if (body.action === 'restore') {
    await run(c.env, 'UPDATE posts SET hidden = 0 WHERE id = ?', postId);
    await run(c.env, "UPDATE reports SET status = 'dismissed', resolved_by = ?, resolved_at = ?, resolution_note = ? WHERE post_id = ? AND kind = 'troll' AND status = 'open'", actor.id, now(), body.reason, postId);
    await logMod(c.env, actor.id, 'restore_post', 'post', postId, body.reason, p.user_id);
    if (p.user_id) await notify(c.env, p.user_id, 'moderation', `Your post was reviewed and restored: ${body.reason}`, `/t/${p.thread_id}?post=${postId}`);
  } else {
    await removePost(c.env, actor.id, postId, body.reason);
  }
  if (body.warn && p.user_id) await issueWarning(c.env, actor.id, p.user_id, body.reason, postId);
  return c.json({ ok: true });
});

// ---------- Reports ----------

admin.get('/reports', async (c) => {
  const status = c.req.query('status') ?? 'open';
  const rows = await all(c.env,
    `SELECT r.*, u.username AS reporter, ru.username AS resolver, p.thread_id
       FROM reports r LEFT JOIN users u ON u.id = r.reporter_id LEFT JOIN users ru ON ru.id = r.resolved_by LEFT JOIN posts p ON p.id = r.post_id
      WHERE r.status = ? AND r.kind = 'report' ORDER BY r.id DESC LIMIT 200`, status);
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

const SETTING_KEYS = ['launch_date', 'honorary_threshold', 'chat_window', 'announcement', 'approve_first_post', 'signup_mode', 'public_read', 'troll_threshold', 'hub_links', 'member_invites'] as const;

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
    signup_mode: z.enum(['invite', 'open']).optional(),
    public_read: z.enum(['0', '1']).optional(),
    troll_threshold: z.string().regex(/^[1-9]\d?$/, 'use a number from 1 to 99').optional(),
    hub_links: z.string().max(4000).optional(),
    member_invites: z.enum(['0', '1', '']).optional(),
  }), await c.req.json());
  for (const [k, v] of Object.entries(body)) if (v !== undefined) await setSetting(c.env, k, v);
  await logMod(c.env, c.get('user').id, 'update_settings', 'settings', null, JSON.stringify(body).slice(0, 500));
  return c.json({ ok: true });
});

// ---------- Sports data feeds ----------

admin.post('/feeds', async (c) => {
  const raw = (await c.req.json()) as { sport?: unknown; url?: unknown };
  // Calendar "subscribe" buttons often hand out webcal:// links; they are the same feed over https.
  if (typeof raw.url === 'string') raw.url = raw.url.trim().replace(/^webcals?:\/\//i, 'https://');
  const body = parse(z.object({ sport: z.string(), url: z.string().url() }), raw);
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

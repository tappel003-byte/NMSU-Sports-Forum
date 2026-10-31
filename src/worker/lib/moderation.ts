// Moderation rules shared by the forum and admin routes. Moderators are the forum's administrators.
import type { Env } from '../env';
import { all, first, logMod, notify, run } from '../db';
import { DAY, HttpError, excerpt, now } from '../util';
import { emailEnabled, sendEmail } from '../email';

export const FLAG_THRESHOLD_DEFAULT = 3;
export const BAN_APPROVALS_REQUIRED = 3;
export const MAX_SUSPENSION_DAYS = 90;
export const APPEALABLE = ['remove_post', 'warn', 'suspend', 'ban'] as const;

export async function moderatorIds(env: Env): Promise<number[]> {
  return (await all<{ id: number }>(env, "SELECT id FROM users WHERE (role = 'admin' OR moderator = 1) AND status = 'active'")).map((r) => r.id);
}

export async function notifyModerators(env: Env, text: string, link: string, exceptId: number | null = null): Promise<void> {
  for (const id of await moderatorIds(env)) if (id !== exceptId) await notify(env, id, 'moderation', text, link);
}

/** Tells a member about a decision, by email too when they may be unable to sign in. */
export async function tellMember(env: Env, userId: number, text: string, link: string, emailSubject?: string): Promise<void> {
  await notify(env, userId, 'moderation', text, link);
  if (emailSubject && emailEnabled(env)) {
    const u = await first<{ email: string }>(env, 'SELECT email FROM users WHERE id = ?', userId);
    if (u) await sendEmail(env, u.email, emailSubject, `${text}\n\nYou can appeal from the sign-in page at https://nmsusportsforum.com/login`);
  }
}

export async function issueWarning(env: Env, moderatorId: number, userId: number, reason: string, postId: number | null): Promise<number> {
  const r = await run(env, 'INSERT INTO warnings (user_id, post_id, reason, issued_by, created_at) VALUES (?, ?, ?, ?, ?)', userId, postId, reason, moderatorId, now());
  await logMod(env, moderatorId, 'warn', 'warning', r.meta.last_row_id, reason, userId);
  await tellMember(env, userId, `A moderator sent you a warning: ${reason} You can appeal from Settings → Moderation history.`, '/settings#moderation');
  return r.meta.last_row_id;
}

/** Removes a post with a recorded reason. Removal is a moderator decision; flags alone never remove anything. */
export async function removePost(env: Env, moderatorId: number, postId: number, reason: string): Promise<void> {
  const p = await first<{ id: number; user_id: number | null; body: string; thread_id: number }>(env, 'SELECT id, user_id, body, thread_id FROM posts WHERE id = ?', postId);
  if (!p) throw new HttpError(404, 'Post not found.');
  await run(env, 'UPDATE posts SET deleted = 1, deleted_by = ?, hidden = 0 WHERE id = ?', moderatorId, postId);
  await run(env, "UPDATE reports SET status = 'resolved', resolved_by = ?, resolved_at = ?, resolution_note = ? WHERE post_id = ? AND status = 'open'", moderatorId, now(), reason, postId);
  await logMod(env, moderatorId, 'remove_post', 'post', postId, `${reason} — “${excerpt(p.body, 120)}”`, p.user_id);
  if (p.user_id && p.user_id !== moderatorId) {
    await tellMember(env, p.user_id, `A moderator removed one of your posts: ${reason} You can appeal from Settings → Moderation history.`, '/settings#moderation');
  }
}

export async function suspend(env: Env, moderatorId: number, userId: number, days: number, reason: string): Promise<void> {
  if (!Number.isInteger(days) || days < 1 || days > MAX_SUSPENSION_DAYS) throw new HttpError(400, `Suspensions are 1 to ${MAX_SUSPENSION_DAYS} days. Permanent bans need three moderators.`);
  await assertNotLastModerator(env, userId);
  const until = now() + days * DAY;
  await run(env, "UPDATE users SET status = 'suspended', suspended_until = ?, suspension_reason = ? WHERE id = ?", until, reason, userId);
  await run(env, 'DELETE FROM sessions WHERE user_id = ?', userId);
  await logMod(env, moderatorId, 'suspend', 'user', userId, `${days} day(s): ${reason}`, userId);
  await tellMember(env, userId, `Your account is suspended for ${days} day${days === 1 ? '' : 's'}: ${reason}`, '/login', 'Your NMSU Sports Forum account is suspended');
}

export async function assertNotLastModerator(env: Env, userId: number): Promise<void> {
  const u = await first<{ role: string; moderator: number }>(env, 'SELECT role, moderator FROM users WHERE id = ?', userId);
  if ((u?.role === 'admin' || u?.moderator) && (await moderatorIds(env)).length <= 1) throw new HttpError(400, 'The forum must always have at least one active moderator.');
}

/** Records a vote; three approvals from different moderators make the ban take effect. */
export async function voteBan(env: Env, moderatorId: number, proposalId: number, vote: 'approve' | 'reject', reason: string) {
  const p = await first<{ id: number; user_id: number; status: string; created_at: number }>(env, 'SELECT * FROM ban_proposals WHERE id = ?', proposalId);
  if (!p || p.status !== 'open') throw new HttpError(400, 'This ban proposal is closed.');
  if (p.user_id === moderatorId) throw new HttpError(400, "You can't vote on your own ban.");
  await run(env, `INSERT INTO ban_votes (proposal_id, moderator_id, vote, reason, created_at) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(proposal_id, moderator_id) DO UPDATE SET vote = excluded.vote, reason = excluded.reason, created_at = excluded.created_at`, proposalId, moderatorId, vote, reason, now());
  await logMod(env, moderatorId, `ban_vote_${vote}`, 'ban_proposal', proposalId, reason, p.user_id);
  const votes = await all<{ vote: string }>(env, 'SELECT vote FROM ban_votes WHERE proposal_id = ?', proposalId);
  const approvals = votes.filter((v) => v.vote === 'approve').length;
  const rejects = votes.filter((v) => v.vote === 'reject').length;
  const eligible = (await moderatorIds(env)).filter((id) => id !== p.user_id).length;
  if (approvals >= BAN_APPROVALS_REQUIRED) {
    await assertNotLastModerator(env, p.user_id);
    await run(env, "UPDATE ban_proposals SET status = 'approved', decided_at = ? WHERE id = ?", now(), proposalId);
    const prop = await first<{ reason: string }>(env, 'SELECT reason FROM ban_proposals WHERE id = ?', proposalId);
    await run(env, "UPDATE users SET status = 'suspended', suspended_until = NULL, banned_at = ?, suspension_reason = ?, role = 'member' WHERE id = ?", now(), prop!.reason, p.user_id);
    await run(env, 'DELETE FROM sessions WHERE user_id = ?', p.user_id);
    await logMod(env, null, 'ban', 'user', p.user_id, `Approved by ${approvals} moderators: ${prop!.reason}`, p.user_id);
    await tellMember(env, p.user_id, `Your account has been permanently banned by decision of ${approvals} moderators: ${prop!.reason}`, '/login', 'Your NMSU Sports Forum account has been banned');
    return { status: 'approved', approvals, rejects };
  }
  if (eligible - rejects < BAN_APPROVALS_REQUIRED) {
    await run(env, "UPDATE ban_proposals SET status = 'rejected', decided_at = ? WHERE id = ?", now(), proposalId);
    await logMod(env, null, 'ban_rejected', 'ban_proposal', proposalId, `Not enough moderators approved (${approvals} approve, ${rejects} reject).`, p.user_id);
    return { status: 'rejected', approvals, rejects };
  }
  return { status: 'open', approvals, rejects };
}

/** Undoes a decision when an appeal is granted. */
export async function overturn(env: Env, log: { action: string; target_id: number | null; subject_user_id: number | null }): Promise<void> {
  if (log.action === 'remove_post' && log.target_id) await run(env, 'UPDATE posts SET deleted = 0, deleted_by = NULL, hidden = 0 WHERE id = ?', log.target_id);
  if (log.action === 'warn' && log.target_id) await run(env, 'UPDATE warnings SET withdrawn = 1 WHERE id = ?', log.target_id);
  if ((log.action === 'suspend' || log.action === 'ban') && log.subject_user_id) {
    await run(env, "UPDATE users SET status = 'active', suspended_until = NULL, banned_at = NULL, suspension_reason = NULL WHERE id = ?", log.subject_user_id);
  }
}

export async function expireBanProposals(env: Env): Promise<void> {
  await run(env, "UPDATE ban_proposals SET status = 'expired', decided_at = ? WHERE status = 'open' AND created_at < ?", now(), now() - 14 * DAY);
}

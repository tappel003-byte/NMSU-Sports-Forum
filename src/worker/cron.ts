import type { Env } from './env';
import { all, notify, run, userPrefs } from './db';
import { emailEnabled, sendEmail } from './email';
import { DAY, now } from './util';
import { deleteObject } from './storage';
import { runGameLifecycle, syncAllFeeds } from './lib/sports';
import { syncRecruiting } from './lib/recruiting';
import { expireBanProposals } from './lib/moderation';

/** Every 30 minutes: sync schedules, run the game-day lifecycle and deliver bookmark reminders. */
export async function frequentJobs(env: Env): Promise<void> {
  await syncAllFeeds(env);
  await runGameLifecycle(env);
  const due = await all<{ id: number; user_id: number; post_id: number; note: string | null; thread_id: number; title: string }>(env,
    `SELECT b.id, b.user_id, b.post_id, b.note, p.thread_id, t.title FROM bookmarks b JOIN posts p ON p.id = b.post_id JOIN threads t ON t.id = p.thread_id
      WHERE b.reminded = 0 AND b.remind_at IS NOT NULL AND b.remind_at <= ?`, now());
  for (const b of due) {
    await notify(env, b.user_id, 'reminder', `Reminder: “${b.title}”${b.note ? ` — ${b.note}` : ''}`, `/t/${b.thread_id}?post=${b.post_id}`);
    await run(env, 'UPDATE bookmarks SET reminded = 1 WHERE id = ?', b.id);
  }
}

/** Daily housekeeping: expire discussion photos after 90 days and prune stale auth records. */
export async function dailyJobs(env: Env): Promise<void> {
  const t = now();
  const expired = await all<{ id: string; kind: string }>(env, 'SELECT id, kind FROM attachments WHERE deleted = 0 AND expires_at IS NOT NULL AND expires_at <= ? LIMIT 500', t);
  for (const a of expired) {
    await deleteObject(env, `${a.kind}/${a.id}`);
    await run(env, 'UPDATE attachments SET deleted = 1 WHERE id = ?', a.id);
  }
  // Uploaded photos never attached to a post are removed after a day.
  const orphans = await all<{ id: string; kind: string }>(env, "SELECT id, kind FROM attachments WHERE deleted = 0 AND kind = 'post' AND post_id IS NULL AND created_at < ? LIMIT 500", t - DAY);
  for (const a of orphans) {
    await deleteObject(env, `${a.kind}/${a.id}`);
    await run(env, 'UPDATE attachments SET deleted = 1 WHERE id = ?', a.id);
  }
  await run(env, 'DELETE FROM sessions WHERE expires_at < ?', t);
  await run(env, 'DELETE FROM login_attempts WHERE at < ?', t - DAY);
  await run(env, 'DELETE FROM password_resets WHERE expires_at < ?', t - 7 * DAY);
  await run(env, 'DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?', t - 90 * DAY);
  await syncRecruiting(env);
  await expireBanProposals(env);
  if (new Date(t).getUTCDay() === 1) await weeklyDigest(env);
}

/** Monday email for members who opted in: the week's busiest discussions. Requires email to be configured. */
async function weeklyDigest(env: Env): Promise<void> {
  if (!emailEnabled(env)) return;
  const top = await all<{ id: number; title: string; reply_count: number }>(env,
    'SELECT id, title, reply_count FROM threads WHERE deleted = 0 AND last_post_at > ? ORDER BY reply_count DESC LIMIT 8', now() - 7 * DAY);
  if (!top.length) return;
  const users = await all<{ email: string; prefs: string }>(env, "SELECT email, prefs FROM users WHERE status = 'active'");
  const lines = top.map((t) => `• ${t.title} (${t.reply_count} replies) — https://nmsusportsforum.com/t/${t.id}`).join('\n');
  for (const u of users) {
    if (userPrefs(u.prefs).digest !== true) continue;
    await sendEmail(env, u.email, 'This week on NMSU Sports Forum', `Here's what Aggie fans talked about this week:\n\n${lines}\n\nTurn this email off any time in Settings.`);
  }
}

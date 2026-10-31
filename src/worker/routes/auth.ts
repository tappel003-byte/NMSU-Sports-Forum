import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { clientIp, createSession, destroySession, liftExpiredSuspension, rateLimit, requireUser } from '../auth';
import { first, getSetting, logMod, run } from '../db';
import { emailEnabled, sendEmail } from '../email';
import { fileAppeal } from './community';
import { HttpError, DAY, hashPassword, now, parse, passwordSchema, randomToken, sha256, usernameSchema, verifyPassword, linkToken } from '../util';

export const auth = new Hono<AppEnv>();

const emailSchema = z.string().trim().email('enter a valid email').max(200);

auth.get('/me', async (c) => {
  const user = c.get('user');
  const anyUser = await first<{ id: number }>(c.env, 'SELECT id FROM users LIMIT 1');
  return c.json({
    user: user ? { id: user.id, username: user.username, role: user.role, display_name: user.display_name, avatar_key: user.avatar_key, prefs: JSON.parse(user.prefs || '{}') } : null,
    setupNeeded: !anyUser,
    emailEnabled: emailEnabled(c.env),
    signupMode: (await getSetting(c.env, 'signup_mode')) || 'invite',
    publicRead: (await getSetting(c.env, 'public_read')) === '1',
    memberInvites: (await getSetting(c.env, 'member_invites')) !== '0',
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || null,
    emailVerified: user ? (await first<{ v: number }>(c.env, 'SELECT email_verified AS v FROM users WHERE id = ?', user.id))?.v !== 0 : true,
  });
});

// First administrator. Only works while the database has no users and requires the
// BOOTSTRAP_TOKEN secret set by the technical owner (docs/DEPLOYMENT.md).
auth.post('/setup', async (c) => {
  await rateLimit(c.env, `setup:${clientIp(c)}`, 10, 900_000);
  const body = parse(z.object({ token: z.string(), username: usernameSchema, email: emailSchema, password: passwordSchema }), await c.req.json());
  if (!c.env.BOOTSTRAP_TOKEN) throw new HttpError(403, 'Setup is not enabled. Set the BOOTSTRAP_TOKEN secret first.');
  if (body.token !== c.env.BOOTSTRAP_TOKEN) throw new HttpError(403, 'Setup token is incorrect.');
  if (await first(c.env, 'SELECT id FROM users LIMIT 1')) throw new HttpError(409, 'Setup has already been completed.');
  const r = await run(c.env, "INSERT INTO users (username, email, password_hash, role, trusted, created_at) VALUES (?, ?, ?, 'admin', 1, ?)",
    body.username, body.email, await hashPassword(body.password), now());
  const id = r.meta.last_row_id;
  await logMod(c.env, id, 'setup_first_admin', 'user', id);
  await createSession(c, id);
  return c.json({ ok: true });
});

auth.get('/invite/:token', async (c) => {
  await rateLimit(c.env, `invitecheck:${clientIp(c)}`, 30, 900_000);
  const { inv, reason } = await findInvite(c.env, c.req.param('token'));
  return c.json({ valid: !reason, reason, email: inv?.email ?? null });
});

type InviteRow = { id: number; email: string | null; uses: number; max_uses: number; expires_at: number; revoked: number };

/** Looks up an invitation and says why it can't be used. Forgives punctuation a messaging app tacked on or clipped at the end. */
async function findInvite(env: AppEnv['Bindings'], raw: string): Promise<{ inv: InviteRow | null; reason: 'not_found' | 'used' | 'expired' | 'revoked' | null }> {
  const lookup = async (t: string) => first<InviteRow>(env, 'SELECT id, email, uses, max_uses, expires_at, revoked FROM invites WHERE token_hash = ?', await sha256(t));
  const token = raw.trim();
  let inv = await lookup(token);
  const trimmed = token.replace(/[^A-Za-z0-9]+$/, '');
  if (!inv && trimmed !== token) inv = await lookup(trimmed);
  // Older links could end in - or _, which some apps drop when linking the URL.
  if (!inv) for (const end of ['-', '_', '--', '__']) { inv = await lookup(trimmed + end); if (inv) break; }
  if (!inv) return { inv: null, reason: 'not_found' };
  if (inv.revoked) return { inv, reason: 'revoked' };
  if (inv.uses >= inv.max_uses) return { inv, reason: 'used' };
  if (inv.expires_at < now()) return { inv, reason: 'expired' };
  return { inv, reason: null };
}

async function validInvite(env: AppEnv['Bindings'], token: string) {
  const { inv, reason } = await findInvite(env, token);
  return reason ? null : inv;
}

/** Cloudflare Turnstile human check for open sign-up (skipped when no key is configured). */
async function verifyTurnstile(env: AppEnv['Bindings'], token: string | undefined, ip: string): Promise<void> {
  if (!env.TURNSTILE_SECRET) return;
  if (!token) throw new HttpError(400, 'Please complete the "verify you are human" check.');
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form, signal: AbortSignal.timeout(8000) });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean };
  if (!data.success) throw new HttpError(400, 'The human check failed. Please try again.');
}

export async function sendVerification(env: AppEnv['Bindings'], origin: string, userId: number, email: string): Promise<boolean> {
  const token = randomToken();
  await run(env, 'INSERT INTO email_verifications (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', await sha256(token), userId, now() + 3 * DAY, now());
  return sendEmail(env, email, 'Confirm your NMSU Sports Forum account',
    `Welcome to NMSU Sports Forum!\n\nConfirm your email to start posting (link expires in 3 days):\n${origin}/verify/${token}\n\nIf you didn't sign up, ignore this email.`);
}

auth.post('/register', async (c) => {
  await rateLimit(c.env, `register:${clientIp(c)}`, 10, 900_000);
  const body = parse(z.object({
    token: z.string().optional(),
    username: usernameSchema,
    email: emailSchema,
    password: passwordSchema,
    display_name: z.string().trim().max(60).optional(),
    turnstile: z.string().optional(),
  }), await c.req.json());
  const open = !body.token && (await getSetting(c.env, 'signup_mode')) === 'open';
  const inv = body.token ? await validInvite(c.env, body.token) : null;
  if (!open && !inv) throw new HttpError(400, body.token ? 'This invitation is invalid, expired or already used. Ask an administrator for a new one.' : 'Sign-up is by invitation right now. Ask a member or administrator for an invite link.');
  if (inv?.email && inv.email.toLowerCase() !== body.email.toLowerCase()) throw new HttpError(400, 'This invitation was issued for a different email address.');
  if (open) {
    await rateLimit(c.env, `signup-open:${clientIp(c)}`, 3, 86_400_000);
    await verifyTurnstile(c.env, body.turnstile, clientIp(c));
  }
  if (await first(c.env, 'SELECT id FROM users WHERE username = ?', body.username)) throw new HttpError(409, 'That username is taken.');
  if (await first(c.env, 'SELECT id FROM users WHERE email = ?', body.email)) throw new HttpError(409, 'An account already uses that email.');
  if (inv) {
    // Claim the invite atomically so it cannot be used twice concurrently.
    const claim = await run(c.env, 'UPDATE invites SET uses = uses + 1 WHERE id = ? AND uses < max_uses AND revoked = 0', inv.id);
    if (!claim.meta.changes) throw new HttpError(400, 'This invitation has already been used.');
  }
  const t = now();
  // Open sign-ups confirm their email before posting (when email is set up) and their first post is reviewed.
  const needsVerify = open && emailEnabled(c.env);
  const r = await run(c.env, 'INSERT INTO users (username, email, password_hash, display_name, created_at, joined_open, email_verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
    body.username, body.email, await hashPassword(body.password), body.display_name || null, t, open ? 1 : 0, needsVerify ? 0 : 1);
  const id = r.meta.last_row_id;
  if (inv) await run(c.env, 'INSERT INTO invite_uses (invite_id, user_id, used_at) VALUES (?, ?, ?)', inv.id, id, t);
  if (needsVerify) await sendVerification(c.env, new URL(c.req.url).origin, id, body.email);
  await createSession(c, id);
  return c.json({ ok: true, verifyEmail: needsVerify });
});

auth.post('/verify', async (c) => {
  const { token } = parse(z.object({ token: z.string().min(10) }), await c.req.json());
  const hash = await sha256(token);
  const v = await first<{ user_id: number; expires_at: number }>(c.env, 'SELECT user_id, expires_at FROM email_verifications WHERE token_hash = ?', hash);
  if (!v || v.expires_at < now()) throw new HttpError(400, 'This confirmation link is invalid or expired. Sign in and ask for a new one.');
  await run(c.env, 'UPDATE users SET email_verified = 1 WHERE id = ?', v.user_id);
  await run(c.env, 'DELETE FROM email_verifications WHERE user_id = ?', v.user_id);
  return c.json({ ok: true });
});

auth.post('/verify/resend', requireUser, async (c) => {
  const user = c.get('user');
  await rateLimit(c.env, `verify-resend:${user.id}`, 3, 3_600_000);
  const u = await first<{ email: string; email_verified: number }>(c.env, 'SELECT email, email_verified FROM users WHERE id = ?', user.id);
  if (!u || u.email_verified) return c.json({ ok: true });
  await sendVerification(c.env, new URL(c.req.url).origin, user.id, u.email);
  return c.json({ ok: true });
});

auth.post('/login', async (c) => {
  const body = parse(z.object({ username: z.string().trim().min(1).max(200), password: z.string().min(1).max(200) }), await c.req.json());
  await rateLimit(c.env, `login-ip:${clientIp(c)}`, 20, 900_000);
  await rateLimit(c.env, `login-user:${body.username.toLowerCase()}`, 10, 900_000);
  const u = await first<{ id: number; password_hash: string; status: string }>(c.env,
    'SELECT id, password_hash, status FROM users WHERE username = ? OR email = ?', body.username, body.username);
  if (!u || !(await verifyPassword(body.password, u.password_hash))) throw new HttpError(401, 'Username or password is incorrect.');
  if (u.status !== 'active' && !(await liftExpiredSuspension(c.env, u.id))) {
    const info = await first<{ suspended_until: number | null; deleted_at: number | null; banned_at: number | null; suspension_reason: string | null }>(c.env,
      'SELECT suspended_until, deleted_at, banned_at, suspension_reason FROM users WHERE id = ?', u.id);
    if (info?.deleted_at) throw new HttpError(401, 'Username or password is incorrect.');
    const why = info?.suspension_reason ? ` Reason: ${info.suspension_reason}` : '';
    throw new HttpError(403, info?.banned_at
      ? `This account has been permanently banned by decision of three moderators.${why} You can appeal below.`
      : info?.suspended_until
        ? `This account is suspended until ${new Date(info.suspended_until).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'long', day: 'numeric' })}.${why} You can appeal below.`
        : `This account is suspended.${why} You can appeal below.`);
  }
  await createSession(c, u.id);
  return c.json({ ok: true });
});

auth.post('/logout', async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

auth.post('/logout-all', requireUser, async (c) => {
  await run(c.env, 'DELETE FROM sessions WHERE user_id = ?', c.get('user').id);
  await destroySession(c);
  return c.json({ ok: true });
});

export async function createResetToken(env: AppEnv['Bindings'], userId: number, createdBy: number | null): Promise<string> {
  const token = linkToken();
  const t = now();
  await run(env, 'INSERT INTO password_resets (token_hash, user_id, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    await sha256(token), userId, createdBy, t + (createdBy ? 3 * DAY : 3_600_000), t);
  return token;
}

auth.post('/forgot', async (c) => {
  await rateLimit(c.env, `forgot:${clientIp(c)}`, 5, 900_000);
  const body = parse(z.object({ email: emailSchema }), await c.req.json());
  const u = await first<{ id: number; email: string; status: string }>(c.env, 'SELECT id, email, status FROM users WHERE email = ?', body.email);
  if (u && u.status === 'active' && emailEnabled(c.env)) {
    const token = await createResetToken(c.env, u.id, null);
    const link = `${new URL(c.req.url).origin}/reset/${token}`;
    await sendEmail(c.env, u.email, 'Reset your NMSU Sports Forum password',
      `Someone asked to reset your NMSU Sports Forum password.\n\nReset it here (link expires in 1 hour):\n${link}\n\nIf this wasn't you, ignore this email.`);
  }
  // Same response either way so the endpoint can't be used to discover member emails.
  return c.json({ ok: true, emailEnabled: emailEnabled(c.env) });
});

auth.post('/reset', async (c) => {
  await rateLimit(c.env, `reset:${clientIp(c)}`, 10, 900_000);
  const body = parse(z.object({ token: z.string().min(10), password: passwordSchema }), await c.req.json());
  const hash = await sha256(body.token);
  const r = await first<{ user_id: number; expires_at: number; used_at: number | null }>(c.env, 'SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?', hash);
  if (!r || r.used_at || r.expires_at < now()) throw new HttpError(400, 'This reset link is invalid or expired.');
  await run(c.env, 'UPDATE password_resets SET used_at = ? WHERE token_hash = ?', now(), hash);
  await run(c.env, 'UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(body.password), r.user_id);
  await run(c.env, 'DELETE FROM sessions WHERE user_id = ?', r.user_id);
  await createSession(c, r.user_id);
  return c.json({ ok: true });
});

auth.post('/password', requireUser, async (c) => {
  const body = parse(z.object({ current: z.string(), password: passwordSchema }), await c.req.json());
  const user = c.get('user');
  const u = await first<{ password_hash: string }>(c.env, 'SELECT password_hash FROM users WHERE id = ?', user.id);
  if (!u || !(await verifyPassword(body.current, u.password_hash))) throw new HttpError(400, 'Current password is incorrect.');
  await run(c.env, 'UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(body.password), user.id);
  await run(c.env, 'DELETE FROM sessions WHERE user_id = ? AND id != ?', user.id, c.get('sessionId'));
  return c.json({ ok: true });
});

// Suspended or banned members can't sign in, so they appeal here with their credentials.
auth.post('/appeal', async (c) => {
  await rateLimit(c.env, `appeal:${clientIp(c)}`, 5, 3_600_000);
  const body = parse(z.object({ username: z.string().trim().min(1).max(200), password: z.string().min(1).max(200), message: z.string().trim().min(10, 'explain why (at least a sentence)').max(2000) }), await c.req.json());
  const u = await first<{ id: number; password_hash: string; status: string }>(c.env, 'SELECT id, password_hash, status FROM users WHERE username = ? OR email = ?', body.username, body.username);
  if (!u || !(await verifyPassword(body.password, u.password_hash))) throw new HttpError(401, 'Username or password is incorrect.');
  if (u.status !== 'suspended') throw new HttpError(400, 'Your account is active. Sign in to appeal from Settings → Moderation history.');
  const log = await first<{ id: number }>(c.env, "SELECT id FROM mod_log WHERE subject_user_id = ? AND action IN ('ban', 'suspend') ORDER BY id DESC LIMIT 1", u.id);
  if (!log) throw new HttpError(404, 'No suspension found to appeal.');
  await fileAppeal(c.env, u.id, log.id, body.message);
  return c.json({ ok: true });
});

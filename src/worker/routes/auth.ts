import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { clientIp, createSession, destroySession, rateLimit, requireUser } from '../auth';
import { first, logMod, run } from '../db';
import { emailEnabled, sendEmail } from '../email';
import { HttpError, DAY, hashPassword, now, parse, passwordSchema, randomToken, sha256, usernameSchema, verifyPassword } from '../util';

export const auth = new Hono<AppEnv>();

const emailSchema = z.string().trim().email('enter a valid email').max(200);

auth.get('/me', async (c) => {
  const user = c.get('user');
  const anyUser = await first<{ id: number }>(c.env, 'SELECT id FROM users LIMIT 1');
  return c.json({
    user: user ? { id: user.id, username: user.username, role: user.role, display_name: user.display_name, avatar_key: user.avatar_key, prefs: JSON.parse(user.prefs || '{}') } : null,
    setupNeeded: !anyUser,
    emailEnabled: emailEnabled(c.env),
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
  const r = await run(c.env, "INSERT INTO users (username, email, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)",
    body.username, body.email, await hashPassword(body.password), now());
  const id = r.meta.last_row_id;
  await logMod(c.env, id, 'setup_first_admin', 'user', id);
  await createSession(c, id);
  return c.json({ ok: true });
});

auth.get('/invite/:token', async (c) => {
  await rateLimit(c.env, `invitecheck:${clientIp(c)}`, 30, 900_000);
  const inv = await validInvite(c.env, c.req.param('token'));
  return c.json({ valid: Boolean(inv), email: inv?.email ?? null });
});

async function validInvite(env: AppEnv['Bindings'], token: string) {
  const inv = await first<{ id: number; email: string | null; uses: number; max_uses: number; expires_at: number; revoked: number }>(env,
    'SELECT id, email, uses, max_uses, expires_at, revoked FROM invites WHERE token_hash = ?', await sha256(token));
  if (!inv || inv.revoked || inv.uses >= inv.max_uses || inv.expires_at < now()) return null;
  return inv;
}

auth.post('/register', async (c) => {
  await rateLimit(c.env, `register:${clientIp(c)}`, 10, 900_000);
  const body = parse(z.object({
    token: z.string().min(10),
    username: usernameSchema,
    email: emailSchema,
    password: passwordSchema,
    display_name: z.string().trim().max(60).optional(),
  }), await c.req.json());
  const inv = await validInvite(c.env, body.token);
  if (!inv) throw new HttpError(400, 'This invitation is invalid, expired or already used. Ask an administrator for a new one.');
  if (inv.email && inv.email.toLowerCase() !== body.email.toLowerCase()) throw new HttpError(400, 'This invitation was issued for a different email address.');
  if (await first(c.env, 'SELECT id FROM users WHERE username = ?', body.username)) throw new HttpError(409, 'That username is taken.');
  if (await first(c.env, 'SELECT id FROM users WHERE email = ?', body.email)) throw new HttpError(409, 'An account already uses that email.');
  // Claim the invite atomically so it cannot be used twice concurrently.
  const claim = await run(c.env, 'UPDATE invites SET uses = uses + 1 WHERE id = ? AND uses < max_uses AND revoked = 0', inv.id);
  if (!claim.meta.changes) throw new HttpError(400, 'This invitation has already been used.');
  const t = now();
  const r = await run(c.env, 'INSERT INTO users (username, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
    body.username, body.email, await hashPassword(body.password), body.display_name || null, t);
  const id = r.meta.last_row_id;
  await run(c.env, 'INSERT INTO invite_uses (invite_id, user_id, used_at) VALUES (?, ?, ?)', inv.id, id, t);
  await createSession(c, id);
  return c.json({ ok: true });
});

auth.post('/login', async (c) => {
  const body = parse(z.object({ username: z.string().trim().min(1).max(200), password: z.string().min(1).max(200) }), await c.req.json());
  await rateLimit(c.env, `login-ip:${clientIp(c)}`, 20, 900_000);
  await rateLimit(c.env, `login-user:${body.username.toLowerCase()}`, 10, 900_000);
  const u = await first<{ id: number; password_hash: string; status: string }>(c.env,
    'SELECT id, password_hash, status FROM users WHERE username = ? OR email = ?', body.username, body.username);
  if (!u || !(await verifyPassword(body.password, u.password_hash))) throw new HttpError(401, 'Username or password is incorrect.');
  if (u.status !== 'active') throw new HttpError(403, 'This account is suspended. Contact an administrator.');
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
  const token = randomToken();
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

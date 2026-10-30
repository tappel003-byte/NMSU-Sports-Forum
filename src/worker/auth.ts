import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv, Ctx, Env, SessionUser } from './env';
import { first, run } from './db';
import { DAY, HttpError, now, randomToken, sha256 } from './util';

const SESSION_TTL = 30 * DAY;

function cookieName(c: Ctx): string {
  return new URL(c.req.url).protocol === 'https:' ? '__Host-nsf_session' : 'nsf_session';
}

export async function createSession(c: Ctx, userId: number): Promise<void> {
  const token = randomToken();
  const t = now();
  await run(c.env, 'INSERT INTO sessions (id, user_id, created_at, expires_at, last_used_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
    await sha256(token), userId, t, t + SESSION_TTL, t, (c.req.header('user-agent') ?? '').slice(0, 200));
  setCookie(c, cookieName(c), token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL / 1000,
  });
}

export async function destroySession(c: Ctx): Promise<void> {
  const token = getCookie(c, cookieName(c));
  if (token) await run(c.env, 'DELETE FROM sessions WHERE id = ?', await sha256(token));
  deleteCookie(c, cookieName(c), { path: '/', secure: new URL(c.req.url).protocol === 'https:' });
}

export async function userFromCookieHeader(env: Env, cookieHeader: string | null): Promise<SessionUser | null> {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)(?:__Host-)?nsf_session=([^;]+)/);
  if (!m) return null;
  return lookupSession(env, await sha256(decodeURIComponent(m[1])));
}

async function lookupSession(env: Env, sessionId: string): Promise<(SessionUser & { last_used_at: number }) | null> {
  const row = await first<SessionUser & { expires_at: number; last_used_at: number }>(env,
    `SELECT u.id, u.username, u.role, u.status, u.display_name, u.avatar_key, u.prefs, u.marked_read_at, u.created_at, u.trusted,
            s.expires_at, s.last_used_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`, sessionId);
  if (!row || row.expires_at < now() || row.status !== 'active') return null;
  return row;
}

/** Reinstates members whose timed suspension has ended. Returns true if the member is active. */
export async function liftExpiredSuspension(env: Env, userId: number): Promise<boolean> {
  const r = await run(env, "UPDATE users SET status = 'active', suspended_until = NULL WHERE id = ? AND status = 'suspended' AND deleted_at IS NULL AND suspended_until IS NOT NULL AND suspended_until <= ?", userId, now());
  return Boolean(r.meta.changes);
}

/** Loads the session user if present; never rejects. */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, cookieName(c));
  if (token) {
    const id = await sha256(token);
    const user = await lookupSession(c.env, id);
    if (user) {
      c.set('user', user);
      c.set('sessionId', id);
      const t = now();
      if (t - user.last_used_at > 3_600_000) {
        c.executionCtx.waitUntil(Promise.all([
          run(c.env, 'UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?', t, t + SESSION_TTL, id),
          run(c.env, 'UPDATE users SET last_seen_at = ? WHERE id = ?', t, user.id),
        ]));
      }
    }
  }
  await next();
};

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) throw new HttpError(401, 'Please sign in.');
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('user')?.role !== 'admin') throw new HttpError(403, 'Administrators only.');
  await next();
};

/** Counts an attempt for `key` and throws 429 once `max` attempts happen inside `windowMs`. */
export async function rateLimit(env: Env, key: string, max: number, windowMs: number): Promise<void> {
  const t = now();
  const r = await first<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND at > ?', key, t - windowMs);
  if ((r?.n ?? 0) >= max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
  await run(env, 'INSERT INTO login_attempts (key, at) VALUES (?, ?)', key, t);
}

export function clientIp(c: Ctx): string {
  return c.req.header('cf-connecting-ip') ?? 'local';
}

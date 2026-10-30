import type { Env } from './env';

type Bind = string | number | null;

export async function first<T>(env: Env, sql: string, ...params: Bind[]): Promise<T | null> {
  return (await env.DB.prepare(sql).bind(...params).first<T>()) ?? null;
}

export async function all<T>(env: Env, sql: string, ...params: Bind[]): Promise<T[]> {
  return (await env.DB.prepare(sql).bind(...params).all<T>()).results;
}

export async function run(env: Env, sql: string, ...params: Bind[]): Promise<D1Result> {
  return env.DB.prepare(sql).bind(...params).run();
}

export function stmt(env: Env, sql: string, ...params: Bind[]): D1PreparedStatement {
  return env.DB.prepare(sql).bind(...params);
}

export async function getSetting(env: Env, key: string): Promise<string> {
  const r = await first<{ value: string }>(env, 'SELECT value FROM settings WHERE key = ?', key);
  return r?.value ?? '';
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await run(env, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

export async function logMod(env: Env, actorId: number | null, action: string, targetType: string, targetId: number | null, detail = ''): Promise<void> {
  await run(env, 'INSERT INTO mod_log (actor_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)', actorId, action, targetType, targetId, detail, Date.now());
}

export async function notify(env: Env, userId: number, type: string, text: string, link: string, actorId: number | null = null): Promise<void> {
  await run(env, 'INSERT INTO notifications (user_id, type, actor_id, text, link, created_at) VALUES (?, ?, ?, ?, ?, ?)', userId, type, actorId, text, link, Date.now());
}

export function userPrefs(prefs: string): Record<string, unknown> {
  try {
    return JSON.parse(prefs) as Record<string, unknown>;
  } catch {
    return {};
  }
}

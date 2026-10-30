import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { all, first, run } from '../db';
import { HttpError, now, parse } from '../util';
import { SPORT_BY_KEY } from '../../shared/sports';
import { createPost } from '../lib/threads';
import { matchup, type GameRow } from '../lib/sports';
import { presentGame } from './games';

export const chat = new Hono<AppEnv>();

async function resolveRoom(env: Env, room: string): Promise<{ room: string; game: GameRow | null }> {
  if (room === 'lounge') return { room, game: null };
  const m = room.match(/^game-(\d+)$/);
  if (!m) throw new HttpError(404, 'Chat room not found.');
  const game = await first<GameRow>(env, 'SELECT * FROM games WHERE id = ?', Number(m[1]));
  if (!game) throw new HttpError(404, 'Chat room not found.');
  return { room, game };
}

chat.get('/chat/rooms', async (c) => {
  const t = now();
  // Game rooms are listed from the day before a game until a day after.
  const games = await all<GameRow>(c.env, "SELECT * FROM games WHERE removed = 0 AND status != 'canceled' AND starts_at BETWEEN ? AND ? ORDER BY starts_at", t - 86_400_000, t + 86_400_000);
  const activity = await all<{ room: string; n: number }>(c.env, 'SELECT room, COUNT(DISTINCT user_id) AS n FROM chat_messages WHERE created_at > ? GROUP BY room', t - 15 * 60_000);
  const act = new Map(activity.map((a) => [a.room, a.n]));
  return c.json({
    rooms: [
      { room: 'lounge', title: 'Aggie Lounge', subtitle: 'Always-open chat for every Aggie', active: act.get('lounge') ?? 0, game: null },
      ...games.map((g) => ({ room: `game-${g.id}`, title: matchup(g), subtitle: SPORT_BY_KEY[g.sport]?.label ?? '', active: act.get(`game-${g.id}`) ?? 0, game: presentGame(g) })),
    ],
  });
});

// Rolling live window: the most recent N messages (admin setting `chat_window`).
chat.get('/chat/:room/history', async (c) => {
  const { room, game } = await resolveRoom(c.env, c.req.param('room'));
  const windowSize = Number((await first<{ value: string }>(c.env, "SELECT value FROM settings WHERE key = 'chat_window'"))?.value) || 200;
  const before = Number(c.req.query('before')) || Number.MAX_SAFE_INTEGER;
  const rows = await all(c.env,
    `SELECT * FROM (SELECT m.id, m.user_id, m.body, m.created_at, u.username, u.display_name FROM chat_messages m JOIN users u ON u.id = m.user_id
       WHERE m.room = ? AND m.deleted = 0 AND m.id < ? ORDER BY m.id DESC LIMIT ?) ORDER BY id`, room, before, Math.min(windowSize, 500));
  return c.json({ room, game: game ? presentGame(game) : null, messages: rows });
});

// Permanent archive. Game rooms: the whole game. Lounge: one day at a time (Mountain Time).
chat.get('/chat/:room/archive', async (c) => {
  const { room, game } = await resolveRoom(c.env, c.req.param('room'));
  const after = Number(c.req.query('after')) || 0;
  let range: [number, number] = [0, Number.MAX_SAFE_INTEGER];
  if (room === 'lounge') {
    const day = c.req.query('day') ?? new Date().toISOString().slice(0, 10);
    const start = Date.parse(`${day}T07:00:00Z`);
    if (Number.isNaN(start)) throw new HttpError(400, 'Invalid day.');
    range = [start, start + 86_400_000];
  }
  const rows = await all(c.env,
    `SELECT m.id, m.user_id, m.body, m.created_at, u.username, u.display_name FROM chat_messages m JOIN users u ON u.id = m.user_id
      WHERE m.room = ? AND m.deleted = 0 AND m.id > ? AND m.created_at >= ? AND m.created_at < ? ORDER BY m.id LIMIT 1000`, room, after, range[0], range[1]);
  return c.json({ room, game: game ? presentGame(game) : null, messages: rows, hasMore: rows.length === 1000 });
});

chat.get('/chat/:room/ws', async (c) => {
  const { room } = await resolveRoom(c.env, c.req.param('room'));
  if (c.req.header('Upgrade') !== 'websocket') throw new HttpError(426, 'Expected a WebSocket.');
  const user = c.get('user');
  const stub = c.env.CHAT.get(c.env.CHAT.idFromName(room));
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-member', JSON.stringify({ id: user.id, username: user.username, display_name: user.display_name, role: user.role }));
  return stub.fetch(`https://chat/ws?room=${encodeURIComponent(room)}`, { headers });
});

chat.delete('/chat/messages/:id', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') throw new HttpError(403, 'Administrators only.');
  const m = await first<{ id: number; room: string }>(c.env, 'SELECT id, room FROM chat_messages WHERE id = ?', Number(c.req.param('id')));
  if (!m) throw new HttpError(404, 'Message not found.');
  await run(c.env, 'UPDATE chat_messages SET deleted = 1, deleted_by = ? WHERE id = ?', user.id, m.id);
  await run(c.env, 'INSERT INTO mod_log (actor_id, action, target_type, target_id, created_at) VALUES (?, ?, ?, ?, ?)', user.id, 'remove_chat', 'chat_message', m.id, now());
  const stub = c.env.CHAT.get(c.env.CHAT.idFromName(m.room));
  await stub.fetch('https://chat/broadcast', { method: 'POST', body: JSON.stringify({ type: 'deleted', id: m.id }) });
  return c.json({ ok: true });
});

chat.post('/chat/report', async (c) => {
  const user = c.get('user');
  const body = parse(z.object({ message_id: z.number().int(), reason: z.string().trim().min(3).max(500) }), await c.req.json());
  const m = await first<{ id: number; body: string; username: string }>(c.env, 'SELECT m.id, m.body, u.username FROM chat_messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?', body.message_id);
  if (!m) throw new HttpError(404, 'Message not found.');
  await run(c.env, 'INSERT INTO reports (reporter_id, chat_message_id, snapshot, reason, created_at) VALUES (?, ?, ?, ?, ?)', user.id, m.id, `Chat from ${m.username}: ${m.body}`, body.reason, now());
  return c.json({ ok: true });
});

// Turn a chat moment into a permanent discussion thread.
chat.post('/chat/to-thread', async (c) => {
  const user = c.get('user');
  const body = parse(z.object({
    room: z.string(),
    message_ids: z.array(z.number().int()).min(1).max(50),
    title: z.string().trim().min(4).max(140),
    comment: z.string().trim().max(5000).optional(),
  }), await c.req.json());
  const { room, game } = await resolveRoom(c.env, body.room);
  const msgs = await all<{ id: number; body: string; created_at: number; username: string }>(c.env,
    `SELECT m.id, m.body, m.created_at, u.username FROM chat_messages m JOIN users u ON u.id = m.user_id
      WHERE m.room = ? AND m.deleted = 0 AND m.id IN (${body.message_ids.map(() => '?').join(',')}) ORDER BY m.id`, room, ...body.message_ids);
  if (!msgs.length) throw new HttpError(400, 'Select at least one message.');
  const forumSlug = game ? SPORT_BY_KEY[game.sport]?.forum ?? 'general' : 'general';
  const f = await first<{ id: number }>(c.env, 'SELECT id FROM forums WHERE slug = ?', forumSlug);
  const quoted = msgs.map((m) => `> **${m.username}** (${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' }).format(new Date(m.created_at))}): ${m.body}`).join('\n');
  const text = `From the ${game ? `${matchup(game)} game chat` : 'Aggie Lounge'}:\n\n${quoted}${body.comment ? `\n\n${body.comment}` : ''}`;
  const t = now();
  const r = await run(c.env, 'INSERT INTO threads (forum_id, user_id, title, description, sport, created_at, last_post_at, game_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    f!.id, user.id, body.title, game ? 'Saved from the game chat' : 'Saved from the Aggie Lounge', game?.sport ?? null, t, t, game?.id ?? null);
  const threadId = r.meta.last_row_id;
  await createPost(c.env, user, { id: threadId, title: body.title, user_id: user.id }, text, { isFirst: true });
  return c.json({ id: threadId });
});

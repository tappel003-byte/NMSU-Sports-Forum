import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { all, first, getSetting, notify, run, userPrefs } from '../db';
import { DAY, HttpError, excerpt, now, parse } from '../util';
import { FEATURED_SQL, SPORT_BY_KEY } from '../../shared/sports';
import { memberSummaries } from '../lib/members';
import { THREAD_SELECT, presentThreads, unreadBaseline, type ThreadRow } from '../lib/threads';
import { presentGame } from './games';
import type { GameRow } from '../lib/sports';
import { putObject, getObject, deleteObject } from '../storage';
import { getPreview } from '../lib/previews';
import { pushEnabled } from '../lib/push';
import { notifyModerators } from '../lib/moderation';
import { destroySession, rateLimit } from '../auth';
import { createInvite, memberInvitesOn } from '../lib/invites';
import { hashPassword, randomToken, verifyPassword } from '../util';

export const community = new Hono<AppEnv>();

const num = (v: string | undefined) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid id.');
  return n;
};

// ---------- Home ----------

community.get('/home', async (c) => {
  const user = c.get('user');
  const t = now();
  const weekAgo = t - 7 * DAY;
  const [games, otherGames, live, weekly, online, chatting, events, announcement, birthdays, replies] = await Promise.all([
    // Football and men's basketball lead; other sports are listed separately so they don't crowd the page.
    all<GameRow>(c.env, `SELECT * FROM games WHERE removed = 0 AND status != 'canceled' AND starts_at > ? AND sport IN ${FEATURED_SQL} ORDER BY starts_at LIMIT 4`, t - 4 * 3_600_000),
    all<GameRow>(c.env, `SELECT * FROM games WHERE removed = 0 AND status != 'canceled' AND starts_at > ? AND sport NOT IN ${FEATURED_SQL} ORDER BY starts_at LIMIT 3`, t - 4 * 3_600_000),
    all<GameRow>(c.env, "SELECT * FROM games WHERE removed = 0 AND status = 'scheduled' AND time_tba = 0 AND starts_at <= ? AND starts_at > ?", t, t - 4 * 3_600_000),
    // Most appreciated this week: thumbs-up received during the last 7 days.
    first<{ id: number; thread_id: number; body: string; user_id: number; up: number; title: string }>(c.env,
      `SELECT p.id, p.thread_id, p.body, p.user_id, COUNT(*) AS up, t.title FROM reactions r JOIN posts p ON p.id = r.post_id JOIN threads t ON t.id = p.thread_id
        WHERE r.value = 1 AND r.created_at > ? AND p.deleted = 0 AND t.deleted = 0 AND p.user_id IS NOT NULL
        GROUP BY p.id ORDER BY up DESC, MAX(r.created_at) DESC LIMIT 1`, weekAgo),
    all<{ id: number; username: string; display_name: string | null; avatar_key: string | null }>(c.env,
      "SELECT id, username, display_name, avatar_key FROM users WHERE status = 'active' AND last_seen_at > ? ORDER BY last_seen_at DESC LIMIT 12", t - 15 * 60_000),
    first<{ n: number }>(c.env, 'SELECT COUNT(DISTINCT user_id) AS n FROM chat_messages WHERE created_at > ?', t - 15 * 60_000),
    all(c.env, 'SELECT id, title, kind, location, starts_at FROM events WHERE deleted = 0 AND starts_at > ? ORDER BY starts_at LIMIT 3', t),
    getSetting(c.env, 'announcement'),
    all<{ id: number; username: string }>(c.env, "SELECT id, username FROM users WHERE status = 'active' AND show_birthday = 1 AND birthday_md = ?",
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', month: '2-digit', day: '2-digit' }).format(new Date(t))),
    first<{ n: number }>(c.env, "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL AND type IN ('reply', 'quote', 'mention')", user.id),
  ]);
  const unread = await first<{ n: number }>(c.env,
    `SELECT COUNT(*) AS n FROM threads t LEFT JOIN thread_reads tr ON tr.thread_id = t.id AND tr.user_id = ?
      WHERE t.deleted = 0 AND t.pending = 0 AND t.last_post_at > ? AND (tr.last_read_post_id IS NULL OR tr.last_read_post_id < t.last_post_id)`, user.id, unreadBaseline(user));
  const followed = await all<ThreadRow>(c.env,
    `${THREAD_SELECT} WHERE t.deleted = 0 AND t.id IN (SELECT thread_id FROM follows WHERE user_id = ?) ORDER BY t.last_post_at DESC LIMIT 5`, user.id, user.id);
  // "Called it!": members who picked a game right in the last week (exact scores first). Replaces a standings page.
  const called = await all<{ user_id: number; game_id: number; points: number; sport: string; opponent: string; home_away: string; result: string | null; nmsu_score: number | null; opp_score: number | null }>(c.env,
    `SELECT p.user_id, p.game_id, p.points, g.sport, g.opponent, g.home_away, g.result, g.nmsu_score, g.opp_score
       FROM predictions p JOIN games g ON g.id = p.game_id
      WHERE p.points > 0 AND g.status = 'final' AND g.starts_at > ? ORDER BY p.points DESC, g.starts_at DESC LIMIT 6`, weekAgo);
  const members = await memberSummaries(c.env, [...(weekly ? [weekly.user_id] : []), ...called.map((x) => x.user_id)]);
  const feeds = await first<{ n: number }>(c.env, 'SELECT COUNT(*) AS n FROM data_feeds WHERE enabled = 1');
  const guest = user.role === 'guest';
  return c.json({
    guest,
    games: games.map(presentGame),
    other_games: otherGames.map(presentGame),
    live: live.map(presentGame),
    feedsConfigured: (feeds?.n ?? 0) > 0,
    stats: { unread: unread?.n ?? 0, replies: replies?.n ?? 0, chatting: chatting?.n ?? 0 },
    weekly: weekly ? { ...weekly, body: excerpt(weekly.body, 180), author: members.get(weekly.user_id) ?? null } : null,
    called: called.map((x) => ({ ...x, exact: x.points >= 3, member: members.get(x.user_id) ?? null })),
    online: guest ? [] : online,
    events: guest ? [] : events,
    announcement,
    birthdays: guest ? [] : birthdays,
    followed: await presentThreads(c.env, user, followed),
  });
});

// ---------- Members ----------

community.get('/members', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const like = `%${q}%`;
  const rows = await all<{ id: number; city: string | null; state: string | null; legacy_moniker: string | null; created_at: number; last_seen_at: number | null }>(c.env,
    `SELECT id, city, state, legacy_moniker, created_at, last_seen_at FROM users WHERE status = 'active'
       AND (? = '' OR username LIKE ? OR display_name LIKE ? OR legacy_moniker LIKE ? OR city LIKE ?) ORDER BY username COLLATE NOCASE LIMIT 500`, q, like, like, like, like);
  const members = await memberSummaries(c.env, rows.map((r) => r.id));
  return c.json({ members: rows.map((r) => ({ ...members.get(r.id), city: r.city, state: r.state, legacy_moniker: r.legacy_moniker, joined: r.created_at, last_seen_at: r.last_seen_at })) });
});

// ---------- @mention autocomplete ----------

community.get('/members/suggest', async (c) => {
  const q = (c.req.query('q') ?? '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 24);
  const rows = await all(c.env,
    `SELECT id, username, display_name, avatar_key FROM users WHERE status = 'active' AND deleted_at IS NULL
       AND (username LIKE ? OR display_name LIKE ?) ORDER BY last_seen_at DESC LIMIT 6`, `${q}%`, `${q}%`);
  return c.json({ members: rows });
});

community.get('/members/by-name/:username', async (c) => {
  const u = await first<{ id: number }>(c.env, "SELECT id FROM users WHERE username = ? AND status = 'active'", c.req.param('username'));
  if (!u) throw new HttpError(404, 'Member not found.');
  return c.json({ id: u.id });
});

community.get('/members/:id', async (c) => {
  const me = c.get('user');
  const id = num(c.req.param('id'));
  const u = await first<Record<string, unknown> & { id: number; email: string; show_email: number; featured_post_id: number | null; birthday_md: string | null; show_birthday: number; status: string }>(c.env,
    `SELECT id, email, bio, grad_year, city, state, interests, legacy_moniker, legacy_join_year, legacy_post_count, legacy_upvotes, show_email, show_on_map,
            featured_post_id, birthday_md, show_birthday, created_at, last_seen_at, status FROM users WHERE id = ?`, id);
  if (!u || (u.status !== 'active' && me.role !== 'admin')) throw new HttpError(404, 'Member not found.');
  const summary = (await memberSummaries(c.env, [id])).get(id);
  const postSelect = `SELECT p.id, p.thread_id, p.body, p.created_at, t.title,
      (SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id AND r.value = 1) AS up
      FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.deleted = 0 AND t.deleted = 0`;
  const [mostAppreciated, featured, recent, muted, prediction] = await Promise.all([
    first<{ id: number; body: string; up: number }>(c.env, `${postSelect} AND p.user_id = ? ORDER BY up DESC, p.id DESC LIMIT 1`, id),
    u.featured_post_id ? first<{ id: number; body: string }>(c.env, `${postSelect} AND p.id = ? AND p.user_id = ?`, u.featured_post_id, id) : Promise.resolve(null),
    all<ThreadRow>(c.env, `${THREAD_SELECT} WHERE t.deleted = 0 AND t.user_id = ? ORDER BY t.created_at DESC LIMIT 8`, me.id, id),
    first(c.env, "SELECT 1 AS m FROM mutes WHERE user_id = ? AND target_type = 'user' AND target_id = ?", me.id, id),
    first<{ called: number }>(c.env, 'SELECT COUNT(*) AS called FROM predictions WHERE user_id = ? AND points > 0', id),
  ]);
  const trim = <T extends { body: string } | null>(p: T) => (p ? { ...p, body: excerpt(p.body, 240) } : null);
  return c.json({
    member: {
      ...summary,
      bio: u.bio, grad_year: u.grad_year, city: u.city, state: u.state, interests: u.interests,
      legacy_moniker: u.legacy_moniker, legacy_join_year: u.legacy_join_year, legacy_post_count: u.legacy_post_count, legacy_upvotes: u.legacy_upvotes,
      email: u.show_email || id === me.id ? u.email : null,
      birthday: u.show_birthday || id === me.id ? u.birthday_md : null,
      joined: u.created_at, last_seen_at: u.last_seen_at, status: u.status,
      games_called: prediction?.called ?? 0,
    },
    most_appreciated: mostAppreciated && mostAppreciated.up > 0 ? trim(mostAppreciated) : null,
    featured: trim(featured),
    recent_threads: await presentThreads(c.env, me, recent),
    muted: Boolean(muted),
    is_me: id === me.id,
  });
});

community.get('/members/:id/posts', async (c) => {
  const id = num(c.req.param('id'));
  const rows = await all(c.env,
    `SELECT p.id, p.thread_id, p.body, p.created_at, t.title,
       (SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id AND r.value = 1) AS up
     FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.user_id = ? AND p.deleted = 0 AND t.deleted = 0 ORDER BY p.id DESC LIMIT 50`, id);
  return c.json({ posts: rows });
});

community.get('/me', async (c) => {
  const u = await first<Record<string, unknown> & { prefs: string }>(c.env,
    `SELECT id, username, email, role, display_name, bio, avatar_key, grad_year, city, state, interests, legacy_moniker, legacy_join_year,
            legacy_post_count, legacy_upvotes, show_email, show_on_map, birthday_md, show_birthday, featured_post_id, prefs FROM users WHERE id = ?`, c.get('user').id);
  return c.json({ me: { ...u, prefs: userPrefs(u?.prefs ?? '{}') } });
});

const optStr = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const optInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable().optional().transform((v) => v ?? null);

community.patch('/me/profile', async (c) => {
  const user = c.get('user');
  const body = parse(z.object({
    display_name: optStr(60), bio: optStr(1000), grad_year: optInt(1930, 2040), city: optStr(80), state: optStr(40), interests: optStr(300),
    legacy_moniker: optStr(60), legacy_join_year: optInt(1990, 2030), legacy_post_count: optInt(0, 10_000_000), legacy_upvotes: optInt(0, 10_000_000),
    show_email: z.boolean(), show_on_map: z.boolean(),
    birthday_md: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'use MM-DD').nullable().optional().or(z.literal('')).transform((v) => v || null),
    show_birthday: z.boolean(),
  }), await c.req.json());
  const prev = await first<{ city: string | null; state: string | null; map_lat: number | null }>(c.env, 'SELECT city, state, map_lat FROM users WHERE id = ?', user.id);
  await run(c.env, `UPDATE users SET display_name = ?, bio = ?, grad_year = ?, city = ?, state = ?, interests = ?, legacy_moniker = ?, legacy_join_year = ?,
                    legacy_post_count = ?, legacy_upvotes = ?, show_email = ?, show_on_map = ?, birthday_md = ?, show_birthday = ? WHERE id = ?`,
    body.display_name, body.bio, body.grad_year, body.city, body.state, body.interests, body.legacy_moniker, body.legacy_join_year,
    body.legacy_post_count, body.legacy_upvotes ?? null, body.show_email ? 1 : 0, body.show_on_map ? 1 : 0, body.birthday_md, body.show_birthday ? 1 : 0, user.id);
  let mapNote: string | null = null;
  if (body.show_on_map && body.city && body.state && (prev?.city !== body.city || prev?.state !== body.state || prev?.map_lat === null)) {
    const coords = await geocodeCity(body.city, body.state);
    if (coords) await run(c.env, 'UPDATE users SET map_lat = ?, map_lon = ? WHERE id = ?', coords[0], coords[1], user.id);
    else mapNote = "We couldn't place that city on the map. Check the spelling of the city and state.";
  }
  if (!body.city || !body.state) await run(c.env, 'UPDATE users SET map_lat = NULL, map_lon = NULL WHERE id = ?', user.id);
  return c.json({ ok: true, mapNote });
});

/** City-level geocoding (OpenStreetMap Nominatim), rounded to ~10 km so pins never reveal precise locations. */
async function geocodeCity(city: string, state: string): Promise<[number, number] | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us,mx&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'NMSUSportsForum/1.0 (+https://nmsusportsforum.com)' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { lat: string; lon: string }[];
    if (!data[0]) return null;
    return [Math.round(Number(data[0].lat) * 10) / 10, Math.round(Number(data[0].lon) * 10) / 10];
  } catch {
    return null;
  }
}

community.patch('/me/prefs', async (c) => {
  const user = c.get('user');
  const body = parse(z.object({
    notify_replies: z.boolean().optional(), notify_mentions: z.boolean().optional(), notify_quotes: z.boolean().optional(),
    notify_games: z.boolean().optional(), notify_dm: z.boolean().optional(), auto_follow: z.boolean().optional(),
    spoiler_free: z.boolean().optional(), large_text: z.boolean().optional(), digest: z.boolean().optional(),
    compact: z.boolean().optional(), push: z.boolean().optional(), theme: z.enum(['system', 'light', 'dark']).optional(),
    my_sports: z.array(z.string()).max(20).optional(),
  }), await c.req.json());
  if (body.my_sports) body.my_sports = body.my_sports.filter((s) => s in SPORT_BY_KEY);
  const prefs = { ...userPrefs(user.prefs), ...body };
  await run(c.env, 'UPDATE users SET prefs = ? WHERE id = ?', JSON.stringify(prefs), user.id);
  return c.json({ prefs });
});

community.post('/me/featured', async (c) => {
  const user = c.get('user');
  const { post_id } = parse(z.object({ post_id: z.number().int().nullable() }), await c.req.json());
  if (post_id && !(await first(c.env, 'SELECT id FROM posts WHERE id = ? AND user_id = ? AND deleted = 0', post_id, user.id))) throw new HttpError(400, 'You can only highlight your own posts.');
  await run(c.env, 'UPDATE users SET featured_post_id = ? WHERE id = ?', post_id, user.id);
  return c.json({ ok: true });
});

community.get('/map', async (c) => {
  const rows = await all<{ id: number; username: string; display_name: string | null; city: string; state: string; map_lat: number; map_lon: number }>(c.env,
    "SELECT id, username, display_name, city, state, map_lat, map_lon FROM users WHERE status = 'active' AND show_on_map = 1 AND map_lat IS NOT NULL");
  return c.json({ pins: rows });
});

community.get('/contributions', async (c) => {
  const rows = await all(c.env,
    `SELECT b.id, b.badge, b.reason, b.awarded_at, u.id AS user_id, u.username, u.display_name, a.username AS awarded_by
       FROM badges b JOIN users u ON u.id = b.user_id LEFT JOIN users a ON a.id = b.awarded_by WHERE b.revoked = 0 ORDER BY b.awarded_at DESC`);
  return c.json({ contributions: rows });
});

// ---------- Uploads ----------

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

community.post('/uploads', async (c) => {
  const user = c.get('user');
  const form = await c.req.formData();
  const file = form.get('file');
  const kind = form.get('kind') === 'avatar' ? 'avatar' : 'post';
  if (!(file instanceof File)) throw new HttpError(400, 'No file uploaded.');
  if (!IMAGE_TYPES.has(file.type)) throw new HttpError(400, 'Only JPEG, PNG, WebP or GIF images are allowed.');
  const max = c.env.UPLOADS ? 8_000_000 : 1_900_000;
  if (file.size > max) throw new HttpError(400, `Images must be under ${Math.round(max / 1_000_000)} MB.`);
  const t = now();
  const recent = await first<{ n: number }>(c.env, 'SELECT COUNT(*) AS n FROM attachments WHERE user_id = ? AND created_at > ?', user.id, t - 3_600_000);
  if ((recent?.n ?? 0) > 60) throw new HttpError(429, 'Upload limit reached. Try again later.');
  const id = crypto.randomUUID().replace(/-/g, '');
  await putObject(c.env, `${kind}/${id}`, await file.arrayBuffer(), file.type);
  // Discussion photos expire 90 days after upload; avatars do not.
  await run(c.env, 'INSERT INTO attachments (id, user_id, kind, content_type, size, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, user.id, kind, file.type, file.size, t, kind === 'post' ? t + 90 * DAY : null);
  if (kind === 'avatar') await run(c.env, 'UPDATE users SET avatar_key = ? WHERE id = ?', id, user.id);
  return c.json({ id, content_type: file.type });
});

community.get('/files/:id', async (c) => {
  const a = await first<{ id: string; kind: string; deleted: number }>(c.env, 'SELECT id, kind, deleted FROM attachments WHERE id = ?', c.req.param('id'));
  if (!a || a.deleted) throw new HttpError(404, 'This photo has expired or was removed.');
  const obj = await getObject(c.env, `${a.kind}/${a.id}`);
  if (!obj) throw new HttpError(404, 'This photo has expired or was removed.');
  return new Response(obj.body, { headers: { 'Content-Type': obj.contentType, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
});

// ---------- Private messages (strictly private: no admin access path exists) ----------

async function blockedBetween(env: AppEnv['Bindings'], a: number, b: number): Promise<boolean> {
  return Boolean(await first(env, "SELECT 1 FROM mutes WHERE target_type = 'user' AND ((user_id = ? AND target_id = ?) OR (user_id = ? AND target_id = ?))", a, b, b, a));
}

community.get('/messages', async (c) => {
  const me = c.get('user').id;
  const convs = await all<{ id: number; user_a: number; user_b: number; last_message_at: number }>(c.env,
    'SELECT id, user_a, user_b, last_message_at FROM dm_conversations WHERE user_a = ? OR user_b = ? ORDER BY last_message_at DESC', me, me);
  const others = convs.map((cv) => (cv.user_a === me ? cv.user_b : cv.user_a));
  const members = await memberSummaries(c.env, others);
  const out = [];
  for (const cv of convs) {
    const last = await first<{ body: string; sender_id: number }>(c.env, 'SELECT body, sender_id FROM dm_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1', cv.id);
    const unread = await first<{ n: number }>(c.env,
      'SELECT COUNT(*) AS n FROM dm_messages WHERE conversation_id = ? AND sender_id != ? AND id > COALESCE((SELECT last_read_id FROM dm_reads WHERE conversation_id = ? AND user_id = ?), 0)',
      cv.id, me, cv.id, me);
    const other = members.get(cv.user_a === me ? cv.user_b : cv.user_a);
    out.push({ id: cv.id, other, last_message_at: cv.last_message_at, last: last ? { body: excerpt(last.body, 80), mine: last.sender_id === me } : null, unread: unread?.n ?? 0 });
  }
  return c.json({ conversations: out });
});

community.get('/messages/:userId', async (c) => {
  const me = c.get('user').id;
  const other = num(c.req.param('userId'));
  const otherSummary = (await memberSummaries(c.env, [other])).get(other);
  if (!otherSummary) throw new HttpError(404, 'Member not found.');
  const [a, b] = me < other ? [me, other] : [other, me];
  const cv = await first<{ id: number }>(c.env, 'SELECT id FROM dm_conversations WHERE user_a = ? AND user_b = ?', a, b);
  const messages = cv ? await all<{ id: number; sender_id: number; body: string; created_at: number }>(c.env,
    'SELECT id, sender_id, body, created_at FROM (SELECT * FROM dm_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 300) ORDER BY id', cv.id) : [];
  if (cv && messages.length) {
    await run(c.env, `INSERT INTO dm_reads (conversation_id, user_id, last_read_id) VALUES (?, ?, ?)
                      ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_read_id = excluded.last_read_id`, cv.id, me, messages[messages.length - 1].id);
  }
  return c.json({ other: otherSummary, messages, blocked: await blockedBetween(c.env, me, other) });
});

community.post('/messages/:userId', async (c) => {
  const user = c.get('user');
  const other = num(c.req.param('userId'));
  if (other === user.id) throw new HttpError(400, "You can't message yourself.");
  const target = await first<{ id: number; status: string; prefs: string }>(c.env, 'SELECT id, status, prefs FROM users WHERE id = ?', other);
  if (!target || target.status !== 'active') throw new HttpError(404, 'Member not found.');
  if (await blockedBetween(c.env, user.id, other)) throw new HttpError(403, "You can't message this member.");
  const { body } = parse(z.object({ body: z.string().trim().min(1).max(5000) }), await c.req.json());
  const t = now();
  const recent = await first<{ n: number }>(c.env, 'SELECT COUNT(*) AS n FROM dm_messages WHERE sender_id = ? AND created_at > ?', user.id, t - 60_000);
  if ((recent?.n ?? 0) >= 20) throw new HttpError(429, 'Slow down a little.');
  const [a, b] = user.id < other ? [user.id, other] : [other, user.id];
  await run(c.env, 'INSERT INTO dm_conversations (user_a, user_b, created_at, last_message_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_a, user_b) DO UPDATE SET last_message_at = excluded.last_message_at', a, b, t, t);
  const cv = await first<{ id: number }>(c.env, 'SELECT id FROM dm_conversations WHERE user_a = ? AND user_b = ?', a, b);
  const r = await run(c.env, 'INSERT INTO dm_messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)', cv!.id, user.id, body, t);
  await run(c.env, `INSERT INTO dm_reads (conversation_id, user_id, last_read_id) VALUES (?, ?, ?)
                    ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_read_id = excluded.last_read_id`, cv!.id, user.id, r.meta.last_row_id);
  // The notification names the sender only; message text never leaves the conversation.
  if (userPrefs(target.prefs).notify_dm !== false) {
    const unreadNote = await first(c.env, "SELECT id FROM notifications WHERE user_id = ? AND type = 'dm' AND actor_id = ? AND read_at IS NULL", other, user.id);
    if (!unreadNote) await notify(c.env, other, 'dm', `New private message from ${user.display_name || user.username}`, `/messages/${user.id}`, user.id);
  }
  return c.json({ id: r.meta.last_row_id });
});

// Only a participant can report a message, and doing so voluntarily shares that one message with admins.
community.post('/messages/report', async (c) => {
  const user = c.get('user');
  const body = parse(z.object({ message_id: z.number().int(), reason: z.string().trim().min(3).max(500) }), await c.req.json());
  const m = await first<{ id: number; body: string; sender_id: number; user_a: number; user_b: number }>(c.env,
    'SELECT m.id, m.body, m.sender_id, cv.user_a, cv.user_b FROM dm_messages m JOIN dm_conversations cv ON cv.id = m.conversation_id WHERE m.id = ?', body.message_id);
  if (!m || (m.user_a !== user.id && m.user_b !== user.id) || m.sender_id === user.id) throw new HttpError(404, 'Message not found.');
  const sender = await first<{ username: string }>(c.env, 'SELECT username FROM users WHERE id = ?', m.sender_id);
  await run(c.env, 'INSERT INTO reports (reporter_id, dm_message_id, snapshot, reason, created_at) VALUES (?, ?, ?, ?, ?)',
    user.id, m.id, `Private message from ${sender?.username ?? 'member'}: ${m.body.slice(0, 2000)}`, body.reason, now());
  return c.json({ ok: true });
});

// ---------- Community calendar ----------

community.get('/calendar', async (c) => {
  const from = Number(c.req.query('from')) || now() - 7 * DAY;
  const to = Math.min(Number(c.req.query('to')) || from + 45 * DAY, from + 120 * DAY);
  const [gameRows, events, birthdays] = await Promise.all([
    all<GameRow>(c.env, 'SELECT * FROM games WHERE removed = 0 AND starts_at BETWEEN ? AND ? ORDER BY starts_at', from, to),
    all<{ id: number; user_id: number; kind: string; title: string; description: string; location: string; starts_at: number; game_id: number | null; going: number }>(c.env,
      `SELECT e.*, (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS going
         FROM events e WHERE e.deleted = 0 AND e.starts_at BETWEEN ? AND ? ORDER BY e.starts_at`, from, to),
    all<{ id: number; username: string; birthday_md: string }>(c.env, "SELECT id, username, birthday_md FROM users WHERE status = 'active' AND show_birthday = 1 AND birthday_md IS NOT NULL"),
  ]);
  const hosts = await memberSummaries(c.env, events.map((e) => e.user_id));
  return c.json({
    games: gameRows.map(presentGame),
    events: events.map((e) => ({ ...e, host: hosts.get(e.user_id)?.username ?? 'member' })),
    birthdays,
  });
});

community.post('/events', async (c) => {
  const user = c.get('user');
  const body = parse(z.object({
    kind: z.enum(['watch_party', 'gathering', 'meetup', 'other']),
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(2000).default(''),
    location: z.string().trim().max(200).default(''),
    starts_at: z.number().int(),
    game_id: z.number().int().nullable().optional(),
  }), await c.req.json());
  if (body.starts_at < now() - DAY) throw new HttpError(400, 'Pick a date in the future.');
  const r = await run(c.env, 'INSERT INTO events (user_id, kind, title, description, location, starts_at, game_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    user.id, body.kind, body.title, body.description, body.location, body.starts_at, body.game_id ?? null, now());
  await run(c.env, "INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, 'going')", r.meta.last_row_id, user.id);
  return c.json({ id: r.meta.last_row_id });
});

community.get('/events/:id', async (c) => {
  const e = await first<{ id: number; user_id: number; game_id: number | null } & Record<string, unknown>>(c.env, 'SELECT * FROM events WHERE id = ? AND deleted = 0', num(c.req.param('id')));
  if (!e) throw new HttpError(404, 'Event not found.');
  const rsvps = await all<{ user_id: number; status: string }>(c.env, 'SELECT user_id, status FROM event_rsvps WHERE event_id = ?', e.id);
  const members = await memberSummaries(c.env, [e.user_id, ...rsvps.map((r) => r.user_id)]);
  const game = e.game_id ? await first<GameRow>(c.env, 'SELECT * FROM games WHERE id = ?', e.game_id) : null;
  return c.json({
    event: { ...e, host: members.get(e.user_id) ?? null, game: game ? presentGame(game) : null },
    rsvps: rsvps.map((r) => ({ status: r.status, member: members.get(r.user_id) ?? null })),
    my_rsvp: rsvps.find((r) => r.user_id === c.get('user').id)?.status ?? null,
  });
});

community.post('/events/:id/rsvp', async (c) => {
  const user = c.get('user');
  const id = num(c.req.param('id'));
  if (!(await first(c.env, 'SELECT id FROM events WHERE id = ? AND deleted = 0', id))) throw new HttpError(404, 'Event not found.');
  const { status } = parse(z.object({ status: z.enum(['going', 'maybe']).nullable() }), await c.req.json());
  if (!status) await run(c.env, 'DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?', id, user.id);
  else await run(c.env, 'INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, ?) ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status', id, user.id, status);
  return c.json({ ok: true });
});

community.delete('/events/:id', async (c) => {
  const user = c.get('user');
  const e = await first<{ user_id: number }>(c.env, 'SELECT user_id FROM events WHERE id = ?', num(c.req.param('id')));
  if (!e) throw new HttpError(404, 'Event not found.');
  if (e.user_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'Only the host or an admin can cancel this event.');
  await run(c.env, 'UPDATE events SET deleted = 1 WHERE id = ?', num(c.req.param('id')));
  return c.json({ ok: true });
});

// ---------- Year in Review ----------

community.get('/year-in-review', async (c) => {
  const year = Number(c.req.query('year')) || new Date().getUTCFullYear();
  const a = Date.UTC(year, 0, 1);
  const b = Date.UTC(year + 1, 0, 1);
  const [topPosts, topThreads, activeMembers, recognitions, chattiestGames, predictionChamp, totals] = await Promise.all([
    all<{ id: number; thread_id: number; body: string; user_id: number; title: string; up: number }>(c.env,
      `SELECT p.id, p.thread_id, p.body, p.user_id, t.title, COUNT(*) AS up FROM reactions r JOIN posts p ON p.id = r.post_id JOIN threads t ON t.id = p.thread_id
        WHERE r.value = 1 AND p.created_at >= ? AND p.created_at < ? AND p.deleted = 0 AND t.deleted = 0 GROUP BY p.id ORDER BY up DESC LIMIT 10`, a, b),
    all<ThreadRow>(c.env, `${THREAD_SELECT} WHERE t.deleted = 0 AND t.created_at >= ? AND t.created_at < ? ORDER BY t.reply_count DESC LIMIT 10`, c.get('user').id, a, b),
    all<{ user_id: number; n: number }>(c.env, 'SELECT user_id, COUNT(*) AS n FROM posts WHERE deleted = 0 AND user_id IS NOT NULL AND created_at >= ? AND created_at < ? GROUP BY user_id ORDER BY n DESC LIMIT 10', a, b),
    all(c.env, `SELECT b.badge, b.reason, b.awarded_at, u.id AS user_id, u.username FROM badges b JOIN users u ON u.id = b.user_id
                 WHERE b.revoked = 0 AND b.awarded_at >= ? AND b.awarded_at < ? ORDER BY b.awarded_at`, a, b),
    all<GameRow & { chats: number }>(c.env,
      `SELECT g.*, COUNT(m.id) AS chats FROM games g JOIN chat_messages m ON m.room = 'game-' || g.id AND m.deleted = 0
        WHERE g.starts_at >= ? AND g.starts_at < ? GROUP BY g.id ORDER BY chats DESC LIMIT 5`, a, b),
    first<{ user_id: number; points: number }>(c.env,
      `SELECT p.user_id, SUM(p.points) AS points FROM predictions p JOIN games g ON g.id = p.game_id
        WHERE g.starts_at >= ? AND g.starts_at < ? AND p.points IS NOT NULL GROUP BY p.user_id ORDER BY points DESC LIMIT 1`, a, b),
    first<{ posts: number; threads: number; members: number; chats: number }>(c.env,
      `SELECT (SELECT COUNT(*) FROM posts WHERE deleted = 0 AND created_at >= ?1 AND created_at < ?2) AS posts,
              (SELECT COUNT(*) FROM threads WHERE deleted = 0 AND created_at >= ?1 AND created_at < ?2) AS threads,
              (SELECT COUNT(*) FROM users WHERE created_at >= ?1 AND created_at < ?2) AS members,
              (SELECT COUNT(*) FROM chat_messages WHERE deleted = 0 AND created_at >= ?1 AND created_at < ?2) AS chats`, a, b),
  ]);
  const members = await memberSummaries(c.env, [...topPosts.map((p) => p.user_id), ...activeMembers.map((m) => m.user_id), predictionChamp?.user_id]);
  return c.json({
    year,
    totals,
    top_posts: topPosts.map((p) => ({ ...p, body: excerpt(p.body, 200), username: members.get(p.user_id)?.username })),
    top_threads: await presentThreads(c.env, c.get('user'), topThreads),
    active_members: activeMembers.map((m) => ({ ...members.get(m.user_id), posts: m.n })),
    recognitions,
    chattiest_games: chattiestGames.map((g) => ({ ...presentGame(g), chats: g.chats })),
    prediction_champion: predictionChamp ? { ...members.get(predictionChamp.user_id), points: predictionChamp.points } : null,
  });
});

// ---------- Link previews (tweets, YouTube, articles) ----------

community.get('/preview', async (c) => {
  const url = c.req.query('url') ?? '';
  try {
    return c.json({ preview: await getPreview(c.env, url) }, 200, { 'Cache-Control': 'private, max-age=3600' });
  } catch {
    throw new HttpError(400, 'That link cannot be previewed.');
  }
});

// ---------- Phone push notifications ----------

community.get('/push/key', (c) => c.json({ key: pushEnabled(c.env) ? c.env.VAPID_PUBLIC_KEY : null }));

community.post('/push/subscribe', async (c) => {
  if (!pushEnabled(c.env)) throw new HttpError(400, 'Phone notifications are not set up on this forum yet.');
  const body = parse(z.object({ endpoint: z.string().url().max(800), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }), await c.req.json());
  if (!body.endpoint.startsWith('https://')) throw new HttpError(400, 'Invalid subscription.');
  await run(c.env, `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, failures = 0`,
    c.get('user').id, body.endpoint, body.keys.p256dh, body.keys.auth, now());
  return c.json({ ok: true });
});

community.post('/push/unsubscribe', async (c) => {
  const { endpoint } = parse(z.object({ endpoint: z.string().max(800) }), await c.req.json());
  await run(c.env, 'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', endpoint, c.get('user').id);
  return c.json({ ok: true });
});

community.get('/push/status', async (c) => {
  const r = await first<{ n: number }>(c.env, 'SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', c.get('user').id);
  return c.json({ enabled: pushEnabled(c.env), devices: r?.n ?? 0 });
});

// ---------- Your data: download and account deletion ----------

community.get('/me/export', async (c) => {
  const id = c.get('user').id;
  const q = (sql: string) => all(c.env, sql, id);
  const [profile, threads, posts, reactions, bookmarks, drafts, predictions, events, notifications, polls, conversations] = await Promise.all([
    first(c.env, `SELECT id, username, email, role, display_name, bio, grad_year, city, state, interests, legacy_moniker, legacy_join_year, legacy_post_count, legacy_upvotes,
                         show_email, show_on_map, birthday_md, show_birthday, prefs, created_at FROM users WHERE id = ?`, id),
    q('SELECT id, title, description, created_at FROM threads WHERE user_id = ? ORDER BY id'),
    q('SELECT id, thread_id, body, created_at, edited_at, deleted FROM posts WHERE user_id = ? ORDER BY id'),
    q('SELECT post_id, value, created_at FROM reactions WHERE user_id = ?'),
    q('SELECT post_id, note, remind_at, created_at FROM bookmarks WHERE user_id = ?'),
    q('SELECT key, title, body, updated_at FROM drafts WHERE user_id = ?'),
    q('SELECT game_id, pick, nmsu_score, opp_score, points FROM predictions WHERE user_id = ?'),
    q('SELECT id, title, location, starts_at FROM events WHERE user_id = ?'),
    q('SELECT text, link, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 500'),
    q('SELECT poll_id, option_id FROM poll_votes WHERE user_id = ?'),
    all(c.env, `SELECT m.conversation_id, u.username AS sender, m.body, m.created_at FROM dm_messages m JOIN dm_conversations cv ON cv.id = m.conversation_id
                 JOIN users u ON u.id = m.sender_id WHERE cv.user_a = ?1 OR cv.user_b = ?1 ORDER BY m.id`, id),
  ]);
  const data = { exported_at: new Date().toISOString(), site: 'NMSU Sports Forum', profile, threads, posts, reactions, bookmarks, drafts, predictions, events, poll_votes: polls, private_messages: conversations, notifications };
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="nmsu-sports-forum-${(profile as { username: string }).username}.json"`, 'Cache-Control': 'no-store' },
  });
});

community.post('/me/delete', async (c) => {
  const user = c.get('user');
  const body = parse(z.object({ password: z.string(), confirm: z.literal('DELETE', { message: 'type DELETE to confirm' }) }), await c.req.json());
  const u = await first<{ password_hash: string; avatar_key: string | null }>(c.env, 'SELECT password_hash, avatar_key FROM users WHERE id = ?', user.id);
  if (!u || !(await verifyPassword(body.password, u.password_hash))) throw new HttpError(400, 'Password is incorrect.');
  if (user.role === 'admin') {
    const admins = await first<{ n: number }>(c.env, "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'");
    if ((admins?.n ?? 0) <= 1) throw new HttpError(400, 'You are the only administrator. Make someone else an administrator first.');
  }
  const id = user.id;
  // Posts stay in discussions (shown as "Former member"); personal details, private messages and settings are erased.
  await run(c.env, `UPDATE users SET username = ?, email = ?, password_hash = ?, display_name = NULL, bio = NULL, avatar_key = NULL, grad_year = NULL,
                    city = NULL, state = NULL, interests = NULL, legacy_moniker = NULL, legacy_join_year = NULL, legacy_post_count = NULL, legacy_upvotes = NULL,
                    show_email = 0, show_on_map = 0, map_lat = NULL, map_lon = NULL, birthday_md = NULL, show_birthday = 0, featured_post_id = NULL,
                    prefs = '{}', role = 'member', status = 'suspended', suspended_until = NULL, deleted_at = ? WHERE id = ?`,
    `former_member_${id}`, `deleted-${id}@deleted.invalid`, await hashPassword(randomToken()), now(), id);
  const convs = await all<{ id: number }>(c.env, 'SELECT id FROM dm_conversations WHERE user_a = ? OR user_b = ?', id, id);
  for (const cv of convs) {
    await run(c.env, 'DELETE FROM dm_messages WHERE conversation_id = ?', cv.id);
    await run(c.env, 'DELETE FROM dm_reads WHERE conversation_id = ?', cv.id);
    await run(c.env, 'DELETE FROM dm_conversations WHERE id = ?', cv.id);
  }
  for (const sql of ['DELETE FROM drafts WHERE user_id = ?', 'DELETE FROM bookmarks WHERE user_id = ?', 'DELETE FROM mutes WHERE user_id = ? OR (target_type = \'user\' AND target_id = ?1)',
    'DELETE FROM follows WHERE user_id = ?', 'DELETE FROM notifications WHERE user_id = ?', 'DELETE FROM push_subscriptions WHERE user_id = ?', 'DELETE FROM event_rsvps WHERE user_id = ?']) {
    await run(c.env, sql, id);
  }
  if (u.avatar_key) {
    await deleteObject(c.env, `avatar/${u.avatar_key}`).catch(() => {});
    await run(c.env, 'UPDATE attachments SET deleted = 1 WHERE id = ?', u.avatar_key);
  }
  await run(c.env, 'DELETE FROM sessions WHERE user_id = ?', id);
  await destroySession(c);
  return c.json({ ok: true });
});

// ---------- Your moderation history and appeals ----------

community.get('/me/moderation', async (c) => {
  const id = c.get('user').id;
  const decisions = await all(c.env,
    `SELECT l.id, l.action, l.detail, l.created_at, a.status AS appeal_status, a.decision_note
       FROM mod_log l LEFT JOIN appeals a ON a.log_id = l.id AND a.user_id = ?1
      WHERE l.subject_user_id = ?1 AND l.action IN ('remove_post', 'warn', 'suspend', 'ban', 'revoke_flagging') ORDER BY l.id DESC LIMIT 50`, id);
  return c.json({ decisions });
});

async function fileAppeal(env: AppEnv['Bindings'], userId: number, logId: number, message: string) {
  const log = await first<{ id: number; action: string; subject_user_id: number | null }>(env, 'SELECT id, action, subject_user_id FROM mod_log WHERE id = ?', logId);
  if (!log || log.subject_user_id !== userId || !['remove_post', 'warn', 'suspend', 'ban'].includes(log.action)) throw new HttpError(404, 'Decision not found.');
  if (await first(env, 'SELECT id FROM appeals WHERE user_id = ? AND log_id = ?', userId, logId)) throw new HttpError(409, 'You already appealed this decision.');
  await run(env, 'INSERT INTO appeals (user_id, log_id, message, created_at) VALUES (?, ?, ?, ?)', userId, logId, message, now());
  const u = await first<{ username: string }>(env, 'SELECT username FROM users WHERE id = ?', userId);
  await notifyModerators(env, `${u?.username ?? 'A member'} appealed a moderation decision.`, '/admin/bans');
}

community.post('/me/appeals', async (c) => {
  const { log_id, message } = parse(z.object({ log_id: z.number().int(), message: z.string().trim().min(10, 'explain why (at least a sentence)').max(2000) }), await c.req.json());
  await fileAppeal(c.env, c.get('user').id, log_id, message);
  return c.json({ ok: true });
});

export { fileAppeal };

// ---------- Members invite friends ----------

community.get('/invites/mine', async (c) => {
  const rows = await all(c.env,
    `SELECT i.id, i.note, i.uses, i.max_uses, i.expires_at, i.revoked, i.created_at,
       (SELECT group_concat(nu.username, ', ') FROM invite_uses iu JOIN users nu ON nu.id = iu.user_id WHERE iu.invite_id = i.id) AS used_by
     FROM invites i WHERE i.created_by = ? ORDER BY i.id DESC LIMIT 50`, c.get('user').id);
  return c.json({ invites: rows, enabled: await memberInvitesOn(c.env) });
});

community.post('/invites', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin' && !(await memberInvitesOn(c.env))) throw new HttpError(403, 'Member invitations are switched off right now.');
  const body = parse(z.object({ name: z.string().trim().max(60).optional(), email: z.string().trim().email().max(200).optional().or(z.literal('')) }), await c.req.json());
  await rateLimit(c.env, `member-invite:${user.id}`, 10, DAY);
  const r = await createInvite(c.env, new URL(c.req.url).origin, user, { name: body.name, email: body.email || undefined, days: 14, maxUses: 1 });
  return c.json({ link: r.link, emailed: r.emailed, emailEnabled: r.emailEnabled, days: r.days });
});

community.delete('/invites/:id', async (c) => {
  await run(c.env, 'UPDATE invites SET revoked = 1 WHERE id = ? AND created_by = ?', Number(c.req.param('id')) || 0, c.get('user').id);
  return c.json({ ok: true });
});


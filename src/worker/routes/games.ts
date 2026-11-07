import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { all, first, getSetting, logMod, notify, run } from '../db';
import { deleteObject, getObject, putObject } from '../storage';
import { parsePastedRoster } from '../lib/rosters';
import { isModerator } from '../auth';
import { HttpError, now, parse } from '../util';
import { FEATURED_SPORTS, FEATURED_SQL, officialRosterUrl, officialScheduleUrl, parseHubLinks, SPORTS, SPORT_BY_KEY } from '../../shared/sports';
import { memberSummaries } from '../lib/members';
import { THREAD_SELECT, presentThreads, type ThreadRow } from '../lib/threads';
import { dayStartMT, seasonOf, seasonRange, weekStartMT, type GameRow } from '../lib/sports';
import { espnTeamUrl, getLiveScore, inLiveWindow, type LiveScore } from '../lib/livescore';
import { getBoxScore } from '../lib/boxscore';

export const games = new Hono<AppEnv>();

export function presentGame(g: GameRow) {
  return {
    id: g.id, sport: g.sport, opponent: g.opponent, home_away: g.home_away, venue: g.venue, starts_at: g.starts_at, time_tba: Boolean(g.time_tba),
    status: g.status, result: g.result, nmsu_score: g.nmsu_score, opp_score: g.opp_score, tv: g.tv, radio: g.radio, audio_url: g.audio_url ?? null, video_url: g.video_url ?? null,
    official_url: g.official_url ?? officialScheduleUrl(g.sport), schedule_url: officialScheduleUrl(g.sport),
    pregame_thread_id: g.pregame_thread_id, postgame_thread_id: g.postgame_thread_id,
    overridden: g.override_fields !== '{}' && Boolean(g.override_fields),
    live: g.status === 'scheduled' && !g.time_tba && g.starts_at <= now() && now() < g.starts_at + 4 * 3_600_000,
  };
}

games.get('/games', async (c) => {
  const sport = c.req.query('sport');
  const range = c.req.query('range') ?? 'upcoming';
  const t = now();
  const params: (string | number)[] = [];
  let where = 'removed = 0';
  if (sport === 'featured') where += ` AND sport IN ${FEATURED_SQL}`;
  else if (sport && sport in SPORT_BY_KEY) { where += ' AND sport = ?'; params.push(sport); }
  let order = 'starts_at ASC';
  if (range === 'upcoming') { where += ' AND starts_at > ?'; params.push(t - 6 * 3_600_000); }
  else if (range === 'week') {
    // This week (Monday–Sunday, Mountain Time): what's left, from the start of today through Sunday night.
    where += ' AND starts_at >= ? AND starts_at < ?'; params.push(dayStartMT(t), weekStartMT(weekStartMT(t) + 7 * 86_400_000 + 12 * 3_600_000));
  }
  else if (range === 'past') { where += ' AND starts_at <= ?'; params.push(t); order = 'starts_at DESC'; }
  else if (range === 'season') {
    const [a, b] = seasonRange(c.req.query('season') ?? seasonOf(t));
    where += ' AND starts_at >= ? AND starts_at < ?'; params.push(a, b);
  }
  const rows = await all<GameRow>(c.env, `SELECT * FROM games WHERE ${where} ORDER BY ${order} LIMIT 200`, ...params);
  const feeds = await first<{ n: number; ok: number }>(c.env, 'SELECT COUNT(*) AS n, SUM(last_ok_at IS NOT NULL) AS ok FROM data_feeds WHERE enabled = 1');
  // Chat button on each game card: open (automatic football/men's basketball, or started by a member) or "start", from the day before until a day after.
  // Only games within a day either side can have a chat, so look up just those (a long list would exceed D1's 100-variable limit).
  const started = new Set((await all<{ game_id: number }>(c.env,
    'SELECT s.game_id FROM started_chats s JOIN games g ON g.id = s.game_id WHERE g.starts_at BETWEEN ? AND ?', t - 86_400_000, t + 86_400_000)).map((r) => r.game_id));
  const chatState = (g: GameRow) => {
    if (g.status === 'canceled' || g.starts_at > t + 86_400_000 || g.starts_at < t - 86_400_000) return null;
    return FEATURED_SPORTS.includes(g.sport) || started.has(g.id) ? 'open' : 'can_start';
  };
  return c.json({ games: rows.map((g) => ({ ...presentGame(g), chat: chatState(g) })), feedsConfigured: (feeds?.n ?? 0) > 0, feedsSynced: (feeds?.ok ?? 0) > 0 });
});

// Compact strip on top of the Board: latest results and the next game.
games.get('/scoreboard', async (c) => {
  const t = now();
  // Football and men's basketball first; other sports only when neither has a recent or upcoming game.
  const pick = async (sql: string, limit: number, ...params: number[]) => {
    const featured = await all<GameRow>(c.env, `${sql.replace('{F}', `AND sport IN ${FEATURED_SQL}`)} LIMIT ${limit}`, ...params);
    return featured.length ? featured : all<GameRow>(c.env, `${sql.replace('{F}', '')} LIMIT 1`, ...params);
  };
  const [recent, next] = await Promise.all([
    pick("SELECT * FROM games WHERE removed = 0 AND status = 'final' AND result IS NOT NULL AND starts_at > ? {F} ORDER BY starts_at DESC", 2, t - 30 * 86_400_000),
    pick("SELECT * FROM games WHERE removed = 0 AND status = 'scheduled' AND starts_at > ? {F} ORDER BY starts_at", 2, t - 4 * 3_600_000),
  ]);
  return c.json({ recent: recent.map(presentGame), next: next.map(presentGame) });
});

// Rosters & links hub: official roster/schedule pages per sport plus admin-curated links (radio, streams).
games.get('/hub', async (c) => c.json({
  sports: SPORTS.map((s) => ({ key: s.key, label: s.label, icon: s.icon, roster_url: officialRosterUrl(s.key), schedule_url: officialScheduleUrl(s.key) })),
  links: parseHubLinks(await getSetting(c.env, 'hub_links')),
}));

// "Start a game thread": recent and upcoming games, with any thread already started for them.
games.get('/games/pickable', async (c) => {
  const t = now();
  // A thread a moderator removed no longer counts, so members can start a fresh one.
  const rows = await all<GameRow>(c.env,
    `SELECT g.*, (SELECT id FROM threads WHERE id = g.pregame_thread_id AND deleted = 0) AS pregame_thread_id,
            (SELECT id FROM threads WHERE id = g.postgame_thread_id AND deleted = 0) AS postgame_thread_id
       FROM games g WHERE g.removed = 0 AND g.status != 'canceled' AND g.starts_at BETWEEN ? AND ? ORDER BY g.starts_at`, t - 3 * 86_400_000, t + 10 * 86_400_000);
  return c.json({ games: rows.map(presentGame) });
});

// Live score (football and men's basketball): ESPN's scoreboard during the game window; otherwise just the ESPN link.
games.get('/games/:id/live', async (c) => {
  const g = await first<GameRow>(c.env, 'SELECT * FROM games WHERE id = ? AND removed = 0', Number(c.req.param('id')));
  if (!g) throw new HttpError(404, 'Game not found.');
  const teamUrl = espnTeamUrl(g.sport);
  if (!teamUrl) return c.json({ live: null, espn_url: null, active: false });
  const active = inLiveWindow(g.starts_at) && g.status !== 'canceled' && g.status !== 'postponed';
  let live: LiveScore | null = active ? await getLiveScore(c.env, g) : null;
  if (!live) {
    // After the game window, keep showing the final score we saw (no new lookup).
    const cached = await first<{ payload: string }>(c.env, 'SELECT payload FROM live_scores WHERE game_id = ?', g.id);
    const last = cached ? (JSON.parse(cached.payload) as LiveScore | null) : null;
    if (last?.state === 'post') live = last;
  }
  // ESPN's box score page for this exact game, once it has started.
  const box_url = live && live.state !== 'pre' && /\/game\/_\/gameId\//.test(live.espn_url) ? live.espn_url.replace('/game/_/gameId/', '/boxscore/_/gameId/') : null;
  return c.json({ live, espn_url: live?.espn_url ?? teamUrl, box_url, active });
});

// Box score (football and men's basketball) once the game has started, from ESPN's game summary.
games.get('/games/:id/boxscore', async (c) => {
  const g = await first<GameRow>(c.env, 'SELECT * FROM games WHERE id = ? AND removed = 0', Number(c.req.param('id')));
  if (!g) throw new HttpError(404, 'Game not found.');
  const active = inLiveWindow(g.starts_at);
  let live: LiveScore | null = active ? await getLiveScore(c.env, g) : null;
  if (!live) {
    const cached = await first<{ payload: string }>(c.env, 'SELECT payload FROM live_scores WHERE game_id = ?', g.id);
    live = cached ? (JSON.parse(cached.payload) as LiveScore | null) : null;
  }
  const eventId = live && live.state !== 'pre' ? live.espn_url.match(/\/gameId\/(\d+)/)?.[1] : undefined;
  if (!eventId) return c.json({ box: null });
  return c.json({ box: await getBoxScore(c.env, g, eventId, live!.state === 'in') });
});

games.get('/games/:id', async (c) => {
  const user = c.get('user');
  const g = await first<GameRow>(c.env, 'SELECT * FROM games WHERE id = ?', Number(c.req.param('id')));
  if (!g) throw new HttpError(404, 'Game not found.');
  const threads = await all<ThreadRow>(c.env, `${THREAD_SELECT} WHERE t.game_id = ? AND t.deleted = 0 ORDER BY t.created_at`, user.id, g.id);
  const room = `game-${g.id}`;
  const [chatCount, preds, mine, events, topPosts] = await Promise.all([
    first<{ n: number }>(c.env, 'SELECT COUNT(*) AS n FROM chat_messages WHERE room = ? AND deleted = 0', room),
    all<{ user_id: number; pick: string; nmsu_score: number | null; opp_score: number | null; points: number | null }>(c.env,
      'SELECT user_id, pick, nmsu_score, opp_score, points FROM predictions WHERE game_id = ?', g.id),
    first(c.env, 'SELECT pick, nmsu_score, opp_score, points FROM predictions WHERE game_id = ? AND user_id = ?', g.id, user.id),
    all(c.env, 'SELECT id, title, kind, location, starts_at FROM events WHERE game_id = ? AND deleted = 0 ORDER BY starts_at', g.id),
    // Aggie Time Machine: the most appreciated posts from this game's discussions.
    all<{ id: number; thread_id: number; body: string; user_id: number; up: number }>(c.env,
      `SELECT p.id, p.thread_id, p.body, p.user_id, COUNT(*) AS up FROM reactions r JOIN posts p ON p.id = r.post_id JOIN threads t ON t.id = p.thread_id
        WHERE t.game_id = ? AND t.deleted = 0 AND p.deleted = 0 AND r.value = 1 GROUP BY p.id ORDER BY up DESC LIMIT 5`, g.id),
  ]);
  const locked = g.starts_at <= now() || g.status !== 'scheduled';
  const members = await memberSummaries(c.env, [...(locked ? preds.map((p) => p.user_id) : []), ...topPosts.map((p) => p.user_id)]);
  return c.json({
    game: presentGame(g),
    threads: await presentThreads(c.env, user, threads),
    // Chat: automatic for football and men's basketball; any other game once a member starts it (from the day before until a day after).
    chat: await (async () => {
      const automatic = FEATURED_SPORTS.includes(g.sport);
      const started = automatic || Boolean(await first(c.env, 'SELECT game_id FROM started_chats WHERE game_id = ?', g.id));
      const t = now();
      return { room, messages: chatCount?.n ?? 0, automatic, open: started, can_start: !started && g.status !== 'canceled' && g.starts_at <= t + 86_400_000 && g.starts_at >= t - 86_400_000 };
    })(),
    predictions: {
      locked,
      mine,
      count: preds.length,
      nmsu: preds.filter((p) => p.pick === 'nmsu').length,
      opp: preds.filter((p) => p.pick === 'opp').length,
      // Individual picks are revealed once predictions lock at game start.
      picks: locked ? preds.map((p) => ({ ...p, username: members.get(p.user_id)?.username ?? 'member' })) : [],
    },
    events,
    top_posts: topPosts.map((p) => ({ ...p, username: members.get(p.user_id)?.username ?? 'member' })),
  });
});

games.post('/games/:id/predict', async (c) => {
  const user = c.get('user');
  const g = await first<GameRow>(c.env, 'SELECT * FROM games WHERE id = ? AND removed = 0', Number(c.req.param('id')));
  if (!g) throw new HttpError(404, 'Game not found.');
  if (g.starts_at <= now() || g.status !== 'scheduled') throw new HttpError(400, 'Predictions are locked for this game.');
  const body = parse(z.object({
    pick: z.enum(['nmsu', 'opp']),
    nmsu_score: z.number().int().min(0).max(300).nullable().optional(),
    opp_score: z.number().int().min(0).max(300).nullable().optional(),
  }), await c.req.json());
  if ((body.nmsu_score ?? null) !== null && (body.opp_score ?? null) !== null) {
    const nm = body.nmsu_score as number, op = body.opp_score as number;
    if ((body.pick === 'nmsu' && nm <= op) || (body.pick === 'opp' && op <= nm)) throw new HttpError(400, 'Your score should match the winner you picked.');
  }
  const t = now();
  await run(c.env, `INSERT INTO predictions (game_id, user_id, pick, nmsu_score, opp_score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(game_id, user_id) DO UPDATE SET pick = excluded.pick, nmsu_score = excluded.nmsu_score, opp_score = excluded.opp_score, updated_at = excluded.updated_at`,
    g.id, user.id, body.pick, body.nmsu_score ?? null, body.opp_score ?? null, t, t);
  return c.json({ ok: true });
});

games.get('/predictions/standings', async (c) => {
  const season = c.req.query('season') ?? seasonOf(now());
  const [a, b] = seasonRange(season);
  const rows = await all<{ user_id: number; points: number; picks: number; correct: number }>(c.env,
    `SELECT p.user_id, SUM(COALESCE(p.points, 0)) AS points, COUNT(*) AS picks, SUM(p.points > 0) AS correct
       FROM predictions p JOIN games g ON g.id = p.game_id
      WHERE g.starts_at >= ? AND g.starts_at < ? AND p.points IS NOT NULL GROUP BY p.user_id ORDER BY points DESC, correct DESC LIMIT 100`, a, b);
  const members = await memberSummaries(c.env, rows.map((r) => r.user_id));
  // Only seasons that actually have scored picks are offered as other seasons to browse.
  const years = await all<{ y: number }>(c.env,
    `SELECT DISTINCT CAST(strftime('%Y', g.starts_at / 1000, 'unixepoch') AS INTEGER)
              - (CASE WHEN CAST(strftime('%m', g.starts_at / 1000, 'unixepoch') AS INTEGER) < 7 THEN 1 ELSE 0 END) AS y
       FROM predictions p JOIN games g ON g.id = p.game_id WHERE p.points IS NOT NULL ORDER BY y DESC`);
  const seasons = years.map((r) => `${r.y}-${String((r.y + 1) % 100).padStart(2, '0')}`);
  return c.json({ season, current: seasonOf(now()), seasons, standings: rows.map((r) => ({ ...r, username: members.get(r.user_id)?.username, display_name: members.get(r.user_id)?.display_name })) });
});

// Aggie Time Machine: past games and everything the community said about them.
// Time Machine, first level: how many past games each sport has on record.
games.get('/time-machine/sports', async (c) => {
  const rows = await all<{ sport: string; n: number }>(c.env, 'SELECT sport, COUNT(*) AS n FROM games WHERE removed = 0 AND starts_at < ? GROUP BY sport', now());
  return c.json({ sports: Object.fromEntries(rows.map((r) => [r.sport, r.n])) });
});

games.get('/time-machine', async (c) => {
  const season = c.req.query('season') ?? seasonOf(now());
  const sport = c.req.query('sport');
  const [a, b] = seasonRange(season);
  const params: (string | number)[] = [a, Math.min(b, now())];
  let where = 'g.removed = 0 AND g.starts_at >= ? AND g.starts_at < ?';
  if (sport && sport in SPORT_BY_KEY) { where += ' AND g.sport = ?'; params.push(sport); }
  const rows = await all<GameRow & { posts: number; chats: number; preds: number }>(c.env,
    `SELECT g.*,
       (SELECT COUNT(*) FROM posts p JOIN threads t ON t.id = p.thread_id WHERE t.game_id = g.id AND p.deleted = 0 AND t.deleted = 0) AS posts,
       (SELECT COUNT(*) FROM chat_messages m WHERE m.room = 'game-' || g.id AND m.deleted = 0) AS chats,
       (SELECT COUNT(*) FROM predictions pr WHERE pr.game_id = g.id) AS preds
     FROM games g WHERE ${where} ORDER BY g.starts_at DESC LIMIT 200`, ...params);
  // Seasons with past games (for the chosen sport, when one is chosen).
  const seasonSport = sport && sport in SPORT_BY_KEY ? sport : null;
  const seasons = await all<{ y: number }>(c.env,
    `SELECT DISTINCT CAST(strftime('%Y', starts_at / 1000, 'unixepoch', '-6 months') AS INTEGER) AS y FROM games
      WHERE removed = 0 AND starts_at < ?${seasonSport ? ' AND sport = ?' : ''}
     UNION SELECT DISTINCT season AS y FROM roster_players WHERE removed = 0${seasonSport ? ' AND sport = ?' : ''}
     ORDER BY y DESC`, ...(seasonSport ? [now(), seasonSport, seasonSport] : [now()]));
  return c.json({
    season,
    seasons: seasons.map((s) => `${s.y}-${String((s.y + 1) % 100).padStart(2, '0')}`),
    games: rows.map((g) => ({ ...presentGame(g), posts: g.posts, chats: g.chats, predictions: g.preds })),
  });
});

// ---------- Rosters by season (Time Machine) ----------
// Filled by imports (football: CollegeFootballData; basketball: Wikipedia) and by members, e.g. from media guides.

const seasonYear = (v: string | undefined) => { const y = Number(String(v ?? '').slice(0, 4)); return Number.isInteger(y) && y >= 1880 && y <= 2100 ? y : null; };

games.get('/time-machine/roster', async (c) => {
  const sport = c.req.query('sport') ?? '';
  const season = seasonYear(c.req.query('season'));
  if (!(sport in SPORT_BY_KEY) || season === null) throw new HttpError(400, 'Choose a sport and season.');
  const rows = await all<{ id: number; name: string; jersey: string | null; position: string | null; class_year: string | null; height: string | null;
    weight: number | null; hometown: string | null; source: string; source_url: string | null; updated_by: number | null; added_by: number | null }>(c.env,
    `SELECT id, name, jersey, position, class_year, height, weight, hometown, source, source_url, updated_by, added_by FROM roster_players
      WHERE sport = ? AND season = ? AND removed = 0 ORDER BY CASE WHEN jersey GLOB '[0-9]*' THEN CAST(jersey AS INTEGER) ELSE 999 END, name`, sport, season);
  const wiki = rows.find((r) => r.source === 'wikipedia' && r.source_url)?.source_url ?? null;
  return c.json({
    players: rows.map(({ source_url: _u, updated_by, added_by, ...r }) => ({ ...r, edited: Boolean(updated_by || added_by) })),
    sources: { cfbd: rows.some((r) => r.source === 'cfbd'), espn: rows.some((r) => r.source === 'espn'), wikipedia: wiki, members: rows.some((r) => r.source === 'member' || r.updated_by) },
    official_url: officialRosterUrl(sport),
  });
});

const rosterFields = z.object({
  name: z.string().trim().min(2, 'enter the player\'s name').max(80),
  jersey: z.string().trim().max(4).optional().nullable(),
  position: z.string().trim().max(12).optional().nullable(),
  class_year: z.string().trim().max(8).optional().nullable(),
  height: z.string().trim().max(8).optional().nullable(),
  weight: z.number().int().min(80).max(450).optional().nullable(),
  hometown: z.string().trim().max(80).optional().nullable(),
});
const orNull = (v: string | null | undefined) => (v ? v : null);

games.post('/rosters', async (c) => {
  const user = c.get('user');
  if (!user?.id) throw new HttpError(401, 'Sign in to add players.');
  const body = parse(rosterFields.extend({ sport: z.string().refine((v) => v in SPORT_BY_KEY, 'choose a sport'), season: z.number().int().min(1880).max(2100) }), await c.req.json());
  const dupe = await first<{ id: number }>(c.env, 'SELECT id FROM roster_players WHERE sport = ? AND season = ? AND removed = 0 AND lower(name) = lower(?)', body.sport, body.season, body.name);
  if (dupe) throw new HttpError(409, 'That player is already on this roster. Use Fix to change their details.');
  const t = now();
  const r = await run(c.env, `INSERT INTO roster_players (sport, season, name, jersey, position, class_year, height, weight, hometown, source, added_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'member', ?, ?, ?)`, body.sport, body.season, body.name, orNull(body.jersey), orNull(body.position), orNull(body.class_year),
    orNull(body.height), body.weight ?? null, orNull(body.hometown), user.id, t, t);
  return c.json({ id: r.meta.last_row_id });
});

games.patch('/rosters/:id{[0-9]+}', async (c) => {
  const user = c.get('user');
  if (!user?.id) throw new HttpError(401, 'Sign in to fix players.');
  const body = parse(rosterFields, await c.req.json());
  const r = await run(c.env, `UPDATE roster_players SET name = ?, jersey = ?, position = ?, class_year = ?, height = ?, weight = ?, hometown = ?, updated_by = ?, updated_at = ?
    WHERE id = ? AND removed = 0`, body.name, orNull(body.jersey), orNull(body.position), orNull(body.class_year), orNull(body.height), body.weight ?? null,
    orNull(body.hometown), user.id, now(), Number(c.req.param('id')));
  if (!r.meta.changes) throw new HttpError(404, 'Player not found.');
  return c.json({ ok: true });
});

games.delete('/rosters/:id{[0-9]+}', async (c) => {
  const user = c.get('user');
  if (!isModerator(user)) throw new HttpError(403, 'Only admins and moderators can remove players.');
  const id = Number(c.req.param('id'));
  const p = await first<{ name: string }>(c.env, 'SELECT name FROM roster_players WHERE id = ? AND removed = 0', id);
  if (!p) throw new HttpError(404, 'Player not found.');
  await run(c.env, 'UPDATE roster_players SET removed = 1, updated_by = ?, updated_at = ? WHERE id = ?', user!.id, now(), id);
  await logMod(c.env, user!.id, 'remove_roster_player', 'roster_player', id, p.name);
  return c.json({ ok: true });
});

// ---------- Media guide photos: members send a page, admins enter the players ----------

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

games.post('/rosters/photos', async (c) => {
  const user = c.get('user');
  if (!user?.id) throw new HttpError(401, 'Sign in to send a media guide page.');
  const form = await c.req.formData();
  const file = form.get('file');
  const sport = String(form.get('sport') ?? '');
  const season = seasonYear(String(form.get('season') ?? ''));
  const note = String(form.get('note') ?? '').trim().slice(0, 300) || null;
  if (!(sport in SPORT_BY_KEY) || season === null) throw new HttpError(400, 'Choose a sport and season.');
  if (!(file instanceof File) || !PHOTO_TYPES.has(file.type)) throw new HttpError(400, 'Send a JPEG, PNG or WebP photo.');
  const max = c.env.UPLOADS ? 8_000_000 : 1_900_000;
  if (file.size > max) throw new HttpError(400, `Photos must be under ${Math.round(max / 1_000_000)} MB.`);
  const open = await first<{ n: number }>(c.env, "SELECT COUNT(*) AS n FROM roster_photos WHERE user_id = ? AND status = 'open'", user.id);
  if ((open?.n ?? 0) >= 30) throw new HttpError(429, 'You have 30 pages waiting. Thanks! Please wait until those are entered.');
  const key = `roster/${crypto.randomUUID().replace(/-/g, '')}`;
  await putObject(c.env, key, await file.arrayBuffer(), file.type);
  await run(c.env, 'INSERT INTO roster_photos (sport, season, user_id, image_key, content_type, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    sport, season, user.id, key, file.type, note, now());
  return c.json({ ok: true });
});

const requireRosterMod = (user: { role: string } | undefined | null) => {
  if (!isModerator(user)) throw new HttpError(403, 'Admins and moderators only.');
};

games.get('/roster-photos', async (c) => {
  requireRosterMod(c.get('user'));
  const rows = await all<{ id: number; sport: string; season: number; user_id: number; note: string | null; created_at: number }>(c.env,
    "SELECT id, sport, season, user_id, note, created_at FROM roster_photos WHERE status = 'open' ORDER BY created_at LIMIT 100");
  const members = await memberSummaries(c.env, rows.map((r) => r.user_id));
  return c.json({ photos: rows.map((r) => ({ ...r, username: members.get(r.user_id)?.username ?? 'member' })) });
});

games.get('/roster-photos/:id{[0-9]+}/image', async (c) => {
  requireRosterMod(c.get('user'));
  const p = await first<{ image_key: string }>(c.env, "SELECT image_key FROM roster_photos WHERE id = ? AND status = 'open'", Number(c.req.param('id')));
  const obj = p ? await getObject(c.env, p.image_key) : null;
  if (!obj) throw new HttpError(404, 'Photo not found.');
  return new Response(obj.body, { headers: { 'Content-Type': obj.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
});

/** Paste a list (e.g. Claude's summary of the page): one player per line. Adds everyone not already on that season's roster. */
games.post('/roster-photos/:id{[0-9]+}/players', async (c) => {
  const user = c.get('user');
  requireRosterMod(user);
  const p = await first<{ sport: string; season: number }>(c.env, "SELECT sport, season FROM roster_photos WHERE id = ? AND status = 'open'", Number(c.req.param('id')));
  if (!p) throw new HttpError(404, 'Photo not found.');
  const { text } = parse(z.object({ text: z.string().max(20_000) }), await c.req.json());
  const rows = parsePastedRoster(text);
  if (!rows.length) throw new HttpError(400, 'No players found. Put one player per line: #, Name, Pos, Yr, Ht, Wt, Hometown');
  const t = now();
  const results = await c.env.DB.batch(rows.map((r) => c.env.DB.prepare(
    `INSERT INTO roster_players (sport, season, name, jersey, position, class_year, height, weight, hometown, source, added_by, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'member', ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM roster_players WHERE sport = ? AND season = ? AND removed = 0 AND lower(name) = lower(?))`)
    .bind(p.sport, p.season, r.name.slice(0, 80), r.jersey, r.position?.slice(0, 12) ?? null, r.class_year?.slice(0, 8) ?? null, r.height?.slice(0, 8) ?? null,
      r.weight, r.hometown?.slice(0, 80) ?? null, user!.id, t, t, p.sport, p.season, r.name)));
  const added = results.reduce((n, x) => n + (x.meta.changes ?? 0), 0);
  return c.json({ added, skipped: rows.length - added });
});

games.post('/roster-photos/:id{[0-9]+}/done', async (c) => {
  const user = c.get('user');
  requireRosterMod(user);
  const id = Number(c.req.param('id'));
  const p = await first<{ sport: string; season: number; user_id: number; image_key: string }>(c.env,
    "SELECT sport, season, user_id, image_key FROM roster_photos WHERE id = ? AND status = 'open'", id);
  if (!p) throw new HttpError(404, 'Photo not found.');
  await run(c.env, "UPDATE roster_photos SET status = 'done', done_by = ?, done_at = ? WHERE id = ?", user!.id, now(), id);
  await deleteObject(c.env, p.image_key);
  const season = `${p.season}-${String((p.season + 1) % 100).padStart(2, '0')}`;
  if (p.user_id !== user!.id) {
    await notify(c.env, p.user_id, 'roster', `Thanks! The ${SPORT_BY_KEY[p.sport]?.label ?? 'team'} roster from your media guide page is up.`,
      `/time-machine?sport=${p.sport}&season=${season}`, user!.id);
  }
  return c.json({ ok: true });
});

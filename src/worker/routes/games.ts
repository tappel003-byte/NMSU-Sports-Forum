import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { all, first, getSetting, run } from '../db';
import { HttpError, now, parse } from '../util';
import { officialRosterUrl, officialScheduleUrl, parseHubLinks, SPORTS, SPORT_BY_KEY } from '../../shared/sports';
import { memberSummaries } from '../lib/members';
import { THREAD_SELECT, presentThreads, type ThreadRow } from '../lib/threads';
import { seasonOf, seasonRange, type GameRow } from '../lib/sports';

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
  if (sport && sport in SPORT_BY_KEY) { where += ' AND sport = ?'; params.push(sport); }
  let order = 'starts_at ASC';
  if (range === 'upcoming') { where += ' AND starts_at > ?'; params.push(t - 6 * 3_600_000); }
  else if (range === 'past') { where += ' AND starts_at <= ?'; params.push(t); order = 'starts_at DESC'; }
  else if (range === 'season') {
    const [a, b] = seasonRange(c.req.query('season') ?? seasonOf(t));
    where += ' AND starts_at >= ? AND starts_at < ?'; params.push(a, b);
  }
  const rows = await all<GameRow>(c.env, `SELECT * FROM games WHERE ${where} ORDER BY ${order} LIMIT 200`, ...params);
  const feeds = await first<{ n: number; ok: number }>(c.env, 'SELECT COUNT(*) AS n, SUM(last_ok_at IS NOT NULL) AS ok FROM data_feeds WHERE enabled = 1');
  return c.json({ games: rows.map(presentGame), feedsConfigured: (feeds?.n ?? 0) > 0, feedsSynced: (feeds?.ok ?? 0) > 0 });
});

// Compact strip on top of the Board: latest results and the next game.
games.get('/scoreboard', async (c) => {
  const t = now();
  const [recent, next] = await Promise.all([
    all<GameRow>(c.env, "SELECT * FROM games WHERE removed = 0 AND status = 'final' AND starts_at > ? ORDER BY starts_at DESC LIMIT 3", t - 30 * 86_400_000),
    all<GameRow>(c.env, "SELECT * FROM games WHERE removed = 0 AND status = 'scheduled' AND starts_at > ? ORDER BY starts_at LIMIT 2", t - 4 * 3_600_000),
  ]);
  return c.json({ recent: recent.map(presentGame), next: next.map(presentGame) });
});

// Rosters & links hub: official roster/schedule pages per sport plus admin-curated links (radio, streams).
games.get('/hub', async (c) => c.json({
  sports: SPORTS.map((s) => ({ key: s.key, label: s.label, icon: s.icon, roster_url: officialRosterUrl(s.key), schedule_url: officialScheduleUrl(s.key) })),
  links: parseHubLinks(await getSetting(c.env, 'hub_links')),
}));

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
    chat: { room, messages: chatCount?.n ?? 0 },
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
  return c.json({ season, standings: rows.map((r) => ({ ...r, username: members.get(r.user_id)?.username, display_name: members.get(r.user_id)?.display_name })) });
});

// Aggie Time Machine: past games and everything the community said about them.
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
  const seasons = await all<{ y: number }>(c.env,
    `SELECT DISTINCT CAST(strftime('%Y', starts_at / 1000, 'unixepoch', '-6 months') AS INTEGER) AS y FROM games WHERE removed = 0 ORDER BY y DESC`);
  return c.json({
    season,
    seasons: seasons.map((s) => `${s.y}-${String((s.y + 1) % 100).padStart(2, '0')}`),
    games: rows.map((g) => ({ ...presentGame(g), posts: g.posts, chats: g.chats, predictions: g.preds })),
  });
});

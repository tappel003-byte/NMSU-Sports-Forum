import type { Env } from '../env';
import { all, first, getSetting, notify, run, userPrefs } from '../db';
import { DAY, now } from '../util';
import { SPORT_BY_KEY, TIME_ZONE, officialScheduleUrl, sportLabel } from '../../shared/sports';
import { parseIcs, toGame, zonedToUtc, type ParsedGame } from './ics';
import { awardBadge } from './members';

export interface GameRow {
  id: number;
  feed_id: number | null;
  source_uid: string;
  sport: string;
  opponent: string;
  home_away: string;
  venue: string | null;
  starts_at: number;
  time_tba: number;
  status: string;
  result: string | null;
  nmsu_score: number | null;
  opp_score: number | null;
  tv: string | null;
  radio: string | null;
  audio_url: string | null;
  video_url: string | null;
  official_url: string | null;
  override_fields: string;
  pregame_thread_id: number | null;
  postgame_thread_id: number | null;
  predictions_scored: number;
  reminded: number;
}

const SYNC_FIELDS = ['sport', 'opponent', 'home_away', 'venue', 'starts_at', 'time_tba', 'status', 'result', 'nmsu_score', 'opp_score', 'tv', 'radio', 'audio_url', 'video_url', 'official_url', 'raw_summary'] as const;

export function matchup(g: { opponent: string; home_away: string }): string {
  return g.home_away === 'away' ? `NM State at ${g.opponent}` : `NM State vs. ${g.opponent}`;
}

function dateLabel(t: number, tba: number): string {
  const d = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(t));
  if (tba) return `${d} (time TBA)`;
  return `${d}, ${new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(t))} MT`;
}

/** Imports one feed. Idempotent: games are matched by the feed's UID and updated in place; admin overrides are respected. */
export async function syncFeed(env: Env, feed: { id: number; sport: string; url: string }): Promise<{ added: number; updated: number; total: number }> {
  const res = await fetch(feed.url, { headers: { 'User-Agent': 'NMSUSportsForum/1.0 (+https://nmsusportsforum.com)', Accept: 'text/calendar, */*' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Feed responded ${res.status}`);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Response is not an iCalendar feed (format may have changed).');
  const games = parseIcs(text).map((e) => toGame(e, feed.sport)).filter((g): g is ParsedGame & { sport: string } => Boolean(g.sport));
  let added = 0;
  let updated = 0;
  const t = now();
  for (const g of games) {
    const existing = await first<GameRow & Record<string, unknown>>(env, 'SELECT * FROM games WHERE source_uid = ?', g.source_uid);
    if (!existing) {
      await run(env, `INSERT INTO games (feed_id, source_uid, sport, opponent, home_away, venue, starts_at, time_tba, status, result, nmsu_score, opp_score, tv, radio, audio_url, video_url, official_url, raw_summary, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        feed.id, g.source_uid, g.sport, g.opponent, g.home_away, g.venue, g.starts_at, g.time_tba, g.status, g.result, g.nmsu_score, g.opp_score, g.tv, g.radio, g.audio_url, g.video_url, g.official_url, g.raw_summary, t, t);
      added++;
      continue;
    }
    const overrides = JSON.parse(existing.override_fields || '{}') as Record<string, unknown>;
    const changes = SYNC_FIELDS.filter((f) => !(f in overrides) && existing[f] !== g[f] && !(f === 'result' && g.result === null && existing.result));
    // Keep a recorded final result if a later feed revision drops it.
    const effective = changes.filter((f) => !(['nmsu_score', 'opp_score', 'status'].includes(f) && existing.status === 'final' && g.status === 'scheduled'));
    if (effective.length || existing.removed) {
      const sets = effective.map((f) => `${f} = ?`).concat('removed = 0', 'updated_at = ?');
      await run(env, `UPDATE games SET ${sets.join(', ')} WHERE id = ?`, ...effective.map((f) => g[f] as string | number | null), t, existing.id);
      updated++;
    }
  }
  // Future games that disappeared from a non-empty feed were dropped from the schedule.
  if (games.length) {
    const uids = new Set(games.map((g) => g.source_uid));
    const future = await all<{ id: number; source_uid: string }>(env, 'SELECT id, source_uid FROM games WHERE feed_id = ? AND removed = 0 AND starts_at > ?', feed.id, t);
    for (const f of future) if (!uids.has(f.source_uid)) await run(env, 'UPDATE games SET removed = 1, updated_at = ? WHERE id = ?', t, f.id);
  }
  return { added, updated, total: games.length };
}

export async function syncAllFeeds(env: Env): Promise<{ feed: number; ok: boolean; error?: string }[]> {
  const feeds = await all<{ id: number; sport: string; url: string; failing: number }>(env, 'SELECT id, sport, url, failing FROM data_feeds WHERE enabled = 1');
  const out = [];
  for (const feed of feeds) {
    try {
      const counts = await syncFeed(env, feed);
      await run(env, 'UPDATE data_feeds SET last_ok_at = ?, last_error = NULL, failing = 0, last_counts = ? WHERE id = ?', now(), JSON.stringify(counts), feed.id);
      out.push({ feed: feed.id, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await run(env, 'UPDATE data_feeds SET last_error = ?, last_error_at = ?, failing = failing + 1 WHERE id = ?', msg.slice(0, 500), now(), feed.id);
      // Alert admins once when a feed starts failing; the forum keeps the last good data.
      if (feed.failing === 2) {
        const admins = await all<{ id: number }>(env, "SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
        for (const a of admins) await notify(env, a.id, 'feed_error', `Schedule feed for ${sportLabel(feed.sport)} is failing: ${msg.slice(0, 120)}`, '/admin/data');
      }
      out.push({ feed: feed.id, ok: false, error: msg });
    }
  }
  return out;
}

async function systemThread(env: Env, sport: string, title: string, description: string, body: string, gameId: number, phase: 'pregame' | 'postgame'): Promise<number> {
  const forumSlug = SPORT_BY_KEY[sport]?.forum ?? 'other-sports';
  const f = await first<{ id: number }>(env, 'SELECT id FROM forums WHERE slug = ?', forumSlug);
  const t = now();
  const r = await run(env, `INSERT INTO threads (forum_id, user_id, title, description, sport, created_at, last_post_at, game_id, game_phase) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    f?.id ?? 1, title, description, sport, t, t, gameId, phase);
  const threadId = r.meta.last_row_id;
  const p = await run(env, 'INSERT INTO posts (thread_id, user_id, body, created_at) VALUES (?, NULL, ?, ?)', threadId, body, t);
  await run(env, 'UPDATE threads SET last_post_id = ? WHERE id = ?', p.meta.last_row_id, threadId);
  return threadId;
}

/** Automatic game-day lifecycle: pregame threads, postgame threads, prediction scoring and game reminders. */
export async function runGameLifecycle(env: Env): Promise<void> {
  // Members start game threads from "Start a game thread"; automatic ones only when an admin switches them on.
  if ((await getSetting(env, 'auto_game_threads')) === '1') await createAutomaticGameThreads(env);
  await scorePredictions(env);
  await sendGameReminders(env);
}

async function createAutomaticGameThreads(env: Env): Promise<void> {
  const t = now();
  const pregame = await all<GameRow>(env,
    `SELECT * FROM games WHERE removed = 0 AND pregame_thread_id IS NULL AND status = 'scheduled' AND starts_at BETWEEN ? AND ?`, t, t + 3 * DAY);
  for (const g of pregame) {
    const id = await systemThread(env, g.sport, `Pregame: ${matchup(g)}`, `${sportLabel(g.sport)} · ${dateLabel(g.starts_at, g.time_tba)}`,
      `${sportLabel(g.sport)}: ${matchup(g)}\n${dateLabel(g.starts_at, g.time_tba)}${g.venue ? `\n${g.venue}` : ''}${g.tv ? `\nTV/Stream: ${g.tv}` : ''}${g.radio ? `\nRadio: ${g.radio}` : ''}\n\nPredictions, lineups and pregame talk go here. Make your pick on the game page: /games/${g.id}\n\nOfficial info: ${g.official_url ?? officialScheduleUrl(g.sport)}`,
      g.id, 'pregame');
    await run(env, 'UPDATE games SET pregame_thread_id = ? WHERE id = ?', id, g.id);
  }
  // Postgame once a final arrives, or 4 hours after start if the source has no result.
  const postgame = await all<GameRow>(env,
    `SELECT * FROM games WHERE removed = 0 AND postgame_thread_id IS NULL AND status NOT IN ('canceled', 'postponed') AND time_tba = 0
       AND (status = 'final' OR starts_at < ?) AND starts_at > ?`, t - 4 * 3_600_000, t - 7 * DAY);
  for (const g of postgame) {
    const id = await systemThread(env, g.sport, `Postgame: ${matchup(g)}`, `${sportLabel(g.sport)} · ${dateLabel(g.starts_at, 0)}`,
      `The game is over. What did you see? Vote for the Player of the Game below. Nominate anyone who isn't listed yet.\n\nScore, box score and recap: ${g.official_url ?? officialScheduleUrl(g.sport)}\nGame page with the chat archive and predictions: /games/${g.id}`,
      g.id, 'postgame');
    await run(env, 'UPDATE games SET postgame_thread_id = ? WHERE id = ?', id, g.id);
    // Automatic Player of the Game vote: members nominate players and vote for 48 hours.
    await run(env, "INSERT INTO polls (thread_id, question, closes_at, created_at, allow_add, kind) VALUES (?, ?, ?, ?, 1, 'potg')",
      id, `Player of the Game: ${matchup(g)}`, now() + 2 * DAY, now());
  }
}

/** 1 point for the correct winner, 2 bonus points for the exact score. */
export function predictionPoints(p: { pick: string; nmsu_score: number | null; opp_score: number | null }, g: { result: string | null; nmsu_score: number | null; opp_score: number | null }): number {
  if (!g.result || g.result === 'T') return 0;
  const winner = g.result === 'W' ? 'nmsu' : 'opp';
  let pts = p.pick === winner ? 1 : 0;
  if (pts && p.nmsu_score !== null && p.opp_score !== null && p.nmsu_score === g.nmsu_score && p.opp_score === g.opp_score) pts += 2;
  return pts;
}

export async function scorePredictions(env: Env): Promise<void> {
  const games = await all<GameRow>(env, "SELECT * FROM games WHERE status = 'final' AND result IS NOT NULL AND predictions_scored = 0");
  for (const g of games) {
    const preds = await all<{ user_id: number; pick: string; nmsu_score: number | null; opp_score: number | null }>(env,
      'SELECT user_id, pick, nmsu_score, opp_score FROM predictions WHERE game_id = ?', g.id);
    for (const p of preds) await run(env, 'UPDATE predictions SET points = ? WHERE game_id = ? AND user_id = ?', predictionPoints(p, g), g.id, p.user_id);
    await run(env, 'UPDATE games SET predictions_scored = 1 WHERE id = ?', g.id);
  }
}

async function sendGameReminders(env: Env): Promise<void> {
  const t = now();
  const games = await all<GameRow>(env, "SELECT * FROM games WHERE removed = 0 AND reminded = 0 AND status = 'scheduled' AND time_tba = 0 AND starts_at BETWEEN ? AND ?", t, t + 2 * 3_600_000);
  if (!games.length) return;
  const users = await all<{ id: number; prefs: string }>(env, "SELECT id, prefs FROM users WHERE status = 'active'");
  for (const g of games) {
    await run(env, 'UPDATE games SET reminded = 1 WHERE id = ?', g.id);
    for (const u of users) {
      const prefs = userPrefs(u.prefs);
      const sports = Array.isArray(prefs.my_sports) ? prefs.my_sports : [];
      if (prefs.notify_games === false || !sports.includes(g.sport)) continue;
      await notify(env, u.id, 'game', `${sportLabel(g.sport)}: ${matchup(g)} starts ${dateLabel(g.starts_at, 0)}. Game chat is open.`, `/games/${g.id}`);
    }
  }
}

export function seasonOf(t: number): string {
  const d = new Date(t);
  const y = d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export function seasonRange(season: string): [number, number] {
  const y = Number(season.slice(0, 4));
  return [Date.UTC(y, 6, 1), Date.UTC(y + 1, 6, 1)];
}

/** Start of the prediction week (Monday 00:00 Mountain Time) containing t. */
export function weekStartMT(t: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const back = (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 7) % 7;
  const monday = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) - back));
  return zonedToUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 0, 0, 0, TIME_ZONE);
}

function weekLabel(start: number): string {
  const f = (t: number) => new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'short', day: 'numeric' }).format(new Date(t));
  return `${f(start)}–${f(start + 6 * DAY)}`;
}

/** Most points wins; ties share the award; nobody wins a week with no correct picks. */
export function weeklyWinners<T extends { pts: number }>(rows: T[]): T[] {
  const top = Math.max(0, ...rows.map((r) => r.pts));
  return top > 0 ? rows.filter((r) => r.pts === top) : [];
}

/**
 * Nostradamus of the Week: once a week ends (Monday–Sunday, Mountain Time), whoever earned the most prediction
 * points that week gets a permanent award on their member card (ties share it). Runs daily; each week is awarded once.
 */
export async function awardWeeklyPredictor(env: Env, t = now()): Promise<void> {
  const end = weekStartMT(t);
  const start = weekStartMT(end - DAY);
  const label = weekLabel(start);
  // Award each week once; until then, re-check daily so a final that arrives late still counts.
  if (await first(env, "SELECT id FROM badges WHERE badge = 'nostradamus' AND reason LIKE ?", `Nostradamus of the week of ${label}:%`)) return;
  const rows = await all<{ user_id: number; pts: number; called: number }>(env,
    `SELECT p.user_id, SUM(p.points) AS pts, COUNT(*) AS called FROM predictions p JOIN games g ON g.id = p.game_id
      WHERE p.points > 0 AND g.starts_at >= ? AND g.starts_at < ? GROUP BY p.user_id ORDER BY pts DESC`, start, end);
  for (const r of weeklyWinners(rows)) {
    await awardBadge(env, r.user_id, 'nostradamus', `Nostradamus of the week of ${label}: called ${r.called} ${r.called === 1 ? 'game' : 'games'} (${r.pts} ${r.pts === 1 ? 'point' : 'points'}).`, null);
  }
}


// Past seasons for the Time Machine: final scores from ESPN's public team-schedule feed.
// Requests send no custom User-Agent, same as the live-score lookups: ESPN refuses unfamiliar agent names (403).
// Runs a few seasons at a time from the 30-minute cron until every season ESPN has is on file.
// Only completed games older than 8 days are added, so nothing here touches game-day features
// (no game threads, chats, reminders or prediction scoring). Recent games keep coming from the NM State calendar.
import type { Env } from '../env';
import { all, getSetting, setSetting, stmt } from '../db';
import { DAY, now } from '../util';

interface HistorySport {
  sport: string;
  path: string;
  team: string;
  /** Earliest ESPN season worth importing (older seasons are missing most games). */
  from: number;
  /** A season with fewer completed games than this is mostly missing on ESPN, so it is skipped. */
  min: number;
  /** ESPN only offers the current season, as one list (no separate postseason). */
  currentOnly?: boolean;
}

/** ESPN season numbers: fall sports use the fall year; basketball and baseball use the spring year. */
export const HISTORY_SPORTS: HistorySport[] = [
  { sport: 'fb', path: 'football/college-football', team: '166', from: 1999, min: 8 },
  { sport: 'mbb', path: 'basketball/mens-college-basketball', team: '166', from: 2002, min: 20 },
  { sport: 'wbb', path: 'basketball/womens-college-basketball', team: '166', from: 2001, min: 20 },
  { sport: 'vb', path: 'volleyball/womens-college-volleyball', team: '166', from: 2025, min: 20 },
  { sport: 'base', path: 'baseball/college-baseball', team: '103', from: 2026, min: 35 },
  { sport: 'soft', path: 'baseball/college-softball', team: '515', from: 2026, min: 35 },
  { sport: 'wsoc', path: 'soccer/usa.ncaa.w.1', team: '20619', from: 2026, min: 12, currentOnly: true },
];
const FETCHES_PER_RUN = 12;
const STATE_KEY = 'history_import';

export interface HistoryGame {
  uid: string;
  sport: string;
  opponent: string;
  home_away: 'home' | 'away' | 'neutral';
  venue: string | null;
  starts_at: number;
  time_tba: 0 | 1;
  result: 'W' | 'L' | 'T';
  nmsu_score: number;
  opp_score: number;
}

type Score = string | { value?: number; displayValue?: string } | undefined;
type Competitor = { id?: string; homeAway?: string; score?: Score; team?: { id?: string; location?: string; displayName?: string } };
type Ev = {
  id?: string; date?: string; timeValid?: boolean;
  competitions?: { neutralSite?: boolean; timeValid?: boolean; venue?: { fullName?: string }; status?: { type?: { completed?: boolean } }; competitors?: Competitor[] }[];
};

const num = (s: Score): number | null => {
  const v = typeof s === 'object' ? (s.displayValue ?? s.value) : s;
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Completed NM State games in an ESPN team-schedule response. Pure, so it can be unit-tested. */
export function parseTeamSchedule(json: unknown, hs: Pick<HistorySport, 'sport' | 'team'>): HistoryGame[] {
  const events = (json as { events?: Ev[] })?.events;
  if (!Array.isArray(events)) return [];
  const out: HistoryGame[] = [];
  for (const ev of events) {
    const comp = ev.competitions?.[0];
    if (!ev.id || !ev.date || !comp?.status?.type?.completed) continue;
    const teams = comp.competitors ?? [];
    const us = teams.find((c) => (c.team?.id ?? c.id) === hs.team);
    const them = teams.find((c) => c !== us);
    if (!us || !them) continue;
    const a = num(us.score), b = num(them.score);
    const startsAt = Date.parse(ev.date);
    if (a === null || b === null || !Number.isFinite(startsAt)) continue;
    // Forfeits (recorded 2–0 or 1–0, e.g. COVID cancellations) aren't real games and don't count in the record.
    if (['fb', 'mbb', 'wbb'].includes(hs.sport) && a + b <= 2) continue;
    // ESPN sometimes lists one game twice. Football and basketball never play the same team two days running;
    // volleyball, baseball and soccer do (series), so for those only an identical start time counts as a repeat.
    const window = ['fb', 'mbb', 'wbb'].includes(hs.sport) ? 36 * 3_600_000 : 3_600_000;
    const opponent = them.team?.location || them.team?.displayName || 'TBA';
    if (out.some((g) => g.opponent === opponent && g.nmsu_score === a && g.opp_score === b && Math.abs(g.starts_at - startsAt) < window)) continue;
    out.push({
      uid: `espn:${hs.sport}:${ev.id}`,
      sport: hs.sport,
      opponent,
      home_away: comp.neutralSite ? 'neutral' : us.homeAway === 'home' ? 'home' : 'away',
      venue: comp.venue?.fullName ?? null,
      starts_at: startsAt,
      time_tba: comp.timeValid === false || ev.timeValid === false ? 1 : 0,
      result: a > b ? 'W' : a < b ? 'L' : 'T',
      nmsu_score: a,
      opp_score: b,
    });
  }
  return out;
}

type State = Record<string, number>;

/** Where each sport's import stands: the next ESPN season to fetch (below `from` means finished). */
async function loadState(env: Env): Promise<State> {
  try { return JSON.parse(await getSetting(env, STATE_KEY) || '{}') as State; } catch { return {}; }
}

/** Saves one season's games. A game already on file for the same sport within a day and a half is the same game:
 *  it is left alone, except that missing final scores are filled in. Returns how many games were added. */
export async function saveSeason(env: Env, games: HistoryGame[], t = now()): Promise<number> {
  const old = games.filter((g) => g.starts_at < t - 8 * DAY);
  if (!old.length) return 0;
  const lo = Math.min(...old.map((g) => g.starts_at)) - 2 * DAY, hi = Math.max(...old.map((g) => g.starts_at)) + 2 * DAY;
  const existing = await all<{ id: number; source_uid: string; starts_at: number; nmsu_score: number | null; status: string }>(env,
    'SELECT id, source_uid, starts_at, nmsu_score, status FROM games WHERE sport = ? AND starts_at BETWEEN ? AND ?', old[0].sport, lo, hi);
  const statements: D1PreparedStatement[] = [];
  const claimed = new Set<number>();
  let added = 0;
  for (const g of [...old].sort((x, y) => x.starts_at - y.starts_at)) {
    if (existing.some((e) => e.source_uid === g.uid)) continue;
    // Closest unmatched game on file (so both halves of a doubleheader pair up correctly).
    const same = existing
      .filter((e) => !claimed.has(e.id) && !e.source_uid.startsWith('espn:') && Math.abs(e.starts_at - g.starts_at) <= 36 * 3_600_000)
      .sort((x, y) => Math.abs(x.starts_at - g.starts_at) - Math.abs(y.starts_at - g.starts_at))[0];
    if (same) {
      claimed.add(same.id);
      if (same.nmsu_score === null && same.status !== 'canceled' && same.status !== 'postponed') {
        statements.push(stmt(env, "UPDATE games SET status = 'final', result = ?, nmsu_score = ?, opp_score = ?, predictions_scored = 1, updated_at = ? WHERE id = ?",
          g.result, g.nmsu_score, g.opp_score, t, same.id));
      }
      continue;
    }
    statements.push(stmt(env,
      `INSERT INTO games (feed_id, source_uid, sport, opponent, home_away, venue, starts_at, time_tba, status, result, nmsu_score, opp_score,
         raw_summary, predictions_scored, reminded, created_at, updated_at)
       VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 'final', ?, ?, ?, 'Final score from ESPN', 1, 1, ?, ?)`,
      g.uid, g.sport, g.opponent, g.home_away, g.venue, g.starts_at, g.time_tba, g.result, g.nmsu_score, g.opp_score, t, t));
    added++;
  }
  if (statements.length) await env.DB.batch(statements);
  return added;
}

/** One season (regular season plus postseason, which ESPN lists separately). Null when ESPN didn't answer properly. */
async function fetchSeason(base: string, hs: HistorySport, season: number, min: number): Promise<HistoryGame[] | null> {
  try {
    const get = (type: number) => fetch(`${base}/apis/site/v2/sports/${hs.path}/teams/${hs.team}/schedule?season=${season}&seasontype=${type}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (hs.currentOnly) {
      const r = await fetch(`${base}/apis/site/v2/sports/${hs.path}/teams/${hs.team}/schedule`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return r.status === 400 || r.status === 404 ? [] : null;
      return parseTeamSchedule(await r.json(), hs);
    }
    const [reg, post] = await Promise.all([get(2), get(3)]);
    const usable = (r: Response) => r.ok || r.status === 400 || r.status === 404;
    if (!usable(reg) || !usable(post)) return null;
    const games = reg.ok ? parseTeamSchedule(await reg.json(), hs) : [];
    if (games.length < min) return [];
    const extra = post.ok ? parseTeamSchedule(await post.json(), hs).filter((p) => !games.some((g) => g.uid === p.uid)) : [];
    return [...games, ...extra];
  } catch {
    return null;
  }
}

/** Daily: re-checks this season and last for every sport, so early-season games the NM State calendar has already
 *  dropped (it only lists about a month back) still reach the Time Machine. */
export async function refreshRecentSeasons(env: Env): Promise<number> {
  const base = (env.ESPN_BASE || 'https://site.api.espn.com').replace(/\/$/, '');
  const y = new Date(now()).getUTCFullYear();
  let added = 0;
  for (const hs of HISTORY_SPORTS) {
    for (const season of [y + 1, y]) {
      const r = await fetchSeason(base, hs, season, 1);
      if (r) added += await saveSeason(env, r);
    }
  }
  return added;
}

/** One step of the import: fetches up to a few seasons, newest first, across all sports. */
export async function runHistoryImport(env: Env, maxFetches = FETCHES_PER_RUN): Promise<{ fetched: number; added: number; done: boolean }> {
  const state = await loadState(env);
  const base = (env.ESPN_BASE || 'https://site.api.espn.com').replace(/\/$/, '');
  const startSeason = new Date(now()).getUTCFullYear() + 1;
  let fetched = 0, added = 0;
  for (const hs of HISTORY_SPORTS) {
    let season = state[hs.sport] ?? startSeason;
    while (season >= hs.from && fetched < maxFetches) {
      fetched += 2;
      // Past seasons with only a handful of games on ESPN are left out; this year's season is always taken.
      const r = await fetchSeason(base, hs, season, season < new Date(now()).getUTCFullYear() ? hs.min : 1);
      if (r === null) break; // ESPN hiccup: try this season again next run
      added += await saveSeason(env, r);
      season--;
    }
    state[hs.sport] = season;
    if (fetched >= maxFetches) break;
  }
  await setSetting(env, STATE_KEY, JSON.stringify(state));
  const done = HISTORY_SPORTS.every((hs) => (state[hs.sport] ?? startSeason) < hs.from);
  return { fetched, added, done };
}

// ---------- Football before 1999 (CollegeFootballData; ESPN's records start in 1999) ----------

type CfbdGame = { id?: number; startDate?: string; startTimeTBD?: boolean; completed?: boolean; neutralSite?: boolean; venue?: string | null;
  homeId?: number; homeTeam?: string; homePoints?: number | null; awayId?: number; awayTeam?: string; awayPoints?: number | null };
const CFBD_NMSU = 166;

/** Completed NM State games in a CollegeFootballData /games response. Pure. */
export function parseCfbdGames(json: unknown): HistoryGame[] {
  if (!Array.isArray(json)) return [];
  const out: HistoryGame[] = [];
  for (const g of json as CfbdGame[]) {
    const home = g.homeId === CFBD_NMSU || g.homeTeam === 'New Mexico State';
    const away = g.awayId === CFBD_NMSU || g.awayTeam === 'New Mexico State';
    if ((!home && !away) || g.id === undefined || !g.startDate || g.completed === false) continue;
    const a = home ? g.homePoints : g.awayPoints, b = home ? g.awayPoints : g.homePoints;
    const startsAt = Date.parse(g.startDate);
    if (a === null || a === undefined || b === null || b === undefined || !Number.isFinite(startsAt)) continue;
    if (a + b <= 2) continue; // forfeit
    out.push({
      uid: `cfbd:fb:${g.id}`, sport: 'fb', opponent: (home ? g.awayTeam : g.homeTeam) || 'TBA',
      home_away: g.neutralSite ? 'neutral' : home ? 'home' : 'away', venue: g.venue ?? null, starts_at: startsAt,
      time_tba: g.startTimeTBD === false ? 0 : 1, result: a > b ? 'W' : a < b ? 'L' : 'T', nmsu_score: a, opp_score: b,
    });
  }
  return out;
}

/** One step: older football seasons from CollegeFootballData, 1998 back to the program's start. Returns requests used. */
export async function runCfbdFootballHistory(env: Env, budget: number): Promise<number> {
  if (!env.CFBD_API_KEY || budget <= 0) return 0;
  const key = 'cfbd_fb_history';
  let y = Number(await getSetting(env, key)) || 1998;
  const base = (env.CFBD_BASE || 'https://api.collegefootballdata.com').replace(/\/$/, '');
  let used = 0;
  while (y >= 1893 && used < budget) {
    used++;
    try {
      const res = await fetch(`${base}/games?year=${y}&team=New%20Mexico%20State&seasonType=both`,
        { headers: { Authorization: `Bearer ${env.CFBD_API_KEY}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) {
        await setSetting(env, 'cfbd_last_error', `${new Date().toISOString()} games ${y}: ${res.status} ${(await res.text()).slice(0, 200)}`);
        if (res.status !== 400 && res.status !== 404) break; // outage or limit: try this season again next run
      } else await saveSeason(env, parseCfbdGames(await res.json()));
    } catch (e) {
      // Record why, and don't let one bad season block the rest: after three failed tries, move past it.
      await setSetting(env, 'cfbd_last_error', `${new Date().toISOString()} games ${y}: ${String(e).slice(0, 200)}`);
      const fails = (await getSetting(env, 'cfbd_fail').then((v) => JSON.parse(v || '{}')).catch(() => ({}))) as { year?: number; n?: number };
      const n = fails.year === y ? (fails.n ?? 0) + 1 : 1;
      await setSetting(env, 'cfbd_fail', JSON.stringify({ year: y, n }));
      if (n < 3) break;
    }
    y--;
  }
  await setSetting(env, key, String(y));
  return used;
}

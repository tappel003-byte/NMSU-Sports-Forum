// In-game scores for football and men's basketball from ESPN's public scoreboard feed.
// ESPN does not formally offer this feed to outside sites, so everything here fails quietly:
// no score bar, but the ESPN Gamecast link still works. Official results still come from the NMSU calendar.
import type { Env } from '../env';
import { first, run } from '../db';
import { now } from '../util';

/** ESPN's team id for the New Mexico State Aggies. */
export const ESPN_TEAM_ID = '166';
const LEAGUES: Record<string, { path: string; site: string; groups: string }> = {
  fb: { path: 'football/college-football', site: 'college-football', groups: '80' },
  mbb: { path: 'basketball/mens-college-basketball', site: 'mens-college-basketball', groups: '50' },
};
const CACHE_MS = 30_000;

export interface LiveScore {
  state: 'pre' | 'in' | 'post';
  detail: string;
  nmsu_score: number | null;
  opp_score: number | null;
  espn_url: string;
}

export function espnTeamUrl(sport: string): string | null {
  const l = LEAGUES[sport];
  return l ? `https://www.espn.com/${l.site}/team/_/id/${ESPN_TEAM_ID}` : null;
}

/** Live scores are looked up from 30 minutes before tip-off until 5 hours after. */
export function inLiveWindow(startsAt: number, t = now()): boolean {
  return t >= startsAt - 30 * 60_000 && t <= startsAt + 5 * 3_600_000;
}

/** The scoreboard date ESPN files a game under (US Eastern). */
export function espnDate(startsAt: number): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(startsAt)).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}`;
}

type EspnCompetitor = { homeAway?: string; score?: string; team?: { id?: string } };
type EspnEvent = { id?: string; date?: string; status?: { type?: { state?: string; shortDetail?: string; detail?: string } }; competitions?: { competitors?: EspnCompetitor[]; status?: EspnEvent['status'] }[] };

/** Finds the NM State game in an ESPN scoreboard response. Pure, so it can be unit-tested. */
export function parseScoreboard(json: unknown, sport: string): LiveScore | null {
  const l = LEAGUES[sport];
  const events = (json as { events?: EspnEvent[] })?.events;
  if (!l || !Array.isArray(events)) return null;
  for (const ev of events) {
    const comp = ev.competitions?.[0];
    const teams = comp?.competitors ?? [];
    const us = teams.find((c) => c.team?.id === ESPN_TEAM_ID);
    if (!us || !ev.id) continue;
    const them = teams.find((c) => c !== us);
    const status = comp?.status ?? ev.status;
    const state = status?.type?.state;
    if (state !== 'pre' && state !== 'in' && state !== 'post') continue;
    const num = (s?: string) => (s !== undefined && s !== '' && Number.isFinite(Number(s)) ? Number(s) : null);
    return {
      state,
      detail: status?.type?.shortDetail || status?.type?.detail || '',
      nmsu_score: state === 'pre' ? null : num(us.score),
      opp_score: state === 'pre' ? null : num(them?.score),
      espn_url: `https://www.espn.com/${l.site}/game/_/gameId/${encodeURIComponent(ev.id)}`,
    };
  }
  return null;
}

/** Cached lookup (30 seconds) shared by everyone watching the game. */
export async function getLiveScore(env: Env, game: { id: number; sport: string; starts_at: number }): Promise<LiveScore | null> {
  const l = LEAGUES[game.sport];
  if (!l) return null;
  const cached = await first<{ payload: string; fetched_at: number }>(env, 'SELECT payload, fetched_at FROM live_scores WHERE game_id = ?', game.id);
  if (cached && now() - cached.fetched_at < CACHE_MS) return JSON.parse(cached.payload) as LiveScore | null;
  let score: LiveScore | null = cached ? (JSON.parse(cached.payload) as LiveScore | null) : null;
  try {
    const base = (env.ESPN_BASE || 'https://site.api.espn.com').replace(/\/$/, '');
    const res = await fetch(`${base}/apis/site/v2/sports/${l.path}/scoreboard?dates=${espnDate(game.starts_at)}&groups=${l.groups}&limit=500`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (res.ok) score = parseScoreboard(await res.json(), game.sport) ?? score;
  } catch {
    // Keep the last known score; the page still offers the ESPN link.
  }
  await run(env, 'INSERT INTO live_scores (game_id, payload, fetched_at) VALUES (?, ?, ?) ON CONFLICT(game_id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at',
    game.id, JSON.stringify(score), now());
  return score;
}

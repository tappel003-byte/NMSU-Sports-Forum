// Box scores for football and men's basketball from ESPN's public game summary feed (same source as live scores).
// Fails quietly: if ESPN's format changes, the box score section simply says it isn't available.
import type { Env } from '../env';
import { first, run } from '../db';
import { now } from '../util';
import { ESPN_TEAM_ID, LEAGUE_PATHS } from './livescore';

export interface BoxGroup { name: string; labels: string[]; players: { name: string; starter: boolean; stats: string[] }[]; totals: string[] | null }
export interface BoxTeam { name: string; nmsu: boolean; groups: BoxGroup[]; team_stats: { label: string; value: string }[] }
export interface BoxScore { teams: BoxTeam[] }

// Columns shown on a phone. Basketball: the usual box score; football: leaders by category.
const MBB_COLS = ['MIN', 'PTS', 'REB', 'AST', 'FG', '3PT', 'FT', 'STL', 'BLK', 'TO', 'PF'];
const FB_GROUPS: Record<string, string[]> = {
  passing: ['C/ATT', 'YDS', 'TD', 'INT'],
  rushing: ['CAR', 'YDS', 'AVG', 'TD'],
  receiving: ['REC', 'YDS', 'TD'],
  defensive: ['TOT', 'SACKS', 'TFL'],
  interceptions: ['INT', 'YDS'],
};
const MBB_TEAM_STATS = ['Field Goal %', 'Three Point %', 'Free Throw %', 'Rebounds', 'Assists', 'Turnovers', 'Steals', 'Blocks'];
const FB_TEAM_STATS = ['1st Downs', 'Total Yards', 'Passing', 'Rushing', 'Turnovers', 'Penalties', 'Possession'];

type EspnAthlete = { athlete?: { displayName?: string; shortName?: string }; starter?: boolean; didNotPlay?: boolean; stats?: string[] };
type EspnStatGroup = { name?: string; text?: string; labels?: string[]; athletes?: EspnAthlete[]; totals?: string[] };
type EspnPlayers = { team?: { id?: string; displayName?: string; shortDisplayName?: string }; statistics?: EspnStatGroup[] };
type EspnTeamStats = { team?: { id?: string }; statistics?: { label?: string; displayValue?: string }[] };

function pick(labels: string[], wanted: string[]): number[] {
  return wanted.map((w) => labels.indexOf(w)).filter((i) => i >= 0);
}

/** Turns ESPN's game summary into a compact box score. Pure, so it can be unit-tested. */
export function parseBoxScore(json: unknown, sport: string): BoxScore | null {
  const box = (json as { boxscore?: { players?: EspnPlayers[]; teams?: EspnTeamStats[] } })?.boxscore;
  if (!box || !Array.isArray(box.players) || !box.players.length) return null;
  const teamStatsWanted = sport === 'fb' ? FB_TEAM_STATS : MBB_TEAM_STATS;
  const teams: BoxTeam[] = box.players.map((p) => {
    const id = p.team?.id;
    const groups: BoxGroup[] = [];
    for (const g of p.statistics ?? []) {
      const labels = g.labels ?? [];
      const wanted = sport === 'fb' ? FB_GROUPS[g.name ?? ''] : MBB_COLS;
      if (!wanted) continue;
      const cols = pick(labels, wanted);
      if (!cols.length) continue;
      const players = (g.athletes ?? [])
        .filter((a) => !a.didNotPlay && (a.stats?.length ?? 0) > 0)
        .map((a) => ({ name: a.athlete?.shortName || a.athlete?.displayName || '—', starter: Boolean(a.starter), stats: cols.map((i) => a.stats?.[i] ?? '') }));
      if (!players.length) continue;
      const name = sport === 'fb' ? (g.text || (g.name ?? '').replace(/^\w/, (c) => c.toUpperCase())) : 'Players';
      groups.push({ name, labels: cols.map((i) => labels[i]), players: sport === 'fb' ? players.slice(0, 4) : players, totals: g.totals?.length ? cols.map((i) => g.totals?.[i] ?? '') : null });
    }
    const ts = (box.teams ?? []).find((t) => t.team?.id === id)?.statistics ?? [];
    const team_stats = teamStatsWanted
      .map((label) => ts.find((s) => s.label === label))
      .filter((s): s is { label: string; displayValue: string } => Boolean(s?.label && s.displayValue !== undefined))
      .map((s) => ({ label: s.label, value: s.displayValue }));
    return { name: id === ESPN_TEAM_ID ? 'NM State' : p.team?.shortDisplayName || p.team?.displayName || 'Opponent', nmsu: id === ESPN_TEAM_ID, groups, team_stats };
  });
  if (!teams.some((t) => t.groups.length)) return null;
  // NM State first.
  teams.sort((a, b) => Number(b.nmsu) - Number(a.nmsu));
  return { teams };
}

/** Cached box score for a game (1 minute while live, then kept). eventId comes from the live score lookup. */
export async function getBoxScore(env: Env, game: { id: number; sport: string }, eventId: string, live: boolean): Promise<BoxScore | null> {
  const path = LEAGUE_PATHS[game.sport];
  if (!path) return null;
  const cached = await first<{ payload: string; fetched_at: number }>(env, 'SELECT payload, fetched_at FROM box_scores WHERE game_id = ?', game.id);
  const maxAge = live ? 60_000 : 6 * 3_600_000;
  if (cached && now() - cached.fetched_at < maxAge) return JSON.parse(cached.payload) as BoxScore | null;
  let box: BoxScore | null = cached ? (JSON.parse(cached.payload) as BoxScore | null) : null;
  try {
    const base = (env.ESPN_BASE || 'https://site.api.espn.com').replace(/\/$/, '');
    const res = await fetch(`${base}/apis/site/v2/sports/${path}/summary?event=${encodeURIComponent(eventId)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (res.ok) box = parseBoxScore(await res.json(), game.sport) ?? box;
  } catch {
    // Keep the last known box score.
  }
  await run(env, 'INSERT INTO box_scores (game_id, payload, fetched_at) VALUES (?, ?, ?) ON CONFLICT(game_id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at',
    game.id, JSON.stringify(box), now());
  return box;
}

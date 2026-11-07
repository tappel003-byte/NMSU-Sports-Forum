// Rosters by season for the Time Machine.
// - Football: CollegeFootballData (CFBD_API_KEY in Worker secrets).
// - Men's and women's basketball: Wikipedia season articles (free to reuse with credit, CC BY-SA), read slowly via the official API.
// - Every sport: members add or fix players (e.g. from media guides).
// Imports only add rows (INSERT OR IGNORE on source_key) and never overwrite a member's fix.
import type { Env } from '../env';
import { getSetting, setSetting, stmt } from '../db';
import { now } from '../util';

export interface RosterRow {
  name: string; jersey: string | null; position: string | null; class_year: string | null;
  height: string | null; weight: number | null; hometown: string | null;
}

const CLASS: Record<string, string> = { fr: 'Fr', so: 'So', jr: 'Jr', sr: 'Sr', gr: 'Gr', '5th': 'Gr', '1': 'Fr', '2': 'So', '3': 'Jr', '4': 'Sr', '5': 'Gr' };

/** Strips wiki markup: [[Link|Text]] → Text, [[Text]] → Text, {{...}} and refs removed. */
function plain(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '').replace(/'{2,}/g, '').replace(/<[^>]+>/g, '').trim();
  return t || null;
}

/** Players in a Wikipedia basketball season article ({{CBB roster/Player|first=…|last=…|num=…|pos=…|ft=…|in=…|lbs=…|class=…|home=…}}). Pure. */
export function parseWikiRoster(wikitext: string): RosterRow[] {
  const out: RosterRow[] = [];
  for (const m of wikitext.matchAll(/\{\{\s*CBB roster\/Player((?:[^{}]|\{\{[^{}]*\}\}|\[\[[^\]]*\]\])*)\}\}/gi)) {
    const f: Record<string, string> = {};
    // Split on | that are not inside [[...]] or {{...}}.
    let depth = 0, cur = '';
    const parts: string[] = [];
    for (const ch of m[1]) {
      if (ch === '[' || ch === '{') depth++;
      if (ch === ']' || ch === '}') depth--;
      if (ch === '|' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    for (const p of parts) { const i = p.indexOf('='); if (i > 0) f[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim(); }
    const name = [plain(f.first), plain(f.last)].filter(Boolean).join(' ');
    if (!name) continue;
    const cls = (f.class || f.year || '').toLowerCase();
    out.push({
      name,
      jersey: plain(f.num),
      position: plain(f.pos),
      class_year: CLASS[cls] ? `${f.rs === 'y' ? 'R-' : ''}${CLASS[cls]}` : plain(f.class),
      height: f.ft ? `${f.ft}-${f.in || 0}` : null,
      weight: f.lbs && Number.isFinite(Number(f.lbs)) ? Number(f.lbs) : null,
      hometown: plain(f.home),
    });
  }
  return out;
}

type CfbdRoster = { id?: string | number; firstName?: string | null; lastName?: string | null; jersey?: number | null; position?: string | null;
  year?: number | null; height?: number | null; weight?: number | null; homeCity?: string | null; homeState?: string | null };

/** CollegeFootballData roster rows. Pure. */
export function parseCfbdRoster(json: unknown): (RosterRow & { key: string })[] {
  if (!Array.isArray(json)) return [];
  return (json as CfbdRoster[]).flatMap((p) => {
    const name = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
    if (!name || p.id === undefined) return [];
    return [{
      key: String(p.id), name,
      jersey: p.jersey === null || p.jersey === undefined ? null : String(p.jersey),
      position: p.position ?? null,
      class_year: p.year ? CLASS[String(p.year)] ?? null : null,
      height: p.height ? `${Math.floor(p.height / 12)}-${p.height % 12}` : null,
      weight: p.weight ?? null,
      hometown: [p.homeCity, p.homeState].filter(Boolean).join(', ') || null,
    }];
  });
}

async function save(env: Env, sport: string, season: number, source: 'cfbd' | 'wikipedia', sourceUrl: string | null, rows: (RosterRow & { key: string })[]) {
  if (!rows.length) return 0;
  const t = now();
  await env.DB.batch(rows.map((r) => stmt(env,
    `INSERT OR IGNORE INTO roster_players (sport, season, name, jersey, position, class_year, height, weight, hometown, source, source_key, source_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sport, season, r.name, r.jersey, r.position, r.class_year, r.height, r.weight, r.hometown, source, `${source}:${sport}:${season}:${r.key}`, sourceUrl, t, t)));
  return rows.length;
}

export const WIKI_UA = 'NMSUSportsForum/1.0 (https://nmsusportsforum.com; forum admins)';
const WIKI_TEAMS: { sport: string; title: (y: number) => string; from: number }[] = [
  { sport: 'mbb', title: (y) => `${y}–${String((y + 1) % 100).padStart(2, '0')} New Mexico State Aggies men's basketball team`, from: 1950 },
  { sport: 'wbb', title: (y) => `${y}–${String((y + 1) % 100).padStart(2, '0')} New Mexico State Aggies women's basketball team`, from: 1975 },
];
const STATE_KEY = 'roster_import';

/** One step of the roster import: up to `budget` requests, newest seasons first. Returns how many requests were used. */
export async function runRosterImport(env: Env, budget: number): Promise<number> {
  if (budget <= 0) return 0;
  let state: Record<string, number> = {};
  try { state = JSON.parse(await getSetting(env, STATE_KEY) || '{}'); } catch { /* start over */ }
  const thisSeason = new Date(now()).getUTCMonth() >= 6 ? new Date(now()).getUTCFullYear() : new Date(now()).getUTCFullYear() - 1;
  let used = 0;
  // Football rosters (CollegeFootballData), this season back to 2000.
  if (env.CFBD_API_KEY) {
    const base = (env.CFBD_BASE || 'https://api.collegefootballdata.com').replace(/\/$/, '');
    let y = state.fb ?? thisSeason;
    while (y >= 2000 && used < budget) {
      used++;
      try {
        const res = await fetch(`${base}/roster?team=New%20Mexico%20State&year=${y}`, { headers: { Authorization: `Bearer ${env.CFBD_API_KEY}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) break; // try again next run
        await save(env, 'fb', y, 'cfbd', null, parseCfbdRoster(await res.json()));
      } catch { break; }
      y--;
    }
    state.fb = y;
  }
  // Basketball rosters (Wikipedia season articles), one page at a time.
  for (const team of WIKI_TEAMS) {
    let y = state[team.sport] ?? thisSeason;
    while (y >= team.from && used < budget) {
      used++;
      const title = team.title(y);
      try {
        const res = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&redirects=1&prop=wikitext&page=${encodeURIComponent(title)}`,
          { headers: { 'User-Agent': WIKI_UA, 'Api-User-Agent': WIKI_UA }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) break; // rate limited or down: try again next run
        const json = (await res.json()) as { parse?: { wikitext?: string; title?: string }; error?: { code?: string } };
        if (json.parse?.wikitext) {
          const url = `https://en.wikipedia.org/wiki/${encodeURIComponent((json.parse.title ?? title).replace(/ /g, '_'))}`;
          const rows = parseWikiRoster(json.parse.wikitext).map((r) => ({ ...r, key: r.name.toLowerCase() }));
          await save(env, team.sport, y, 'wikipedia', url, rows);
        } else if (json.error?.code !== 'missingtitle') break;
      } catch { break; }
      y--;
    }
    state[team.sport] = y;
  }
  await setSetting(env, STATE_KEY, JSON.stringify(state));
  return used;
}

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

async function save(env: Env, sport: string, season: number, source: 'cfbd' | 'wikipedia' | 'espn', sourceUrl: string | null, rows: (RosterRow & { key: string })[]) {
  if (!rows.length) return 0;
  const t = now();
  // A player already on that season's roster (from any source, or added by a member) is never added twice.
  await env.DB.batch(rows.map((r) => stmt(env,
    `INSERT OR IGNORE INTO roster_players (sport, season, name, jersey, position, class_year, height, weight, hometown, source, source_key, source_url, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM roster_players WHERE sport = ? AND season = ? AND lower(name) = lower(?))`,
    sport, season, r.name, r.jersey, r.position, r.class_year, r.height, r.weight, r.hometown, source, `${source}:${sport}:${season}:${r.key}`, sourceUrl, t, t,
    sport, season, r.name)));
  return rows.length;
}

export const WIKI_UA = 'NMSUSportsForum/1.0 (https://nmsusportsforum.com; forum admins)';
const WIKI_TEAMS: { sport: string; title: (y: number) => string; from: number }[] = [
  { sport: 'mbb', title: (y) => `${y}–${String((y + 1) % 100).padStart(2, '0')} New Mexico State Aggies men's basketball team`, from: 1950 },
  { sport: 'wbb', title: (y) => `${y}–${String((y + 1) % 100).padStart(2, '0')} New Mexico State Aggies women's basketball team`, from: 1975 },
];
const STATE_KEY = 'roster_import';

type EspnAthlete = { id?: string; fullName?: string; displayName?: string; jersey?: string; position?: { abbreviation?: string };
  experience?: { displayValue?: string; abbreviation?: string }; displayHeight?: string; displayWeight?: string; weight?: number;
  birthPlace?: { city?: string; state?: string } };

/** ESPN team roster (athletes either flat or grouped by unit, as football is). Pure. */
export function parseEspnRoster(json: unknown): (RosterRow & { key: string })[] {
  const list = (json as { athletes?: (EspnAthlete & { items?: EspnAthlete[] })[] })?.athletes;
  if (!Array.isArray(list)) return [];
  const flat = list.flatMap((a) => (Array.isArray(a.items) ? a.items : [a]));
  const yr: Record<string, string> = { freshman: 'Fr', sophomore: 'So', junior: 'Jr', senior: 'Sr', graduate: 'Gr' };
  return flat.flatMap((a) => {
    const name = (a.fullName || a.displayName || '').trim();
    if (!name || !a.id) return [];
    const ht = /^(\d+)' ?(\d+)/.exec(a.displayHeight ?? '');
    const wt = a.weight ?? Number(/\d+/.exec(a.displayWeight ?? '')?.[0]);
    return [{
      key: String(a.id), name, jersey: a.jersey ?? null, position: a.position?.abbreviation ?? null,
      class_year: yr[(a.experience?.displayValue ?? '').toLowerCase()] ?? null,
      height: ht ? `${ht[1]}-${ht[2]}` : null, weight: Number.isFinite(wt) && wt ? wt : null,
      hometown: [a.birthPlace?.city, a.birthPlace?.state].filter(Boolean).join(', ') || null,
    }];
  });
}

/** This season's rosters from ESPN (football, men's and women's basketball), at most once a day. Returns requests used. */
const ESPN_ROSTERS: { sport: string; path: string; team: string }[] = [
  { sport: 'fb', path: 'football/college-football', team: '166' },
  { sport: 'mbb', path: 'basketball/mens-college-basketball', team: '166' },
  { sport: 'wbb', path: 'basketball/womens-college-basketball', team: '166' },
  // Baseball left out: ESPN's college baseball roster is stale (same list every season, positions "UN").
];
async function refreshCurrentRosters(env: Env, season: number): Promise<number> {
  const last = Number(await getSetting(env, 'current_rosters_at')) || 0;
  if (now() - last < 24 * 3_600_000) return 0;
  const base = (env.ESPN_BASE || 'https://site.api.espn.com').replace(/\/$/, '');
  let ok = true;
  for (const r of ESPN_ROSTERS) {
    try {
      const res = await fetch(`${base}/apis/site/v2/sports/${r.path}/teams/${r.team}/roster`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
      if (res.ok) await save(env, r.sport, season, 'espn', null, parseEspnRoster(await res.json()));
      else ok = false;
    } catch { ok = false; }
  }
  if (ok) await setSetting(env, 'current_rosters_at', String(now()));
  return ESPN_ROSTERS.length;
}

/** One step of the roster import: up to `budget` requests, newest seasons first. Returns how many requests were used. */
export async function runRosterImport(env: Env, budget: number): Promise<number> {
  if (budget <= 0) return 0;
  let state: Record<string, number> = {};
  try { state = JSON.parse(await getSetting(env, STATE_KEY) || '{}'); } catch { /* start over */ }
  const thisSeason = new Date(now()).getUTCMonth() >= 6 ? new Date(now()).getUTCFullYear() : new Date(now()).getUTCFullYear() - 1;
  // This season first (ESPN), then older seasons.
  let used = await refreshCurrentRosters(env, thisSeason);
  // Football rosters (CollegeFootballData), this season back to 2000.
  if (env.CFBD_API_KEY) {
    const base = (env.CFBD_BASE || 'https://api.collegefootballdata.com').replace(/\/$/, '');
    let y = state.fb ?? thisSeason;
    while (y >= 2000 && used < budget) {
      used++;
      try {
        const res = await fetch(`${base}/roster?team=New%20Mexico%20State&year=${y}`, { headers: { Authorization: `Bearer ${env.CFBD_API_KEY}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) {
          await setSetting(env, 'cfbd_last_error', `${new Date().toISOString()} roster ${y}: ${res.status} ${(await res.text()).slice(0, 200)}`);
          if (res.status !== 400 && res.status !== 404) break; // outage or limit: try again next run
        } else await save(env, 'fb', y, 'cfbd', null, parseCfbdRoster(await res.json()));
      } catch (e) {
        await setSetting(env, 'cfbd_last_error', `${new Date().toISOString()} roster ${y}: ${String(e).slice(0, 200)}`);
        break;
      }
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

/** A pasted list, one player per line: "#, Name, Pos, Yr, Ht, Wt, Hometown" (number optional; hometown may contain commas). Pure. */
export function parsePastedRoster(text: string): RosterRow[] {
  const out: RosterRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^[\s*•-]+/, '').trim();
    if (!line) continue;
    const f = line.split(/\s*[,\t|]\s*/).map((x) => x.trim());
    let jersey: string | null = null;
    if (/^#?\d{1,3}$/.test(f[0] ?? '')) jersey = f.shift()!.replace('#', '');
    const name = f.shift() ?? '';
    if (name.length < 2 || /^name$/i.test(name)) continue;
    const [position, class_year, height, weight, ...rest] = f;
    const wt = Number(String(weight ?? '').replace(/[^0-9]/g, ''));
    out.push({
      name, jersey,
      position: position || null,
      class_year: class_year || null,
      height: height ? height.replace(/['"\s]+/g, '-').replace(/-+$/, '') : null,
      weight: wt >= 80 && wt <= 450 ? wt : null,
      hometown: rest.join(', ') || null,
    });
  }
  return out;
}

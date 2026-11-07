// One-time, read-only check (Nov 2026): what NM State's public schedule services offer for past seasons.
// Results are saved to the settings table for review; nothing else is changed. Remove once reviewed.
import type { Env } from '../env';
import { getSetting, setSetting } from '../db';

const KEY = 'probe_nmstate_v2';
const UA = 'NMSUSportsForum/1.0 (+https://nmsusportsforum.com)';

async function get(url: string, headers: Record<string, string> = { 'User-Agent': UA }) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  return { res, text: await res.text() };
}

export async function runNmStateProbe(env: Env): Promise<void> {
  if (await getSetting(env, KEY)) return;
  const out: Record<string, unknown> = {};
  try {
    // robots.txt: the rules for all crawlers ("User-agent: *") and any rule naming /services/.
    const { text } = await get('https://nmstatesports.com/robots.txt');
    const blocks = text.split(/\r?\n\s*\r?\n/);
    out.robots_star = blocks.filter((b) => /User-agent:\s*\*/i.test(b)).join('\n---\n').slice(0, 2000);
    out.robots_services = text.split(/\r?\n/).filter((l) => /services|calendar/i.test(l));
  } catch (e) { out.robots_error = String(e); }
  try {
    // One full month (Oct 2015): every field of one finished event, and which sports appear.
    const { res, text } = await get('https://nmstatesports.com/services/responsive-calendar.ashx?type=month&sport=0&date=10/1/2015');
    const days = JSON.parse(text) as { date: string; events: Record<string, unknown>[] }[];
    const events = days.flatMap((d) => d.events ?? []);
    out.month_status = res.status;
    out.month_events = events.length;
    out.month_sample = events.find((e) => e.result || (e as { results?: unknown }).results) ?? events[0];
    out.month_sports = [...new Set(events.map((e) => JSON.stringify((e as { sport?: { title?: string; id?: number } }).sport ?? null)))].slice(0, 20);
  } catch (e) { out.month_error = String(e); }
  // How far back it goes.
  const depth: Record<string, number | string> = {};
  for (const d of ['10/1/2005', '10/1/1998', '10/1/1990', '2/1/2010']) {
    try {
      const { text } = await get(`https://nmstatesports.com/services/responsive-calendar.ashx?type=month&sport=0&date=${d}`);
      depth[d] = (JSON.parse(text) as { events?: unknown[] }[]).reduce((n, day) => n + (day.events?.length ?? 0), 0);
    } catch (e) { depth[d] = String(e).slice(0, 80); }
  }
  out.depth = depth;
  // Football data service again (it answered 502 during the first check).
  if (env.CFBD_API_KEY) {
    const base = (env.CFBD_BASE || 'https://api.collegefootballdata.com').replace(/\/$/, '');
    const cfbd: Record<string, unknown> = {};
    for (const path of ['/games?year=1960&team=New%20Mexico%20State', '/games?year=1990&team=New%20Mexico%20State',
      '/roster?team=New%20Mexico%20State&year=2005', '/roster?team=New%20Mexico%20State&year=2017']) {
      try {
        const { res, text } = await get(base + path, { Authorization: `Bearer ${env.CFBD_API_KEY}`, Accept: 'application/json' });
        const json = (() => { try { return JSON.parse(text) as unknown; } catch { return null; } })();
        cfbd[path] = { status: res.status, count: Array.isArray(json) ? json.length : null, sample: Array.isArray(json) ? json[0] : text.slice(0, 200) };
      } catch (e) { cfbd[path] = String(e).slice(0, 120); }
    }
    out.cfbd = cfbd;
  }
  await setSetting(env, KEY, JSON.stringify(out));
}

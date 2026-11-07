// One-time, read-only check (Nov 2026): what NM State's public schedule services offer for past seasons.
// Results are saved to the settings table for review; nothing else is changed. Remove once reviewed.
import type { Env } from '../env';
import { getSetting, setSetting } from '../db';

const KEY = 'probe_nmstate_v1';
const URLS = [
  'https://nmstatesports.com/robots.txt',
  'https://nmstatesports.com/calendar.ashx/calendar.ics?sport_id=0',
  'https://nmstatesports.com/sports/softball/schedule/2019',
  'https://nmstatesports.com/services/responsive-calendar.ashx?type=month&sport=0&date=10/1/2015',
  'https://nmstatesports.com/services/responsive-calendar.ashx?type=events&sport=0&date=10/3/2015',
];

export async function runNmStateProbe(env: Env): Promise<void> {
  if (await getSetting(env, KEY)) return;
  const out: Record<string, unknown>[] = [];
  for (const url of URLS) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'NMSUSportsForum/1.0 (+https://nmsusportsforum.com)' }, signal: AbortSignal.timeout(15_000) });
      const text = await res.text();
      const ics = (text.match(/BEGIN:VEVENT/g) ?? []).length;
      const years = [...new Set((text.match(/DTSTART[^:]*:(\d{4})/g) ?? []).map((m) => m.slice(-4)))].sort();
      const calLinks = [...new Set(text.match(/calendar\.ashx[^"'\s<>]*/g) ?? [])].slice(0, 8);
      out.push({ url, status: res.status, type: res.headers.get('content-type'), length: text.length, ics, years, calLinks,
        head: url.endsWith('robots.txt') ? text.slice(0, 1500) : text.slice(0, 300) });
    } catch (e) {
      out.push({ url, error: e instanceof Error ? e.message : String(e) });
    }
  }
  // Football data service (key in Worker secrets): how far back games and rosters go.
  if (env.CFBD_API_KEY) {
    const base = (env.CFBD_BASE || 'https://api.collegefootballdata.com').replace(/\/$/, '');
    for (const path of ['/games?year=1960&team=New%20Mexico%20State', '/games?year=1990&team=New%20Mexico%20State',
      '/roster?team=New%20Mexico%20State&year=2000', '/roster?team=New%20Mexico%20State&year=2010', '/roster?team=New%20Mexico%20State&year=2017']) {
      try {
        const res = await fetch(base + path, { headers: { Authorization: `Bearer ${env.CFBD_API_KEY}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
        const json = (await res.json().catch(() => null)) as unknown[] | null;
        out.push({ cfbd: path, status: res.status, count: Array.isArray(json) ? json.length : null, sample: Array.isArray(json) ? json[0] : json });
      } catch (e) {
        out.push({ cfbd: path, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  await setSetting(env, KEY, JSON.stringify(out));
}

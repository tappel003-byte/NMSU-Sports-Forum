// Pure iCalendar parsing and game-field extraction for the official athletics calendar feeds.
// Kept free of Worker bindings so it can be unit-tested with sample feeds.
import { SPORTS, TIME_ZONE } from '../../shared/sports';

export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  url: string;
  status: string;
  start: number;
  allDay: boolean;
}

export interface ParsedGame {
  source_uid: string;
  sport: string | null;
  opponent: string;
  home_away: 'home' | 'away' | 'neutral' | 'tbd';
  venue: string | null;
  starts_at: number;
  time_tba: number;
  status: 'scheduled' | 'final' | 'postponed' | 'canceled';
  result: 'W' | 'L' | 'T' | null;
  nmsu_score: number | null;
  opp_score: number | null;
  tv: string | null;
  radio: string | null;
  audio_url: string | null;
  video_url: string | null;
  official_url: string | null;
  raw_summary: string;
}

function unescapeText(s: string): string {
  return s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/** Offset in ms of `tz` from UTC at instant `utc`. */
function tzOffset(utc: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - utc;
}

/** Converts a wall-clock time in `tz` to a UTC epoch. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess - tzOffset(guess, tz);
  t = guess - tzOffset(t, tz);
  return t;
}

function parseDate(value: string, params: Record<string, string>): { t: number; allDay: boolean } | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h) return { t: zonedToUtc(+y, +mo, +d, 12, 0, 0, TIME_ZONE), allDay: true };
  if (z) return { t: Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)), allDay: false };
  let tz = params.TZID ?? TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    tz = TIME_ZONE;
  }
  return { t: zonedToUtc(+y, +mo, +d, +h, +mi, +(s ?? 0), tz), allDay: false };
}

export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur?.uid && cur.start !== undefined && cur.summary) {
        events.push({ uid: cur.uid, summary: cur.summary, description: cur.description ?? '', location: cur.location ?? '', url: cur.url ?? '', status: cur.status ?? '', start: cur.start, allDay: Boolean(cur.allDay) });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const [name, ...paramParts] = line.slice(0, idx).split(';');
    const params = Object.fromEntries(paramParts.map((p) => p.split('=') as [string, string]));
    const value = line.slice(idx + 1);
    switch (name.toUpperCase()) {
      case 'UID': cur.uid = value.trim(); break;
      case 'SUMMARY': cur.summary = unescapeText(value).trim(); break;
      case 'DESCRIPTION': cur.description = unescapeText(value); break;
      case 'LOCATION': cur.location = unescapeText(value).trim(); break;
      case 'URL': cur.url = value.trim().replace(/&amp;/g, '&'); break;
      case 'STATUS': cur.status = value.trim().toUpperCase(); break;
      case 'DTSTART': {
        const d = parseDate(value.trim(), params);
        if (d) { cur.start = d.t; cur.allDay = d.allDay; }
        break;
      }
    }
  }
  return events;
}

const SPORT_PATTERNS: [RegExp, string][] = [
  [/women'?s basketball|\bwbb\b/i, 'wbb'],
  [/men'?s basketball|\bmbb\b/i, 'mbb'],
  [/volleyball/i, 'vb'],
  [/football/i, 'fb'],
  [/softball/i, 'soft'],
  [/baseball/i, 'base'],
  [/soccer/i, 'wsoc'],
  [/cross country/i, 'xc'],
  [/track/i, 'track'],
  [/women'?s golf/i, 'wgolf'],
  [/golf/i, 'mgolf'],
  [/tennis/i, 'wten'],
  [/swim|diving/i, 'swim'],
];

export function detectSport(text: string): string | null {
  for (const [re, key] of SPORT_PATTERNS) if (re.test(text)) return key;
  return null;
}

const RESULT_RE = /\b([WLT])\s*[,:]?\s*(\d{1,3})\s*[-–]\s*(\d{1,3})\b/;

export function toGame(ev: IcsEvent, feedSport: string | null): ParsedGame {
  const text = `${ev.summary}\n${ev.description}`;
  const sport = feedSport && feedSport !== 'auto' && SPORTS.some((s) => s.key === feedSport) ? feedSport : detectSport(ev.summary) ?? detectSport(ev.description);

  // Opponent: text after " vs " / " at " (or "@"), minus result, rankings and trailing notes.
  let homeAway: ParsedGame['home_away'] = 'tbd';
  let opponent = ev.summary;
  const m = ev.summary.match(/\s(vs\.?|versus|at|@)\s+(.+)$/i);
  if (m) {
    homeAway = /^(at|@)$/i.test(m[1]) ? 'away' : 'home';
    opponent = m[2];
  }
  opponent = opponent
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\((?:[WLT]\s*[,:]?\s*\d+\s*[-–]\s*\d+[^)]*)\)/gi, '')
    .replace(RESULT_RE, '')
    .replace(/#\d+\s*/g, '')
    .replace(/\s*[-–|]\s*(canceled|cancelled|postponed).*$/i, '')
    // Promotions follow a spaced dash ("Western Kentucky - Pink Game"); hyphenated names ("A&M-Corpus Christi") are kept.
    .replace(/\s+[-–]\s+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (homeAway === 'home' && ev.location && !/las cruces/i.test(ev.location)) homeAway = 'neutral';

  let status: ParsedGame['status'] = 'scheduled';
  let result: ParsedGame['result'] = null;
  let nmsu: number | null = null;
  let opp: number | null = null;
  const r = text.match(RESULT_RE);
  if (r) {
    result = r[1] as 'W' | 'L' | 'T';
    const a = Number(r[2]);
    const b = Number(r[3]);
    nmsu = result === 'L' ? Math.min(a, b) : Math.max(a, b);
    opp = result === 'L' ? Math.max(a, b) : Math.min(a, b);
    status = 'final';
  }
  // Exhibitions and meets often end "Completed" with no score.
  if (status === 'scheduled' && /(?:^|\n)\s*(?:Completed|Final)\s*(?:\n|$)/i.test(ev.description)) status = 'final';
  if (ev.status === 'CANCELLED' || /\bcancel+ed\b/i.test(ev.summary)) status = 'canceled';
  else if (/\bpostponed\b/i.test(ev.summary)) status = 'postponed';

  const line = (re: RegExp) => ev.description.match(re)?.[1]?.trim() || null;
  return {
    source_uid: ev.uid,
    sport,
    opponent: opponent || 'Opponent TBA',
    home_away: homeAway,
    venue: ev.location || null,
    starts_at: ev.start,
    time_tba: ev.allDay ? 1 : 0,
    status,
    result,
    nmsu_score: nmsu,
    opp_score: opp,
    tv: line(/(?:^|\n)\s*(?:TV|Television|Watch|Stream(?:ing)?|Network)\s*:\s*([^\n]+)/i),
    radio: line(/(?:^|\n)\s*Radio\s*:\s*([^\n]+)/i),
    audio_url: line(/(?:^|\n)\s*Streaming Audio\s*:\s*(https:\/\/\S+)/i),
    video_url: line(/(?:^|\n)\s*Streaming Video\s*:\s*(https:\/\/\S+)/i),
    official_url: ev.url || null,
    raw_summary: ev.summary,
  };
}

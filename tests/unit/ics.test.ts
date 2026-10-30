import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectSport, parseIcs, toGame, zonedToUtc } from '../../src/worker/lib/ics';

const ics = readFileSync(new URL('../fixtures/sample-athletics.ics', import.meta.url), 'utf8');
const events = parseIcs(ics);
const game = (uid: string) => toGame(events.find((e) => e.uid.startsWith(uid))!, 'auto');

describe('parseIcs', () => {
  it('parses every event', () => {
    expect(events).toHaveLength(7);
  });

  it('converts Mountain Time to UTC, including daylight saving', () => {
    // Nov 7, 2026 is after DST ends: MST = UTC-7.
    expect(game('sample-fb-001').starts_at).toBe(Date.UTC(2026, 10, 8, 2, 0));
    // Oct 24, 2026 is during DST: MDT = UTC-6.
    expect(game('sample-fb-004').starts_at).toBe(Date.UTC(2026, 9, 25, 0, 0));
    expect(zonedToUtc(2026, 7, 1, 12, 0, 0, 'America/Denver')).toBe(Date.UTC(2026, 6, 1, 18, 0));
  });

  it('keeps UTC times as-is', () => {
    expect(game('sample-mbb-002').starts_at).toBe(Date.UTC(2026, 10, 12, 2, 0));
  });
});

describe('toGame', () => {
  it('extracts opponent, home game, TV and radio', () => {
    const g = game('sample-fb-001');
    expect(g).toMatchObject({ sport: 'fb', opponent: 'Sample State', home_away: 'home', tv: 'ESPN+', radio: 'Aggie Radio Network', status: 'scheduled', venue: 'Las Cruces, N.M.' });
  });

  it('detects away games and strips rankings', () => {
    expect(game('sample-mbb-002')).toMatchObject({ sport: 'mbb', opponent: 'Example Tech', home_away: 'away', tv: 'CBS Sports Network' });
  });

  it('marks date-only events as time TBA', () => {
    expect(game('sample-vb-003')).toMatchObject({ sport: 'vb', time_tba: 1, opponent: 'Placeholder U' });
  });

  it('reads wins and losses with NMSU score first', () => {
    expect(game('sample-fb-004')).toMatchObject({ status: 'final', result: 'W', nmsu_score: 31, opp_score: 14, opponent: 'Demo College' });
    expect(game('sample-wsoc-005')).toMatchObject({ status: 'final', result: 'L', nmsu_score: 1, opp_score: 2, sport: 'wsoc' });
  });

  it('recognizes cancellations', () => {
    expect(game('sample-base-006')).toMatchObject({ status: 'canceled', opponent: 'Mock University' });
  });

  it('treats home-style listings away from Las Cruces as neutral site', () => {
    expect(game('sample-soft-007')).toMatchObject({ home_away: 'neutral', sport: 'soft' });
  });

  it('uses the feed sport when one is configured', () => {
    const e = events.find((x) => x.uid.startsWith('sample-vb-003'))!;
    expect(toGame(e, 'wbb').sport).toBe('wbb');
  });
});

describe('detectSport', () => {
  it('separates men and women basketball', () => {
    expect(detectSport("Women's Basketball vs X")).toBe('wbb');
    expect(detectSport("Men's Basketball vs X")).toBe('mbb');
  });
});

// Mirrors the official SIDEARM composite feed (nmstatesports.com "Add To Calendar"), with fictional events.
const SIDEARM = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//SIDEARM Sports//NONSGML SIDEARM//EN
BEGIN:VEVENT
UID:vcal_90001-nmstatesports.com
DTSTART:20261002T000000Z
LOCATION:Las Cruces\\, N.M., Aggie Memorial Stadium
SUMMARY:[W] New Mexico State University  Football vs Sample State - Pink Game
DESCRIPTION:[W] New Mexico State University  Football vs Sample State - Pink Game\\nW 34-13\\nTV: CBS Sports Network\\nRadio: 99.5 FM KXPZ \\nStreaming Audio: https://audio.example.test/live\\nTickets: https://tickets.example.test/x\\n
URL:https://nmstatesports.com/calendar.aspx?game_id=90001&amp;sport_id=4
END:VEVENT
BEGIN:VEVENT
UID:vcal_90002-nmstatesports.com
DTSTART:20260930T220000Z
LOCATION:Las Cruces\\, N.M., NM State Swimming and Diving Complex
SUMMARY:[N] New Mexico State University  Women's Swimming and Diving vs Crimson & White
DESCRIPTION:[N] New Mexico State University  Women's Swimming and Diving vs Crimson & White\\n Completed\\n
URL:https://nmstatesports.com/calendar.aspx?game_id=90002&amp;sport_id=20
END:VEVENT
BEGIN:VEVENT
UID:vcal_90003-nmstatesports.com
DTSTART:20261111T020000Z
LOCATION:El Paso\\, TX, Don Haskins Center
SUMMARY:New Mexico State University  Women's Basketball at Texas A&M-Corpus Christi
DESCRIPTION:New Mexico State University  Women's Basketball at Texas A&M-Corpus Christi\\nStreaming Video: https://video.example.test/watch\\n
URL:https://nmstatesports.com/calendar.aspx?game_id=90003&amp;sport_id=25
END:VEVENT
END:VCALENDAR`;

describe('official SIDEARM feed format', () => {
  const [fb, swim, wbb] = parseIcs(SIDEARM).map((e) => toGame(e, 'auto'));
  it('reads results, TV, radio and streams', () => {
    expect(fb).toMatchObject({ sport: 'fb', opponent: 'Sample State', home_away: 'home', status: 'final', result: 'W', nmsu_score: 34, opp_score: 13, tv: 'CBS Sports Network', radio: '99.5 FM KXPZ', audio_url: 'https://audio.example.test/live' });
    expect(fb.official_url).toBe('https://nmstatesports.com/calendar.aspx?game_id=90001&sport_id=4');
  });
  it('treats "Completed" without a score as finished', () => {
    expect(swim).toMatchObject({ sport: 'swim', status: 'final', result: null });
  });
  it('keeps hyphenated opponent names and finds video streams', () => {
    expect(wbb).toMatchObject({ sport: 'wbb', opponent: 'Texas A&M-Corpus Christi', home_away: 'away', video_url: 'https://video.example.test/watch' });
  });
});

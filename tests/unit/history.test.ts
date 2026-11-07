import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTeamSchedule } from '../../src/worker/lib/history';

const fb = JSON.parse(readFileSync(new URL('../fixtures/espn-fb-schedule-2026.json', import.meta.url), 'utf8'));

describe('ESPN team schedule (Time Machine history)', () => {
  const games = parseTeamSchedule(fb, { sport: 'fb', team: '166' });

  it("keeps only completed games, with NM State's score first", () => {
    expect(games).toHaveLength(8);
    const fsu = games[0];
    expect(fsu).toMatchObject({ uid: 'espn:fb:401864570', opponent: 'Florida State', home_away: 'away', nmsu_score: 17, opp_score: 34, result: 'L', venue: 'Doak Campbell Stadium' });
    expect(fsu.starts_at).toBe(Date.parse('2026-08-29T23:00Z'));
  });

  it('marks home games, wins and losses correctly', () => {
    const merc = games.find((g) => g.opponent === 'Mercyhurst')!;
    expect(merc).toMatchObject({ home_away: 'home', nmsu_score: 51, opp_score: 14, result: 'W' });
    const unm = games.find((g) => g.opponent === 'New Mexico')!;
    expect(unm).toMatchObject({ home_away: 'home', result: 'L', nmsu_score: 18, opp_score: 42 });
  });

  it('handles scores given as plain text, neutral sites, ties and junk safely', () => {
    const json = { events: [
      { id: '1', date: '2010-01-01T19:00Z', competitions: [{ neutralSite: true, status: { type: { completed: true } }, competitors: [
        { homeAway: 'home', score: '70', team: { id: '9', location: 'Rival' } }, { homeAway: 'away', score: '70', team: { id: '166', location: 'New Mexico State' } }] }] },
      { id: '2', date: '2010-01-02T19:00Z', competitions: [{ status: { type: { completed: false } }, competitors: [] }] },
      { id: '3', date: 'not a date', competitions: [{ status: { type: { completed: true } }, competitors: [{ team: { id: '166' }, score: '1' }, { team: { id: '9' }, score: '0' }] }] },
    ] };
    const out = parseTeamSchedule(json, { sport: 'mbb', team: '166' });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ home_away: 'neutral', result: 'T', nmsu_score: 70, opp_score: 70 });
    expect(parseTeamSchedule(null, { sport: 'fb', team: '166' })).toEqual([]);
  });

  it('drops ESPN repeats of one game, but keeps real back-to-back volleyball matches', () => {
    const ev = (id: string, date: string, us: string, them: string) => ({ id, date, competitions: [{ status: { type: { completed: true } }, competitors: [
      { homeAway: 'home', score: us, team: { id: '166' } }, { homeAway: 'away', score: them, team: { id: '9', location: 'Western Kentucky' } }] }] });
    const twice = { events: [ev('1', '2001-01-04T02:00Z', '73', '90'), ev('2', '2001-01-05T01:00Z', '73', '90')] };
    expect(parseTeamSchedule(twice, { sport: 'wbb', team: '166' })).toHaveLength(1);
    expect(parseTeamSchedule(twice, { sport: 'vb', team: '166' })).toHaveLength(2);
  });

  it('leaves out forfeits in football and basketball', () => {
    const json = { events: [{ id: '9', date: '2022-01-07T02:00Z', competitions: [{ status: { type: { completed: true } }, competitors: [
      { homeAway: 'home', score: '2', team: { id: '166' } }, { homeAway: 'away', score: '0', team: { id: '5', location: 'Lamar' } }] }] }] };
    expect(parseTeamSchedule(json, { sport: 'mbb', team: '166' })).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { parseCfbdRoster, parseWikiRoster } from '../../src/worker/lib/rosters';
import { parseCfbdGames } from '../../src/worker/lib/history';

describe('Wikipedia basketball rosters', () => {
  // Real template line from "2021–22 New Mexico State Aggies men's basketball team", plus an older-style entry.
  const wikitext = `==Roster==
{{CBB roster/Header|year=2021|team=New Mexico State Aggies}}
{{CBB roster/Player|first=Teddy|last=Allen|link=y|dab=basketball|num=0|pos=G|ft=6|in=6|lbs=212|class=jr|rs=y|home=[[Phoenix, Arizona|Phoenix, AZ]]|high_school=[[Nebraska Cornhuskers men's basketball|Nebraska]]}}
{{CBB roster/Player|first=Sam|last=Crawford|num=10|pos=G|ft=5|in=8|class=sr|home=Pasadena, CA<ref>{{cite web|url=x}}</ref>}}
{{CBB roster/Footer}}`;
  it('reads name, number, position, class, height, weight and hometown', () => {
    const rows = parseWikiRoster(wikitext);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: 'Teddy Allen', jersey: '0', position: 'G', class_year: 'R-Jr', height: '6-6', weight: 212, hometown: 'Phoenix, AZ' });
    expect(rows[1]).toMatchObject({ name: 'Sam Crawford', jersey: '10', class_year: 'Sr', height: '5-8', weight: null, hometown: 'Pasadena, CA' });
  });
  it('returns nothing for a page without a roster', () => {
    expect(parseWikiRoster('The 1965–66 team finished 23–5.')).toEqual([]);
  });
});

describe('CollegeFootballData', () => {
  it('maps roster rows (height in inches, class year number)', () => {
    const rows = parseCfbdRoster([
      { id: '-1024391', firstName: 'Jaylon', lastName: 'Williams-Reese', weight: 240, height: 73, jersey: 56, year: 2, position: 'LB', homeCity: 'Tyler', homeState: 'TX' },
      { id: '112487', firstName: 'Paul', lastName: 'Dombrowski', weight: null, height: null, jersey: null, year: null, position: null, homeCity: null, homeState: null },
    ]);
    expect(rows[0]).toEqual({ key: '-1024391', name: 'Jaylon Williams-Reese', jersey: '56', position: 'LB', class_year: 'So', height: '6-1', weight: 240, hometown: 'Tyler, TX' });
    expect(rows[1]).toMatchObject({ name: 'Paul Dombrowski', jersey: null, height: null, hometown: null });
  });
  it('maps old games with NM State home or away; skips unfinished games and forfeits', () => {
    const games = parseCfbdGames([
      { id: 35516, startDate: '1960-09-10T00:00:00.000Z', startTimeTBD: false, completed: true, neutralSite: false, homeId: 166, homeTeam: 'New Mexico State', homePoints: 41, awayId: 1000736, awayTeam: 'University of Mexico', awayPoints: 0 },
      { id: 56567, startDate: '1990-09-01T00:00:00.000Z', completed: true, homeId: 167, homeTeam: 'New Mexico', homePoints: 29, awayId: 166, awayTeam: 'New Mexico State', awayPoints: 12 },
      { id: 3, startDate: '1950-01-01T00:00:00.000Z', completed: false, homeId: 166, homePoints: null, awayPoints: null },
      { id: 4, startDate: '1944-10-01T00:00:00.000Z', completed: true, homeId: 166, homeTeam: 'New Mexico State', homePoints: 1, awayTeam: 'X', awayPoints: 0 },
    ]);
    expect(games).toHaveLength(2);
    expect(games[0]).toMatchObject({ uid: 'cfbd:fb:35516', opponent: 'University of Mexico', home_away: 'home', result: 'W', nmsu_score: 41, opp_score: 0, time_tba: 0 });
    expect(games[1]).toMatchObject({ opponent: 'New Mexico', home_away: 'away', result: 'L', nmsu_score: 12, opp_score: 29, time_tba: 1 });
  });
});

import { parseEspnRoster } from '../../src/worker/lib/rosters';
describe('ESPN current rosters', () => {
  it('reads flat (basketball) and grouped (football) rosters', () => {
    const flat = parseEspnRoster({ athletes: [{ id: '1', fullName: 'Jachai Cantave', jersey: '5', position: { abbreviation: 'G' }, experience: { displayValue: 'Freshman' }, displayHeight: "6' 1\"", displayWeight: '180 lbs', birthPlace: { city: 'Houston', state: 'TX' } }] });
    expect(flat[0]).toEqual({ key: '1', name: 'Jachai Cantave', jersey: '5', position: 'G', class_year: 'Fr', height: '6-1', weight: 180, hometown: 'Houston, TX' });
    const grouped = parseEspnRoster({ athletes: [{ position: 'offense', items: [{ id: '2', fullName: 'Trey Arnold', jersey: '17', position: { abbreviation: 'QB' }, experience: { displayValue: 'Freshman' }, displayHeight: "6' 2\"", weight: 205 }] }] });
    expect(grouped[0]).toMatchObject({ name: 'Trey Arnold', position: 'QB', height: '6-2', weight: 205 });
    expect(parseEspnRoster({})).toEqual([]);
  });
});

import { parsePastedRoster } from '../../src/worker/lib/rosters';
describe('Pasted roster lists (e.g. from Claude reading a media guide page)', () => {
  it('reads one player per line, number optional, hometown with commas', () => {
    const rows = parsePastedRoster(`#, Name, Pos, Yr, Ht, Wt, Hometown
12, John Smith, QB, Jr, 6-2, 205 lbs, Tyler, TX
- Maria Lopez, SS, So, 5'6", , Las Cruces, NM
#3 | Ty Brown | WR | Fr | 6' 0" | 180 | Dallas, TX

`);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ name: 'John Smith', jersey: '12', position: 'QB', class_year: 'Jr', height: '6-2', weight: 205, hometown: 'Tyler, TX' });
    expect(rows[1]).toMatchObject({ name: 'Maria Lopez', jersey: null, position: 'SS', height: '5-6', weight: null, hometown: 'Las Cruces, NM' });
    expect(rows[2]).toMatchObject({ name: 'Ty Brown', jersey: '3', height: '6-0', weight: 180, hometown: 'Dallas, TX' });
  });
});

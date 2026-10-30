import { describe, expect, it } from 'vitest';
import { espnDate, espnTeamUrl, inLiveWindow, parseScoreboard } from '../../src/worker/lib/livescore';

// Shaped like ESPN's public scoreboard response; teams and numbers are fictional.
const board = (state: string, home: string, away: string, detail: string) => ({
  events: [
    { id: '900', competitions: [{ competitors: [{ homeAway: 'home', score: '70', team: { id: '1' } }, { homeAway: 'away', score: '60', team: { id: '2' } }], status: { type: { state: 'in', shortDetail: '1st Half' } } }] },
    { id: '401', competitions: [{ competitors: [{ homeAway: 'home', score: home, team: { id: '166' } }, { homeAway: 'away', score: away, team: { id: '9999' } }], status: { type: { state, shortDetail: detail } } }] },
  ],
});

describe('ESPN live scores', () => {
  it('finds the NM State game and reads the score and clock', () => {
    expect(parseScoreboard(board('in', '42', '31', '2nd Half 8:14'), 'mbb')).toEqual({
      state: 'in', detail: '2nd Half 8:14', nmsu_score: 42, opp_score: 31, espn_url: 'https://www.espn.com/mens-college-basketball/game/_/gameId/401',
    });
  });
  it('shows no score before tip-off and the final afterwards', () => {
    expect(parseScoreboard(board('pre', '0', '0', '7:30 PM'), 'fb')).toMatchObject({ state: 'pre', nmsu_score: null, espn_url: 'https://www.espn.com/college-football/game/_/gameId/401' });
    expect(parseScoreboard(board('post', '28', '35', 'Final'), 'fb')).toMatchObject({ state: 'post', nmsu_score: 28, opp_score: 35 });
  });
  it('returns nothing for other sports, missing games or unexpected data', () => {
    expect(parseScoreboard(board('in', '1', '0', 'x'), 'vb')).toBeNull();
    expect(parseScoreboard({ events: [] }, 'fb')).toBeNull();
    expect(parseScoreboard({ nope: true }, 'fb')).toBeNull();
    expect(parseScoreboard(null, 'fb')).toBeNull();
  });
  it('uses the US Eastern date ESPN files games under, and a game-day window', () => {
    expect(espnDate(Date.UTC(2026, 10, 4, 1, 30))).toBe('20261103'); // 6:30 PM MT Nov 3 = 8:30 PM ET Nov 3
    const start = Date.UTC(2026, 10, 4, 1, 30);
    expect(inLiveWindow(start, start - 20 * 60_000)).toBe(true);
    expect(inLiveWindow(start, start - 2 * 3_600_000)).toBe(false);
    expect(inLiveWindow(start, start + 6 * 3_600_000)).toBe(false);
  });
  it('links football and men\'s basketball to the NM State team page on ESPN', () => {
    expect(espnTeamUrl('fb')).toBe('https://www.espn.com/college-football/team/_/id/166');
    expect(espnTeamUrl('mbb')).toBe('https://www.espn.com/mens-college-basketball/team/_/id/166');
    expect(espnTeamUrl('soft')).toBeNull();
  });
});

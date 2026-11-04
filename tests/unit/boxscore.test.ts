import { describe, expect, it } from 'vitest';
import { parseBoxScore } from '../../src/worker/lib/boxscore';

// Shaped like ESPN's public game summary (boxscore.players / boxscore.teams).
const mbbLabels = ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF'];
const mbb = {
  boxscore: {
    teams: [
      { team: { id: '999' }, statistics: [{ label: 'Field Goal %', displayValue: '41.0' }, { label: 'Rebounds', displayValue: '30' }] },
      { team: { id: '166' }, statistics: [{ label: 'Field Goal %', displayValue: '52.3' }, { label: 'Rebounds', displayValue: '38' }, { label: 'Odd Stat', displayValue: '1' }] },
    ],
    players: [
      { team: { id: '999', displayName: 'Western New Mexico Mustangs', shortDisplayName: 'W. New Mexico' }, statistics: [{ labels: mbbLabels, athletes: [
        { athlete: { displayName: 'Opp Guard', shortName: 'O. Guard' }, starter: true, stats: ['30', '12', '5-11', '2-5', '0-0', '3', '4', '2', '1', '0', '1', '2', '3'] },
      ], totals: ['200', '60', '22-54', '6-20', '10-14', '30', '11', '15', '5', '2', '8', '22', '18'] }] },
      { team: { id: '166', displayName: 'New Mexico State Aggies', shortDisplayName: 'NM State' }, statistics: [{ labels: mbbLabels, athletes: [
        { athlete: { displayName: 'Fictional Starter', shortName: 'F. Starter' }, starter: true, stats: ['32', '21', '8-13', '3-6', '2-2', '7', '5', '1', '2', '1', '2', '5', '2'] },
        { athlete: { displayName: 'Bench Guy', shortName: 'B. Guy' }, starter: false, stats: ['10', '4', '2-3', '0-1', '0-0', '1', '0', '0', '0', '0', '0', '1', '1'] },
        { athlete: { displayName: 'Did Not Play', shortName: 'D. Np' }, didNotPlay: true, stats: [] },
      ], totals: ['200', '78', '30-57', '8-21', '10-12', '38', '16', '10', '7', '4', '9', '29', '14'] }] },
    ],
  },
};

describe('parseBoxScore', () => {
  it('builds a basketball box score with NM State first, phone columns, totals and team stats', () => {
    const b = parseBoxScore(mbb, 'mbb')!;
    expect(b.teams.map((t) => t.name)).toEqual(['NM State', 'W. New Mexico']);
    const g = b.teams[0].groups[0];
    expect(g.labels).toEqual(['MIN', 'PTS', 'REB', 'AST', 'FG', '3PT', 'FT', 'STL', 'BLK', 'TO', 'PF']);
    expect(g.players).toHaveLength(2);
    expect(g.players[0]).toEqual({ name: 'F. Starter', starter: true, stats: ['32', '21', '7', '5', '8-13', '3-6', '2-2', '2', '1', '1', '2'] });
    expect(g.totals?.[1]).toBe('78');
    expect(b.teams[0].team_stats).toEqual([{ label: 'Field Goal %', value: '52.3' }, { label: 'Rebounds', value: '38' }]);
  });

  it('builds football leaders by category (top 4 per category)', () => {
    const fb = { boxscore: { teams: [], players: [
      { team: { id: '166', shortDisplayName: 'NM State' }, statistics: [
        { name: 'passing', text: 'Passing', labels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'QBR'], athletes: [{ athlete: { shortName: 'Q. Back' }, stats: ['20/30', '250', '8.3', '2', '1', '60.1'] }], totals: ['20/30', '250', '8.3', '2', '1', '--'] },
        { name: 'kickReturns', text: 'Kick Returns', labels: ['NO', 'YDS'], athletes: [{ athlete: { shortName: 'K. R' }, stats: ['1', '20'] }] },
      ] },
    ] } };
    const b = parseBoxScore(fb, 'fb')!;
    expect(b.teams[0].groups).toHaveLength(1);
    expect(b.teams[0].groups[0]).toMatchObject({ name: 'Passing', labels: ['C/ATT', 'YDS', 'TD', 'INT'], players: [{ name: 'Q. Back', stats: ['20/30', '250', '2', '1'] }] });
  });

  it('returns null for anything it cannot read', () => {
    expect(parseBoxScore({}, 'mbb')).toBeNull();
    expect(parseBoxScore({ boxscore: { players: [] } }, 'mbb')).toBeNull();
    expect(parseBoxScore(null, 'fb')).toBeNull();
  });
});

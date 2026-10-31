import { describe, expect, it } from 'vitest';
import { weekStartMT, weeklyWinners } from '../../src/worker/lib/sports';

describe('Nostradamus of the Week', () => {
  it('weeks run Monday to Sunday in Mountain Time', () => {
    // Tue Nov 3, 2026, 6:30 PM MST → week starts Mon Nov 2, 00:00 MST (07:00 UTC).
    expect(weekStartMT(Date.UTC(2026, 10, 4, 1, 30))).toBe(Date.UTC(2026, 10, 2, 7));
    // Sunday 11 PM MST still belongs to that week.
    expect(weekStartMT(Date.UTC(2026, 10, 9, 6, 0))).toBe(Date.UTC(2026, 10, 2, 7));
    // Monday just after midnight MST starts the next week.
    expect(weekStartMT(Date.UTC(2026, 10, 9, 7, 1))).toBe(Date.UTC(2026, 10, 9, 7));
    // Across the end of daylight saving time (Nov 1): the week of Oct 26 starts at 00:00 MDT (06:00 UTC).
    expect(weekStartMT(Date.UTC(2026, 9, 31, 12))).toBe(Date.UTC(2026, 9, 26, 6));
  });
  it('most points wins, ties share, and an empty week has no winner', () => {
    expect(weeklyWinners([{ id: 1, pts: 4 }, { id: 2, pts: 3 }])).toEqual([{ id: 1, pts: 4 }]);
    expect(weeklyWinners([{ id: 1, pts: 3 }, { id: 2, pts: 3 }, { id: 3, pts: 1 }]).map((r) => r.id)).toEqual([1, 2]);
    expect(weeklyWinners([])).toEqual([]);
    expect(weeklyWinners([{ id: 1, pts: 0 }])).toEqual([]);
  });
});

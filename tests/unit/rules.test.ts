import { describe, expect, it } from 'vitest';
import { predictionPoints, seasonOf } from '../../src/worker/lib/sports';
import { isArchived, ARCHIVE_AFTER } from '../../src/worker/lib/threads';
import { extractMentions } from '../../src/worker/util';

describe('archive rule', () => {
  const t = Date.UTC(2026, 9, 30);
  it('archives 90 days after the last reply', () => {
    expect(isArchived({ last_post_at: t - ARCHIVE_AFTER - 1, reopened_at: 0, archive_exempt: 0 }, t)).toBe(true);
    expect(isArchived({ last_post_at: t - ARCHIVE_AFTER + 1000, reopened_at: 0, archive_exempt: 0 }, t)).toBe(false);
  });
  it('respects admin reopen and archive-exempt forums', () => {
    expect(isArchived({ last_post_at: 0, reopened_at: t - 1000, archive_exempt: 0 }, t)).toBe(false);
    expect(isArchived({ last_post_at: 0, reopened_at: 0, archive_exempt: 1 }, t)).toBe(false);
  });
});

describe('predictions', () => {
  const win = { result: 'W', nmsu_score: 31, opp_score: 14 };
  it('scores 1 for the winner and +2 for the exact score', () => {
    expect(predictionPoints({ pick: 'nmsu', nmsu_score: null, opp_score: null }, win)).toBe(1);
    expect(predictionPoints({ pick: 'nmsu', nmsu_score: 31, opp_score: 14 }, win)).toBe(3);
    expect(predictionPoints({ pick: 'opp', nmsu_score: 10, opp_score: 20 }, win)).toBe(0);
  });
  it('groups seasons July to June', () => {
    expect(seasonOf(Date.UTC(2026, 8, 1))).toBe('2026-27');
    expect(seasonOf(Date.UTC(2027, 2, 1))).toBe('2026-27');
  });
});

describe('mentions', () => {
  it('finds @usernames but not emails', () => {
    expect(extractMentions('Great call @AggieFan82 and @crimson_76! mail me at a@b.com')).toEqual(['aggiefan82', 'crimson_76']);
  });
});

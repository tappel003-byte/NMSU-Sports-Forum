import { describe, expect, it } from 'vitest';
import { parseFacebookUrl } from '../../src/shared/forum';

describe('parseFacebookUrl', () => {
  it('recognizes posts, share links, photos, videos and reels', () => {
    expect(parseFacebookUrl('https://www.facebook.com/NMStateAthletics/posts/pfbid02abcXYZ')).toEqual({ canonical: 'https://www.facebook.com/NMStateAthletics/posts/pfbid02abcXYZ', video: false });
    expect(parseFacebookUrl('https://www.facebook.com/share/p/1AbCdEf/?mibextid=xyz')).toEqual({ canonical: 'https://www.facebook.com/share/p/1AbCdEf/', video: false });
    expect(parseFacebookUrl('https://m.facebook.com/story.php?story_fbid=123&id=456&ref=x')?.canonical).toBe('https://www.facebook.com/story.php?story_fbid=123&id=456');
    expect(parseFacebookUrl('https://www.facebook.com/photo.php?fbid=789&set=a.1')?.video).toBe(false);
    expect(parseFacebookUrl('https://www.facebook.com/NMStateAthletics/videos/1234567890')?.video).toBe(true);
    expect(parseFacebookUrl('https://www.facebook.com/reel/987654321')?.video).toBe(true);
    expect(parseFacebookUrl('https://www.facebook.com/share/v/1XyZ/')?.video).toBe(true);
    expect(parseFacebookUrl('https://fb.watch/abc123/')).toEqual({ canonical: 'https://fb.watch/abc123/', video: true });
    expect(parseFacebookUrl('https://www.facebook.com/groups/aggiefans/posts/111222/')?.video).toBe(false);
  });
  it('ignores pages, other sites and look-alike hosts', () => {
    expect(parseFacebookUrl('https://www.facebook.com/NMStateAthletics')).toBeNull();
    expect(parseFacebookUrl('https://www.facebook.com/')).toBeNull();
    expect(parseFacebookUrl('https://evilfacebook.com/x/posts/1')).toBeNull();
    expect(parseFacebookUrl('https://facebook.com.evil.net/x/posts/1')).toBeNull();
    expect(parseFacebookUrl('https://x.com/nmstate/status/123456')).toBeNull();
    expect(parseFacebookUrl('not a url')).toBeNull();
  });
});

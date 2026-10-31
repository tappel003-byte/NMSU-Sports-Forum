import { describe, expect, it } from 'vitest';
import { articleUrl, isRelevant, parseRecurring, parseRss } from '../../src/worker/lib/topics';

// Fictional headlines in common RSS shapes (an athletics site feed and a news-search feed with a redirect link).
const ATHLETICS = `<?xml version="1.0"?><rss version="2.0"><channel><title>NM State Athletics</title>
<item><title><![CDATA[Aggies Add Sample Assistant Coach]]></title><link>https://nmstatesports.com/news/2026/10/30/sample.aspx</link><pubDate>Fri, 30 Oct 2026 18:00:00 GMT</pubDate><description><![CDATA[<p>Sample story &amp; details.</p>]]></description></item>
<item><title>No link here</title></item>
</channel></rss>`;
const SEARCH = `<rss><channel><title>Bing: NM State</title>
<item><title>New Mexico State tops Sample U in opener</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fwww.example-news.test%2fstory%2f1&amp;c=1</link><pubDate>Sat, 31 Oct 2026 02:00:00 GMT</pubDate><News:Source>Example News</News:Source><description>NM State won.</description></item>
<item><title>Texas A&amp;M Aggies win big</title><link>https://www.example-news.test/other</link><description>A different team.</description></item>
</channel></rss>`;

describe('Aggie News Desk feed reading', () => {
  it('reads titles, links, dates and sources, skipping items without a link', () => {
    const items = parseRss(ATHLETICS);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Aggies Add Sample Assistant Coach', url: 'https://nmstatesports.com/news/2026/10/30/sample.aspx', source: 'nmstatesports.com', summary: 'Sample story & details.' });
    expect(items[0].published).toBe(Date.UTC(2026, 9, 30, 18));
  });
  it('unwraps news-search redirect links to the real article and keeps the source name', () => {
    const [first] = parseRss(SEARCH);
    expect(first.url).toBe('https://www.example-news.test/story/1');
    expect(first.source).toBe('Example News');
    expect(articleUrl('https://example.test/plain')).toBe('https://example.test/plain');
  });
  it('keeps official athletics stories and only clearly-NM State stories from searches', () => {
    const [ours, theirs] = parseRss(SEARCH);
    expect(isRelevant(ours, 'https://www.bing.com/news/search?q=x')).toBe(true);
    expect(isRelevant(theirs, 'https://www.bing.com/news/search?q=x')).toBe(false);
    expect(isRelevant(parseRss(ATHLETICS)[0], 'https://nmstatesports.com/rss.aspx')).toBe(true);
  });
});

describe('weekly topics', () => {
  it('reads "day | time | title" lines in 12- or 24-hour time', () => {
    expect(parseRecurring('Mon | 6:00 PM | Radio Show Tonight')).toEqual({ day: 1, minutes: 18 * 60, title: 'Radio Show Tonight' });
    expect(parseRecurring('tuesday | 07:30 | Cup of Joe')).toEqual({ day: 2, minutes: 7 * 60 + 30, title: 'Cup of Joe' });
    expect(parseRecurring('Sun | 12 am | Late night')).toEqual({ day: 0, minutes: 0, title: 'Late night' });
    expect(parseRecurring('Someday | 6 PM | Nope')).toBeNull();
    expect(parseRecurring('Fri | 25:00 | Nope')).toBeNull();
    expect(parseRecurring('Fri | 6 PM |')).toBeNull();
  });
});

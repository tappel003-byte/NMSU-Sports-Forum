// Sports covered by the forum, the venue forum each belongs to, and the official
// schedule page used for outbound links. Official URLs follow nmstatesports.com's
// standard layout and should be confirmed alongside the feed URLs (SPORTS_DATA.md).
export interface Sport {
  key: string;
  label: string;
  short: string;
  forum: string;
  icon: string;
  schedulePath: string;
}

export const OFFICIAL_SITE = 'https://nmstatesports.com';

export const SPORTS: Sport[] = [
  { key: 'fb', label: 'Football', short: 'Football', forum: 'aggie-memorial', icon: '🏈', schedulePath: 'football' },
  { key: 'mbb', label: "Men's Basketball", short: "Men's Hoops", forum: 'the-pan-am', icon: '🏀', schedulePath: 'mens-basketball' },
  { key: 'wbb', label: "Women's Basketball", short: "Women's Hoops", forum: 'the-pan-am', icon: '🏀', schedulePath: 'womens-basketball' },
  { key: 'vb', label: 'Volleyball', short: 'Volleyball', forum: 'the-pan-am', icon: '🏐', schedulePath: 'womens-volleyball' },
  { key: 'base', label: 'Baseball', short: 'Baseball', forum: 'presley-askew-field', icon: '⚾', schedulePath: 'baseball' },
  { key: 'soft', label: 'Softball', short: 'Softball', forum: 'softball-complex', icon: '🥎', schedulePath: 'softball' },
  { key: 'wsoc', label: "Women's Soccer", short: 'Soccer', forum: 'the-pitch', icon: '⚽', schedulePath: 'womens-soccer' },
  { key: 'track', label: 'Track & Field', short: 'Track', forum: 'track-and-field', icon: '🏃', schedulePath: 'track-and-field' },
  { key: 'xc', label: 'Cross Country', short: 'Cross Country', forum: 'track-and-field', icon: '🏃', schedulePath: 'cross-country' },
  { key: 'mgolf', label: "Men's Golf", short: 'Golf', forum: 'other-sports', icon: '⛳', schedulePath: 'mens-golf' },
  { key: 'wgolf', label: "Women's Golf", short: 'Golf', forum: 'other-sports', icon: '⛳', schedulePath: 'womens-golf' },
  { key: 'wten', label: "Women's Tennis", short: 'Tennis', forum: 'other-sports', icon: '🎾', schedulePath: 'womens-tennis' },
  { key: 'swim', label: 'Swimming & Diving', short: 'Swimming', forum: 'other-sports', icon: '🏊', schedulePath: 'womens-swimming-and-diving' },
];

export const SPORT_BY_KEY: Record<string, Sport> = Object.fromEntries(SPORTS.map((s) => [s.key, s]));

export function sportLabel(key: string | null | undefined): string {
  return (key && SPORT_BY_KEY[key]?.label) || 'Other';
}

export function officialScheduleUrl(key: string): string {
  const s = SPORT_BY_KEY[key];
  return s ? `${OFFICIAL_SITE}/sports/${s.schedulePath}/schedule` : `${OFFICIAL_SITE}/calendar`;
}

export const TIME_ZONE = 'America/Denver';

export const BADGES: Record<string, { label: string; description: string }> = {
  founding: { label: 'Founding Member', description: 'Joined in the first 30 days after launch.' },
  honorary_founding: { label: 'Honorary Founding Member', description: 'Recognized by the community as a founder in spirit.' },
  supporter: { label: 'Clubhouse Supporter', description: 'Helped pay for the domain or hosting.' },
  architect: { label: 'Forum Architect', description: 'Designed a feature or layout.' },
  developer: { label: 'Forum Developer', description: 'Contributed code or fixes.' },
  idea: { label: 'Idea Contributor', description: 'Suggested an idea that was implemented.' },
  builder: { label: 'Community Builder', description: 'Helped grow and strengthen the community.' },
};

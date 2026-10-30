import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SPORT_BY_KEY, TIME_ZONE } from '../shared/sports';
import { useApp } from './state';

export function timeAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }).format(new Date(t));
}

export function gameTime(t: number, tba = false): string {
  const d = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(t));
  if (tba) return `${d} · Time TBA`;
  const time = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(t));
  return `${d} · ${time} MT`;
}

export function dateParts(t: number) {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, ...o }).format(new Date(t));
  return { month: f({ month: 'short' }), day: f({ day: 'numeric' }), weekday: f({ weekday: 'long' }), full: f({ weekday: 'long', month: 'long', day: 'numeric' }) };
}

export function fullTime(t: number): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(t)) + ' MT';
}

export function sportName(key: string | null | undefined) {
  return (key && SPORT_BY_KEY[key]?.label) || 'Other';
}

export function sportIcon(key: string | null | undefined) {
  return (key && SPORT_BY_KEY[key]?.icon) || '🏅';
}

export function matchup(g: { opponent: string; home_away: string }) {
  return g.home_away === 'away' ? `at ${g.opponent}` : `vs. ${g.opponent}`;
}

/** Final score, hidden behind a tap when the member has spoiler-free mode on. */
export function Score({ game }: { game: { status: string; result: string | null; nmsu_score: number | null; opp_score: number | null } }) {
  const { me } = useApp();
  const [shown, setShown] = useState(false);
  if (game.status === 'canceled') return <span className="chip gray">Canceled</span>;
  if (game.status === 'postponed') return <span className="chip gray">Postponed</span>;
  if (game.status !== 'final') return null;
  const text = game.result ? `${game.result} ${game.nmsu_score ?? ''}–${game.opp_score ?? ''}` : 'Final';
  if (me?.prefs?.spoiler_free && !shown) {
    return <button type="button" className="spoiler" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShown(true); }}>Final · tap to reveal</button>;
  }
  return <span className={`result ${game.result ?? ''}`}>{text}</span>;
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
const INLINE_RE = /(\*\*[^*]+\*\*|@[A-Za-z0-9_]{3,24}\b|https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]|\/(?:games|t|members|events)\/\d+[^\s]*)/g;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('@')) out.push(<Link key={k} to={`/u/${tok.slice(1)}`}>{tok}</Link>);
    else if (tok.startsWith('/')) out.push(<Link key={k} to={tok}>{tok}</Link>);
    else out.push(<a key={k} href={tok} target="_blank" rel="noopener noreferrer nofollow">{tok.replace(/^https?:\/\//, '').slice(0, 60)}</a>);
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Safe post renderer: paragraphs, > quotes, **bold**, links and @mentions. No raw HTML is ever rendered. */
export function PostBody({ text }: { text: string }) {
  const blocks: { quote: boolean; lines: string[] }[] = [];
  for (const line of text.split('\n')) {
    const quote = line.startsWith('>');
    const content = quote ? line.replace(/^>\s?/, '') : line;
    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock && lastBlock.quote === quote && !(content === '' && !quote)) lastBlock.lines.push(content);
    else blocks.push({ quote, lines: [content] });
  }
  return (
    <div className="post-body">
      {blocks.map((b, bi) => {
        const paras = b.lines.join('\n').split(/\n{2,}/).filter((p) => p.trim());
        const content = paras.map((p, pi) => (
          <p key={pi}>{p.split('\n').map((l, li) => <Fragment key={li}>{li > 0 && <br />}{inline(l, `${bi}-${pi}-${li}`)}</Fragment>)}</p>
        ));
        return b.quote ? <blockquote key={bi}>{content}</blockquote> : <Fragment key={bi}>{content}</Fragment>;
      })}
    </div>
  );
}

export { URL_RE };

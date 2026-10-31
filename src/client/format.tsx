import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { parseFacebookUrl, parseTweetUrl, parseYouTubeId } from '../shared/forum';
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

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span className={`spoiler-text ${shown ? 'shown' : ''}`} role="button" tabIndex={0} aria-label={shown ? undefined : 'Spoiler, tap to reveal'}
      onClick={() => setShown(true)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setShown(true)}>{children}</span>
  );
}

const SPOILER_RE = /\|\|([\s\S]+?)\|\||\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi;

function withSpoilers(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(SPOILER_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(...inline(text.slice(last, idx), `${keyBase}-t${i}`));
    out.push(<Spoiler key={`${keyBase}-s${i}`}>{inline(m[1] ?? m[2] ?? '', `${keyBase}-si${i}`)}</Spoiler>);
    last = idx + m[0].length;
    i++;
  }
  if (last < text.length) out.push(...inline(text.slice(last), `${keyBase}-t${i}`));
  return out;
}

interface PreviewData { url: string; kind: 'x' | 'youtube' | 'link'; ok: boolean; title: string | null; description: string | null; site: string | null; author: string | null; published: string | null }
const previewCache = new Map<string, Promise<PreviewData | null>>();

function loadPreview(url: string): Promise<PreviewData | null> {
  if (!previewCache.has(url)) {
    previewCache.set(url, fetch(`/api/preview?url=${encodeURIComponent(url)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<{ preview?: PreviewData }>) : null)).then((d) => d?.preview ?? null).catch(() => null));
  }
  return previewCache.get(url)!;
}

function YouTube({ id, title }: { id: string; title?: string | null }) {
  const [play, setPlay] = useState(false);
  return (
    <div className="yt">
      {play ? (
        <iframe src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1`} title={title ?? 'YouTube video'} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
      ) : (
        <>
          <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" />
          <button type="button" onClick={() => setPlay(true)} aria-label={`Play ${title ?? 'video'}`}>▶</button>
        </>
      )}
    </div>
  );
}

/** Facebook post card. The post itself loads from Facebook only when tapped (no Facebook tracking until then). */
function FacebookPost({ url, canonical, video }: { url: string; canonical: string; video: boolean }) {
  const [show, setShow] = useState(false);
  const src = `https://www.facebook.com/plugins/${video ? 'video' : 'post'}.php?href=${encodeURIComponent(canonical)}&show_text=true&width=500`;
  return (
    <div className="preview fb">
      <div className="head"><span className="logo fb-logo" aria-hidden="true">f</span><span>Facebook {video ? 'video' : 'post'}</span></div>
      {show ? (
        <iframe className="fb-frame" src={src} title={`Facebook ${video ? 'video' : 'post'}`} scrolling="yes" allow="encrypted-media; picture-in-picture; clipboard-write" allowFullScreen />
      ) : (
        <button type="button" className="btn secondary small" style={{ marginTop: 6 }} onClick={() => setShow(true)}>Show the post here</button>
      )}
      <div className="tiny muted" style={{ marginTop: 6 }}>
        <a href={url} target="_blank" rel="noopener noreferrer nofollow">Open on Facebook ↗</a>
        {show && ' · If it stays blank, the post is private or Facebook won\'t show it outside Facebook.'}
      </div>
    </div>
  );
}

/** Rich card for a pasted link: tweets, Facebook posts, YouTube videos and articles. */
export function LinkPreview({ url }: { url: string }) {
  const [p, setP] = useState<PreviewData | null | undefined>(undefined);
  const yt = parseYouTubeId(url);
  const tweet = parseTweetUrl(url);
  const fb = parseFacebookUrl(url);
  useEffect(() => { if (fb) return; let live = true; loadPreview(url).then((d) => live && setP(d)); return () => { live = false; }; }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  if (fb) return <FacebookPost url={url} canonical={fb.canonical} video={fb.video} />;
  if (yt) return <YouTube id={yt} title={p?.title} />;
  if (tweet) {
    return (
      <a className="preview x" href={tweet.canonical.replace('twitter.com', 'x.com')} target="_blank" rel="noopener noreferrer nofollow">
        <div className="head"><span className="logo" aria-hidden="true">𝕏</span><span>{p?.author ?? `@${tweet.user}`}</span><span className="tiny muted">@{tweet.user}</span></div>
        <div className="text" style={{ marginTop: 4 }}>{p === undefined ? 'Loading post…' : p?.ok && p.description ? p.description : 'This post is unavailable (it may have been deleted or made private). Tap to try it on X.'}</div>
        <div className="tiny muted" style={{ marginTop: 4 }}>{p?.published ? `${p.published} · ` : ''}View on X ↗</div>
      </a>
    );
  }
  if (!p || !p.ok || !p.title) return null;
  return (
    <a className="preview" href={url} target="_blank" rel="noopener noreferrer nofollow">
      <div className="site">{p.site}</div>
      <div className="title">{p.title}</div>
      {p.description && <div className="text small muted">{p.description.slice(0, 220)}</div>}
    </a>
  );
}

/** Safe post renderer: paragraphs, > quotes, **bold**, spoilers, links with previews and @mentions. No raw HTML is ever rendered. */
export function PostBody({ text, previews = true }: { text: string; previews?: boolean }) {
  const blocks: { quote: boolean; lines: string[] }[] = [];
  for (const line of text.split('\n')) {
    const quote = line.startsWith('>');
    const content = quote ? line.replace(/^>\s?/, '') : line;
    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock && lastBlock.quote === quote && !(content === '' && !quote)) lastBlock.lines.push(content);
    else blocks.push({ quote, lines: [content] });
  }
  const urls = previews
    ? [...new Set(blocks.filter((b) => !b.quote).flatMap((b) => b.lines.join(' ').replace(SPOILER_RE, ' ').match(URL_RE) ?? []))].slice(0, 3)
    : [];
  return (
    <div className="post-body">
      {blocks.map((b, bi) => {
        const paras = b.lines.join('\n').split(/\n{2,}/).filter((p) => p.trim());
        const content = paras.map((p, pi) => (
          <p key={pi}>{p.split('\n').map((l, li) => <Fragment key={li}>{li > 0 && <br />}{withSpoilers(l, `${bi}-${pi}-${li}`)}</Fragment>)}</p>
        ));
        return b.quote ? <blockquote key={bi}>{content}</blockquote> : <Fragment key={bi}>{content}</Fragment>;
      })}
      {urls.map((u) => <LinkPreview key={u} url={u} />)}
    </div>
  );
}

export { URL_RE };

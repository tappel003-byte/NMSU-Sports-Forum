import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { List, Plus, Rows3 } from 'lucide-react';
import { ShareModal } from '../components/Share';
import { TAGS } from '../../shared/forum';
import { api } from '../api';
import { useApi, useApp } from '../state';
import { Score, gameTime, matchup, sportIcon, sportName, timeAgo } from '../format';
import { ErrorState, GameRow, JoinCta, Loading, ThreadList, type GameItem, type MemberLite, type ThreadItem } from '../components/ui';

interface HomeData {
  games: GameItem[];
  live: GameItem[];
  feedsConfigured: boolean;
  stats: { unread: number; replies: number; chatting: number };
  weekly: { id: number; thread_id: number; body: string; up: number; title: string; author: MemberLite | null } | null;
  online: MemberLite[];
  events: { id: number; title: string; kind: string; location: string; starts_at: number }[];
  announcement: string;
  birthdays: { id: number; username: string }[];
  followed: ThreadItem[];
}

const TABS = [
  ['latest', 'Latest'], ['unread', 'Unread'], ['following', 'Following'], ['popular', 'Popular'],
] as const;

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function Scoreboard() {
  const { data } = useApi<{ recent: GameItem[]; next: GameItem[] }>('/scoreboard');
  if (!data || (!data.recent.length && !data.next.length)) return null;
  return (
    <div className="scoreboard" aria-label="Latest scores">
      {data.recent.map((g) => (
        <Link key={g.id} to={`/games/${g.id}`} className="score-chip">
          <span className="tiny muted">{sportIcon(g.sport)} {sportName(g.sport)}</span>
          <span className="score-line"><span className="grow">{matchup(g)}</span> <Score game={g} /></span>
        </Link>
      ))}
      {data.next.map((g) => (
        <Link key={g.id} to={`/games/${g.id}`} className="score-chip">
          <span className="tiny muted">{sportIcon(g.sport)} Next · {sportName(g.sport)}</span>
          <span className="score-line"><span className="grow">{matchup(g)}</span> {g.live ? <span className="chip live">Game day</span> : <span className="tiny muted">{gameTime(g.starts_at, g.time_tba)}</span>}</span>
        </Link>
      ))}
    </div>
  );
}

export function Feed({ initialTab = 'latest', compact = false }: { initialTab?: string; compact?: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? initialTab;
  const tag = params.get('tag') ?? '';
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<{ threads: ThreadItem[]; hasMore: boolean; needsSports?: boolean }>(`/feed?tab=${tab}&page=${page}${tag ? `&tag=${tag}` : ''}${compact ? '' : '&games=1'}`);
  const { me, refreshPulse, toast, refresh } = useApp();
  const [share, setShare] = useState(false);
  const toggleCompact = async () => {
    await api('/me/prefs', { method: 'PATCH', body: { compact: !me?.prefs?.compact } });
    refresh();
  };
  const markAll = async () => {
    await api('/mark-all-read', { method: 'POST' });
    toast('Everything marked as read');
    refreshPulse();
    reload();
  };
  return (
    <section className="card">
      <div className="section-head">
        <h2>{compact ? 'Community discussions' : 'The Board'}</h2>
        <div className="row">
          {tab === 'unread' && <button className="btn ghost small" onClick={markAll}>Mark all read</button>}
          {me && <button className="btn ghost small" onClick={toggleCompact} aria-pressed={Boolean(me?.prefs?.compact)} title="Compact list">{me?.prefs?.compact ? <List size={16} /> : <Rows3 size={16} />}<span className="sr-only">Compact list</span></button>}
          {me && <button className="btn secondary small" onClick={() => setShare(true)}>Share a tweet</button>}
          {me && <Link to="/new" className="btn secondary small">🏟️ Game thread</Link>}
          {me && <Link to="/new" className="btn small desktop-only-inline"><Plus size={16} /> New thread</Link>}
        </div>
      </div>
      {!compact && <Scoreboard />}
      <div className="tabs" role="tablist">
        {TABS.filter(([k]) => me || k === 'latest' || k === 'popular').map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => { setPage(1); setParams((p) => { p.set('tab', k); return p; }, { replace: true }); }}>{label}</button>
        ))}
      </div>
      <div className="filter-row" aria-label="Filter by tag">
        <button className={`btn small ${tag ? 'secondary' : ''}`} onClick={() => { setPage(1); setParams((p) => { p.delete('tag'); return p; }, { replace: true }); }}>All topics</button>
        {Object.entries(TAGS).map(([k, v]) => (
          <button key={k} className={`btn small ${tag === k ? '' : 'secondary'}`} onClick={() => { setPage(1); setParams((p) => { p.set('tag', k); return p; }, { replace: true }); }}>{v}</button>
        ))}
      </div>
      {share && <ShareModal onClose={() => setShare(false)} />}
      {me && <Link to="/new" className="fab" aria-label="Start a new discussion"><Plus size={26} /></Link>}
      {loading && !data ? <Loading /> : error ? <ErrorState error={error} retry={reload} /> : data?.needsSports ? (
        <div className="empty">Pick your favorite sports in <Link to="/settings">Settings</Link> to build your personal feed.</div>
      ) : (
        <>
          <ThreadList threads={data?.threads ?? []} empty={tab === 'unread' ? "You're all caught up." : tab === 'following' ? 'Follow a discussion to see it here. You automatically follow threads you post in.' : 'No discussions yet. Start the first one!'} />
          {(page > 1 || data?.hasMore) && (
            <div className="pager">
              <button className="btn secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
              <button className="btn secondary small" disabled={!data?.hasMore} onClick={() => setPage(page + 1)}>Older</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function Home() {
  const { me } = useApp();
  const nav = useNavigate();
  const { data, error, reload } = useApi<HomeData>('/home');
  const { data: forums } = useApi<{ forums: { slug: string; name: string; sport_label: string; icon: string; kind: string; unread: number }[] }>('/forums');
  if (error) return <ErrorState error={error} retry={reload} />;
  const next = data?.live[0] ?? data?.games[0];
  return (
    <div className="stack">
      <div className="page-head">
        <div className="eyebrow">{me ? 'Welcome back' : 'Welcome, Aggie fans'}</div>
        <h1>{me ? `${greeting()}, ${me.display_name || me.username}.` : 'NMSU Sports Forum'}</h1>
        <div className="muted small">The latest from your NMSU sports community.</div>
      </div>

      {!me && <JoinCta text="Free, no ads. Join to post, react, chat on game day and track recruits." />}
      {data?.announcement && <div className="note-box"><strong>Announcement:</strong> {data.announcement}</div>}

      <section className="hero" aria-label="Next game">
        <div className="grow">
          {next ? (
            <>
              <div className="eyebrow">{data?.live.length ? '● Game day' : 'Next game'} · {sportName(next.sport)}</div>
              <h2>NM State {matchup(next)}</h2>
              <div className="hero-meta">{gameTime(next.starts_at, next.time_tba)}{next.venue ? ` · ${next.venue}` : ''}{next.tv ? ` · ${next.tv}` : ''}</div>
              <div className="row">
                <Link to={`/games/${next.id}`} className="btn on-crimson small">Game page</Link>
                <Link to={`/chat/game-${next.id}`} className="btn on-crimson outline small">Game chat</Link>
                {next.pregame_thread_id && <Link to={`/t/${next.pregame_thread_id}`} className="btn on-crimson outline small">Pregame thread</Link>}
                {next.postgame_thread_id && <Link to={`/t/${next.postgame_thread_id}`} className="btn on-crimson outline small">Postgame thread</Link>}
                <a href={next.official_url} target="_blank" rel="noopener noreferrer" className="btn on-crimson outline small">Official info</a>
              </div>
            </>
          ) : (
            <>
              <div className="eyebrow">Game Center</div>
              <h2>NM State Aggies</h2>
              <div className="hero-meta">{data?.feedsConfigured ? 'No upcoming games on the official calendar right now.' : 'Schedules appear here automatically once the official athletics calendar feeds are connected.'}</div>
              <div className="row"><Link to="/games" className="btn on-crimson small">Game Center</Link><Link to="/chat/lounge" className="btn on-crimson outline small">Aggie Lounge chat</Link></div>
            </>
          )}
        </div>
        <img src="/brand/crest-480.webp" alt="" className="hero-crest" width={92} height={92} />
      </section>

      {me && <div className="stat-grid">
        <Link to="/?tab=unread" className="stat"><b>{data?.stats.unread ?? '–'}</b><span>Unread discussions</span></Link>
        <Link to="/notifications" className="stat"><b>{data?.stats.replies ?? '–'}</b><span>Replies to you</span></Link>
        <Link to="/chat" className="stat"><b>{data?.stats.chatting ?? '–'}</b><span>Chatting now</span></Link>
      </div>}

      {data && data.birthdays.length > 0 && (
        <div className="note-box small">🎂 Happy birthday to {data.birthdays.map((b, i) => <span key={b.id}>{i > 0 && ', '}<Link to={`/members/${b.id}`}>{b.username}</Link></span>)}!</div>
      )}

      <Feed compact />

      {data?.weekly && (
        <Link to={`/t/${data.weekly.thread_id}?post=${data.weekly.id}`} className="card card-pad" style={{ display: 'block', color: 'inherit' }}>
          <div className="eyebrow">🏅 Most appreciated this week</div>
          <div style={{ marginTop: 6 }}>“{data.weekly.body}”</div>
          <div className="small muted" style={{ marginTop: 4 }}>{data.weekly.author?.display_name || data.weekly.author?.username} · 👍 {data.weekly.up} · in {data.weekly.title}</div>
        </Link>
      )}

      {data && data.games.length > 1 && (
        <section className="card desktop-only">
          <div className="section-head"><h2>Upcoming games</h2><Link to="/games" className="small">Full schedule</Link></div>
          {data.games.slice(0, 4).map((g) => <GameRow key={g.id} game={g} />)}
        </section>
      )}

      {data && data.followed.length > 0 && (
        <section className="card">
          <div className="section-head"><h2>Discussions you follow</h2><Link to="/?tab=following" className="small">All</Link></div>
          <ThreadList threads={data.followed} />
        </section>
      )}

      {data && data.events.length > 0 && (
        <section className="card desktop-only">
          <div className="section-head"><h2>Watch parties &amp; gatherings</h2><Link to="/calendar" className="small">Calendar</Link></div>
          {data.events.map((e) => (
            <Link key={e.id} to={`/events/${e.id}`} className="list-row"><span>📍</span><div className="grow"><strong>{e.title}</strong><div className="small muted">{gameTime(e.starts_at)} · {e.location}</div></div></Link>
          ))}
        </section>
      )}

      <div className="row" style={{ justifyContent: 'center' }}>
        {me && <button className="btn small" onClick={() => nav('/invite')}>Invite friends</button>}
        <button className="btn ghost small" onClick={() => nav('/rosters')}>Rosters &amp; links</button>
        <button className="btn ghost small" onClick={() => nav('/recruiting')}>Recruiting &amp; portal</button>
        <button className="btn ghost small" onClick={() => nav('/time-machine')}>Aggie Time Machine</button>
        <button className="btn ghost small" onClick={() => nav('/predictions')}>Prediction standings</button>
        <button className="btn ghost small" onClick={() => nav('/calendar')}>Community calendar</button>
      </div>
      <p className="footer-note">NMSU Sports Forum is an independent fan community, not affiliated with New Mexico State University. Last refreshed {timeAgo(Date.now())}.</p>
    </div>
  );
}

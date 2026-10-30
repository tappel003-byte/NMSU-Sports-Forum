import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../api';
import { useApi, useApp } from '../state';
import { gameTime, matchup, sportName, timeAgo } from '../format';
import { ErrorState, GameRow, Loading, ThreadList, type GameItem, type MemberLite, type ThreadItem } from '../components/ui';

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
  ['latest', 'Latest'], ['unread', 'Unread'], ['following', 'Following'], ['mysports', 'My sports'], ['popular', 'Popular'],
] as const;

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function Feed({ initialTab = 'latest', compact = false }: { initialTab?: string; compact?: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab = compact ? params.get('tab') ?? initialTab : params.get('tab') ?? initialTab;
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<{ threads: ThreadItem[]; hasMore: boolean; needsSports?: boolean }>(`/feed?tab=${tab}&page=${page}`);
  const { refreshPulse, toast } = useApp();
  const markAll = async () => {
    await api('/mark-all-read', { method: 'POST' });
    toast('Everything marked as read');
    refreshPulse();
    reload();
  };
  return (
    <section className="card">
      <div className="section-head">
        <h2>{compact ? 'Community discussions' : 'All discussions'}</h2>
        <div className="row">
          {tab === 'unread' && <button className="btn ghost small" onClick={markAll}>Mark all read</button>}
          <Link to="/new" className="btn small"><Plus size={16} /> New thread</Link>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => { setPage(1); setParams((p) => { p.set('tab', k); return p; }, { replace: true }); }}>{label}</button>
        ))}
      </div>
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
        <div className="eyebrow">Welcome back</div>
        <h1>{greeting()}, {me?.display_name || me?.username}.</h1>
        <div className="muted small">The latest from your NMSU sports community.</div>
      </div>

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

      <div className="stat-grid">
        <Link to="/?tab=unread" className="stat"><b>{data?.stats.unread ?? '–'}</b><span>Unread discussions</span></Link>
        <Link to="/notifications" className="stat"><b>{data?.stats.replies ?? '–'}</b><span>Replies to you</span></Link>
        <Link to="/chat" className="stat"><b>{data?.stats.chatting ?? '–'}</b><span>Chatting now</span></Link>
      </div>

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
        <section className="card">
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
        <section className="card">
          <div className="section-head"><h2>Watch parties &amp; gatherings</h2><Link to="/calendar" className="small">Calendar</Link></div>
          {data.events.map((e) => (
            <Link key={e.id} to={`/events/${e.id}`} className="list-row"><span>📍</span><div className="grow"><strong>{e.title}</strong><div className="small muted">{gameTime(e.starts_at)} · {e.location}</div></div></Link>
          ))}
        </section>
      )}

      <section className="card">
        <div className="section-head"><h2>Sports venues</h2><Link to="/forums" className="small">All forums</Link></div>
        <div className="card-pad venue-grid">
          {forums?.forums.filter((f) => f.kind === 'sport').map((f) => (
            <Link key={f.slug} to={`/f/${f.slug}`} className="venue-card">
              <span className="venue-emoji" aria-hidden="true">{f.icon}</span>
              <span className="grow"><span className="venue-name">{f.name}</span><br /><span className="venue-sport">{f.sport_label}</span></span>
              {f.unread > 0 && <span className="chip">{f.unread} new</span>}
            </Link>
          ))}
        </div>
      </section>

      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn ghost small" onClick={() => nav('/time-machine')}>Aggie Time Machine</button>
        <button className="btn ghost small" onClick={() => nav('/predictions')}>Prediction standings</button>
        <button className="btn ghost small" onClick={() => nav('/calendar')}>Community calendar</button>
      </div>
      <p className="footer-note">NMSU Sports Forum is an independent fan community, not affiliated with New Mexico State University. Last refreshed {timeAgo(Date.now())}.</p>
    </div>
  );
}

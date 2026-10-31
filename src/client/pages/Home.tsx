import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { ShareModal } from '../components/Share';
import { FEATURED_SPORTS } from '../../shared/sports';
import { api } from '../api';
import { useApi, useApp } from '../state';
import { Score, gameTime, matchup, sportIcon, sportName, timeAgo } from '../format';
import { ErrorState, GameRow, JoinCta, Loading, ThreadList, type GameItem, type MemberLite, type ThreadItem } from '../components/ui';

interface HomeData {
  games: GameItem[];
  other_games: GameItem[];
  live: GameItem[];
  feedsConfigured: boolean;
  stats: { unread: number; replies: number; chatting: number };
  weekly: { id: number; thread_id: number; body: string; up: number; title: string; author: MemberLite | null } | null;
  online: MemberLite[];
  events: { id: number; title: string; kind: string; location: string; starts_at: number }[];
  announcement: string;
  birthdays: { id: number; username: string }[];
  followed: ThreadItem[];
  nostradamus: { reason: string; member: MemberLite | null }[];
  called: { user_id: number; game_id: number; exact: boolean; sport: string; opponent: string; home_away: string; result: string | null; nmsu_score: number | null; opp_score: number | null; member: MemberLite | null }[];
}

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
  const [params] = useSearchParams();
  const tab = params.get('tab') ?? initialTab;
  const tag = params.get('tag') ?? '';
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<{ threads: ThreadItem[]; hasMore: boolean; needsSports?: boolean }>(`/feed?tab=${tab}&page=${page}${tag ? `&tag=${tag}` : ''}&games=1`);
  const { me, refreshPulse, toast } = useApp();
  const [share, setShare] = useState(false);
  const markAll = async () => {
    await api('/mark-all-read', { method: 'POST' });
    toast('Everything marked as read');
    refreshPulse();
    reload();
  };
  return (
    <section className="card">
      {compact ? (
        // Home shows a short preview of the Board; posting lives on the Board and the + button.
        <div className="feed-head">
          <div className="feed-title">
            <h2>Latest discussions</h2>
            <Link to="/feed" className="small">See all →</Link>
          </div>
        </div>
      ) : (
        <div className="feed-head">
          <div className="feed-title">
            <h2>The Board</h2>
          </div>
          {me && (
            <div className="feed-actions">
              <Link to="/new" className="btn small desktop-only-inline"><Plus size={16} /> New thread</Link>
              <Link to="/new" className="btn secondary small">🏟️ Game thread</Link>
              <button className="btn secondary small" onClick={() => setShare(true)}>Share a tweet</button>
              {tab === 'unread' && <button className="btn ghost small" onClick={markAll}>Mark all read</button>}
            </div>
          )}
        </div>
      )}
      {!compact && <Scoreboard />}
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
  const next = data?.live.find((g) => FEATURED_SPORTS.includes(g.sport)) ?? data?.games[0] ?? data?.live[0] ?? data?.other_games[0];
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
                {FEATURED_SPORTS.includes(next.sport) && <Link to={`/chat/game-${next.id}`} className="btn on-crimson outline small">Game chat</Link>}
                {next.pregame_thread_id && <Link to={`/t/${next.pregame_thread_id}`} className="btn on-crimson outline small">Pregame thread</Link>}
                {next.postgame_thread_id && <Link to={`/t/${next.postgame_thread_id}`} className="btn on-crimson outline small">Postgame thread</Link>}
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

      {data && (data.called.length > 0 || data.nostradamus.length > 0) && (
        <section className="card card-pad">
          <div className="eyebrow">🎯 Predictions this week</div>
          {data.nostradamus.map((n, i) => (
            <div key={i} className="note-box small" style={{ marginTop: 8 }}>
              <strong>🏆 Last week's Nostradamus: {n.member ? <Link to={`/members/${n.member.id}`}>{n.member.display_name || n.member.username}</Link> : 'a member'}</strong>
              <div className="tiny muted">{n.reason.replace(/^Nostradamus of the week of [^:]*: /, '')}</div>
            </div>
          ))}
          {data.called.length > 0 ? (
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              {data.called.map((c) => (
                <Link key={`${c.user_id}-${c.game_id}`} to={`/games/${c.game_id}`} style={{ color: 'inherit' }}>
                  🎯 <strong>{c.member?.display_name || c.member?.username}</strong> called {sportIcon(c.sport)} NM State {matchup(c)}{me?.prefs?.spoiler_free ? '' : ` · ${c.result ?? ''} ${c.nmsu_score ?? ''}–${c.opp_score ?? ''}`}{c.exact && <> · <strong>exact score!</strong></>}
                </Link>
              ))}
            </div>
          ) : <div className="small muted" style={{ marginTop: 8 }}>No one has called a game yet this week. Make your pick on the next game's page.</div>}
          <div className="tiny muted" style={{ marginTop: 8 }}>Whoever calls the most this week (Mon–Sun) becomes Nostradamus of the Week, an award that stays on their member card.</div>
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
        <button className="btn ghost small" onClick={() => nav('/calendar')}>Community calendar</button>
      </div>
      <p className="footer-note">NMSU Sports Forum is an independent fan community, not affiliated with New Mexico State University. Last refreshed {timeAgo(Date.now())}.</p>
    </div>
  );
}

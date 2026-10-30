import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useApi, useApp } from '../state';
import { Score, fullTime, gameTime, matchup, sportIcon, sportName } from '../format';
import { ErrorState, GameRow, JoinCta, Loading, ThreadList, type GameItem, type ThreadItem } from '../components/ui';
import { SPORTS, SPORT_BY_KEY } from '../../shared/sports';

export function Games() {
  const [params, setParams] = useSearchParams();
  const sport = params.get('sport') ?? '';
  const range = params.get('range') ?? 'upcoming';
  const { data, error, loading, reload } = useApi<{ games: GameItem[]; feedsConfigured: boolean; feedsSynced: boolean }>(`/games?range=${range}${sport ? `&sport=${sport}` : ''}`);
  const set = (k: string, v: string) => setParams((p) => { if (v) p.set(k, v); else p.delete(k); return p; }, { replace: true });
  return (
    <div className="stack">
      <div className="page-head">
        <div className="eyebrow">Game Center</div>
        <h1>NM State schedules &amp; game day</h1>
        <p className="muted small" style={{ margin: 0 }}>Schedules and results update automatically from the official NMSU Athletics calendar. During games, follow live stats on the official site and talk it over in game chat.</p>
      </div>
      <section className="card">
        <div className="tabs" role="tablist">
          {[['upcoming', 'Upcoming'], ['past', 'Results'], ['season', 'Full season']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={range === k} className={`tab ${range === k ? 'active' : ''}`} onClick={() => set('range', k === 'upcoming' ? '' : k)}>{l}</button>
          ))}
        </div>
        <div className="filter-row">
          <button className={`btn small ${sport ? 'secondary' : ''}`} onClick={() => set('sport', '')}>All sports</button>
          {SPORTS.map((s) => <button key={s.key} className={`btn small ${sport === s.key ? '' : 'secondary'}`} onClick={() => set('sport', s.key)}>{s.icon} {s.short}</button>)}
        </div>
        {loading && !data ? <Loading /> : error ? <ErrorState error={error} retry={reload} /> : data && data.games.length ? (
          data.games.map((g) => <GameRow key={g.id} game={g} />)
        ) : (
          <div className="empty">
            {!data?.feedsConfigured
              ? 'The official schedule feeds have not been connected yet. Once an administrator connects them, every NM State game appears here automatically.'
              : !data.feedsSynced ? 'Waiting for the first schedule sync from the official athletics calendar.' : 'No games in this view.'}
            <div style={{ marginTop: 10 }}><a href="https://nmstatesports.com/calendar" target="_blank" rel="noopener noreferrer">Official NMSU Athletics calendar ↗</a></div>
          </div>
        )}
      </section>
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link to="/predictions" className="btn secondary small">Prediction standings</Link>
        <Link to="/time-machine" className="btn secondary small">Aggie Time Machine</Link>
      </div>
    </div>
  );
}

interface GameDetail {
  game: GameItem;
  threads: ThreadItem[];
  chat: { room: string; messages: number };
  predictions: { locked: boolean; mine: { pick: string; nmsu_score: number | null; opp_score: number | null; points: number | null } | null; count: number; nmsu: number; opp: number; picks: { username: string; pick: string; nmsu_score: number | null; opp_score: number | null; points: number | null }[] };
  events: { id: number; title: string; kind: string; location: string; starts_at: number }[];
  top_posts: { id: number; thread_id: number; body: string; username: string; up: number }[];
}

export function GamePage() {
  const { id = '' } = useParams();
  const { me, toast } = useApp();
  const { data, error, reload } = useApi<GameDetail>(`/games/${id}`);
  const [pick, setPick] = useState<'nmsu' | 'opp' | ''>('');
  const [scores, setScores] = useState({ nmsu: '', opp: '' });
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  const g = data.game;
  const p = data.predictions;
  const forum = SPORT_BY_KEY[g.sport]?.forum ?? 'other-sports';
  const pregame = data.threads.find((t) => t.game_phase === 'pregame');
  const postgame = data.threads.find((t) => t.game_phase === 'postgame');
  const submitPick = async () => {
    try {
      await api(`/games/${g.id}/predict`, { body: { pick: pick || p.mine?.pick, nmsu_score: scores.nmsu === '' ? null : Number(scores.nmsu), opp_score: scores.opp === '' ? null : Number(scores.opp) } });
      toast('Prediction saved. You can change it until kickoff.');
      reload();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="stack">
      <nav className="small"><Link to="/games">Game Center</Link> › {sportName(g.sport)}</nav>
      <section className="hero">
        <div className="grow">
          <div className="eyebrow">{sportIcon(g.sport)} {sportName(g.sport)}{g.live ? ' · ● Game day' : ''}</div>
          <h2>NM State {matchup(g)}</h2>
          <div className="hero-meta">{gameTime(g.starts_at, g.time_tba)}{g.venue ? ` · ${g.venue}` : ''}</div>
          <div className="hero-meta">{[g.tv && `TV/Stream: ${g.tv}`, g.radio && `Radio: ${g.radio}`].filter(Boolean).join(' · ')}</div>
          <div style={{ marginTop: 8 }}><Score game={g} /></div>
          <div className="row">
            <Link to={`/chat/${data.chat.room}`} className="btn on-crimson small">{g.live ? 'Join live chat' : 'Game chat'}</Link>
            {g.audio_url && <a href={g.audio_url} target="_blank" rel="noopener noreferrer" className="btn on-crimson outline small">🎧 Listen live ↗</a>}
            {g.video_url && <a href={g.video_url} target="_blank" rel="noopener noreferrer" className="btn on-crimson outline small">📺 Watch ↗</a>}
            <a href={g.official_url} target="_blank" rel="noopener noreferrer" className="btn on-crimson outline small">{g.live ? 'Official live stats ↗' : 'Official game info ↗'}</a>
            <a href={g.schedule_url} target="_blank" rel="noopener noreferrer" className="btn on-crimson outline small">Full schedule ↗</a>
          </div>
        </div>
      </section>
      {g.overridden && <div className="notice small">An administrator corrected some details for this game while the official feed was out of date.</div>}

      <section className="card card-pad">
        <h2>🔮 Predictions</h2>
        {!me && !p.locked ? <JoinCta text="Join free to make your pick and climb the season standings." /> : !p.locked ? (
          <>
            <p className="small muted" style={{ marginTop: 0 }}>Pick the winner (1 point). Nail the exact score for 2 bonus points. Picks lock at game time and are scored automatically when the final arrives. {p.count} member{p.count === 1 ? '' : 's'} picked so far.</p>
            {p.mine && <div className="note-box small" style={{ marginBottom: 10 }}>Your pick: <strong>{p.mine.pick === 'nmsu' ? 'NM State' : g.opponent}</strong>{p.mine.nmsu_score !== null ? ` (${p.mine.nmsu_score}–${p.mine.opp_score})` : ''}</div>}
            <div className="row">
              <button className={`btn ${(pick || p.mine?.pick) === 'nmsu' ? '' : 'secondary'}`} onClick={() => setPick('nmsu')}>NM State wins</button>
              <button className={`btn ${(pick || p.mine?.pick) === 'opp' ? '' : 'secondary'}`} onClick={() => setPick('opp')}>{g.opponent} wins</button>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <label className="small">NM State <input className="input" style={{ width: 80, display: 'inline-block' }} type="number" min={0} inputMode="numeric" value={scores.nmsu} onChange={(e) => setScores({ ...scores, nmsu: e.target.value })} /></label>
              <label className="small">{g.opponent} <input className="input" style={{ width: 80, display: 'inline-block' }} type="number" min={0} inputMode="numeric" value={scores.opp} onChange={(e) => setScores({ ...scores, opp: e.target.value })} /></label>
              <button className="btn" disabled={!(pick || p.mine?.pick)} onClick={submitPick}>Save pick</button>
            </div>
          </>
        ) : (
          <>
            <p className="small muted" style={{ marginTop: 0 }}>Picks are locked. {p.nmsu} picked NM State, {p.opp} picked {g.opponent}.</p>
            {p.picks.length ? (
              <div className="table-scroll"><table className="simple"><thead><tr><th>Member</th><th>Pick</th><th>Score</th><th>Points</th></tr></thead><tbody>
                {p.picks.map((x, i) => <tr key={i}><td>{x.username}</td><td>{x.pick === 'nmsu' ? 'NM State' : g.opponent}</td><td>{x.nmsu_score !== null ? `${x.nmsu_score}–${x.opp_score}` : '—'}</td><td>{x.points ?? (g.status === 'final' ? 0 : 'pending')}</td></tr>)}
              </tbody></table></div>
            ) : <div className="small muted">No predictions were made for this game.</div>}
          </>
        )}
      </section>

      <section className="card">
        <div className="section-head"><h2>Game discussions</h2></div>
        <ThreadList threads={data.threads} showForum={false} empty="Pregame and postgame threads are created automatically as game day approaches." />
        <div className="card-pad row">
          {!pregame && <Link className="btn secondary small" to={`/new?forum=${forum}&game=${g.id}&phase=pregame`}>Start pregame thread</Link>}
          {!postgame && g.status === 'final' && <Link className="btn secondary small" to={`/new?forum=${forum}&game=${g.id}&phase=postgame`}>Start postgame thread</Link>}
          <Link className="btn secondary small" to={`/new?forum=${forum}&game=${g.id}`}>New thread about this game</Link>
          <Link className="btn ghost small" to={`/chat/${data.chat.room}/archive`}>Chat archive ({data.chat.messages} messages)</Link>
        </div>
      </section>

      {data.top_posts.length > 0 && (
        <section className="card">
          <div className="section-head"><h2>🏅 Most appreciated from this game</h2></div>
          {data.top_posts.map((tp) => (
            <Link key={tp.id} to={`/t/${tp.thread_id}?post=${tp.id}`} className="list-row"><div className="grow"><div className="small">“{tp.body.slice(0, 200)}”</div><div className="tiny muted">{tp.username} · 👍 {tp.up}</div></div></Link>
          ))}
        </section>
      )}

      <section className="card">
        <div className="section-head"><h2>Watch parties</h2><Link to={`/calendar?new=1&game=${g.id}`} className="btn small secondary">Host one</Link></div>
        {data.events.length ? data.events.map((e) => (
          <Link key={e.id} to={`/events/${e.id}`} className="list-row"><span>📍</span><div className="grow"><strong>{e.title}</strong><div className="small muted">{fullTime(e.starts_at)} · {e.location}</div></div></Link>
        )) : <div className="empty small">No watch parties yet{me ? ' — host one!' : ''}</div>}
      </section>
    </div>
  );
}

export function Predictions() {
  const [season, setSeason] = useState('');
  const { data, error, reload } = useApi<{ season: string; standings: { user_id: number; username: string; display_name: string | null; points: number; picks: number; correct: number }[] }>(`/predictions/standings${season ? `?season=${season}` : ''}`);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  const y = Number(data.season.slice(0, 4));
  return (
    <div className="stack">
      <div className="page-head spread">
        <div><div className="eyebrow">Friendly contest</div><h1>Prediction standings · {data.season}</h1><p className="muted small" style={{ margin: 0 }}>1 point for the right winner, 2 bonus for the exact score. Make picks on any upcoming game page.</p></div>
        <div className="row"><button className="btn secondary small" onClick={() => setSeason(`${y - 1}-${String(y % 100).padStart(2, '0')}`)}>‹ {y - 1}</button><button className="btn secondary small" onClick={() => setSeason(`${y + 1}-${String((y + 2) % 100).padStart(2, '0')}`)}>{y + 1} ›</button></div>
      </div>
      <section className="card">
        {data.standings.length ? (
          <div className="table-scroll"><table className="simple"><thead><tr><th>#</th><th>Member</th><th>Points</th><th>Correct</th><th>Scored picks</th></tr></thead><tbody>
            {data.standings.map((s, i) => <tr key={s.user_id}><td>{i + 1}</td><td><Link to={`/members/${s.user_id}`}>{s.display_name || s.username}</Link></td><td><strong>{s.points}</strong></td><td>{s.correct}</td><td>{s.picks}</td></tr>)}
          </tbody></table></div>
        ) : <div className="empty">No scored predictions yet this season. Picks are scored automatically when final results arrive.</div>}
      </section>
    </div>
  );
}

export function TimeMachine() {
  const [params, setParams] = useSearchParams();
  const season = params.get('season') ?? '';
  const sport = params.get('sport') ?? '';
  const q = new URLSearchParams({ ...(season ? { season } : {}), ...(sport ? { sport } : {}) });
  const { data, error, reload } = useApi<{ season: string; seasons: string[]; games: (GameItem & { posts: number; chats: number; predictions: number })[] }>(`/time-machine?${q}`);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  const set = (k: string, v: string) => setParams((p) => { if (v) p.set(k, v); else p.delete(k); return p; }, { replace: true });
  return (
    <div className="stack">
      <div className="page-head">
        <div className="eyebrow">Aggie Time Machine</div>
        <h1>Relive every game, the way we lived it</h1>
        <p className="muted small" style={{ margin: 0 }}>Every past game keeps its pregame predictions, live chat, postgame thread and most appreciated posts — forever.</p>
      </div>
      <section className="card">
        <div className="filter-row">
          <select className="select" style={{ width: 'auto' }} value={season || data.season} onChange={(e) => set('season', e.target.value)} aria-label="Season">
            {[...new Set([data.season, ...data.seasons])].map((s) => <option key={s} value={s}>{s} season</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={sport} onChange={(e) => set('sport', e.target.value)} aria-label="Sport">
            <option value="">All sports</option>
            {SPORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        {data.games.length ? data.games.map((g) => (
          <GameRow key={g.id} game={g} extra={<div className="tiny muted">💬 {g.posts} posts · 🗨️ {g.chats} chat messages · 🔮 {g.predictions} picks</div>} />
        )) : <div className="empty">No past games recorded for this season yet. The archive grows automatically as games are played.</div>}
      </section>
    </div>
  );
}

import { useState } from 'react';
import { FEATURED_SPORTS, officialRosterUrl } from '../../shared/sports';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useApi, useApp } from '../state';
import { Score, fullTime, gameTime, matchup, sportIcon, sportName } from '../format';
import { BackButton, ErrorState, GameRow, JoinCta, Loading, ThreadList, type GameItem, type ThreadItem, LiveScore } from '../components/ui';
import { SPORTS, SPORT_BY_KEY } from '../../shared/sports';

export function Games() {
  const [params, setParams] = useSearchParams();
  // Football by default, men's basketball one tap away; "all" or any other single sport on request.
  const sport = params.get('sport') ?? 'fb';
  const range = params.get('range') ?? 'upcoming';
  // "This week": every Aggie sport, Monday–Sunday, what's left from today on.
  const { data, error, loading, reload } = useApi<{ games: GameItem[]; feedsConfigured: boolean; feedsSynced: boolean }>(sport === 'week' ? '/games?range=week' : `/games?range=${range}${sport !== 'all' ? `&sport=${sport}` : ''}`);
  const [shown, setShown] = useState(15);
  const set = (k: string, v: string) => { setShown(15); setParams((p) => { if (v) p.set(k, v); else p.delete(k); return p; }, { replace: true }); };
  const single = !['fb', 'mbb', 'all', 'featured', 'week'].includes(sport) ? sport : '';
  return (
    <div className="stack">
      <div className="page-head">
        <BackButton />
        <div className="eyebrow" style={{ marginTop: 8 }}>Game Center</div>
        <h1>NM State schedules &amp; game day</h1>
        <p className="muted small" style={{ margin: 0 }}>Schedules and results update automatically from the official NMSU Athletics calendar. During games, follow live stats on the official site and talk it over in game chat.</p>
      </div>
      <section className="card">
        <div className="tabs" role="tablist">
          {[['upcoming', 'Upcoming'], ['past', 'Results'], ['season', 'Full season']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={sport !== 'week' && range === k} className={`tab ${sport !== 'week' && range === k ? 'active' : ''}`} onClick={() => { set('range', k === 'upcoming' ? '' : k); if (sport === 'week') set('sport', ''); }}>{l}</button>
          ))}
        </div>
        <div className="filter-row">
          <button className={`btn small ${sport === 'week' ? '' : 'secondary'}`} onClick={() => set('sport', 'week')}>📅 This week</button>
          <button className={`btn small ${sport === 'fb' ? '' : 'secondary'}`} onClick={() => set('sport', '')}>🏈 Football</button>
          <button className={`btn small ${sport === 'mbb' ? '' : 'secondary'}`} onClick={() => set('sport', 'mbb')}>🏀 Men's Hoops</button>
          <button className={`btn small ${sport === 'all' ? '' : 'secondary'}`} onClick={() => set('sport', 'all')}>All sports</button>
          <select className={`select small-select ${single ? 'chosen' : ''}`} aria-label="Another sport" value={single} onChange={(e) => set('sport', e.target.value || '')}>
            <option value="">Another sport…</option>
            {SPORTS.filter((s) => !FEATURED_SPORTS.includes(s.key)).map((s) => <option key={s.key} value={s.key}>{s.icon} {s.label}</option>)}
          </select>
        </div>
        {loading && !data ? <Loading /> : error ? <ErrorState error={error} retry={reload} /> : data && data.games.length ? (
          <>
            {data.games.slice(0, shown).map((g) => <GameRow key={g.id} game={g} />)}
            {data.games.length > shown && <div className="card-pad"><button className="btn secondary block" onClick={() => setShown(shown + 15)}>Show more ({data.games.length - shown} more)</button></div>}
          </>
        ) : (
          <div className="empty">
            {!data?.feedsConfigured
              ? 'The official schedule feeds have not been connected yet. Once an administrator connects them, every NM State game appears here automatically.'
              : !data.feedsSynced ? 'Waiting for the first schedule sync from the official athletics calendar.' : sport === 'week' ? 'No Aggie games left this week.' : 'No games in this view.'}
            <div style={{ marginTop: 10 }}><a href="https://nmstatesports.com/calendar" target="_blank" rel="noopener noreferrer">Official NMSU Athletics calendar ↗</a></div>
          </div>
        )}
      </section>
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link to="/time-machine" className="btn secondary small">Aggie Time Machine</Link>
      </div>
    </div>
  );
}

interface GameDetail {
  game: GameItem;
  threads: ThreadItem[];
  chat: { room: string; messages: number; automatic?: boolean; open?: boolean; can_start?: boolean };
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
  const nav = useNavigate();
  const startChat = async () => {
    try { const r = await api<{ room: string }>(`/chat/game-${id}/start`, { method: 'POST' }); nav(`/chat/${r.room}`); }
    catch (err) { toast((err as Error).message); }
  };
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
          {/* One wrapping row: chat, listen/watch, schedule, and ESPN (live stats and box score for football and men's basketball). */}
          <LiveScore game={g}>
            {data.chat.open && <Link to={`/chat/${data.chat.room}`} className="btn on-crimson small">{g.live ? 'Join live chat' : 'Game chat'}</Link>}
            {!data.chat.open && data.chat.can_start && <button type="button" className="btn on-crimson small" onClick={startChat}>💬 Start a game chat</button>}
            {g.audio_url && <a href={g.audio_url} target="_blank" rel="noopener noreferrer" className="btn on-crimson outline small">🎧 Listen ↗</a>}
            {g.video_url && <a href={g.video_url} target="_blank" rel="noopener noreferrer" className="btn on-crimson outline small">📺 Watch ↗</a>}
            <a href={officialRosterUrl(g.sport)} target="_blank" rel="noopener noreferrer" className="btn on-crimson outline small">Roster ↗</a>
            <a href={g.schedule_url} target="_blank" rel="noopener noreferrer" className="btn on-crimson outline small">Schedule ↗</a>
          </LiveScore>
        </div>
      </section>
      {g.overridden && <div className="notice small">An administrator corrected some details for this game while the official feed was out of date.</div>}

      <section className="card card-pad">
        <h2>🎯 Predictions</h2>
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
        <ThreadList threads={data.threads} showForum={false} empty="No game threads yet. Start one below." />
        <div className="card-pad row">
          {!pregame && <Link className="btn secondary small" to={`/new?forum=${forum}&game=${g.id}&phase=pregame`}>Start pregame thread</Link>}
          {!postgame && g.status === 'final' && <Link className="btn secondary small" to={`/new?forum=${forum}&game=${g.id}&phase=postgame`}>Start postgame thread</Link>}
          <Link className="btn secondary small" to={`/new?forum=${forum}&game=${g.id}`}>New thread about this game</Link>
          {(data.chat.open || data.chat.messages > 0) && <Link className="btn ghost small" to={`/chat/${data.chat.room}/archive`}>Chat archive ({data.chat.messages} messages)</Link>}
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
  const { data, error, reload } = useApi<{ season: string; current: string; seasons: string[]; standings: { user_id: number; username: string; display_name: string | null; points: number; picks: number; correct: number }[] }>(`/predictions/standings${season ? `?season=${season}` : ''}`);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  const isCurrent = data.season === data.current;
  // Other seasons appear only once they have scored picks; no empty past or future seasons.
  const others = [...new Set([data.current, ...data.seasons])].filter((s) => s !== data.season);
  return (
    <div className="stack">
      <div className="page-head spread">
        <div><div className="eyebrow">Friendly contest</div><h1>Prediction standings · {isCurrent ? 'this season' : `${data.season} season`}</h1><p className="muted small" style={{ margin: 0 }}>Pick the winner of any upcoming game on its game page: 1 point for the right winner, 2 bonus points for the exact score. It counts from the first game members pick, so it's fine to start mid-season.</p></div>
        {others.length > 0 && <div className="row">{others.map((s) => <button key={s} className="btn secondary small" onClick={() => setSeason(s === data.current ? '' : s)}>{s === data.current ? 'This season' : `${s} season`}</button>)}</div>}
      </div>
      <section className="card">
        {data.standings.length ? (
          <div className="table-scroll"><table className="simple"><thead><tr><th>#</th><th>Member</th><th>Points</th><th>Correct</th><th>Scored picks</th></tr></thead><tbody>
            {data.standings.map((s, i) => <tr key={s.user_id}><td>{i + 1}</td><td><Link to={`/members/${s.user_id}`}>{s.display_name || s.username}</Link></td><td><strong>{s.points}</strong></td><td>{s.correct}</td><td>{s.picks}</td></tr>)}
          </tbody></table></div>
        ) : <div className="empty">No picks scored yet. Make a pick on the next game's page (Games → open a game → Predictions); points are added automatically when the final score comes in.</div>}
      </section>
    </div>
  );
}

// Time Machine groups (text only, no icons). Track and cross country cover both men and women.
const TM_GROUPS: { title: string; sports: string[] }[] = [
  { title: "Men's sports", sports: ['fb', 'mbb', 'base', 'mgolf'] },
  { title: "Women's sports", sports: ['wbb', 'vb', 'soft', 'wsoc', 'wgolf', 'wten', 'swim'] },
  { title: "Men's & women's", sports: ['track', 'xc'] },
];

// Fall sports' seasons fit in one calendar year ("2026"); the rest span two ("2026-27").
const FALL_SPORTS = ['fb', 'vb', 'wsoc', 'xc'];
const seasonLabel = (sport: string, s: string) => (FALL_SPORTS.includes(sport) ? s.slice(0, 4) : s);

/** Aggie Time Machine, organized like RockAuto: pick a sport, then a season, then see that season's games. */
export function TimeMachine() {
  const [params] = useSearchParams();
  const sport = params.get('sport') ?? '';
  const season = params.get('season') ?? '';
  const label = (k: string) => SPORT_BY_KEY[k]?.label ?? k;
  return (
    <div className="stack">
      <div className="page-head">
        <BackButton />
        <div className="eyebrow" style={{ marginTop: 8 }}>Aggie Time Machine</div>
        <h1>{sport ? (season ? `${label(sport)} · ${seasonLabel(sport, season)}` : label(sport)) : 'Pick a sport'}</h1>
        <nav className="tm-crumbs small" aria-label="Time Machine path">
          <Link to="/time-machine">All sports</Link>
          {sport && <> › <Link to={`/time-machine?sport=${sport}`}>{label(sport)}</Link></>}
          {sport && season && <> › {seasonLabel(sport, season)}</>}
        </nav>
      </div>
      {!sport ? <TmSports /> : !season ? <TmSeasons sport={sport} /> : <TmGames sport={sport} season={season} />}
    </div>
  );
}

function TmSports() {
  const { data, error, reload } = useApi<{ sports: Record<string, number> }>('/time-machine/sports');
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <>
      {TM_GROUPS.map((grp) => (
        <section key={grp.title} className="card">
          <div className="section-head"><h2>{grp.title}</h2></div>
          {grp.sports.map((k) => (
            <Link key={k} to={`/time-machine?sport=${k}`} className="list-row tm-row">
              <span className="grow"><strong>{SPORT_BY_KEY[k]?.label ?? k}</strong></span>
              <span className="small muted">{data.sports[k] ? `${data.sports[k]} ${data.sports[k] === 1 ? 'game' : 'games'}` : 'No games yet'}</span>
              <span aria-hidden="true">›</span>
            </Link>
          ))}
        </section>
      ))}
    </>
  );
}

function TmSeasons({ sport }: { sport: string }) {
  const { data, error, reload } = useApi<{ seasons: string[] }>(`/time-machine?sport=${sport}`);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <section className="card">
      <div className="section-head"><h2>Seasons</h2></div>
      {data.seasons.length ? data.seasons.map((s) => (
        <Link key={s} to={`/time-machine?sport=${sport}&season=${s}`} className="list-row tm-row">
          <span className="grow"><strong>{seasonLabel(sport, s)} season</strong></span>
          <span aria-hidden="true">›</span>
        </Link>
      )) : <div className="empty">No past games on record for this sport yet. Seasons appear here as games are played.</div>}
    </section>
  );
}

function TmGames({ sport, season }: { sport: string; season: string }) {
  const { data, error, reload } = useApi<{ games: (GameItem & { posts: number; chats: number })[] }>(`/time-machine?sport=${sport}&season=${season}`);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <section className="card">
      <div className="section-head"><h2>Games</h2><span className="small muted">{data.games.length} played</span></div>
      {data.games.length ? data.games.map((g) => (
        // History is a plain results list: date, opponent, score. No calendar block or sport label (it reads like an upcoming game).
        <Link key={g.id} to={`/games/${g.id}`} className="list-row tm-row tm-game">
          <span className="grow">
            <strong>{matchup(g)}</strong>
            <span className="tiny muted" style={{ display: 'block' }}>
              {new Date(g.starts_at).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric' })}
              {(g.posts || g.chats) ? ` · ${g.posts} posts · ${g.chats} chat messages` : ''}
            </span>
          </span>
          <Score game={g} />
        </Link>
      )) : <div className="empty">No games on record for this season.</div>}
    </section>
  );
}

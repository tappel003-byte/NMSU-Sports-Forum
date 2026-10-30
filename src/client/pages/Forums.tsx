import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BellOff, Plus } from 'lucide-react';
import { api } from '../api';
import { useApi, useApp } from '../state';
import { sportName } from '../format';
import { ErrorState, GameRow, Loading, SUGGESTION_LABELS, ThreadList, type GameItem, type ThreadItem } from '../components/ui';
import { ComposerTools, MentionTextarea, PhotoPicker, PhotoThumbs, useDraft } from '../components/Composer';
import { TagPicker } from './Thread';
import { TAGS } from '../../shared/forum';
import { timeAgo } from '../format';

interface ForumInfo { id: number; slug: string; name: string; sport_label: string; description: string; icon: string; sports: string[]; kind: string; muted: boolean; threads?: number; unread?: number; last_post_at?: number | null }

export function Forums() {
  const { data, error, reload } = useApi<{ forums: ForumInfo[] }>('/forums');
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  const venues = data.forums.filter((f) => f.kind === 'sport');
  const other = data.forums.filter((f) => f.kind !== 'sport');
  const card = (f: ForumInfo) => (
    <Link key={f.slug} to={`/f/${f.slug}`} className="venue-card">
      <span className="venue-emoji" aria-hidden="true">{f.icon}</span>
      <span className="grow">
        <span className="venue-name">{f.name}</span><br />
        <span className="venue-sport">{f.sport_label}</span>
        <span className="small muted" style={{ display: 'block' }}>{f.threads} discussions{f.last_post_at ? ` · active ${timeAgo(f.last_post_at)}` : ''}{f.muted ? ' · muted' : ''}</span>
      </span>
      {Boolean(f.unread) && <span className="chip">{f.unread} new</span>}
    </Link>
  );
  return (
    <div className="stack">
      <div className="page-head"><div className="eyebrow">Sports forums</div><h1>Explore the Aggie sports communities</h1><p className="muted small" style={{ margin: 0 }}>Each venue has its own discussions, schedule and game-day threads.</p></div>
      <Link to="/recruiting" className="venue-card"><span className="venue-emoji" aria-hidden="true">📋</span><span className="grow"><span className="venue-name">Recruiting &amp; Transfer Portal</span><br /><span className="venue-sport">Player cards · news · predictions</span></span></Link>
      <div className="venue-grid">{venues.map(card)}</div>
      <h2 style={{ marginTop: 24 }}>Community</h2>
      <div className="venue-grid">{other.map(card)}</div>
    </div>
  );
}

export function ForumPage() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const sport = params.get('sport') ?? '';
  const status = params.get('status') ?? '';
  const tag = params.get('tag') ?? '';
  const [page, setPage] = useState(1);
  const { toast } = useApp();
  const q = new URLSearchParams({ page: String(page), ...(sport ? { sport } : {}), ...(status ? { status } : {}), ...(tag ? { tag } : {}) });
  const { data, error, loading, reload } = useApi<{ forum: ForumInfo; threads: ThreadItem[]; hasMore: boolean; games: GameItem[] }>(`/forums/${slug}?${q}`);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  const f = data.forum;
  const toggleMute = async () => {
    await api('/mutes', { body: { target_type: 'forum', target_id: f.id, muted: !f.muted } });
    toast(f.muted ? `${f.name} unmuted` : `${f.name} muted. It won't appear in your feeds.`);
    reload();
  };
  const setFilter = (k: string, v: string) => { setPage(1); setParams((p) => { if (v) p.set(k, v); else p.delete(k); return p; }, { replace: true }); };
  return (
    <div className="stack">
      <div className="page-head spread">
        <div>
          <div className="eyebrow">{f.icon} {f.sport_label}</div>
          <h1>{f.name}</h1>
          <p className="muted small" style={{ margin: 0 }}>{f.description}</p>
        </div>
        <div className="row">
          <button className="btn ghost small" onClick={toggleMute}><BellOff size={16} /> {f.muted ? 'Unmute' : 'Mute'}</button>
          <Link to={`/new?forum=${f.slug}`} className="btn"><Plus size={16} /> {f.kind === 'suggestions' ? 'Suggest an idea' : 'New thread'}</Link>
        </div>
      </div>
      {f.kind === 'suggestions' && (
        <div className="note-box small">Propose a feature or improvement. Members discuss and give thumbs-up; administrators mark ideas <em>Under consideration</em>, <em>Planned</em> or <em>Implemented</em>. Implemented ideas earn the proposer the Idea Contributor recognition.</div>
      )}
      {f.kind === 'history' && <div className="note-box small">Aggie History threads are never archived. Share classic games, favorite players and memories.</div>}
      {data.games.length > 0 && (
        <section className="card">
          <div className="section-head"><h2>Upcoming {f.sport_label.toLowerCase()} games</h2><Link to={`/games?sport=${f.sports[0] ?? ''}`} className="small">Schedule</Link></div>
          {data.games.map((g) => <GameRow key={g.id} game={g} />)}
        </section>
      )}
      <section className="card">
        {(f.sports.length > 1 || f.kind === 'suggestions') && (
          <div className="filter-row">
            {f.kind === 'suggestions' ? (
              <>
                <button className={`btn small ${status ? 'secondary' : ''}`} onClick={() => setFilter('status', '')}>All</button>
                {Object.entries(SUGGESTION_LABELS).map(([k, v]) => <button key={k} className={`btn small ${status === k ? '' : 'secondary'}`} onClick={() => setFilter('status', k)}>{v}</button>)}
              </>
            ) : (
              <>
                <button className={`btn small ${sport ? 'secondary' : ''}`} onClick={() => setFilter('sport', '')}>All</button>
                {f.sports.map((s) => <button key={s} className={`btn small ${sport === s ? '' : 'secondary'}`} onClick={() => setFilter('sport', s)}>{sportName(s)}</button>)}
              </>
            )}
          </div>
        )}
        {f.kind === 'sport' && (
          <div className="filter-row" aria-label="Filter by tag">
            <button className={`btn small ${tag ? 'secondary' : ''}`} onClick={() => setFilter('tag', '')}>All topics</button>
            {Object.entries(TAGS).map(([k, v]) => <button key={k} className={`btn small ${tag === k ? '' : 'secondary'}`} onClick={() => setFilter('tag', k)}>{v}</button>)}
          </div>
        )}
        {loading ? <Loading /> : <ThreadList threads={data.threads} showForum={false} empty="No discussions here yet. Start the first one!" />}
        <Link to={`/new?forum=${f.slug}`} className="fab" aria-label="Start a new discussion"><Plus size={26} /></Link>
        {(page > 1 || data.hasMore) && (
          <div className="pager">
            <button className="btn secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
            <button className="btn secondary small" disabled={!data.hasMore} onClick={() => setPage(page + 1)}>Older</button>
          </div>
        )}
      </section>
    </div>
  );
}

export function NewThread() {
  const [params] = useSearchParams();
  const { toast } = useApp();
  const nav = useNavigate();
  const { data } = useApi<{ forums: ForumInfo[] }>('/forums');
  const [forum, setForum] = useState(params.get('forum') ?? '');
  const gameId = Number(params.get('game')) || null;
  const phase = params.get('phase') as 'pregame' | 'postgame' | null;
  const draftKey = `new-${gameId ? `game-${gameId}-${phase ?? 'talk'}` : forum || 'any'}`;
  const draft = useDraft(draftKey);
  const [description, setDescription] = useState('');
  const [sport, setSport] = useState('');
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [pollOn, setPollOn] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [poll, setPoll] = useState({ question: '', options: ['', ''], closes: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const f = data?.forums.find((x) => x.slug === forum);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: number; pending: boolean }>('/threads', {
        body: {
          forum, title: draft.title, description, body: draft.body, sport: sport || null, attachments: photos.map((p) => p.id), draft_key: draftKey, tags,
          game_id: gameId, game_phase: phase,
          poll: pollOn ? { question: poll.question, options: poll.options.filter((o) => o.trim()), closes_at: poll.closes ? new Date(poll.closes).getTime() : null } : null,
        },
      });
      draft.clear();
      if (r.pending) toast('Thanks! Your first post will appear once an admin approves it.');
      nav(`/t/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-pad">
      <h1>{f?.kind === 'suggestions' ? 'Suggest an improvement' : 'Start a discussion'}</h1>
      {gameId && <div className="note-box small" style={{ marginBottom: 12 }}>This thread will be linked to the game page{phase ? ` as the ${phase} discussion` : ''}.</div>}
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="forum">Forum</label>
          <select id="forum" className="select" value={forum} onChange={(e) => { setForum(e.target.value); setSport(''); }} required>
            <option value="">Choose a forum…</option>
            {data?.forums.map((x) => <option key={x.slug} value={x.slug}>{x.name} — {x.sport_label}</option>)}
          </select>
        </div>
        {f && f.sports.length > 1 && (
          <div className="field">
            <label htmlFor="sport">Sport</label>
            <select id="sport" className="select" value={sport} onChange={(e) => setSport(e.target.value)}>
              <option value="">General {f.sport_label}</option>
              {f.sports.map((s) => <option key={s} value={s}>{sportName(s)}</option>)}
            </select>
          </div>
        )}
        <div className="field"><label htmlFor="title">Title</label><input id="title" className="input" value={draft.title} onChange={(e) => draft.setTitle(e.target.value)} required minLength={4} maxLength={140} /></div>
        <div className="field"><label htmlFor="desc">Short topic description</label><input id="desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} required minLength={3} maxLength={240} placeholder="One line so members know what it's about" /></div>
        <div className="field">
          <label htmlFor="body">Your post</label>
          <MentionTextarea id="body" textareaRef={bodyRef} className="textarea" style={{ minHeight: 180 }} value={draft.body} onChange={draft.setBody} required />
          <span className="hint">Tips: paste a tweet or YouTube link and it shows as a card; start a line with &gt; to quote; **bold**; ||spoiler||; @ to mention. {draft.status === 'saved' && draft.body ? 'Draft saved.' : draft.status === 'saving' ? 'Saving draft…' : ''}</span>
        </div>
        <div className="field"><span className="label">Tags (optional, up to 3)</span><TagPicker value={tags} onChange={setTags} /></div>
        <PhotoThumbs photos={photos} setPhotos={setPhotos} />
        <div className="row" style={{ margin: '8px 0 14px' }}>
          <PhotoPicker photos={photos} setPhotos={setPhotos} onError={setError} />
          <ComposerTools value={draft.body} onChange={draft.setBody} textareaRef={bodyRef} onError={setError} />
          <button type="button" className="btn secondary small" onClick={() => setPollOn(!pollOn)}>{pollOn ? 'Remove poll' : 'Add a poll'}</button>
        </div>
        {pollOn && (
          <div className="card card-pad" style={{ marginBottom: 14 }}>
            <div className="field"><label htmlFor="pq">Poll question</label><input id="pq" className="input" value={poll.question} onChange={(e) => setPoll({ ...poll, question: e.target.value })} required /></div>
            {poll.options.map((o, i) => (
              <div className="field" key={i}><label htmlFor={`po${i}`}>Choice {i + 1}</label><input id={`po${i}`} className="input" value={o} onChange={(e) => { const opts = [...poll.options]; opts[i] = e.target.value; setPoll({ ...poll, options: opts }); }} required={i < 2} /></div>
            ))}
            {poll.options.length < 10 && <button type="button" className="btn ghost small" onClick={() => setPoll({ ...poll, options: [...poll.options, ''] })}>Add choice</button>}
            <div className="field" style={{ marginTop: 10 }}><label htmlFor="pc">Closes (optional)</label><input id="pc" type="datetime-local" className="input" value={poll.closes} onChange={(e) => setPoll({ ...poll, closes: e.target.value })} /></div>
          </div>
        )}
        {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
        <div className="row"><button className="btn" disabled={busy}>{busy ? 'Posting…' : 'Post discussion'}</button><button type="button" className="btn ghost" onClick={() => nav(-1)}>Cancel</button></div>
      </form>
    </div>
  );
}

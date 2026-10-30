import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../api';
import { useApi, useApp } from '../state';
import { LinkPreview, sportIcon, sportName, timeAgo } from '../format';
import { ErrorState, Loading, Modal } from '../components/ui';
import { ShareForm, ShareModal } from '../components/Share';
import type React from 'react';
import { SPORTS } from '../../shared/sports';

interface Player {
  id: number; sport: string; kind: 'recruit' | 'transfer_in' | 'transfer_out'; source: 'cfbd' | 'member'; name: string; position: string | null;
  class_year: number | null; school: string | null; hometown: string | null; stars: number | null; rating: number | null; ranking: number | null;
  status: string; other_school: string | null; source_url: string | null; thread_id: number | null; updated_at: number; news?: number; yes?: number; predictions?: number;
}

export const STATUS_LABELS: Record<string, string> = {
  tracking: 'Tracking', offered: 'Offered', visiting: 'Visiting', committed: 'Committed to NM State', signed: 'Signed', enrolled: 'Enrolled',
  decommitted: 'Decommitted', committed_elsewhere: 'Committed elsewhere', in_portal: 'In the portal', transferred: 'Transferred',
};
const KIND_LABELS = { recruit: 'Recruit', transfer_in: 'Transferring in', transfer_out: 'Transferring out' };

function Stars({ n }: { n: number | null }) {
  if (!n) return null;
  return <span className="stars" aria-label={`${n} stars`}>{'★'.repeat(n)}</span>;
}

export function Recruiting() {
  const [params, setParams] = useSearchParams();
  const kind = params.get('kind') ?? 'recruit';
  const sport = params.get('sport') ?? '';
  const [adding, setAdding] = useState(false);
  const { data, error, reload } = useApi<{ players: Player[]; sync: { configured: boolean; last_ok_at?: number | null; last_error?: string | null } }>(`/players?kind=${kind}${sport ? `&sport=${sport}` : ''}`);
  if (error) return <ErrorState error={error} retry={reload} />;
  const set = (k: string, v: string) => setParams((p) => { if (v) p.set(k, v); else p.delete(k); return p; }, { replace: true });
  return (
    <div className="stack">
      <div className="page-head spread">
        <div>
          <div className="eyebrow">Recruiting &amp; transfer portal</div>
          <h1>Who's coming, who's going</h1>
          <p className="small muted" style={{ margin: 0 }}>Football recruits and portal moves update automatically each day. Members add everything else and share tweets on each player's card.</p>
        </div>
        <button className="btn" onClick={() => setAdding(true)}><Plus size={16} /> Add a player</button>
      </div>
      {data && !data.sync.configured && <div className="notice small">Automatic football recruiting data turns on once the free CollegeFootballData.com key is added. Until then, members can add players with a source link.</div>}
      {data?.sync.last_error && <div className="error-box small">The last automatic update failed ({data.sync.last_error}). Existing players are unaffected.</div>}
      <section className="card">
        <div className="tabs" role="tablist">
          {[['recruit', 'Recruits'], ['portal', 'Transfer portal']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={kind === k} className={`tab ${kind === k ? 'active' : ''}`} onClick={() => set('kind', k === 'recruit' ? '' : k)}>{l}</button>
          ))}
        </div>
        <div className="filter-row">
          <button className={`btn small ${sport ? 'secondary' : ''}`} onClick={() => set('sport', '')}>All sports</button>
          {SPORTS.map((s) => <button key={s.key} className={`btn small ${sport === s.key ? '' : 'secondary'}`} onClick={() => set('sport', s.key)}>{s.icon} {s.short}</button>)}
        </div>
        {!data ? <Loading /> : data.players.length ? data.players.map((p) => (
          <Link key={p.id} to={`/recruiting/${p.id}`} className="player-card">
            <span className="player-pos">{p.position ?? sportIcon(p.sport)}</span>
            <span className="grow">
              <strong>{p.name}</strong> <Stars n={p.stars} />
              <span className="small muted" style={{ display: 'block' }}>
                {sportName(p.sport)} · {KIND_LABELS[p.kind]}{p.class_year ? ` · ${p.class_year}` : ''}{p.school ? ` · ${p.school}` : ''}{p.hometown ? ` · ${p.hometown}` : ''}
              </span>
              <span className="tiny muted">{p.news ? `📰 ${p.news} news · ` : ''}{p.predictions ? `🔮 ${Math.round(((p.yes ?? 0) / p.predictions) * 100)}% say yes · ` : ''}updated {timeAgo(p.updated_at)}</span>
            </span>
            <span className={`chip ${p.status === 'committed' || p.status === 'signed' || p.status === 'enrolled' ? '' : 'gray'}`}>{STATUS_LABELS[p.status] ?? p.status}</span>
          </Link>
        )) : <div className="empty">Nobody tracked here yet. {data.sync.configured ? 'Automatic data appears after the next daily update.' : 'Add the first player.'}</div>}
      </section>
      {adding && <AddPlayer onClose={() => setAdding(false)} defaultKind={kind === 'portal' ? 'transfer_in' : 'recruit'} />}
    </div>
  );
}

function AddPlayer({ onClose, defaultKind }: { onClose: () => void; defaultKind: string }) {
  const nav = useNavigate();
  const { toast } = useApp();
  const [f, setF] = useState({ sport: 'mbb', kind: defaultKind, name: '', position: '', class_year: '', school: '', status: 'tracking', source_url: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ id: number }>('/players', { body: { ...f, position: f.position || null, school: f.school || null, class_year: f.class_year ? Number(f.class_year) : null } });
      onClose();
      nav(`/recruiting/${r.id}`);
    } catch (err) { toast((err as Error).message); }
  };
  return (
    <Modal title="Add a player to track" onClose={onClose}>
      <form onSubmit={save}>
        <div className="grid-2">
          <div className="field"><label htmlFor="ps">Sport</label><select id="ps" className="select" value={f.sport} onChange={set('sport')}>{SPORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
          <div className="field"><label htmlFor="pk">Type</label><select id="pk" className="select" value={f.kind} onChange={set('kind')}><option value="recruit">Recruit</option><option value="transfer_in">Transferring in</option><option value="transfer_out">Transferring out</option></select></div>
          <div className="field"><label htmlFor="pn">Name</label><input id="pn" className="input" value={f.name} onChange={set('name')} required minLength={3} /></div>
          <div className="field"><label htmlFor="pp">Position</label><input id="pp" className="input" value={f.position} onChange={set('position')} maxLength={20} /></div>
          <div className="field"><label htmlFor="py">Class / season</label><input id="py" className="input" inputMode="numeric" value={f.class_year} onChange={set('class_year')} placeholder="2027" /></div>
          <div className="field"><label htmlFor="pc">{f.kind === 'recruit' ? 'High school' : 'Previous school'}</label><input id="pc" className="input" value={f.school} onChange={set('school')} /></div>
          <div className="field"><label htmlFor="pst">Status</label><select id="pst" className="select" value={f.status} onChange={set('status')}>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </div>
        <div className="field"><label htmlFor="pu">Source link (tweet or article)</label><input id="pu" className="input" type="url" value={f.source_url} onChange={set('source_url')} required placeholder="https://x.com/…" /><span className="hint">Required, so everyone can see where the news came from. It becomes the first news item.</span></div>
        <button className="btn">Add player</button>
      </form>
    </Modal>
  );
}

export function PlayerPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { toast } = useApp();
  const { data, error, reload } = useApi<{ player: Player & { added_by: string | null }; news: { id: number; url: string; note: string | null; username: string; created_at: number; post_id: number | null }[]; predictions: { yes: number; no: number; mine: string | null }; can_edit: boolean }>(`/players/${id}`);
  const [share, setShare] = useState(false);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  const p = data.player;
  const total = data.predictions.yes + data.predictions.no;
  const predict = async (pick: 'yes' | 'no') => {
    try { await api(`/players/${p.id}/predict`, { body: { pick: data.predictions.mine === pick ? null : pick } }); reload(); } catch (e) { toast((e as Error).message); }
  };
  const discuss = async () => {
    const r = await api<{ thread_id: number }>(`/players/${p.id}/thread`, { method: 'POST' });
    nav(`/t/${r.thread_id}`);
  };
  const setStatus = async (status: string) => {
    try { await api(`/players/${p.id}`, { method: 'PATCH', body: { status } }); toast('Status updated'); reload(); } catch (e) { toast((e as Error).message); }
  };
  const question = p.kind === 'transfer_out' ? 'Will he end up back at NM State?' : p.status === 'committed' ? 'Will he sign with NM State?' : 'Will he end up at NM State?';
  return (
    <div className="stack">
      <nav className="small"><Link to="/recruiting">Recruiting</Link> › {sportName(p.sport)}</nav>
      <section className="card card-pad">
        <div className="profile-head">
          <span className="player-pos" style={{ width: 64, height: 64, fontSize: '1.1rem' }}>{p.position ?? sportIcon(p.sport)}</span>
          <div className="grow">
            <h1 style={{ marginBottom: 2 }}>{p.name} <Stars n={p.stars} /></h1>
            <div className="small muted">{sportName(p.sport)} · {KIND_LABELS[p.kind]}{p.class_year ? ` · ${p.class_year}` : ''}</div>
            <div style={{ marginTop: 6 }}><span className="chip">{STATUS_LABELS[p.status] ?? p.status}</span>{p.other_school && <span className="small muted"> → {p.other_school}</span>}</div>
          </div>
        </div>
        <dl className="kv" style={{ marginTop: 12 }}>
          {p.school && <><dt>{p.kind === 'recruit' ? 'School' : 'From'}</dt><dd>{p.school}</dd></>}
          {p.hometown && <><dt>Hometown</dt><dd>{p.hometown}</dd></>}
          {p.rating !== null && <><dt>Rating</dt><dd>{p.rating}{p.ranking ? ` · national rank ${p.ranking}` : ''}</dd></>}
          <dt>Source</dt><dd className="small">{p.source === 'cfbd' ? 'CollegeFootballData.com (updates daily)' : `Added by ${p.added_by ?? 'a member'}`}</dd>
        </dl>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => setShare(true)}>Share a tweet about him</button>
          <button className="btn secondary" onClick={discuss}>Discussion</button>
        </div>
        {data.can_edit && (
          <div className="row" style={{ marginTop: 10 }}>
            <label className="small" htmlFor="pstatus">Update status</label>
            <select id="pstatus" className="select" style={{ width: 'auto' }} value={p.status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
        )}
      </section>
      <section className="card card-pad">
        <h2>🔮 {question}</h2>
        <div className="row">
          <button className={`btn ${data.predictions.mine === 'yes' ? '' : 'secondary'}`} onClick={() => predict('yes')}>Yes</button>
          <button className={`btn ${data.predictions.mine === 'no' ? '' : 'secondary'}`} onClick={() => predict('no')}>No</button>
          {total > 0 && <span className="small muted">{Math.round((data.predictions.yes / total) * 100)}% of {total} member{total === 1 ? '' : 's'} say yes</span>}
        </div>
      </section>
      <section className="card">
        <div className="section-head"><h2>News &amp; tweets</h2><button className="btn small secondary" onClick={() => setShare(true)}>Add</button></div>
        {data.news.length ? data.news.map((n) => (
          <div key={n.id} className="card-pad" style={{ borderBottom: '1px solid var(--line)' }}>
            {n.note && <div style={{ marginBottom: 4 }}>{n.note}</div>}
            <LinkPreview url={n.url} />
            {!/x\.com|twitter\.com|youtu/.test(n.url) && <a href={n.url} target="_blank" rel="noopener noreferrer nofollow" className="small">{n.url.replace(/^https?:\/\//, '').slice(0, 70)}</a>}
            <div className="tiny muted">Shared by {n.username} · {timeAgo(n.created_at)}</div>
          </div>
        )) : <div className="empty">No news yet. Copy a tweet's link in the X app and share it here.</div>}
      </section>
      {share && <ShareModal target={{ kind: 'player', id: p.id, name: p.name }} onClose={() => { setShare(false); reload(); }} />}
    </div>
  );
}

export function SharePage() {
  const [params] = useSearchParams();
  const raw = `${params.get('url') ?? ''} ${params.get('text') ?? ''}`;
  const url = raw.match(/https?:\/\/\S+/)?.[0] ?? '';
  const text = (params.get('text') ?? '').replace(url, '').trim();
  return (
    <div className="card card-pad">
      <h1>Share to NMSU Sports Forum</h1>
      <ShareForm initialUrl={url} initialText={text} />
    </div>
  );
}


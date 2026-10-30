import type React from 'react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useApi, useApp } from '../state';
import { Score, dateParts, fullTime, gameTime, matchup, sportIcon, sportName } from '../format';
import { Avatar, ErrorState, GameRow, Loading, Modal, ThreadList, type GameItem, type MemberLite, type ThreadItem } from '../components/ui';
import { BADGES } from '../../shared/sports';

const KINDS: Record<string, string> = { watch_party: 'Watch party', gathering: 'Gathering', meetup: 'Meetup', other: 'Event' };

interface CalEvent { id: number; kind: string; title: string; location: string; starts_at: number; host: string; going: number; game_id: number | null }

export function Calendar() {
  const [params, setParams] = useSearchParams();
  const [offset, setOffset] = useState(0);
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() + offset * 30);
  const to = from.getTime() + 30 * 86_400_000;
  const { data, error, reload } = useApi<{ games: GameItem[]; events: CalEvent[]; birthdays: { id: number; username: string; birthday_md: string }[] }>(`/calendar?from=${from.getTime()}&to=${to}`);
  const [creating, setCreating] = useState(params.get('new') === '1');
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;

  type Item = { t: number; kind: 'game' | 'event' | 'birthday'; node: React.ReactElement };
  const items: Item[] = [
    ...data.games.map((g) => ({ t: g.starts_at, kind: 'game' as const, node: (
      <Link key={`g${g.id}`} to={`/games/${g.id}`} className="cal-item"><span>{sportIcon(g.sport)}</span><span className="grow"><strong>{sportName(g.sport)}</strong> · NM State {matchup(g)}<span className="small muted"> · {gameTime(g.starts_at, g.time_tba).split(' · ').slice(1).join(' · ')}</span></span><Score game={g} /></Link>
    ) })),
    ...data.events.map((e) => ({ t: e.starts_at, kind: 'event' as const, node: (
      <Link key={`e${e.id}`} to={`/events/${e.id}`} className="cal-item"><span>📍</span><span className="grow"><strong>{e.title}</strong><span className="small muted"> · {KINDS[e.kind]} · {e.location || 'Location TBA'} · {e.going} going</span></span></Link>
    ) })),
  ];
  // Opt-in birthdays that fall inside the window.
  for (let d = 0; d < 30; d++) {
    const day = new Date(from.getTime() + d * 86_400_000);
    const md = `${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    for (const b of data.birthdays.filter((x) => x.birthday_md === md)) {
      items.push({ t: day.getTime() + 1, kind: 'birthday', node: <Link key={`b${b.id}${md}`} to={`/members/${b.id}`} className="cal-item"><span>🎂</span><span className="grow">{b.username}'s birthday</span></Link> });
    }
  }
  items.sort((a, b) => a.t - b.t);
  const byDay = new Map<string, Item[]>();
  for (const it of items) {
    const key = dateParts(it.t).full;
    byDay.set(key, [...(byDay.get(key) ?? []), it]);
  }
  return (
    <div className="stack">
      <div className="page-head spread">
        <div><div className="eyebrow">Community calendar</div><h1>Games, watch parties &amp; gatherings</h1></div>
        <button className="btn" onClick={() => setCreating(true)}>Add an event</button>
      </div>
      <div className="row"><button className="btn secondary small" onClick={() => setOffset(offset - 1)}>‹ Earlier</button><span className="small muted">{dateParts(from.getTime()).full} – {dateParts(to).full}</span><button className="btn secondary small" onClick={() => setOffset(offset + 1)}>Later ›</button></div>
      <section className="card">
        {byDay.size ? [...byDay.entries()].map(([day, list]) => (
          <div key={day} className="cal-day"><h3>{day}</h3>{list.map((i) => i.node)}</div>
        )) : <div className="empty">Nothing on the calendar in this window.</div>}
      </section>
      {creating && <EventForm gameId={Number(params.get('game')) || null} onClose={() => { setCreating(false); setParams({}); }} onCreated={reload} />}
    </div>
  );
}

function EventForm({ gameId, onClose, onCreated }: { gameId: number | null; onClose: () => void; onCreated: () => void }) {
  const nav = useNavigate();
  const { toast } = useApp();
  const [f, setF] = useState({ kind: gameId ? 'watch_party' : 'gathering', title: '', description: '', location: '', when: '' });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ id: number }>('/events', { body: { kind: f.kind, title: f.title, description: f.description, location: f.location, starts_at: new Date(f.when).getTime(), game_id: gameId } });
      onCreated();
      nav(`/events/${r.id}`);
    } catch (err) { toast((err as Error).message); }
  };
  return (
    <Modal title="Add to the community calendar" onClose={onClose}>
      <form onSubmit={save}>
        <div className="field"><label htmlFor="ek">Type</label><select id="ek" className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label htmlFor="et">Title</label><input id="et" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required minLength={3} /></div>
        <div className="field"><label htmlFor="ew">When</label><input id="ew" type="datetime-local" className="input" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} required /></div>
        <div className="field"><label htmlFor="el">Where</label><input id="el" className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="A public place, e.g. a restaurant or sports bar" /></div>
        <div className="field"><label htmlFor="ed">Details</label><textarea id="ed" className="textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        {gameId && <div className="small muted" style={{ marginBottom: 10 }}>This event will be linked to the game.</div>}
        <button className="btn">Add event</button>
      </form>
    </Modal>
  );
}

export function EventPage() {
  const { id = '' } = useParams();
  const { me, toast } = useApp();
  const nav = useNavigate();
  const { data, error, reload } = useApi<{ event: { id: number; kind: string; title: string; description: string; location: string; starts_at: number; user_id: number; host: MemberLite | null; game: GameItem | null }; rsvps: { status: string; member: MemberLite | null }[]; my_rsvp: string | null }>(`/events/${id}`);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  const e = data.event;
  const rsvp = async (status: string | null) => { await api(`/events/${e.id}/rsvp`, { body: { status } }); reload(); };
  const cancel = async () => { if (!confirm('Cancel this event?')) return; await api(`/events/${e.id}`, { method: 'DELETE' }); toast('Event canceled'); nav('/calendar'); };
  return (
    <div className="stack">
      <nav className="small"><Link to="/calendar">Calendar</Link> › {KINDS[e.kind]}</nav>
      <section className="card card-pad">
        <div className="eyebrow">{KINDS[e.kind]}</div>
        <h1>{e.title}</h1>
        <div className="muted">{fullTime(e.starts_at)}{e.location ? ` · ${e.location}` : ''}</div>
        <div className="small muted">Hosted by {e.host ? <Link to={`/members/${e.host.id}`}>{e.host.username}</Link> : 'a member'}</div>
        {e.description && <p>{e.description}</p>}
        {e.game && <div style={{ marginTop: 8 }}><GameRow game={e.game} /></div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className={`btn ${data.my_rsvp === 'going' ? '' : 'secondary'}`} onClick={() => rsvp(data.my_rsvp === 'going' ? null : 'going')}>Going</button>
          <button className={`btn ${data.my_rsvp === 'maybe' ? '' : 'secondary'}`} onClick={() => rsvp(data.my_rsvp === 'maybe' ? null : 'maybe')}>Maybe</button>
          {(e.user_id === me?.id || me?.role === 'admin') && <button className="btn ghost" onClick={cancel}>Cancel event</button>}
        </div>
      </section>
      <section className="card card-pad">
        <h2>Who's coming</h2>
        {data.rsvps.length ? <div className="chip-row">{data.rsvps.map((r, i) => <span key={i} className="chip gray">{r.member?.username}{r.status === 'maybe' ? ' (maybe)' : ''}</span>)}</div> : <div className="small muted">No RSVPs yet.</div>}
      </section>
    </div>
  );
}

export function YearInReview() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, error, reload } = useApi<{
    year: number; totals: { posts: number; threads: number; members: number; chats: number };
    top_posts: { id: number; thread_id: number; body: string; username: string; up: number; title: string }[];
    top_threads: ThreadItem[]; active_members: (MemberLite & { posts: number })[];
    recognitions: { badge: string; reason: string; user_id: number; username: string; awarded_at: number }[];
    chattiest_games: (GameItem & { chats: number })[]; prediction_champion: (MemberLite & { points: number }) | null;
  }>(`/year-in-review?year=${year}`);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <div className="page-head spread">
        <div><div className="eyebrow">Year in Review</div><h1>{data.year} on NMSU Sports Forum</h1></div>
        <div className="row"><button className="btn secondary small" onClick={() => setYear(year - 1)}>‹ {year - 1}</button>{year < new Date().getFullYear() && <button className="btn secondary small" onClick={() => setYear(year + 1)}>{year + 1} ›</button>}</div>
      </div>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
        <div className="stat"><b>{data.totals.threads}</b><span>Discussions</span></div>
        <div className="stat"><b>{data.totals.posts}</b><span>Posts</span></div>
        <div className="stat"><b>{data.totals.chats}</b><span>Chat messages</span></div>
        <div className="stat"><b>{data.totals.members}</b><span>New members</span></div>
      </div>
      <section className="card"><div className="section-head"><h2>🏅 Most appreciated posts</h2></div>
        {data.top_posts.length ? data.top_posts.map((p) => <Link key={p.id} to={`/t/${p.thread_id}?post=${p.id}`} className="list-row"><div className="grow"><div className="small">“{p.body}”</div><div className="tiny muted">{p.username} · 👍 {p.up} · {p.title}</div></div></Link>) : <div className="empty">No reactions yet this year.</div>}
      </section>
      <section className="card"><div className="section-head"><h2>Biggest discussions</h2></div><ThreadList threads={data.top_threads} /></section>
      <section className="card card-pad"><h2>Most active members</h2>
        {data.active_members.length ? <div className="chip-row">{data.active_members.map((m) => <Link key={m.id} to={`/members/${m.id}`} className="chip gray">{m.display_name || m.username} · {m.posts}</Link>)}</div> : <div className="small muted">—</div>}
        {data.prediction_champion && <p className="small" style={{ marginBottom: 0 }}>🔮 Prediction champion: <strong>{data.prediction_champion.display_name || data.prediction_champion.username}</strong> ({data.prediction_champion.points} pts)</p>}
      </section>
      {data.chattiest_games.length > 0 && <section className="card"><div className="section-head"><h2>Games we couldn't stop talking about</h2></div>{data.chattiest_games.map((g) => <GameRow key={g.id} game={g} extra={<div className="tiny muted">🗨️ {g.chats} chat messages</div>} />)}</section>}
      {data.recognitions.length > 0 && <section className="card card-pad"><h2>People who built the forum</h2>{data.recognitions.map((r, i) => <div key={i} className="small" style={{ padding: '4px 0' }}><span className="badge">{BADGES[r.badge]?.label}</span> <Link to={`/members/${r.user_id}`}>{r.username}</Link> — {r.reason}</div>)}</section>}
    </div>
  );
}

export function Contributions() {
  const { data, error, reload } = useApi<{ contributions: { id: number; badge: string; reason: string; awarded_at: number; user_id: number; username: string; display_name: string | null; awarded_by: string | null }[] }>('/contributions');
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <div className="page-head">
        <div className="eyebrow">Community contribution history</div>
        <h1>The people who helped build this place</h1>
        <p className="small muted" style={{ margin: 0 }}>Recognition celebrates what members have done for the forum. It never grants moderation powers or special access.</p>
      </div>
      <section className="card card-pad">
        <h2>Recognitions</h2>
        <dl className="kv">{Object.entries(BADGES).map(([k, b]) => <Fragment key={k}><dt>{b.label}</dt><dd className="small">{b.description}</dd></Fragment>)}</dl>
      </section>
      <section className="card">
        {data.contributions.length ? data.contributions.map((c) => (
          <div key={c.id} className="list-row">
            <span className="badge">{BADGES[c.badge]?.label ?? c.badge}</span>
            <div className="grow"><Link to={`/members/${c.user_id}`}><strong>{c.display_name || c.username}</strong></Link><div className="small">{c.reason}</div></div>
            <span className="tiny muted">{fullTime(c.awarded_at).split(',').slice(0, 2).join(',')}</span>
          </div>
        )) : <div className="empty">No recognitions awarded yet. Founding Member status appears automatically on each founder's profile.</div>}
      </section>
    </div>
  );
}

export function MapPage() {
  const { data, error, reload } = useApi<{ pins: { id: number; username: string; display_name: string | null; city: string; state: string; map_lat: number; map_lon: number }[] }>('/map');
  const box = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  useEffect(() => {
    if (!data || !box.current) return;
    let map: import('leaflet').Map | null = null;
    let cancelled = false;
    (async () => {
      const L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !box.current) return;
      map = L.map(box.current, { scrollWheelZoom: false }).setView([32.3, -106.75], 5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 10, attribution: '© OpenStreetMap contributors' }).addTo(map);
      const groups = new Map<string, typeof data.pins>();
      for (const p of data.pins) {
        const k = `${p.map_lat},${p.map_lon}`;
        groups.set(k, [...(groups.get(k) ?? []), p]);
      }
      for (const [, list] of groups) {
        const m = L.circleMarker([list[0].map_lat, list[0].map_lon], { radius: 8 + Math.min(list.length, 10), color: '#8C0B42', fillColor: '#8C0B42', fillOpacity: 0.75, weight: 2 }).addTo(map);
        const el = document.createElement('div');
        const place = document.createElement('strong');
        place.textContent = `${list[0].city}, ${list[0].state}`;
        el.appendChild(place);
        el.appendChild(document.createElement('br'));
        for (const p of list) {
          const a = document.createElement('a');
          a.href = `/members/${p.id}`;
          a.textContent = p.display_name || p.username;
          a.onclick = (ev) => { ev.preventDefault(); nav(`/members/${p.id}`); };
          el.appendChild(a);
          el.appendChild(document.createElement('br'));
        }
        m.bindPopup(el);
      }
    })();
    return () => { cancelled = true; map?.remove(); };
  }, [data, nav]);
  if (error) return <ErrorState error={error} retry={reload} />;
  return (
    <div className="stack">
      <div className="page-head"><div className="eyebrow">Member map</div><h1>Where Aggies are</h1><p className="small muted" style={{ margin: 0 }}>Opt-in only, by city, rounded to about 10 km. Turn it on in Settings.</p></div>
      <div className="map-box" ref={box} role="region" aria-label="Map of members by city" />
      {data && !data.pins.length && <div className="empty">No members on the map yet.</div>}
      {data && data.pins.length > 0 && (
        <section className="card">
          {data.pins.map((p) => <Link key={p.id} to={`/members/${p.id}`} className="list-row"><Avatar member={{ id: p.id, username: p.username, display_name: p.display_name }} size="sm" /><span className="grow">{p.display_name || p.username}</span><span className="small muted">{p.city}, {p.state}</span></Link>)}
        </section>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { api } from '../api';
import { useApi, useApp } from '../state';
import { fullTime, gameTime, matchup, sportName, timeAgo } from '../format';
import { ErrorState, Loading, Modal, type GameItem } from '../components/ui';
import { BADGES, SPORTS } from '../../shared/sports';

function copy(text: string, toast: (m: string) => void) {
  navigator.clipboard?.writeText(text).then(() => toast('Link copied'), () => toast('Copy failed — select the link and copy it manually'));
}

interface Feed { id: number; sport: string; url: string; enabled: number; last_ok_at: number | null; last_error: string | null; last_error_at: number | null; failing: number; last_counts: string | null }

function Overview() {
  const { data, error, reload } = useApi<{ members: { total: number; admins: number; suspended: number }; open_reports: number; pending_posts: number; open_invites: number; feeds: Feed[]; log: { id: number; actor: string | null; action: string; target_type: string; detail: string | null; created_at: number }[]; emailEnabled: boolean }>('/admin/overview');
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  const failing = data.feeds.filter((f) => f.failing > 0);
  return (
    <div className="stack">
      <div className="stat-grid">
        <Link to="/admin/members" className="stat"><b>{data.members.total}</b><span>Members ({data.members.admins} admins)</span></Link>
        <Link to="/admin/reports" className="stat"><b>{data.open_reports}</b><span>Open reports</span></Link>
        <Link to="/admin/approvals" className="stat"><b>{data.pending_posts}</b><span>Waiting approval</span></Link>
      </div>
      {!data.feeds.length && <div className="notice small"><strong>Schedules aren't connected yet.</strong> Add the official NMSU Athletics calendar feed(s) under <Link to="/admin/data">Sports data</Link> so games populate automatically.</div>}
      {failing.length > 0 && <div className="error-box small">⚠️ {failing.length} schedule feed{failing.length > 1 ? 's are' : ' is'} failing. The forum keeps showing the last good data. See <Link to="/admin/data">Sports data</Link>.</div>}
      {!data.emailEnabled && <div className="note-box small">Email is not configured, so invitations and password resets are shared as links you copy and send yourself (text, email, etc.). The technical owner can enable email later; see docs/DEPLOYMENT.md.</div>}
      <section className="card">
        <div className="section-head"><h2>Recent moderation activity</h2><Link to="/admin/log" className="small">Full log</Link></div>
        {data.log.length ? data.log.map((l) => <div key={l.id} className="list-row small"><span className="grow"><strong>{l.actor ?? 'system'}</strong> {l.action.replace(/_/g, ' ')} {l.detail ? `— ${l.detail.slice(0, 100)}` : ''}</span><span className="tiny muted">{timeAgo(l.created_at)}</span></div>) : <div className="empty">Nothing yet.</div>}
      </section>
    </div>
  );
}

function Invites() {
  const { toast, emailEnabled } = useApp();
  const { data, reload } = useApi<{ invites: { id: number; email: string | null; note: string | null; max_uses: number; uses: number; expires_at: number; revoked: number; created_at: number; created_by: string; used_by: string | null }[] }>('/admin/invites');
  const [f, setF] = useState({ email: '', note: '', days: '14', max_uses: '1' });
  const [created, setCreated] = useState<{ link: string; emailed: boolean } | null>(null);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ link: string; emailed: boolean }>('/admin/invites', { body: { email: f.email, note: f.note, days: Number(f.days), max_uses: Number(f.max_uses) } });
      setCreated(r);
      setF({ email: '', note: '', days: '14', max_uses: '1' });
      reload();
    } catch (err) { toast((err as Error).message); }
  };
  const revoke = async (id: number) => { await api(`/admin/invites/${id}`, { method: 'DELETE' }); toast('Invitation revoked'); reload(); };
  return (
    <div className="stack">
      <section className="card card-pad">
        <h2>Invite a member</h2>
        <form onSubmit={create}>
          <div className="grid-2">
            <div className="field"><label htmlFor="ie">Email (optional)</label><input id="ie" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /><span className="hint">{emailEnabled ? 'If given, the invite is emailed and only that address can use it.' : 'If given, only that address can use the invite.'}</span></div>
            <div className="field"><label htmlFor="in">Private note</label><input id="in" className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Rick from the tailgate" /></div>
            <div className="field"><label htmlFor="id">Expires after (days)</label><input id="id" type="number" min={1} max={60} className="input" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></div>
            <div className="field"><label htmlFor="iu">Number of uses</label><input id="iu" type="number" min={1} max={50} className="input" value={f.max_uses} onChange={(e) => setF({ ...f, max_uses: e.target.value })} /></div>
          </div>
          <button className="btn">Create invitation</button>
        </form>
      </section>
      {created && (
        <Modal title="Invitation created" onClose={() => setCreated(null)}>
          {created.emailed && <p className="small">Emailed to the address you entered.</p>}
          <p className="small">Copy this link and send it to the new member. It is shown only once.</p>
          <input className="input" readOnly value={created.link} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
          <div className="row" style={{ marginTop: 10 }}><button className="btn" onClick={() => copy(created.link, toast)}>Copy link</button>{'share' in navigator && <button className="btn secondary" onClick={() => navigator.share({ title: 'NMSU Sports Forum invitation', text: "You're invited to NMSU Sports Forum", url: created.link }).catch(() => {})}>Share…</button>}</div>
        </Modal>
      )}
      <section className="card">
        <div className="section-head"><h2>Invitations</h2></div>
        <div className="table-scroll"><table className="simple"><thead><tr><th>Created</th><th>For</th><th>Used</th><th>Status</th><th /></tr></thead><tbody>
          {data?.invites.map((i) => {
            const status = i.revoked ? 'Revoked' : i.uses >= i.max_uses ? 'Used' : i.expires_at < Date.now() ? 'Expired' : 'Active';
            return (
              <tr key={i.id}>
                <td>{timeAgo(i.created_at)}<div className="tiny muted">by {i.created_by}</div></td>
                <td>{i.email ?? '—'}{i.note && <div className="tiny muted">{i.note}</div>}</td>
                <td>{i.uses}/{i.max_uses}{i.used_by && <div className="tiny muted">{i.used_by}</div>}</td>
                <td>{status}{status === 'Active' && <div className="tiny muted">until {fullTime(i.expires_at)}</div>}</td>
                <td>{status === 'Active' && <button className="btn ghost small" onClick={() => revoke(i.id)}>Revoke</button>}</td>
              </tr>
            );
          })}
        </tbody></table></div>
      </section>
    </div>
  );
}

function Members() {
  const { me, toast } = useApp();
  const { data, reload } = useApi<{ members: { id: number; username: string; email: string; display_name: string | null; role: string; status: string; suspended_until: number | null; created_at: number; last_seen_at: number | null; posts: number }[] }>('/admin/members');
  const [link, setLink] = useState<string | null>(null);
  const [badgeFor, setBadgeFor] = useState<{ id: number; username: string } | null>(null);
  const patch = async (id: number, body: Record<string, unknown>, msg: string) => {
    try { await api(`/admin/members/${id}`, { method: 'PATCH', body }); toast(msg); reload(); } catch (e) { toast((e as Error).message); }
  };
  const reset = async (id: number) => {
    const r = await api<{ link: string; emailed: boolean }>(`/admin/members/${id}/reset-link`, { method: 'POST' });
    setLink(r.link);
  };
  if (!data) return <Loading />;
  return (
    <section className="card">
      <div className="section-head"><h2>Members</h2><span className="small muted">Email addresses are visible to admins for account recovery only.</span></div>
      <div className="table-scroll"><table className="simple"><thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Activity</th><th>Actions</th></tr></thead><tbody>
        {data.members.map((m) => (
          <tr key={m.id}>
            <td><Link to={`/members/${m.id}`}>{m.username}</Link><div className="tiny muted">{m.email}</div></td>
            <td>{m.role}</td>
            <td>{m.status}{m.suspended_until ? <div className="tiny muted">until {fullTime(m.suspended_until)}</div> : null}</td>
            <td className="tiny">{m.posts} posts<br />joined {timeAgo(m.created_at)}<br />{m.last_seen_at ? `seen ${timeAgo(m.last_seen_at)}` : 'never seen'}</td>
            <td>
              <div className="row" style={{ gap: 4 }}>
                {m.id !== me?.id && (m.role === 'admin'
                  ? <button className="btn ghost small" onClick={() => patch(m.id, { role: 'member' }, 'Admin role removed')}>Remove admin</button>
                  : <button className="btn ghost small" onClick={() => confirm(`Make ${m.username} an administrator?`) && patch(m.id, { role: 'admin' }, 'Now an administrator')}>Make admin</button>)}
                {m.id !== me?.id && (m.status === 'active'
                  ? <button className="btn ghost small" onClick={() => {
                      const reason = prompt(`Suspend ${m.username}? Reason (private):`);
                      if (reason === null) return;
                      const days = prompt('For how many days? Leave blank to suspend until you reinstate them.', '7');
                      if (days === null) return;
                      const body: Record<string, unknown> = { status: 'suspended', reason };
                      if (days.trim()) body.days = Number(days);
                      patch(m.id, body as Record<string, string>, days.trim() ? `Suspended for ${days} days` : 'Member suspended and signed out');
                    }}>Suspend</button>
                  : <button className="btn ghost small" onClick={() => patch(m.id, { status: 'active' }, 'Member reinstated')}>Reinstate</button>)}
                <button className="btn ghost small" onClick={() => reset(m.id)}>Reset link</button>
                <button className="btn ghost small" onClick={() => setBadgeFor(m)}>Recognize</button>
              </div>
            </td>
          </tr>
        ))}
      </tbody></table></div>
      {link && (
        <Modal title="Password reset link" onClose={() => setLink(null)}>
          <p className="small">Send this to the member. It works once and expires in 3 days.</p>
          <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Reset link" />
          <button className="btn" style={{ marginTop: 10 }} onClick={() => copy(link, toast)}>Copy link</button>
        </Modal>
      )}
      {badgeFor && <BadgeModal member={badgeFor} onClose={() => setBadgeFor(null)} />}
    </section>
  );
}

function BadgeModal({ member, onClose }: { member: { id: number; username: string }; onClose: () => void }) {
  const { toast } = useApp();
  const [badge, setBadge] = useState('builder');
  const [reason, setReason] = useState('');
  const save = async () => {
    try { await api('/admin/badges', { body: { user_id: member.id, badge, reason } }); toast('Recognition awarded'); onClose(); } catch (e) { toast((e as Error).message); }
  };
  return (
    <Modal title={`Recognize ${member.username}`} onClose={onClose}>
      <div className="field"><label htmlFor="bb">Recognition</label><select id="bb" className="select" value={badge} onChange={(e) => setBadge(e.target.value)}>{Object.entries(BADGES).filter(([k]) => k !== 'founding').map(([k, b]) => <option key={k} value={k}>{b.label} — {b.description}</option>)}</select></div>
      <div className="field"><label htmlFor="br">Reason (shown on their profile and in the contribution history)</label><input id="br" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Suggested the game-day chat" /></div>
      <p className="tiny muted">Recognition never grants moderation powers.</p>
      <button className="btn" disabled={reason.trim().length < 3} onClick={save}>Award</button>
    </Modal>
  );
}

function Reports() {
  const { toast, refreshPulse } = useApp();
  const [status, setStatus] = useState('open');
  const { data, reload } = useApi<{ reports: { id: number; reporter: string; post_id: number | null; dm_message_id: number | null; chat_message_id: number | null; thread_id: number | null; snapshot: string; reason: string; status: string; resolver: string | null; resolution_note: string | null; created_at: number }[] }>(`/admin/reports?status=${status}`);
  const resolve = async (id: number, s: string) => {
    const note = prompt('Resolution note (optional, private):') ?? '';
    await api(`/admin/reports/${id}`, { method: 'PATCH', body: { status: s, note } });
    toast(`Report ${s}`);
    refreshPulse();
    reload();
  };
  const removePost = async (postId: number) => { if (!confirm('Remove this post?')) return; await api(`/posts/${postId}`, { method: 'DELETE' }); toast('Post removed'); };
  const removeChat = async (id: number) => { await api(`/chat/messages/${id}`, { method: 'DELETE' }); toast('Chat message removed'); };
  return (
    <section className="card">
      <div className="tabs">{['open', 'resolved', 'dismissed'].map((s) => <button key={s} className={`tab ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}</div>
      {!data ? <Loading /> : data.reports.length ? data.reports.map((r) => (
        <div key={r.id} className="card-pad" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="small"><strong>{r.reporter}</strong> reported {r.dm_message_id ? 'a private message (shared voluntarily by the recipient)' : r.chat_message_id ? 'a chat message' : 'a post'} · {timeAgo(r.created_at)}</div>
          <div className="small" style={{ margin: '4px 0' }}>Reason: {r.reason}</div>
          <blockquote className="quote-embed small">{r.snapshot}</blockquote>
          <div className="row">
            {r.thread_id && r.post_id && <Link className="btn ghost small" to={`/t/${r.thread_id}?post=${r.post_id}`}>View in context</Link>}
            {r.post_id && <button className="btn ghost small" onClick={() => removePost(r.post_id!)}>Remove post</button>}
            {r.chat_message_id && <button className="btn ghost small" onClick={() => removeChat(r.chat_message_id!)}>Remove chat message</button>}
            {r.status === 'open' ? (
              <><button className="btn small" onClick={() => resolve(r.id, 'resolved')}>Resolve</button><button className="btn secondary small" onClick={() => resolve(r.id, 'dismissed')}>Dismiss</button></>
            ) : <span className="tiny muted">{r.status} by {r.resolver}{r.resolution_note ? `: ${r.resolution_note}` : ''}</span>}
          </div>
        </div>
      )) : <div className="empty">No {status} reports.</div>}
    </section>
  );
}

function Approvals() {
  const { toast, refreshPulse } = useApp();
  const { data, reload } = useApi<{ pending: { id: number; body: string; created_at: number; thread_id: number; title: string; new_thread: number; user_id: number; username: string }[] }>('/admin/pending');
  const decide = async (id: number, approve: boolean) => {
    try { await api(`/admin/pending/${id}`, { body: { approve } }); toast(approve ? 'Approved' : 'Rejected'); refreshPulse(); reload(); } catch (e) { toast((e as Error).message); }
  };
  if (!data) return <Loading />;
  return (
    <section className="card">
      <div className="section-head"><h2>Waiting for approval</h2><span className="small muted">Turn this on or off in Settings</span></div>
      {data.pending.length ? data.pending.map((p) => (
        <div key={p.id} className="card-pad" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="small"><strong>{p.username}</strong> {p.new_thread ? 'started' : 'replied in'} <Link to={`/t/${p.thread_id}`}>“{p.title}”</Link> · {timeAgo(p.created_at)}</div>
          <blockquote className="quote-embed small">{p.body.slice(0, 600)}</blockquote>
          <div className="row"><button className="btn small" onClick={() => decide(p.id, true)}>Approve</button><button className="btn secondary small" onClick={() => decide(p.id, false)}>Reject</button></div>
        </div>
      )) : <div className="empty">Nothing waiting.</div>}
    </section>
  );
}

function SportsData() {
  const { toast } = useApp();
  const { data, reload } = useApi<{ feeds: Feed[] }>('/admin/overview');
  const { data: games, reload: reloadGames } = useApi<{ games: GameItem[] }>('/games?range=upcoming');
  const [f, setF] = useState({ sport: 'auto', url: '' });
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState<GameItem | null>(null);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api('/admin/feeds', { body: f }); setF({ sport: 'auto', url: '' }); toast('Feed added. Run a sync to import now.'); reload(); } catch (err) { toast((err as Error).message); }
  };
  const sync = async () => {
    setBusy(true);
    try {
      const r = await api<{ results: { feed: number; ok: boolean; error?: string }[] }>('/admin/feeds/sync', { method: 'POST' });
      const bad = r.results.filter((x) => !x.ok);
      toast(bad.length ? `Sync finished with ${bad.length} error(s)` : 'Sync complete');
      reload();
      reloadGames();
    } catch (err) { toast((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <div className="note-box small">
        Schedules and results populate <strong>automatically</strong> from the official NMSU Athletics calendar feeds (iCalendar). The forum checks every 30 minutes, creates pregame and postgame threads, opens game chat, and scores predictions. Nobody needs to type games in. If a feed fails, the forum keeps the last good data and admins are notified.
      </div>
      <section className="card card-pad">
        <div className="spread"><h2 style={{ margin: 0 }}>Schedule feeds</h2><button className="btn small" disabled={busy || !data?.feeds.length} onClick={sync}>{busy ? 'Syncing…' : 'Sync now'}</button></div>
        {data?.feeds.length ? (
          <div className="table-scroll" style={{ marginTop: 10 }}><table className="simple"><thead><tr><th>Sport</th><th>Feed</th><th>Status</th><th /></tr></thead><tbody>
            {data.feeds.map((x) => (
              <tr key={x.id}>
                <td>{x.sport === 'auto' ? 'All sports (detect)' : sportName(x.sport)}</td>
                <td className="tiny" style={{ wordBreak: 'break-all' }}>{x.url}</td>
                <td className="tiny">
                  {!x.enabled ? 'Paused' : x.failing ? <span style={{ color: 'var(--crimson)' }}>Failing ({x.failing}×): {x.last_error}</span> : x.last_ok_at ? <>OK · {timeAgo(x.last_ok_at)}{x.last_counts && <><br />{(() => { const c = JSON.parse(x.last_counts); return `${c.total} events, ${c.added} new, ${c.updated} updated`; })()}</>}</> : 'Not synced yet'}
                </td>
                <td>
                  <button className="btn ghost small" onClick={() => api(`/admin/feeds/${x.id}`, { method: 'PATCH', body: { enabled: !x.enabled } }).then(reload)}>{x.enabled ? 'Pause' : 'Resume'}</button>
                  <button className="btn ghost small" onClick={() => confirm('Remove this feed? Imported games stay.') && api(`/admin/feeds/${x.id}`, { method: 'DELETE' }).then(reload)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <p className="small muted">No feeds connected yet.</p>}
        <form onSubmit={add} style={{ marginTop: 14 }}>
          <div className="grid-2">
            <div className="field"><label htmlFor="fs">Sport</label><select id="fs" className="select" value={f.sport} onChange={(e) => setF({ ...f, sport: e.target.value })}><option value="auto">All sports (composite calendar)</option>{SPORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
            <div className="field"><label htmlFor="fu">Official calendar feed URL (.ics)</label><input id="fu" className="input" type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} required placeholder="https://nmstatesports.com/…" /><span className="hint">Use the “Sync to calendar / iCal” link on the official schedule page.</span></div>
          </div>
          <button className="btn secondary">Add feed</button>
        </form>
      </section>
      <section className="card">
        <div className="section-head"><h2>Upcoming games (from feeds)</h2></div>
        {games?.games.length ? games.games.slice(0, 40).map((g) => (
          <div key={g.id} className="list-row small">
            <span className="grow"><strong>{sportName(g.sport)}</strong> · NM State {matchup(g)}<div className="tiny muted">{gameTime(g.starts_at, g.time_tba)}{g.overridden ? ' · corrected by admin' : ''}</div></span>
            <button className="btn ghost small" onClick={() => setOverride(g)}>Correct…</button>
          </div>
        )) : <div className="empty">No upcoming games imported yet.</div>}
      </section>
      <RecruitingSync />
      {override && <OverrideModal game={override} onClose={() => { setOverride(null); reloadGames(); }} />}
    </div>
  );
}

function OverrideModal({ game, onClose }: { game: GameItem; onClose: () => void }) {
  const { toast } = useApp();
  const local = (t: number) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [f, setF] = useState({ starts: local(game.starts_at), status: game.status, tv: game.tv ?? '', venue: game.venue ?? '' });
  const save = async () => {
    try {
      await api(`/admin/games/${game.id}`, { method: 'PATCH', body: { starts_at: new Date(f.starts).getTime(), status: f.status, tv: f.tv, venue: f.venue } });
      toast('Correction saved');
      onClose();
    } catch (e) { toast((e as Error).message); }
  };
  const clear = async () => { await api(`/admin/games/${game.id}`, { method: 'PATCH', body: { clear: true } }); toast('Correction cleared; the feed is authoritative again'); onClose(); };
  return (
    <Modal title="Emergency correction" onClose={onClose}>
      <p className="small muted">Use only when the official feed is wrong. Corrected fields are flagged and won't be overwritten by the feed until you clear the correction.</p>
      <div className="field"><label htmlFor="os">Start (your local time)</label><input id="os" type="datetime-local" className="input" value={f.starts} onChange={(e) => setF({ ...f, starts: e.target.value })} /></div>
      <div className="field"><label htmlFor="ost">Status</label><select id="ost" className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{['scheduled', 'postponed', 'canceled', 'final'].map((s) => <option key={s}>{s}</option>)}</select></div>
      <div className="field"><label htmlFor="otv">TV / stream</label><input id="otv" className="input" value={f.tv} onChange={(e) => setF({ ...f, tv: e.target.value })} /></div>
      <div className="field"><label htmlFor="ov">Venue</label><input id="ov" className="input" value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} /></div>
      <div className="row"><button className="btn" onClick={save}>Save correction</button>{game.overridden && <button className="btn secondary" onClick={clear}>Clear correction</button>}</div>
    </Modal>
  );
}

function SettingsTab() {
  const { toast } = useApp();
  const { data, reload } = useApi<{ settings: Record<string, string> }>('/admin/settings');
  const [s, setS] = useState<Record<string, string> | null>(null);
  const cur = s ?? data?.settings;
  if (!cur) return <Loading />;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api('/admin/settings', { method: 'PUT', body: cur }); toast('Settings saved'); reload(); } catch (err) { toast((err as Error).message); }
  };
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setS({ ...cur, [k]: e.target.value });
  return (
    <section className="card card-pad">
      <h2>Community settings</h2>
      <form onSubmit={save}>
        <div className="field"><label htmlFor="ld">Official launch date</label><input id="ld" type="date" className="input" value={cur.launch_date} onChange={set('launch_date')} /><span className="hint">Members who join within 30 days of this date are Founding Members. Leave blank until launch — everyone who joins before launch is a founder.</span></div>
        <div className="field"><label htmlFor="ht">Honorary Founding Member threshold</label><input id="ht" type="number" min={0} className="input" value={cur.honorary_threshold} onChange={set('honorary_threshold')} /><span className="hint">Thumbs-up from this many <em>different</em> members earns a later member Honorary Founding Member automatically. 0 = off (admins can still award it by hand).</span></div>
        <div className="field"><label htmlFor="cw">Live chat window (messages)</label><input id="cw" type="number" min={10} max={500} className="input" value={cur.chat_window} onChange={set('chat_window')} /><span className="hint">How many recent messages show in a live room. Everything is archived permanently regardless.</span></div>
        <label className="check"><input type="checkbox" checked={cur.approve_first_post === '1'} onChange={(e) => setS({ ...cur, approve_first_post: e.target.checked ? '1' : '0' })} /><span>Approve each new member's first post<span className="hint" style={{ display: 'block' }}>New members' first post waits in Admin → Approvals. Once one post is approved, their posts appear right away.</span></span></label>
        <div className="field"><label htmlFor="an">Home page announcement</label><textarea id="an" className="textarea" style={{ minHeight: 70 }} value={cur.announcement} onChange={set('announcement')} maxLength={500} /></div>
        <button className="btn">Save settings</button>
      </form>
    </section>
  );
}

function Log() {
  const { data } = useApi<{ log: { id: number; actor: string | null; action: string; target_type: string; target_id: number | null; detail: string | null; created_at: number }[] }>('/admin/log');
  if (!data) return <Loading />;
  return (
    <section className="card">
      <div className="section-head"><h2>Moderation log</h2><span className="small muted">Private to administrators</span></div>
      <div className="table-scroll"><table className="simple"><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Detail</th></tr></thead><tbody>
        {data.log.map((l) => <tr key={l.id}><td className="tiny">{fullTime(l.created_at)}</td><td>{l.actor ?? 'system'}</td><td>{l.action.replace(/_/g, ' ')} <span className="tiny muted">{l.target_type} {l.target_id ?? ''}</span></td><td className="tiny">{l.detail}</td></tr>)}
      </tbody></table></div>
    </section>
  );
}

export function Admin() {
  const { me, pulse } = useApp();
  if (me?.role !== 'admin') return <ErrorState error="Administrators only." />;
  return (
    <div className="stack">
      <div className="page-head"><div className="eyebrow">Community administration</div><h1>Admin</h1><p className="small muted" style={{ margin: 0 }}>Community administration is separate from technical ownership of hosting, the domain and GitHub.</p></div>
      <nav className="card tabs" aria-label="Admin sections">
        {[['', 'Overview'], ['invites', 'Invitations'], ['members', 'Members'], ['reports', 'Reports'], ['approvals', 'Approvals'], ['data', 'Sports data'], ['settings', 'Settings'], ['log', 'Log']].map(([p, l]) => (
          <NavLink key={p} to={`/admin${p ? `/${p}` : ''}`} end className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>{l}</NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="invites" element={<Invites />} />
        <Route path="members" element={<Members />} />
        <Route path="reports" element={<Reports />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="data" element={<SportsData />} />
        <Route path="settings" element={<SettingsTab />} />
        <Route path="log" element={<Log />} />
      </Routes>
    </div>
  );
}

function RecruitingSync() {
  const { toast } = useApp();
  const { data, reload } = useApi<{ sync: { configured: boolean; last_ok_at?: number | null; last_error?: string | null; last_counts?: string | null } }>('/players?kind=recruit');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; added?: number; updated?: number; error?: string; skipped?: string }>('/admin/recruiting/sync', { method: 'POST' });
      toast(r.ok ? `Recruiting updated: ${r.added} new, ${r.updated} changed` : r.skipped ?? `Failed: ${r.error}`);
      reload();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const s = data?.sync;
  return (
    <section className="card card-pad">
      <div className="spread"><h2 style={{ margin: 0 }}>Football recruiting &amp; portal</h2><button className="btn small" disabled={busy || !s?.configured} onClick={run}>{busy ? 'Updating…' : 'Update now'}</button></div>
      <p className="small muted">Updates automatically once a day from CollegeFootballData.com.</p>
      <div className="small">
        {!s ? '…' : !s.configured ? 'Not connected: the technical owner adds the free CFBD_API_KEY secret (see docs/DEPLOYMENT.md).'
          : s.last_error ? <span style={{ color: 'var(--crimson)' }}>Last update failed: {s.last_error}</span>
          : s.last_ok_at ? <>OK · {timeAgo(s.last_ok_at)}{s.last_counts && <> · {(() => { const c = JSON.parse(s.last_counts); return `${c.total} players, ${c.added} new, ${c.updated} changed`; })()}</>}</> : 'Waiting for the first update.'}
      </div>
    </section>
  );
}

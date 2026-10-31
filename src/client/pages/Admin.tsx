import { useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { api } from '../api';
import { useApi, useApp } from '../state';
import { fullTime, gameTime, matchup, sportName, timeAgo } from '../format';
import { ErrorState, Loading, Modal, type GameItem } from '../components/ui';
import { InviteSheet, type CreatedInvite } from '../components/Invite';
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

/** US numbers: 10 digits become +1XXXXXXXXXX; anything else is passed through as typed digits. */
function Invites() {
  const { toast, emailEnabled } = useApp();
  const { data, reload } = useApi<{ invites: { id: number; email: string | null; note: string | null; max_uses: number; uses: number; expires_at: number; revoked: number; created_at: number; created_by: string; used_by: string | null }[] }>('/admin/invites');
  const blank = { name: '', phone: '', email: '', lock: false, note: '', days: '14', max_uses: '1' };
  const [f, setF] = useState(blank);
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const make = async (v: typeof blank) => {
    try {
      // The phone number stays on this device: it's only used to open your Messages app.
      const r = await api<{ link: string; emailed: boolean; days: number }>('/admin/invites', { body: { name: v.name, email: v.email, lock_email: v.lock, note: v.note, days: Number(v.days), max_uses: Number(v.max_uses) } });
      setCreated({ ...r, name: v.name, phone: v.phone, email: v.email });
      setF(blank);
      reload();
    } catch (err) { toast((err as Error).message); }
  };
  const create = (e: React.FormEvent) => { e.preventDefault(); make(f); };
  // Contact Picker is available on some phones (Android Chrome; iPhone only behind a Safari setting).
  const contacts = (navigator as Navigator & { contacts?: { select: (props: string[], opts: { multiple: boolean }) => Promise<{ name?: string[]; tel?: string[]; email?: string[] }[]> } }).contacts;
  const pick = async () => {
    try {
      const [c] = await contacts!.select(['name', 'tel', 'email'], { multiple: false });
      if (c) setF({ ...f, name: c.name?.[0]?.split(' ')[0] ?? f.name, phone: c.tel?.[0] ?? '', email: c.email?.[0] ?? '' });
    } catch { /* picker closed */ }
  };
  const revoke = async (id: number) => { await api(`/admin/invites/${id}`, { method: 'DELETE' }); toast('Invitation revoked'); reload(); };
  return (
    <div className="stack">
      <section className="card card-pad">
        <h2>Invite someone</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Tap the button, then choose Text or Email and pick the person from your phone's contacts. The invitation is already written for you.</p>
        <button className="btn block" onClick={() => make(blank)}>📱 Invite someone from my phone</button>
      </section>
      <section className="card card-pad">
        <h2>Or type in their details</h2>
        {contacts && <button type="button" className="btn secondary small" style={{ marginBottom: 10 }} onClick={pick}>Choose from contacts</button>}
        <form onSubmit={create}>
          <div className="grid-2">
            <div className="field"><label htmlFor="iname">Their name (optional)</label><input id="iname" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Rick" maxLength={60} /><span className="hint">Used to greet them in the message.</span></div>
            <div className="field"><label htmlFor="iphone">Cell number (optional)</label><input id="iphone" type="tel" inputMode="tel" autoComplete="off" className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="575-555-0123" /><span className="hint">Not saved on the site. It just fills in your text message.</span></div>
            <div className="field"><label htmlFor="ie">Email (optional)</label><input id="ie" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /><span className="hint">{emailEnabled ? 'The site emails the invitation automatically, and you can also send it yourself.' : 'You can send it from your own email app in the next step.'}</span></div>
            <div className="field"><label htmlFor="in">Private note</label><input id="in" className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. from the tailgate" /></div>
          </div>
          {f.email && <label className="check"><input type="checkbox" checked={f.lock} onChange={(e) => setF({ ...f, lock: e.target.checked })} /><span>Only this email address can use the invitation</span></label>}
          <details style={{ marginBottom: 12 }}>
            <summary className="small muted" style={{ cursor: 'pointer' }}>More options</summary>
            <div className="grid-2" style={{ marginTop: 10 }}>
              <div className="field"><label htmlFor="id">Expires after (days)</label><input id="id" type="number" min={1} max={60} className="input" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></div>
              <div className="field"><label htmlFor="iu">Number of uses</label><input id="iu" type="number" min={1} max={50} className="input" value={f.max_uses} onChange={(e) => setF({ ...f, max_uses: e.target.value })} /></div>
            </div>
          </details>
          <button className="btn">Create invitation</button>
        </form>
      </section>
      {created && <InviteSheet created={created} onClose={() => setCreated(null)} />}
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
      <ul className="member-admin-list">
        {data.members.map((m) => {
          const self = m.id === me?.id;
          // One compact menu instead of a row of buttons; each choice runs once, then the menu resets.
          const act = (choice: string) => {
            if (choice === 'admin') { if (confirm(`Make ${m.username} an administrator?`)) patch(m.id, { role: 'admin' }, 'Now an administrator'); }
            else if (choice === 'unadmin') { if (confirm(`Remove ${m.username}'s admin role?`)) patch(m.id, { role: 'member' }, 'Admin role removed'); }
            else if (choice === 'suspend') {
              const days = prompt(`Suspend ${m.username} for how many days? (1–90. Permanent bans need three moderators: use "Propose ban".)`, '7');
              if (!days) return;
              const reason = prompt('Reason (the member sees it and can appeal):');
              if (reason) patch(m.id, { status: 'suspended', days: Number(days), reason }, `Suspended for ${days} days`);
            } else if (choice === 'reinstate') { const reason = prompt(`Lift ${m.username}'s suspension? Reason (recorded):`); if (reason) patch(m.id, { status: 'active', reason }, 'Member reinstated'); }
            else if (choice === 'warn') { const reason = prompt(`Warning for ${m.username} (they see it and can appeal):`); if (reason) api(`/admin/members/${m.id}/warn`, { body: { reason } }).then(() => toast('Warning sent')).catch((e) => toast(e.message)); }
            else if (choice === 'ban') {
              const reason = prompt(`Propose permanently banning ${m.username}? Three moderators must approve. Explain why:`);
              if (reason) api<{ status: string; approvals: number }>('/admin/bans', { body: { user_id: m.id, reason } }).then((r) => toast(r.status === 'approved' ? 'Banned' : `Ban proposed: ${r.approvals} of 3 approvals. Other moderators have been notified.`)).catch((e) => toast(e.message));
            } else if (choice === 'reset') reset(m.id);
            else if (choice === 'recognize') setBadgeFor(m);
          };
          return (
            <li key={m.id}>
              <div className="grow">
                <Link to={`/members/${m.id}`}><strong>{m.username}</strong></Link>{m.role === 'admin' && <span className="chip" style={{ marginLeft: 6 }}>Admin</span>}{m.status !== 'active' && <span className="chip gray" style={{ marginLeft: 6 }}>{m.status}</span>}
                <div className="tiny muted">{m.email}</div>
                <div className="tiny muted">{m.posts} {m.posts === 1 ? 'post' : 'posts'} · joined {timeAgo(m.created_at)} · {m.last_seen_at ? `seen ${timeAgo(m.last_seen_at)}` : 'never seen'}{m.suspended_until ? ` · suspended until ${fullTime(m.suspended_until)}` : ''}</div>
              </div>
              <select className="select small-select" aria-label={`Actions for ${m.username}`} value="" onChange={(e) => { act(e.target.value); e.target.value = ''; }}>
                <option value="">Actions…</option>
                {!self && (m.role === 'admin' ? <option value="unadmin">Remove admin</option> : <option value="admin">Make admin</option>)}
                {!self && (m.status === 'active' ? <option value="suspend">Suspend</option> : <option value="reinstate">Reinstate</option>)}
                {!self && <option value="warn">Warn</option>}
                {!self && m.status === 'active' && <option value="ban">Propose ban</option>}
                <option value="reset">Password reset link</option>
                <option value="recognize">Recognize</option>
              </select>
            </li>
          );
        })}
      </ul>
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

interface Flagger { id: number; username: string; can_flag: number; on_author_30d: number; dismissed: number; total: number }

function Flagged() {
  const { toast, refreshPulse } = useApp();
  const { data, reload } = useApi<{ flagged: { id: number; thread_id: number; body: string; hidden: number; username: string | null; user_id: number | null; title: string; flags: number; prior_warnings: number; flaggers: Flagger[] }[] }>('/admin/flagged');
  const [reason, setReason] = useState<Record<number, string>>({});
  const [warn, setWarn] = useState<Record<number, boolean>>({});
  const act = async (id: number, action: 'restore' | 'remove') => {
    try {
      await api(`/admin/flagged/${id}`, { body: { action, reason: reason[id] ?? '', warn: Boolean(warn[id]) } });
      toast(action === 'restore' ? 'Restored' : 'Removed');
      refreshPulse();
      reload();
    } catch (e) { toast((e as Error).message); }
  };
  if (!data?.flagged.length) return null;
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="section-head"><h2>🚩 Flagged posts</h2><span className="small muted">Three flags hide a post until reviewed. Flags never change reputation.</span></div>
      {data.flagged.map((f) => (
        <div key={f.id} className="card-pad" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="small"><strong>{f.username ?? 'member'}</strong> in <Link to={`/t/${f.thread_id}?post=${f.id}`}>“{f.title}”</Link> · {f.flags} flag{f.flags === 1 ? '' : 's'} {f.hidden ? <span className="chip gray">Hidden pending review</span> : null}{f.prior_warnings ? <span className="tiny muted"> · {f.prior_warnings} earlier warning{f.prior_warnings === 1 ? '' : 's'}</span> : null}</div>
          <blockquote className="quote-embed small">{f.body.slice(0, 500)}</blockquote>
          <div className="tiny muted" style={{ marginBottom: 6 }}>
            Flagged by: {f.flaggers.map((x, i) => (
              <span key={x.id}>{i > 0 && ', '}<strong>{x.username}</strong> ({x.on_author_30d > 1 ? `${x.on_author_30d} flags on this member in 30 days, ` : ''}{x.dismissed}/{x.total} past flags dismissed{x.can_flag ? '' : ', flagging off'})</span>
            ))}
          </div>
          <input className="input" placeholder="Reason (recorded; the member sees it)" value={reason[f.id] ?? ''} onChange={(e) => setReason({ ...reason, [f.id]: e.target.value })} aria-label="Reason" />
          <div className="row" style={{ marginTop: 8 }}>
            <label className="small row"><input type="checkbox" checked={Boolean(warn[f.id])} onChange={(e) => setWarn({ ...warn, [f.id]: e.target.checked })} /> Also send a warning</label>
            <button className="btn secondary small" disabled={(reason[f.id] ?? '').trim().length < 3} onClick={() => act(f.id, 'restore')}>Restore</button>
            <button className="btn small" disabled={(reason[f.id] ?? '').trim().length < 3} onClick={() => act(f.id, 'remove')}>Remove</button>
          </div>
        </div>
      ))}
    </section>
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
  const removePost = async (postId: number) => { const reason = prompt('Reason for removing this post (the member sees it and can appeal):'); if (!reason) return; try { await api(`/posts/${postId}`, { method: 'DELETE', body: { reason } }); toast('Post removed'); } catch (e) { toast((e as Error).message); } };
  const removeChat = async (id: number) => { await api(`/chat/messages/${id}`, { method: 'DELETE' }); toast('Chat message removed'); };
  return (
    <>
    <Flagged />
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
    </>
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

function BansAppeals() {
  const { me, toast, refreshPulse } = useApp();
  const { data: bans, reload: reloadBans } = useApi<{ required: number; moderators: number; proposals: { id: number; user_id: number; username: string; proposed_by_name: string; reason: string; status: string; created_at: number; votes: { moderator: string; moderator_id: number; vote: string; reason: string }[] }[] }>('/admin/bans');
  const { data: appeals, reload: reloadAppeals } = useApi<{ appeals: { id: number; username: string; action: string; detail: string; actor_id: number | null; acted_by: string | null; message: string; status: string; decision_note: string | null; decided_by_name: string | null; created_at: number }[] }>('/admin/appeals');
  const { data: flaggers, reload: reloadFlaggers } = useApi<{ flaggers: { id: number; username: string; can_flag: number; flags: number; upheld: number; dismissed: number; pending: number }[] }>('/admin/flaggers');
  const vote = async (id: number, v: 'approve' | 'reject') => {
    const reason = prompt(v === 'approve' ? 'Why do you approve this ban?' : 'Why do you reject this ban?');
    if (!reason) return;
    try { const r = await api<{ status: string; approvals: number }>(`/admin/bans/${id}/vote`, { body: { vote: v, reason } }); toast(r.status === 'approved' ? 'Ban approved by three moderators and in effect' : r.status === 'rejected' ? 'Proposal rejected' : `Vote recorded (${r.approvals} of 3)`); refreshPulse(); reloadBans(); } catch (e) { toast((e as Error).message); }
  };
  const decide = async (id: number, decision: 'upheld' | 'overturned') => {
    const note = prompt(decision === 'overturned' ? 'Why grant this appeal? (the member sees this)' : 'Why does the decision stand? (the member sees this)');
    if (!note) return;
    try { await api(`/admin/appeals/${id}`, { body: { decision, note } }); toast('Appeal decided'); refreshPulse(); reloadAppeals(); } catch (e) { toast((e as Error).message); }
  };
  const toggleFlagging = async (id: number, enabled: boolean) => {
    const reason = prompt(enabled ? 'Reason for restoring flagging:' : 'Reason for turning off flagging (the member sees it):');
    if (!reason) return;
    await api(`/admin/members/${id}/flagging`, { body: { enabled, reason } });
    reloadFlaggers();
  };
  return (
    <div className="stack">
      <section className="card">
        <div className="section-head"><h2>Permanent ban proposals</h2><span className="small muted">{bans?.required ?? 3} moderators must approve{bans && bans.moderators < 3 ? ` (only ${bans.moderators} active now: use timed suspensions until more moderators join)` : ''}</span></div>
        {bans?.proposals.length ? bans.proposals.map((b) => {
          const mine = b.votes.find((v) => v.moderator_id === me?.id);
          return (
            <div key={b.id} className="card-pad" style={{ borderBottom: '1px solid var(--line)' }}>
              <div className="small"><strong>{b.username}</strong> · proposed by {b.proposed_by_name} · {timeAgo(b.created_at)} · <span className="chip gray">{b.status}</span></div>
              <div className="small" style={{ margin: '4px 0' }}>{b.reason}</div>
              <div className="tiny muted">{b.votes.map((v) => `${v.moderator}: ${v.vote} (${v.reason})`).join(' · ')}</div>
              {b.status === 'open' && b.user_id !== me?.id && (
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn small" onClick={() => vote(b.id, 'approve')}>{mine?.vote === 'approve' ? 'Approved ✓' : 'Approve'}</button>
                  <button className="btn secondary small" onClick={() => vote(b.id, 'reject')}>{mine?.vote === 'reject' ? 'Rejected ✓' : 'Reject'}</button>
                </div>
              )}
            </div>
          );
        }) : <div className="empty">No ban proposals. Propose one from Admin → Members.</div>}
      </section>
      <section className="card">
        <div className="section-head"><h2>Appeals</h2><span className="small muted">Decided by a moderator who didn't make the original decision</span></div>
        {appeals?.appeals.length ? appeals.appeals.map((a) => (
          <div key={a.id} className="card-pad" style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="small"><strong>{a.username}</strong> appeals: {a.action.replace(/_/g, ' ')} by {a.acted_by ?? 'the system'} · {timeAgo(a.created_at)} {a.status !== 'open' && <span className="chip gray">{a.status === 'overturned' ? 'granted' : 'upheld'} by {a.decided_by_name}</span>}</div>
            <div className="tiny muted">Decision: {a.detail}</div>
            <blockquote className="quote-embed small">{a.message}</blockquote>
            {a.decision_note && <div className="tiny muted">Note: {a.decision_note}</div>}
            {a.status === 'open' && (a.actor_id === me?.id
              ? <div className="tiny muted">You made this decision, so another moderator will review the appeal.</div>
              : <div className="row"><button className="btn small" onClick={() => decide(a.id, 'overturned')}>Grant appeal</button><button className="btn secondary small" onClick={() => decide(a.id, 'upheld')}>Decision stands</button></div>)}
          </div>
        )) : <div className="empty">No appeals.</div>}
      </section>
      <section className="card">
        <div className="section-head"><h2>Flagging history</h2><span className="small muted">Spot members whose flags are often dismissed</span></div>
        <div className="table-scroll"><table className="simple"><thead><tr><th>Member</th><th>Flags</th><th>Upheld</th><th>Dismissed</th><th>Open</th><th /></tr></thead><tbody>
          {flaggers?.flaggers.map((f) => (
            <tr key={f.id}><td>{f.username}{!f.can_flag && <span className="tiny muted"> (flagging off)</span>}</td><td>{f.flags}</td><td>{f.upheld ?? 0}</td><td>{f.dismissed ?? 0}</td><td>{f.pending ?? 0}</td>
              <td><button className="btn ghost small" onClick={() => toggleFlagging(f.id, !f.can_flag)}>{f.can_flag ? 'Turn off flagging' : 'Restore flagging'}</button></td></tr>
          ))}
        </tbody></table></div>
        {!flaggers?.flaggers.length && <div className="empty">No flags yet.</div>}
      </section>
    </div>
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
            <div className="field"><label htmlFor="fu">Official calendar feed URL (.ics)</label><input id="fu" className="input" type="text" inputMode="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} required placeholder="https://nmstatesports.com/…" /><span className="hint">Use the “Sync to calendar / iCal” link on the official schedule page. Links starting with webcal:// work too.</span></div>
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
        <div className="grid-2">
          <div className="field"><label htmlFor="ld">Founding Members join by</label><input id="ld" type="date" className="input" value={cur.founding_until || '2026-11-26'} onChange={set('founding_until')} /><span className="hint">Thanksgiving unless you change it.</span></div>
          <div className="field"><label htmlFor="fl">How many Founding Members</label><input id="fl" type="number" min={1} max={9999} className="input" value={cur.founding_limit || '30'} onChange={set('founding_limit')} /><span className="hint">The first people to join, up to this number, get the Founding Member badge.</span></div>
        </div>
        <div className="field"><label htmlFor="ht">Honorary Founding Member threshold</label><input id="ht" type="number" min={0} className="input" value={cur.honorary_threshold} onChange={set('honorary_threshold')} /><span className="hint">Thumbs-up from this many <em>different</em> members earns a later member Honorary Founding Member automatically. 0 = off (admins can still award it by hand).</span></div>
        <div className="field"><label htmlFor="cw">Live chat window (messages)</label><input id="cw" type="number" min={10} max={500} className="input" value={cur.chat_window} onChange={set('chat_window')} /><span className="hint">How many recent messages show in a live room. Everything is archived permanently regardless.</span></div>
        <h3>Who can join and read</h3>
        <div className="field">
          <label htmlFor="sm">Sign-up</label>
          <select id="sm" className="select" value={cur.signup_mode || 'invite'} onChange={(e) => setS({ ...cur, signup_mode: e.target.value })}>
            <option value="invite">Invitation only</option>
            <option value="open">Open: anyone can join free</option>
          </select>
          <span className="hint">Open sign-up uses the human check and email confirmation when they're configured, and every newcomer's first post is reviewed.</span>
        </div>
        <label className="check"><input type="checkbox" checked={cur.public_read === '1'} onChange={(e) => setS({ ...cur, public_read: e.target.checked ? '1' : '0' })} /><span>Anyone can read discussions without an account<span className="hint" style={{ display: 'block' }}>Posting, reacting, chat, private messages, the member directory, map and calendar still require an account.</span></span></label>
        <div className="field"><label htmlFor="tt">Troll flags needed to hide a post</label><input id="tt" type="number" min={1} max={99} className="input" value={cur.troll_threshold || '3'} onChange={(e) => setS({ ...cur, troll_threshold: e.target.value })} /><span className="hint">Different established members must flag it. An admin's flag hides it immediately.</span></div>
        <label className="check"><input type="checkbox" checked={cur.member_invites !== '0'} onChange={(e) => setS({ ...cur, member_invites: e.target.checked ? '1' : '0' })} /><span>Members can invite friends<span className="hint" style={{ display: 'block' }}>Each member can send up to 10 invitations a day from Invite friends. Every invitation works once and expires in 14 days.</span></span></label>
        <div className="field"><label htmlFor="agt">Automatic game threads</label>
          <select id="agt" className="select" value={cur.auto_game_threads ?? ''} onChange={(e) => setS({ ...cur, auto_game_threads: e.target.value })}>
            <option value="">Football &amp; men's basketball: one game thread per game</option>
            <option value="1">Every sport: pregame and postgame threads</option>
            <option value="0">Off: members start game threads themselves</option>
          </select>
          <span className="hint">Game threads open two days before the game; at the final the score is posted and the Player of the Game vote opens in the same thread.</span>
        </div>
        <h3>Posting</h3>
        <label className="check"><input type="checkbox" checked={cur.approve_first_post === '1'} onChange={(e) => setS({ ...cur, approve_first_post: e.target.checked ? '1' : '0' })} /><span>Approve each new member's first post<span className="hint" style={{ display: 'block' }}>New members' first post waits in Admin → Approvals. Once one post is approved, their posts appear right away.</span></span></label>
        <div className="field"><label htmlFor="an">Home page announcement</label><textarea id="an" className="textarea" style={{ minHeight: 70 }} value={cur.announcement} onChange={set('announcement')} maxLength={500} /></div>
        <h3>Automatic topics</h3>
        <p className="small muted" style={{ marginTop: 0 }}>These keep the Board active when nobody starts a topic. Each is capped and never repeats.</p>
        <label className="check"><input type="checkbox" checked={cur.news_desk !== '0'} onChange={(e) => setS({ ...cur, news_desk: e.target.checked ? '1' : '0' })} /><span>📰 Aggie News: start topics from NM State news<span className="hint" style={{ display: 'block' }}>Checks the news every two hours and posts the headline and link only. Posted as “NMSU Sports Forum”.</span></span></label>
        <div className="grid-2">
          <div className="field"><label htmlFor="npd">News topics per day (at most)</label><input id="npd" type="number" min={1} max={10} className="input" value={cur.news_per_day || '3'} onChange={set('news_per_day')} /></div>
          <div className="field"><span className="label">Check now</span><button type="button" className="btn secondary" onClick={async () => { try { const r = await api<{ posted: number; checked: number; errors: string[] }>('/admin/news/run', { method: 'POST' }); toast(`News: ${r.posted} new topic${r.posted === 1 ? '' : 's'} from ${r.checked} stories${r.errors.length ? ` (${r.errors.length} source${r.errors.length === 1 ? '' : 's'} failed)` : ''}`); } catch (err) { toast((err as Error).message); } }}>Check news now</button></div>
        </div>
        <div className="field"><label htmlFor="nf">News sources (optional)</label><textarea id="nf" className="textarea" style={{ minHeight: 70 }} value={cur.news_feeds ?? ''} onChange={set('news_feeds')} placeholder={'Leave blank for the defaults: NM State Athletics news and a news search for NM State.\nOr list RSS feed addresses, one per line.'} /></div>
        <label className="check"><input type="checkbox" checked={cur.starters !== '0'} onChange={(e) => setS({ ...cur, starters: e.target.checked ? '1' : '0' })} /><span>🎲 Topic of the day on quiet days<span className="hint" style={{ display: 'block' }}>If no member starts a topic for a day, the site posts one from the list below (9 AM–8 PM, at most one a day). The same list powers the 🎲 Random topic button.</span></span></label>
        <button type="button" className="btn secondary small" style={{ marginBottom: 10 }} onClick={async () => { try { const r = await api<{ thread_id: number }>('/admin/topics/starter', { method: 'POST' }); toast('Topic posted to the Board'); window.open(`/t/${r.thread_id}`, '_self'); } catch (err) { toast((err as Error).message); } }}>🎲 Post a topic now</button>
        <div className="field"><label htmlFor="sp">Conversation starters (optional, one per line)</label><textarea id="sp" className="textarea" style={{ minHeight: 90 }} value={cur.starter_prompts ?? ''} onChange={set('starter_prompts')} placeholder={'Leave blank to use the built-in list of 30+ Aggie topics, or write your own, one per line.'} /></div>
        <div className="field"><label htmlFor="rt">Weekly topics (optional)</label><textarea id="rt" className="textarea" style={{ minHeight: 70 }} value={cur.recurring_topics ?? ''} onChange={set('recurring_topics')} placeholder={'Mon | 6:00 PM | Radio Show Tonight\nTue | 7:00 AM | Cup of Joe'} /><span className="hint">One per line: day | time (Mountain) | title. Each posts once a week at that time.</span></div>
        <h3>Rosters &amp; links page</h3>
        <div className="field"><label htmlFor="hl">Useful links (radio, streams, tickets…)</label><textarea id="hl" className="textarea" style={{ minHeight: 110 }} value={cur.hub_links ?? ''} onChange={set('hub_links')} maxLength={4000} placeholder={'Aggie radio | https://…\nTickets | https://…'} /><span className="hint">One per line: a name, a | bar, then the web address (https). Rosters for every sport are linked automatically.</span></div>
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
        {[['', 'Overview'], ['invites', 'Invitations'], ['members', 'Members'], ['reports', 'Reports'], ['approvals', 'Approvals'], ['bans', 'Bans & appeals'], ['data', 'Sports data'], ['settings', 'Settings'], ['log', 'Log']].map(([p, l]) => (
          <NavLink key={p} to={`/admin${p ? `/${p}` : ''}`} end className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>{l}</NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="invites" element={<Invites />} />
        <Route path="members" element={<Members />} />
        <Route path="reports" element={<Reports />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="bans" element={<BansAppeals />} />
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

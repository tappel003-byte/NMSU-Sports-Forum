import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApi, useApp } from '../state';
import { fullTime } from '../format';
import { Loading, Modal } from './ui';

export interface CreatedInvite { link: string; emailed: boolean; name: string; phone: string; email: string; days: number }

export function smsNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return raw.trim().startsWith('+') ? `+${digits}` : digits;
}

export function inviteMessage(name: string, link: string, days: number): string {
  return `${name ? `Hey ${name}, you're` : "You're"} invited to NMSU Sports Forum, the new home for Aggie fans. Free, no ads, built for your phone. Join here (the link works once and expires in ${days} days): ${link}`;
}

function copy(text: string, toast: (m: string) => void) {
  navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => toast('Copy failed — select the link and copy it manually'));
}

/** "Invitation ready": opens Messages or Mail with the invitation written. With no number or address, the To: line is empty so you pick a contact. */
export function InviteSheet({ created, onClose }: { created: CreatedInvite; onClose: () => void }) {
  const { toast } = useApp();
  const msg = inviteMessage(created.name, created.link, created.days);
  const ios = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  const smsHref = `sms:${created.phone ? smsNumber(created.phone) : ''}${ios ? '&' : '?'}body=${encodeURIComponent(msg)}`;
  const mailHref = `mailto:${created.email ? encodeURIComponent(created.email) : ''}?subject=${encodeURIComponent("You're invited to NMSU Sports Forum")}&body=${encodeURIComponent(msg)}`;
  return (
    <Modal title="Invitation ready" onClose={onClose}>
      {created.emailed && <div className="note-box small" style={{ marginBottom: 10 }}>✓ The site emailed the invitation to {created.email}.</div>}
      <p className="small" style={{ marginTop: 0 }}>
        {created.phone || created.email ? 'Tap a button to open your app with the invitation already written, then press Send.' : 'Tap Text it or Email it, type their name in the "To:" line to pick them from your contacts, then press Send.'}
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <a className="btn" href={smsHref}>💬 Text it</a>
        <a className="btn secondary" href={mailHref}>✉️ Email it</a>
        {'share' in navigator && <button className="btn ghost" onClick={() => navigator.share({ title: 'NMSU Sports Forum invitation', text: msg }).catch(() => {})}>Other apps…</button>}
      </div>
      <div className="label">The message</div>
      <div className="quote-embed small" style={{ whiteSpace: 'pre-wrap' }}>{msg}</div>
      <p className="tiny muted">The link is shown only once. Copy it now if you'd rather send it another way.</p>
      <input className="input" readOnly value={created.link} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn secondary" onClick={() => copy(msg, toast)}>Copy message</button>
        <button className="btn ghost" onClick={() => copy(created.link, toast)}>Copy link only</button>
      </div>
    </Modal>
  );
}

type MyInvite = { id: number; note: string | null; uses: number; max_uses: number; expires_at: number; revoked: number; created_at: number; used_by: string | null };

/** Members invite friends: one tap, then pick the person in Messages or Mail. */
export function InviteFriends() {
  const { me, toast } = useApp();
  const { data, reload } = useApi<{ invites: MyInvite[]; enabled: boolean }>('/invites/mine');
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading />;
  const make = async () => {
    setBusy(true);
    try {
      const r = await api<{ link: string; emailed: boolean; days: number }>('/invites', { body: {} });
      setCreated({ ...r, name: '', phone: '', email: '' });
      reload();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const revoke = async (id: number) => { await api(`/invites/${id}`, { method: 'DELETE' }); toast('Invitation cancelled'); reload(); };
  const canInvite = data.enabled || me?.role === 'admin';
  const joined = data.invites.filter((i) => i.used_by);
  return (
    <div className="stack">
      <div className="page-head">
        <div className="eyebrow">Bring your Aggie friends</div>
        <h1>Invite friends</h1>
        <div className="muted small">Know someone who'd love this place? Send them an invitation from your phone.</div>
      </div>
      <section className="card card-pad">
        {canInvite ? (
          <>
            <button className="btn block" onClick={make} disabled={busy}>📱 Invite someone from my phone</button>
            <p className="small muted" style={{ marginBottom: 0 }}>Then choose Text or Email and pick the person from your contacts. The invitation is already written. Each link works for one person and expires in 14 days.</p>
          </>
        ) : <div className="empty">Member invitations are switched off right now. Ask an admin for an invitation link.</div>}
      </section>
      {created && <InviteSheet created={created} onClose={() => setCreated(null)} />}
      {data.invites.length > 0 && (
        <section className="card">
          <div className="section-head"><h2>Your invitations</h2>{joined.length > 0 && <span className="chip">{joined.length} joined</span>}</div>
          <ul className="hub-list">
            {data.invites.map((i) => {
              const status = i.used_by ? `Joined as ${i.used_by}` : i.revoked ? 'Cancelled' : i.expires_at < Date.now() ? 'Expired' : `Waiting · until ${fullTime(i.expires_at)}`;
              return (
                <li key={i.id}>
                  <span className="grow small">{i.used_by ? <Link to={`/u/${i.used_by.split(',')[0]}`}>{status}</Link> : status}</span>
                  {!i.used_by && !i.revoked && i.expires_at > Date.now() && <button className="btn ghost small" onClick={() => revoke(i.id)}>Cancel</button>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

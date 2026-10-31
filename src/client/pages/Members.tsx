import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Mail, Send, VolumeX } from 'lucide-react';
import { api, uploadImage } from '../api';
import { useApi, useApp, type Prefs } from '../state';
import { PostBody, fullTime, timeAgo } from '../format';
import { Avatar, Badges, ErrorState, Loading, ThreadList, type MemberLite, type ThreadItem } from '../components/ui';
import { BADGES, SPORTS } from '../../shared/sports';
import { rankFor } from '../../shared/forum';
import { ReportModal } from './Thread';

type MemberRow = MemberLite & { city: string | null; state: string | null; legacy_moniker: string | null; joined: number; reputation: number; post_count: number };

export function Members() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { const t = setTimeout(() => setQuery(q), 300); return () => clearTimeout(t); }, [q]);
  const { data, error, reload } = useApi<{ members: MemberRow[] }>(`/members?q=${encodeURIComponent(query)}`);
  return (
    <div className="stack">
      <div className="page-head spread">
        <div><div className="eyebrow">Members</div><h1>The Aggie family</h1></div>
        <div className="row"><Link to="/invite" className="btn small">Invite friends</Link><Link to="/map" className="btn secondary small">Member map</Link><Link to="/contributions" className="btn secondary small">Contributions</Link></div>
      </div>
      <input className="input" placeholder="Search by username, name, city or Aggie Alert moniker" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search members" />
      {error ? <ErrorState error={error} retry={reload} /> : !data ? <Loading /> : (
        <div className="member-grid">
          {data.members.map((m) => (
            <Link key={m.id} to={`/members/${m.id}`} className="card member-card">
              <Avatar member={m} />
              <div className="grow">
                <strong>{m.display_name || m.username}</strong>{m.display_name && <span className="tiny muted"> @{m.username}</span>}
                <div><Badges member={m} max={2} /></div>
                <div className="tiny muted">{m.reputation} rep · {m.post_count} posts{m.legacy_moniker ? ` · AA: ${m.legacy_moniker}` : ''}{m.city ? ` · ${m.city}${m.state ? `, ${m.state}` : ''}` : ''}</div>
              </div>
            </Link>
          ))}
          {!data.members.length && <div className="empty">No members match.</div>}
        </div>
      )}
    </div>
  );
}

export function UserRedirect() {
  const { username = '' } = useParams();
  const [id, setId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<{ id: number }>(`/members/by-name/${encodeURIComponent(username)}`).then((r) => setId(r.id)).catch((e) => setErr(e.message)); }, [username]);
  if (err) return <ErrorState error={err} />;
  return id ? <Navigate to={`/members/${id}`} replace /> : <Loading />;
}

interface Profile {
  member: MemberRow & { bio: string | null; grad_year: number | null; interests: string | null; legacy_join_year: number | null; legacy_post_count: number | null; legacy_upvotes: number | null; email: string | null; birthday: string | null; last_seen_at: number | null; games_called: number; games_picked: number; status: string; badges: { badge: string; reason: string; awarded_at: number }[] };
  most_appreciated: { id: number; thread_id: number; body: string; up: number; title: string } | null;
  featured: { id: number; thread_id: number; body: string; up: number; title: string } | null;
  recent_threads: ThreadItem[];
  muted: boolean;
  is_me: boolean;
}

export function MemberPage() {
  const { id = '' } = useParams();
  const { me, toast } = useApp();
  const { data, error, reload } = useApi<Profile>(`/members/${id}`);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  const m = data.member;
  const toggleMute = async () => {
    await api('/mutes', { body: { target_type: 'user', target_id: m.id, muted: !data.muted } });
    toast(data.muted ? 'Unmuted' : `${m.username} muted. Their posts are hidden and they can't message you.`);
    reload();
  };
  const award = async () => {
    const badge = prompt(`Recognition to award (${Object.keys(BADGES).filter((b) => b !== 'founding').join(', ')}):`, 'builder');
    if (!badge) return;
    const reason = prompt('Short reason (shown on their profile):');
    if (!reason) return;
    try { await api('/admin/badges', { body: { user_id: m.id, badge, reason } }); toast('Recognition awarded'); reload(); } catch (e) { toast((e as Error).message); }
  };
  const highlight = data.featured ?? data.most_appreciated;
  return (
    <div className="stack">
      <section className="card card-pad">
        <div className="profile-head">
          <Avatar member={m} size="lg" />
          <div className="grow">
            <h1 style={{ marginBottom: 2 }}>{m.display_name || m.username}</h1>
            <div className="small muted">@{m.username} · joined {fullTime(m.joined).replace(/,? \d+:\d+ [AP]M MT$/, '')}{m.last_seen_at ? ` · active ${timeAgo(m.last_seen_at)}` : ''}</div>
            <div style={{ marginTop: 6 }}><span className="rank">{rankFor(m.post_count)}</span> <Badges member={m} max={10} /></div>
          </div>
          <div className="row">
            {data.is_me ? <Link className="btn secondary small" to="/settings">Edit profile</Link> : (
              <>
                <Link className="btn small" to={`/messages/${m.id}`}><Mail size={15} /> Message</Link>
                <button className="btn ghost small" onClick={toggleMute}><VolumeX size={15} /> {data.muted ? 'Unmute' : 'Mute'}</button>
                {me?.role === 'admin' && <button className="btn ghost small" onClick={award}>Award recognition</button>}
              </>
            )}
          </div>
        </div>
        <div className="rep" style={{ marginTop: 16 }}>
          <div><b>{m.reputation}</b><span>Aggie Reputation</span></div>
          <div><b>{m.post_count}</b><span>Forum posts</span></div>
          <div><b>{m.games_called}{m.games_picked > 0 && <small style={{ fontSize: '.6em', fontWeight: 600 }}> of {m.games_picked}</small>}</b><span>Games called{(() => { const n = m.badges.filter((b) => b.badge === 'nostradamus').length; return n ? ` · 🔮×${n}` : ''; })()}</span></div>
        </div>
      </section>

      {highlight && (
        <Link to={`/t/${highlight.thread_id}?post=${highlight.id}`} className="card card-pad" style={{ display: 'block', color: 'inherit' }}>
          <div className="eyebrow">{data.featured ? '⭐ Highlighted post' : '🏅 Most appreciated post'}</div>
          <div style={{ marginTop: 6 }}>“{highlight.body}”</div>
          <div className="small muted" style={{ marginTop: 4 }}>👍 {highlight.up} · {highlight.title}</div>
        </Link>
      )}

      <section className="card card-pad">
        <h2>About</h2>
        {m.bio && <PostBody text={m.bio} />}
        <dl className="kv">
          {(m.city || m.state) && <><dt>Location</dt><dd>{[m.city, m.state].filter(Boolean).join(', ')}</dd></>}
          {m.grad_year && <><dt>NMSU class</dt><dd>{m.grad_year}</dd></>}
          {m.interests && <><dt>Interests</dt><dd>{m.interests}</dd></>}
          {m.email && <><dt>Email</dt><dd><a href={`mailto:${m.email}`}>{m.email}</a>{data.is_me && <span className="tiny muted"> (visible only to you unless you share it)</span>}</dd></>}
          {m.birthday && <><dt>Birthday</dt><dd>{m.birthday}</dd></>}
        </dl>
        {(m.legacy_moniker || m.legacy_post_count != null || m.legacy_upvotes != null) && (
          <div className="note-box small" style={{ marginTop: 12 }}>
            <strong>Aggie Alert history (self-reported):</strong> {m.legacy_moniker && <>moniker <strong>{m.legacy_moniker}</strong></>}
            {m.legacy_join_year && <> · member since {m.legacy_join_year}</>}
            {m.legacy_post_count != null && <> · {m.legacy_post_count.toLocaleString()} posts</>}
            {m.legacy_upvotes != null && <> · {m.legacy_upvotes.toLocaleString()} up votes received</>}
            <div className="tiny muted">Separate from this forum's automatic post count and Aggie Reputation.</div>
          </div>
        )}
      </section>

      {m.badges.length > 0 && (
        <section className="card card-pad">
          <h2>Recognition</h2>
          {m.badges.map((b, i) => (
            <div key={i} className="list-row" style={{ padding: '8px 0' }}>
              <span className={`badge ${b.badge === 'founding' ? 'founding' : ''}`}>{BADGES[b.badge]?.label ?? b.badge}</span>
              <span className="small grow">{b.reason}</span>
              <span className="tiny muted">{fullTime(b.awarded_at).split(',').slice(0, 2).join(',')}</span>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <div className="section-head"><h2>Recent discussions</h2></div>
        <ThreadList threads={data.recent_threads} showForum empty="No discussions started yet." />
      </section>
    </div>
  );
}

interface MeData {
  me: {
    id: number; username: string; email: string; display_name: string | null; bio: string | null; avatar_key: string | null; grad_year: number | null;
    city: string | null; state: string | null; interests: string | null; legacy_moniker: string | null; legacy_join_year: number | null; legacy_post_count: number | null; legacy_upvotes: number | null;
    show_email: number; show_on_map: number; birthday_md: string | null; show_birthday: number; prefs: Prefs;
  };
}

/** Turns server validation messages ("legacy_join_year: Expected number…") into plain words. */
function friendlyError(msg: string): string {
  const names: Record<string, string> = { legacy_join_year: 'Year you joined Aggie Alert', legacy_post_count: 'Aggie Alert post count', legacy_upvotes: 'Aggie Alert up votes', grad_year: 'NMSU class year', birthday_md: 'Birthday (use MM-DD, like 07-07)', city: 'City', state: 'State' };
  const key = Object.keys(names).find((k) => msg.includes(k));
  return key ? `check "${names[key]}". ${msg.replace(/^[^:]*:\s*/, '')}` : msg;
}

export function Settings() {
  const { refresh, toast } = useApp();
  const [params] = useSearchParams();
  const { data, reload } = useApi<MeData>('/me');
  const { data: mutes, reload: reloadMutes } = useApi<{ users: { id: number; username: string }[]; forums: { id: number; name: string }[] }>('/mutes');
  const [p, setP] = useState<Record<string, string | boolean>>({});
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [pw, setPw] = useState({ current: '', password: '' });
  const avatarInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!data) return;
    const m = data.me;
    setP({
      display_name: m.display_name ?? '', bio: m.bio ?? '', grad_year: m.grad_year ? String(m.grad_year) : '', city: m.city ?? '', state: m.state ?? '', interests: m.interests ?? '',
      legacy_moniker: m.legacy_moniker ?? '', legacy_join_year: m.legacy_join_year ? String(m.legacy_join_year) : '', legacy_post_count: m.legacy_post_count !== null ? String(m.legacy_post_count) : '', legacy_upvotes: m.legacy_upvotes != null ? String(m.legacy_upvotes) : '',
      show_email: Boolean(m.show_email), show_on_map: Boolean(m.show_on_map), birthday_md: m.birthday_md ?? '', show_birthday: Boolean(m.show_birthday),
    });
    setPrefs({ notify_replies: true, notify_mentions: true, notify_quotes: true, notify_games: true, notify_dm: true, auto_follow: true, ...m.prefs });
  }, [data]);

  if (!data) return <Loading />;
  const str = (k: string) => (p[k] as string) ?? '';
  // Forgiving number boxes: "3,901" → 3901, and a year box takes "08/24/2010" or "2010" alike.
  const intOrNull = (k: string) => { const d = str(k).replace(/\D/g, ''); return d ? Number(d) : null; };
  const yearOrNull = (k: string) => { const m = str(k).match(/(19|20)\d{2}/); return m ? Number(m[0]) : null; };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMsg(null);
    try {
      const r = await api<{ mapNote: string | null }>('/me/profile', {
        method: 'PATCH',
        body: {
          display_name: str('display_name'), bio: str('bio'), grad_year: yearOrNull('grad_year'), city: str('city'), state: str('state'), interests: str('interests'),
          legacy_moniker: str('legacy_moniker'), legacy_join_year: yearOrNull('legacy_join_year'), legacy_post_count: intOrNull('legacy_post_count'), legacy_upvotes: intOrNull('legacy_upvotes'),
          show_email: Boolean(p.show_email), show_on_map: Boolean(p.show_on_map), birthday_md: str('birthday_md'), show_birthday: Boolean(p.show_birthday),
        },
      });
      // Messages stay next to the Save button so a failed save can't go unnoticed.
      setSaveMsg(r.mapNote ? { ok: false, text: `Saved, but: ${r.mapNote}` } : { ok: true, text: '✓ Profile saved' });
      refresh();
      reload();
    } catch (err) { setSaveMsg({ ok: false, text: `Not saved: ${friendlyError((err as Error).message)}` }); }
  };

  const savePrefs = async (next: Prefs) => {
    setPrefs(next);
    try { await api('/me/prefs', { method: 'PATCH', body: next }); refresh(); } catch (err) { toast((err as Error).message); }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api('/auth/password', { body: pw }); setPw({ current: '', password: '' }); toast('Password changed. Other devices were signed out.'); } catch (err) { toast((err as Error).message); }
  };

  const onAvatar = async (files: FileList | null) => {
    if (!files?.[0]) return;
    try { await uploadImage(files[0], 'avatar'); toast('Photo updated'); refresh(); reload(); } catch (err) { toast((err as Error).message); }
  };

  const toggle = (k: keyof Prefs) => savePrefs({ ...prefs, [k]: !prefs[k] });
  const toggleSport = (key: string) => {
    const cur = prefs.my_sports ?? [];
    savePrefs({ ...prefs, my_sports: cur.includes(key) ? cur.filter((s) => s !== key) : [...cur, key] });
  };
  const field = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <div className="field"><label htmlFor={k}>{label}</label><input id={k} className="input" value={str(k)} onChange={(e) => setP({ ...p, [k]: e.target.value })} {...props} />{hint && <span className="hint">{hint}</span>}</div>
  );
  const check = (k: string, label: string, hint?: string) => (
    <label className="check"><input type="checkbox" checked={Boolean(p[k])} onChange={(e) => setP({ ...p, [k]: e.target.checked })} /><span>{label}{hint && <span className="hint" style={{ display: 'block' }}>{hint}</span>}</span></label>
  );
  const prefCheck = (k: keyof Prefs, label: string, hint?: string) => (
    <label className="check"><input type="checkbox" checked={Boolean(prefs[k])} onChange={() => toggle(k)} /><span>{label}{hint && <span className="hint" style={{ display: 'block' }}>{hint}</span>}</span></label>
  );

  return (
    <div className="stack">
      {params.get('welcome') && <div className="note-box"><strong>Welcome to NMSU Sports Forum!</strong> Add a few details so fellow Aggies recognize you, and pick your favorite sports for a personal feed. To add the forum to your iPhone home screen, tap Share → <em>Add to Home Screen</em> in Safari.</div>}
      <div className="page-head"><h1>Settings &amp; profile</h1></div>

      <section className="card card-pad">
        <h2>Profile</h2>
        <div className="row" style={{ marginBottom: 14 }}>
          <Avatar member={data.me} size="lg" />
          <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => onAvatar(e.target.files)} />
          <button className="btn secondary small" onClick={() => avatarInput.current?.click()}>Change photo</button>
        </div>
        <form onSubmit={saveProfile}>
          <div className="grid-2">
            {field('display_name', 'Display name', { maxLength: 60 })}
            {field('grad_year', 'NMSU class year (optional)', { inputMode: 'numeric' })}
            {field('city', 'City (optional)', { maxLength: 80 })}
            {field('state', 'State (optional)', { maxLength: 40 })}
          </div>
          <div className="field"><label htmlFor="bio">About you</label><textarea id="bio" className="textarea" style={{ minHeight: 90 }} value={str('bio')} onChange={(e) => setP({ ...p, bio: e.target.value })} maxLength={1000} /></div>
          {field('interests', 'Favorite sports, players or memories', { maxLength: 300 })}
          <h3 style={{ marginTop: 10 }}>Aggie Alert history (optional, self-reported)</h3>
          <div className="grid-2">
            {field('legacy_moniker', 'Aggie Alert moniker', { maxLength: 60 }, 'Helps old friends find you.')}
            {field('legacy_join_year', 'Year you joined Aggie Alert', {}, 'The year is enough; a full date like 08/24/2010 works too.')}
            {field('legacy_post_count', 'Aggie Alert post count', { inputMode: 'numeric' }, 'Shown separately from this forum\'s count.')}
            {field('legacy_upvotes', 'Aggie Alert up votes received', { inputMode: 'numeric' }, 'From your Aggie Alert profile. Shown on your profile; it doesn\'t change your reputation here.')}
            {field('birthday_md', 'Birthday (MM-DD, optional)', { placeholder: '04-15', pattern: '(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])' })}
          </div>
          <h3 style={{ marginTop: 10 }}>Privacy</h3>
          {check('show_email', 'Show my email on my profile', 'Off by default. Your email is otherwise visible only to you.')}
          {check('show_on_map', 'Show me on the member map', 'Uses your city only, rounded to about 10 km. Never a precise location.')}
          {check('show_birthday', 'Show my birthday on the community calendar')}
          {/* Pinned to the bottom of the screen while the long form scrolls, so Save is always in reach. */}
          <div className="sticky-save">
            <button className="btn">Save profile</button>
            {saveMsg && <span className={saveMsg.ok ? 'save-ok' : 'save-bad'} role="status">{saveMsg.text}</span>}
          </div>
        </form>
      </section>

      <section className="card card-pad">
        <h2>My sports</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Used for your “My sports” feed and game reminders.</p>
        <div className="chip-row">
          {SPORTS.map((s) => (
            <button key={s.key} className={`btn small ${(prefs.my_sports ?? []).includes(s.key) ? '' : 'secondary'}`} aria-pressed={(prefs.my_sports ?? []).includes(s.key)} onClick={() => toggleSport(s.key)}>{s.icon} {s.label}</button>
          ))}
        </div>
      </section>

      <section className="card card-pad">
        <h2>Notifications &amp; reading</h2>
        {prefCheck('notify_replies', 'Replies in discussions I follow')}
        {prefCheck('notify_mentions', 'When someone @mentions me')}
        {prefCheck('notify_quotes', 'When someone quotes me')}
        {prefCheck('notify_dm', 'New private messages')}
        {prefCheck('notify_games', 'Game reminders for my sports', 'About two hours before each game.')}
        {prefCheck('auto_follow', 'Automatically follow discussions I post in')}
        {prefCheck('spoiler_free', 'Spoiler-free mode', 'Hide final scores until you tap to reveal — handy when watching on delay.')}
        {prefCheck('large_text', 'Larger text')}
        {prefCheck('compact', 'Compact discussion lists', 'Hide descriptions so more discussions fit on screen.')}
        <div className="field" style={{ marginTop: 8 }}>
          <span className="label">Appearance</span>
          <div className="row" role="radiogroup" aria-label="Appearance" style={{ marginTop: 6 }}>
            {(['system', 'light', 'dark'] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={(prefs.theme ?? 'system') === t} className={`btn small ${(prefs.theme ?? 'system') === t ? '' : 'secondary'}`} onClick={() => savePrefs({ ...prefs, theme: t })}>
                {t === 'system' ? 'Match my phone' : t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>
        {prefCheck('digest', 'Weekly email digest', 'A Monday summary of the week\'s busiest discussions (when email is enabled for the forum).')}
      </section>

      <PushSettings />

      <section className="card card-pad">
        <h2>Share tweets in one tap (iPhone)</h2>
        <p className="small" style={{ marginTop: 0 }}>The quickest way: in the X app tap <strong>Share → Copy link</strong>, then tap <strong>Share a tweet → Paste</strong> here.</p>
        <p className="small">For one tap from the X share sheet, create an iPhone Shortcut once:</p>
        <ol className="small" style={{ paddingLeft: 20 }}>
          <li>Open the <strong>Shortcuts</strong> app → <strong>+</strong> → name it <strong>NMSU Forum</strong>.</li>
          <li>Tap the <strong>ⓘ</strong> button and turn on <strong>Show in Share Sheet</strong>, accepting URLs and Text.</li>
          <li>Add the action <strong>Open URLs</strong> with: <code style={{ wordBreak: 'break-all' }}>{location.origin}/share?url=</code> followed by the <strong>Shortcut Input</strong> variable.</li>
          <li>Done. In the X app, tap Share → <strong>NMSU Forum</strong>, and the tweet opens here ready to post.</li>
        </ol>
      </section>

      <section className="card card-pad">
        <h2>Muted</h2>
        {mutes && (mutes.users.length || mutes.forums.length) ? (
          <div className="chip-row">
            {mutes.users.map((u) => <button key={`u${u.id}`} className="chip gray" onClick={() => api('/mutes', { body: { target_type: 'user', target_id: u.id, muted: false } }).then(reloadMutes)}>{u.username} ✕</button>)}
            {mutes.forums.map((f) => <button key={`f${f.id}`} className="chip gray" onClick={() => api('/mutes', { body: { target_type: 'forum', target_id: f.id, muted: false } }).then(reloadMutes)}>{f.name} ✕</button>)}
          </div>
        ) : <div className="small muted">You haven't muted anyone or any forum. Muted members' posts are hidden and they can't message you.</div>}
      </section>

      <section className="card card-pad">
        <h2>Account</h2>
        <div className="small muted" style={{ marginBottom: 10 }}>Signed in as {data.me.username} · {data.me.email}</div>
        <form onSubmit={changePassword} className="grid-2">
          <div className="field"><label htmlFor="cur">Current password</label><input id="cur" type="password" className="input" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></div>
          <div className="field"><label htmlFor="npw">New password</label><input id="npw" type="password" className="input" autoComplete="new-password" minLength={10} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} required /></div>
          <div><button className="btn secondary">Change password</button></div>
        </form>
        <button className="btn ghost small" style={{ marginTop: 10 }} onClick={() => api('/auth/logout-all', { method: 'POST' }).then(() => refresh())}>Sign out on all devices</button>
      </section>

      <ModerationHistory />

      <section className="card card-pad">
        <h2>Your data</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Download everything you've posted and your settings, including your private messages, as a file.</p>
        <a className="btn secondary small" href="/api/me/export" download>Download my data</a>
        <DeleteAccount />
      </section>
    </div>
  );
}

export function Messages() {
  const { data, error, reload } = useApi<{ conversations: { id: number; other: MemberLite; last_message_at: number; last: { body: string; mine: boolean } | null; unread: number }[] }>('/messages');
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <div className="page-head"><div className="eyebrow">Private messages</div><h1>Messages</h1><p className="small muted" style={{ margin: 0 }}>Strictly private between you and the other member. Administrators cannot read them. To start a conversation, open a member's profile and tap Message.</p></div>
      <section className="card">
        {data.conversations.length ? data.conversations.map((c) => (
          <Link key={c.id} to={`/messages/${c.other.id}`} className={`list-row ${c.unread ? 'unread' : ''}`}>
            <Avatar member={c.other} />
            <div className="grow"><strong>{c.other.display_name || c.other.username}</strong><div className="small muted">{c.last ? `${c.last.mine ? 'You: ' : ''}${c.last.body}` : ''}</div></div>
            <div className="tiny muted" style={{ textAlign: 'right' }}>{timeAgo(c.last_message_at)}{c.unread > 0 && <div><span className="chip">{c.unread} new</span></div>}</div>
          </Link>
        )) : <div className="empty">No conversations yet.</div>}
      </section>
    </div>
  );
}

export function Conversation() {
  const { userId = '' } = useParams();
  const { me, toast, refreshPulse } = useApp();
  const { data, error, reload } = useApi<{ other: MemberLite; messages: { id: number; sender_id: number; body: string; created_at: number }[]; blocked: boolean }>(`/messages/${userId}`);
  const [text, setText] = useState('');
  const [report, setReport] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView(); refreshPulse(); }, [data, refreshPulse]);
  useEffect(() => { const t = setInterval(reload, 15_000); return () => clearInterval(t); }, [reload]);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    try { await api(`/messages/${userId}`, { body: { body: text } }); setText(''); reload(); } catch (err) { toast((err as Error).message); }
  };
  return (
    <div className="card chat-wrap">
      <div className="section-head">
        <div className="row grow"><Avatar member={data.other} size="sm" /><div><h2 style={{ fontSize: '1rem', margin: 0 }}><Link to={`/members/${data.other.id}`}>{data.other.display_name || data.other.username}</Link></h2><div className="tiny muted">🔒 Private — only the two of you can read this</div></div></div>
        <Link to="/messages" className="btn ghost small">All messages</Link>
      </div>
      <div className="chat-log">
        {data.messages.length === 0 && <div className="empty">Say hello to {data.other.username}.</div>}
        {data.messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.sender_id === me?.id ? 'mine' : ''}`}>
            <div className="bubble">
              <PostBody text={m.body} />
              <div className="spread"><span className="tiny muted">{timeAgo(m.created_at)}</span>{m.sender_id !== me?.id && <button className="btn ghost small" style={{ minHeight: 22, padding: '0 6px' }} aria-label="Report message" onClick={() => setReport(m.id)}><span className="tiny">Report</span></button>}</div>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {data.blocked ? <div className="composer small muted">Messaging is unavailable because one of you has muted the other.</div> : (
        <form className="chat-input" onSubmit={send}>
          <label htmlFor="dm" className="sr-only">Message</label>
          <input id="dm" className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Private message" maxLength={5000} autoComplete="off" />
          <button className="btn" aria-label="Send" disabled={!text.trim()}><Send size={16} /></button>
        </form>
      )}
      {report && <ReportModal path="/messages/report" extra={{ message_id: report }} note="Reporting shares only this one message with the administrators. Nothing else in your conversation is visible to them." onClose={() => setReport(null)} />}
    </div>
  );
}

export function Notifications() {
  const { refreshPulse } = useApp();
  const nav = useNavigate();
  const { data, reload } = useApi<{ notifications: { id: number; type: string; text: string; link: string; created_at: number; read_at: number | null }[] }>('/notifications');
  const open = async (n: { id: number; link: string; read_at: number | null }) => {
    if (!n.read_at) await api('/notifications/read', { body: { ids: [n.id] } });
    refreshPulse();
    nav(n.link);
  };
  const readAll = async () => { await api('/notifications/read', { body: { all: true } }); refreshPulse(); reload(); };
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <div className="page-head spread"><h1>Notifications</h1><button className="btn secondary small" onClick={readAll}>Mark all read</button></div>
      <section className="card">
        {data.notifications.length ? data.notifications.map((n) => (
          <button key={n.id} className={`list-row ${n.read_at ? '' : 'unread'}`} style={{ width: '100%', border: 0, textAlign: 'left', cursor: 'pointer', background: n.read_at ? 'none' : undefined }} onClick={() => open(n)}>
            <span aria-hidden="true">{({ reply: '💬', mention: '📣', quote: '❝', dm: '✉️', game: '🏟️', badge: '🏅', reminder: '⏰', feed_error: '⚠️' } as Record<string, string>)[n.type] ?? '🔔'}</span>
            <span className="grow small">{n.text}</span>
            <span className="tiny muted">{timeAgo(n.created_at)}</span>
          </button>
        )) : <div className="empty">No notifications yet.</div>}
      </section>
    </div>
  );
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const query = params.get('q') ?? '';
  const { data, loading } = useApi<{ threads: ThreadItem[]; posts: { id: number; thread_id: number; body: string; created_at: number; username: string; title: string; forum_name: string }[]; members: MemberLite[] }>(query.length >= 2 ? `/search?q=${encodeURIComponent(query)}` : null);
  return (
    <div className="stack">
      <form onSubmit={(e) => { e.preventDefault(); setParams({ q }); }} className="row">
        <label htmlFor="sq" className="sr-only">Search</label>
        <input id="sq" className="input grow" placeholder="Search discussions, posts and members" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <button className="btn">Search</button>
      </form>
      {query.length >= 2 && (loading ? <Loading /> : data && (
        <>
          {data.members?.length > 0 && (
            <section className="card"><div className="section-head"><h2>Members</h2></div>
              <div className="card-pad chip-row">{data.members.map((m) => <Link key={m.id} to={`/members/${m.id}`} className="chip gray">{m.display_name || m.username}</Link>)}</div>
            </section>
          )}
          <section className="card"><div className="section-head"><h2>Discussions</h2></div><ThreadList threads={data.threads} empty="No matching discussion titles." /></section>
          <section className="card"><div className="section-head"><h2>Posts</h2></div>
            {data.posts.length ? data.posts.map((p) => (
              <Link key={p.id} to={`/t/${p.thread_id}?post=${p.id}`} className="list-row"><div className="grow"><div className="tiny muted">{p.forum_name} · {p.title}</div><div className="small">{p.body.slice(0, 220)}</div><div className="tiny muted">{p.username} · {timeAgo(p.created_at)}</div></div></Link>
            )) : <div className="empty">No matching posts.</div>}
          </section>
        </>
      ))}
    </div>
  );
}

export function Bookmarks() {
  const { toast } = useApp();
  const { data, reload } = useApi<{ bookmarks: { id: number; post_id: number; note: string | null; remind_at: number | null; reminded: number; body: string; deleted: number; thread_id: number; title: string; username: string }[] }>('/bookmarks');
  if (!data) return <Loading />;
  const remove = async (postId: number) => { await api(`/posts/${postId}/bookmark`, { body: { bookmarked: false } }); toast('Removed'); reload(); };
  return (
    <div className="stack">
      <div className="page-head"><h1>Bookmarks &amp; reminders</h1></div>
      <section className="card">
        {data.bookmarks.length ? data.bookmarks.map((b) => (
          <div key={b.id} className="list-row">
            <div className="grow">
              <Link to={`/t/${b.thread_id}?post=${b.post_id}`}><strong>{b.title}</strong></Link>
              <div className="small">{b.deleted ? <em>Post removed</em> : b.body.slice(0, 180)}</div>
              <div className="tiny muted">{b.username}{b.note ? ` · Note: ${b.note}` : ''}{b.remind_at ? ` · ${b.reminded ? 'Reminded' : 'Reminder'} ${fullTime(b.remind_at)}` : ''}</div>
            </div>
            <button className="btn ghost small" onClick={() => remove(b.post_id)}>Remove</button>
          </div>
        )) : <div className="empty">Tap the bookmark icon on any post to save it here, with an optional reminder.</div>}
      </section>
    </div>
  );
}

export function Drafts() {
  const { data, reload } = useApi<{ drafts: { key: string; title: string | null; body: string; updated_at: number }[] }>('/drafts');
  if (!data) return <Loading />;
  const link = (key: string) => {
    const reply = key.match(/^reply-(\d+)$/);
    if (reply) return `/t/${reply[1]}#reply`;
    const game = key.match(/^new-game-(\d+)-(\w+)$/);
    if (game) return `/new?game=${game[1]}${game[2] !== 'talk' ? `&phase=${game[2]}` : ''}`;
    const forum = key.match(/^new-(.+)$/);
    return forum && forum[1] !== 'any' ? `/new?forum=${forum[1]}` : '/new';
  };
  return (
    <div className="stack">
      <div className="page-head"><h1>Drafts</h1><p className="small muted" style={{ margin: 0 }}>Drafts save automatically as you type, so you can start on your phone and finish on your computer.</p></div>
      <section className="card">
        {data.drafts.length ? data.drafts.map((d) => (
          <div key={d.key} className="list-row">
            <Link to={link(d.key)} className="grow" style={{ color: 'inherit' }}><strong>{d.title || (d.key.startsWith('reply') ? 'Reply' : 'New discussion')}</strong><div className="small muted">{d.body.slice(0, 140)}</div><div className="tiny muted">Saved {timeAgo(d.updated_at)}</div></Link>
            <button className="btn ghost small" onClick={() => api(`/drafts/${encodeURIComponent(d.key)}`, { method: 'DELETE' }).then(reload)}>Discard</button>
          </div>
        )) : <div className="empty">No drafts.</div>}
      </section>
    </div>
  );
}

function PushSettings() {
  const { toast } = useApp();
  const { data, reload } = useApi<{ enabled: boolean; devices: number }>('/push/status');
  const [busy, setBusy] = useState(false);
  const supported = 'serviceWorker' in navigator && 'PushManager' in window;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const enable = async () => {
    setBusy(true);
    try {
      const { key } = await api<{ key: string | null }>('/push/key');
      if (!key) throw new Error('Phone notifications are not set up on this forum yet.');
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications were not allowed. You can change this in your phone settings.');
      const reg = await navigator.serviceWorker.ready;
      const pad = '='.repeat((4 - (key.length % 4)) % 4);
      const raw = Uint8Array.from(atob((key + pad).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
      await api('/push/subscribe', { body: sub.toJSON() });
      toast('Phone notifications are on for this device');
      reload();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const disable = async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await api('/push/unsubscribe', { body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
    toast('Phone notifications are off for this device');
    reload();
  };
  return (
    <section className="card card-pad">
      <h2>Phone notifications</h2>
      <p className="small muted" style={{ marginTop: 0 }}>Get a notification for replies, mentions, private messages and game starts (based on the choices above).</p>
      {data && !data.enabled ? <div className="small muted">Not set up on this forum yet.</div>
        : !supported ? <div className="small muted">{isIos && !standalone ? 'On iPhone, first add the forum to your Home Screen (Share → Add to Home Screen), open it from there, then come back here.' : 'This browser does not support notifications.'}</div>
        : (
          <div className="row">
            <button className="btn small" disabled={busy} onClick={enable}>Turn on for this device</button>
            {Boolean(data?.devices) && <button className="btn ghost small" onClick={disable}>Turn off for this device</button>}
            <span className="tiny muted">{data?.devices ? `On for ${data.devices} device${data.devices === 1 ? '' : 's'}` : ''}</span>
          </div>
        )}
    </section>
  );
}

function DeleteAccount() {
  const { refresh, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const go = async () => {
    try {
      await api('/me/delete', { body: { password, confirm: confirmText } });
      await refresh();
      window.location.href = '/login';
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <div style={{ marginTop: 14 }}>
      {!open ? <button className="btn ghost small" onClick={() => setOpen(true)}>Delete my account…</button> : (
        <div className="note-box small">
          <p style={{ marginTop: 0 }}><strong>Delete your account permanently.</strong> Your profile, private messages, bookmarks and settings are erased. Your posts stay in their discussions so conversations still make sense, shown as “Former member.” This can't be undone.</p>
          <div className="field"><label htmlFor="dpw">Password</label><input id="dpw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <div className="field"><label htmlFor="dcf">Type DELETE to confirm</label><input id="dcf" className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /></div>
          <div className="row"><button className="btn small" disabled={confirmText !== 'DELETE' || !password} onClick={go}>Delete my account</button><button className="btn ghost small" onClick={() => setOpen(false)}>Cancel</button></div>
        </div>
      )}
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = { remove_post: 'Post removed', warn: 'Warning', suspend: 'Suspension', ban: 'Ban', revoke_flagging: 'Flagging turned off' };

function ModerationHistory() {
  const { toast } = useApp();
  const { data, reload } = useApi<{ decisions: { id: number; action: string; detail: string; created_at: number; appeal_status: string | null; decision_note: string | null }[] }>('/me/moderation');
  const [appealing, setAppealing] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const send = async () => {
    try { await api('/me/appeals', { body: { log_id: appealing, message } }); toast('Appeal sent'); setAppealing(null); setMessage(''); reload(); } catch (e) { toast((e as Error).message); }
  };
  return (
    <section className="card card-pad" id="moderation">
      <h2>Moderation history</h2>
      {!data?.decisions.length ? <p className="small muted" style={{ margin: 0 }}>Nothing here. Thanks for keeping it friendly.</p> : data.decisions.map((d) => (
        <div key={d.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
          <div className="spread"><strong className="small">{ACTION_LABELS[d.action] ?? d.action}</strong><span className="tiny muted">{fullTime(d.created_at)}</span></div>
          <div className="small">{d.detail}</div>
          {d.appeal_status ? (
            <div className="tiny muted" style={{ marginTop: 4 }}>Appeal {d.appeal_status === 'open' ? 'under review' : d.appeal_status === 'overturned' ? 'granted' : 'reviewed: decision stands'}{d.decision_note ? ` — ${d.decision_note}` : ''}</div>
          ) : d.action !== 'revoke_flagging' && (
            appealing === d.id ? (
              <div style={{ marginTop: 6 }}>
                <textarea className="textarea" style={{ minHeight: 80 }} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Explain why this should be reconsidered." aria-label="Appeal message" />
                <div className="row" style={{ marginTop: 6 }}><button className="btn small" disabled={message.trim().length < 10} onClick={send}>Send appeal</button><button className="btn ghost small" onClick={() => setAppealing(null)}>Cancel</button></div>
                <div className="tiny muted">A moderator who didn't make this decision reviews appeals.</div>
              </div>
            ) : <button className="btn ghost small" onClick={() => setAppealing(d.id)}>Appeal</button>
          )}
        </div>
      ))}
    </section>
  );
}

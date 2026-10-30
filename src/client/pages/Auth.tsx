import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../state';

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/brand/crest-480.webp" alt="NMSU Sports Forum crest" className="auth-crest" width={150} height={143} />
        <h1 style={{ textAlign: 'center' }}>{title}</h1>
        {subtitle && <p className="muted small" style={{ textAlign: 'center', marginTop: 0 }}>{subtitle}</p>}
        {children}
        <p className="disclaimer">NMSU Sports Forum is an independent fan community. It is not affiliated with or endorsed by New Mexico State University.</p>
      </div>
    </div>
  );
}

function useSubmit(fn: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return { error, busy, submit };
}

export function Login() {
  const { refresh, setupNeeded } = useApp();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, submit } = useSubmit(async () => {
    await api('/auth/login', { body: { username, password } });
    await refresh();
    nav('/');
  });
  return (
    <AuthShell title="Welcome back, Aggie" subtitle="A private, invitation-only community for NM State fans.">
      {setupNeeded && <div className="note-box small" style={{ marginBottom: 12 }}>This forum hasn't been set up yet. The technical owner can <Link to="/setup">create the first administrator</Link>.</div>}
      <form onSubmit={submit}>
        <div className="field"><label htmlFor="u">Username or email</label><input id="u" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></div>
        <div className="field"><label htmlFor="p">Password</label><input id="p" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
        <button className="btn block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="small" style={{ textAlign: 'center' }}><Link to="/forgot">Forgot your password?</Link></p>
      <p className="small muted" style={{ textAlign: 'center' }}>New here? Membership is by invitation. Ask a member or administrator for an invite link.</p>
    </AuthShell>
  );
}

export function Join() {
  const { token = '' } = useParams();
  const { refresh } = useApp();
  const nav = useNavigate();
  const [check, setCheck] = useState<{ valid: boolean; email: string | null } | null>(null);
  const [f, setF] = useState({ username: '', email: '', password: '', confirm: '', display_name: '' });
  useEffect(() => {
    api<{ valid: boolean; email: string | null }>(`/auth/invite/${token}`).then((r) => { setCheck(r); if (r.email) setF((x) => ({ ...x, email: r.email! })); }).catch(() => setCheck({ valid: false, email: null }));
  }, [token]);
  const { error, busy, submit } = useSubmit(async () => {
    if (f.password !== f.confirm) throw new Error('Passwords do not match.');
    await api('/auth/register', { body: { token, username: f.username, email: f.email, password: f.password, display_name: f.display_name || undefined } });
    await refresh();
    nav('/settings?welcome=1');
  });
  if (!check) return <AuthShell title="Checking your invitation…"><div /></AuthShell>;
  if (!check.valid) return <AuthShell title="Invitation not valid" subtitle="This link is expired, revoked or already used. Ask an administrator for a new invitation."><Link className="btn block" to="/login">Go to sign in</Link></AuthShell>;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <AuthShell title="You're invited!" subtitle="Create your NMSU Sports Forum account.">
      <form onSubmit={submit}>
        <div className="field"><label htmlFor="un">Username</label><input id="un" className="input" autoComplete="username" value={f.username} onChange={set('username')} required pattern="[A-Za-z0-9_]{3,24}" /><span className="hint">3–24 letters, numbers or underscores. This is how members will know you.</span></div>
        <div className="field"><label htmlFor="dn">Display name (optional)</label><input id="dn" className="input" value={f.display_name} onChange={set('display_name')} maxLength={60} /></div>
        <div className="field"><label htmlFor="em">Email</label><input id="em" className="input" type="email" autoComplete="email" value={f.email} onChange={set('email')} required readOnly={Boolean(check.email)} /><span className="hint">Private by default. Used only for password recovery.</span></div>
        <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required minLength={10} /><span className="hint">At least 10 characters.</span></div>
        <div className="field"><label htmlFor="pc">Confirm password</label><input id="pc" className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} required /></div>
        {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
        <button className="btn block" disabled={busy}>{busy ? 'Creating account…' : 'Join NMSU Sports Forum'}</button>
      </form>
    </AuthShell>
  );
}

export function Setup() {
  const { refresh, setupNeeded } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ token: '', username: '', email: '', password: '' });
  const { error, busy, submit } = useSubmit(async () => {
    await api('/auth/setup', { body: f });
    await refresh();
    nav('/admin');
  });
  if (!setupNeeded) return <AuthShell title="Setup complete" subtitle="This forum already has an administrator."><Link className="btn block" to="/login">Go to sign in</Link></AuthShell>;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <AuthShell title="Create the first administrator" subtitle="One-time setup. Requires the setup token configured by the technical owner.">
      <form onSubmit={submit}>
        <div className="field"><label htmlFor="tk">Setup token</label><input id="tk" className="input" type="password" value={f.token} onChange={set('token')} required /></div>
        <div className="field"><label htmlFor="su">Username</label><input id="su" className="input" value={f.username} onChange={set('username')} required /></div>
        <div className="field"><label htmlFor="se">Email</label><input id="se" className="input" type="email" value={f.email} onChange={set('email')} required /></div>
        <div className="field"><label htmlFor="sp">Password</label><input id="sp" className="input" type="password" value={f.password} onChange={set('password')} required minLength={10} /></div>
        {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
        <button className="btn block" disabled={busy}>Create administrator</button>
      </form>
    </AuthShell>
  );
}

export function Forgot() {
  const { emailEnabled } = useApp();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { error, busy, submit } = useSubmit(async () => {
    await api('/auth/forgot', { body: { email } });
    setSent(true);
  });
  return (
    <AuthShell title="Reset your password">
      {!emailEnabled ? (
        <div className="note-box small">Password reset emails aren't turned on for this forum yet. Ask any administrator to create a reset link for you. They can send it to you by text or email.</div>
      ) : sent ? (
        <div className="note-box small">If that email belongs to a member, a reset link is on its way. It expires in one hour.</div>
      ) : (
        <form onSubmit={submit}>
          <div className="field"><label htmlFor="fe">Your email</label><input id="fe" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
          <button className="btn block" disabled={busy}>Send reset link</button>
        </form>
      )}
      <p className="small" style={{ textAlign: 'center' }}><Link to="/login">Back to sign in</Link></p>
    </AuthShell>
  );
}

export function Reset() {
  const { token = '' } = useParams();
  const { refresh } = useApp();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { error, busy, submit } = useSubmit(async () => {
    if (password !== confirm) throw new Error('Passwords do not match.');
    await api('/auth/reset', { body: { token, password } });
    await refresh();
    nav('/');
  });
  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit}>
        <div className="field"><label htmlFor="np">New password</label><input id="np" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} /></div>
        <div className="field"><label htmlFor="nc">Confirm</label><input id="nc" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
        {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
        <button className="btn block" disabled={busy}>Save password and sign in</button>
      </form>
    </AuthShell>
  );
}

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';

export interface Me {
  id: number;
  username: string;
  role: 'member' | 'admin';
  display_name: string | null;
  avatar_key: string | null;
  prefs: Prefs;
}

export interface Prefs {
  notify_replies?: boolean;
  notify_mentions?: boolean;
  notify_quotes?: boolean;
  notify_games?: boolean;
  notify_dm?: boolean;
  auto_follow?: boolean;
  spoiler_free?: boolean;
  large_text?: boolean;
  digest?: boolean;
  my_sports?: string[];
  theme?: 'system' | 'light' | 'dark';
  compact?: boolean;
  push?: boolean;
}

export interface SiteInfo { signupMode: 'invite' | 'open'; publicRead: boolean; memberInvites: boolean; turnstileSiteKey: string | null; emailVerified: boolean }

export interface Pulse { notifications: number; messages: number; unread_threads: number; open_reports: number }

interface AppState {
  me: Me | null;
  loading: boolean;
  setupNeeded: boolean;
  emailEnabled: boolean;
  site: SiteInfo;
  pulse: Pulse;
  refresh: () => Promise<void>;
  refreshPulse: () => void;
  toast: (msg: string) => void;
}

const Ctx = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [site, setSite] = useState<SiteInfo>({ signupMode: 'invite', publicRead: false, memberInvites: true, turnstileSiteKey: null, emailVerified: true });
  const [pulse, setPulse] = useState<Pulse>({ notifications: 0, messages: 0, unread_threads: 0, open_reports: 0 });
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const r = await api<{ user: Me | null; setupNeeded: boolean; emailEnabled: boolean } & SiteInfo>('/auth/me');
    setSite({ signupMode: r.signupMode, publicRead: r.publicRead, memberInvites: r.memberInvites !== false, turnstileSiteKey: r.turnstileSiteKey, emailVerified: r.emailVerified });
    setMe(r.user);
    setSetupNeeded(r.setupNeeded);
    setEmailEnabled(r.emailEnabled);
    setLoading(false);
  }, []);

  const refreshPulse = useCallback(() => {
    api<Pulse>('/pulse').then(setPulse).catch(() => {});
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
    const onOut = () => setMe(null);
    window.addEventListener('nsf:signed-out', onOut);
    return () => window.removeEventListener('nsf:signed-out', onOut);
  }, [refresh]);

  useEffect(() => {
    if (!me) return;
    refreshPulse();
    const t = window.setInterval(refreshPulse, 45_000);
    const onFocus = () => refreshPulse();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [me, refreshPulse]);

  useEffect(() => {
    document.documentElement.classList.toggle('large-text', Boolean(me?.prefs?.large_text));
  }, [me?.prefs?.large_text]);

  // Theme: follow the phone's setting unless the member picked light or dark.
  useEffect(() => {
    const pref = me?.prefs?.theme ?? 'system';
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = pref === 'dark' || (pref === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#8C0B42');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [me?.prefs?.theme]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 3200);
  }, []);

  return (
    <Ctx.Provider value={{ me, loading, setupNeeded, emailEnabled, site, pulse, refresh, refreshPulse, toast }}>
      {children}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </Ctx.Provider>
  );
}

/** Fetches `path` and re-fetches when it changes; `reload` refreshes in place. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const seq = useRef(0);
  const load = useCallback(async (quiet = false) => {
    if (!path) return;
    const n = ++seq.current;
    if (!quiet) setLoading(true);
    try {
      const d = await api<T>(path);
      if (n === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (n === seq.current) setError((e as Error).message);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  // Pull-to-refresh and returning to the app refresh whatever is on screen.
  useEffect(() => {
    const onRefresh = () => load(true);
    window.addEventListener('nsf:refresh', onRefresh);
    return () => window.removeEventListener('nsf:refresh', onRefresh);
  }, [load]);
  return { data, error, loading, reload: () => load(true), setData };
}

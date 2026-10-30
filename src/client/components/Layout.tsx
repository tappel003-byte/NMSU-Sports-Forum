import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Award, Bell, Bookmark, CalendarDays, History, Home, Lightbulb, LogOut, Mail, Map as MapIcon, MessageCircle, MessagesSquare,
  Search, Settings, Shield, Sparkles, Trophy, Trophy as TrophyIcon, Users,
} from 'lucide-react';
import { api } from '../api';
import { useApi, useApp } from '../state';
import { Avatar, GameRow, type GameItem } from './ui';

interface ForumLite { slug: string; name: string; sport_label: string; icon: string; unread: number; threads: number; kind: string }

function useForums() {
  return useApi<{ forums: ForumLite[] }>('/forums');
}

function Header() {
  const { me, pulse, refresh } = useApp();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    await refresh();
    nav('/login');
  };
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link to="/" className="brand" aria-label="NMSU Sports Forum home">
          <img src="/brand/crest-160.webp" alt="" className="brand-crest" width={46} height={46} />
          <span className="brand-text">
            <span className="brand-name">NMSU SPORTS FORUM</span>
            <span className="brand-tag">Independent Aggie fan community</span>
          </span>
        </Link>
        <nav className="top-nav" aria-label="Main">
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/forums">Forums</NavLink>
          <NavLink to="/games">Game Center</NavLink>
          <NavLink to="/chat">Live Chat</NavLink>
          <NavLink to="/members">Members</NavLink>
        </nav>
        <div className="header-actions">
          <Link to="/search" className="icon-btn" aria-label="Search"><Search size={20} /></Link>
          <Link to="/messages" className="icon-btn" aria-label={`Private messages${pulse.messages ? `, ${pulse.messages} unread` : ''}`}>
            <Mail size={20} />{pulse.messages > 0 && <span className="dot">{pulse.messages}</span>}
          </Link>
          <Link to="/notifications" className="icon-btn" aria-label={`Notifications${pulse.notifications ? `, ${pulse.notifications} new` : ''}`}>
            <Bell size={20} />{pulse.notifications > 0 && <span className="dot">{pulse.notifications > 99 ? '99+' : pulse.notifications}</span>}
          </Link>
          <div style={{ position: 'relative' }} ref={menuRef}>
            <button className="icon-btn" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen(!open)}>
              <Avatar member={me} size="sm" />
            </button>
            {open && me && (
              <div className="menu" role="menu">
                <Link to={`/members/${me.id}`}>My profile</Link>
                <Link to="/settings">Settings &amp; profile</Link>
                <Link to="/bookmarks">Bookmarks &amp; reminders</Link>
                <Link to="/drafts">Drafts</Link>
                {me.role === 'admin' && <Link to="/admin">Admin{pulse.open_reports ? ` (${pulse.open_reports} reports)` : ''}</Link>}
                <hr />
                <button onClick={logout}><LogOut size={14} style={{ verticalAlign: '-2px' }} /> Sign out</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function LeftRail() {
  const { me, pulse } = useApp();
  const { data } = useForums();
  const venues = data?.forums.filter((f) => f.kind === 'sport') ?? [];
  const community = data?.forums.filter((f) => f.kind !== 'sport') ?? [];
  return (
    <aside className="left-rail" aria-label="Sections">
      <div className="rail-card">
        <p className="rail-title">Navigate</p>
        <nav className="side-nav">
          <NavLink to="/" end><Home size={17} /> Home</NavLink>
          <NavLink to="/feed"><MessagesSquare size={17} /> All discussions{pulse.unread_threads > 0 && <span className="count hot">{pulse.unread_threads}</span>}</NavLink>
          <NavLink to="/games"><TrophyIcon size={17} /> Game Center</NavLink>
          <NavLink to="/chat"><MessageCircle size={17} /> Live chat</NavLink>
          <NavLink to="/calendar"><CalendarDays size={17} /> Calendar</NavLink>
          <NavLink to="/members"><Users size={17} /> Members</NavLink>
          <NavLink to="/predictions"><Trophy size={17} /> Predictions</NavLink>
          <NavLink to="/time-machine"><History size={17} /> Time Machine</NavLink>
          {me?.role === 'admin' && <NavLink to="/admin"><Shield size={17} /> Admin{pulse.open_reports > 0 && <span className="count hot">{pulse.open_reports}</span>}</NavLink>}
        </nav>
      </div>
      <div className="rail-card">
        <p className="rail-title">Sports venues</p>
        <nav className="side-nav">
          {venues.map((f) => (
            <NavLink key={f.slug} to={`/f/${f.slug}`} title={f.sport_label}>
              <span aria-hidden="true">{f.icon}</span>
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
                <span>{f.name}</span><span className="tiny muted" style={{ fontWeight: 600 }}>{f.sport_label}</span>
              </span>
              <span className={`count ${f.unread ? 'hot' : ''}`}>{f.unread || f.threads || ''}</span>
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="rail-card">
        <p className="rail-title">Community</p>
        <nav className="side-nav">
          {community.map((f) => (
            <NavLink key={f.slug} to={`/f/${f.slug}`}><span aria-hidden="true">{f.icon}</span> {f.name}{f.unread > 0 && <span className="count hot">{f.unread}</span>}</NavLink>
          ))}
          <NavLink to="/contributions"><Award size={17} /> Contributions</NavLink>
          <NavLink to="/year-in-review"><Sparkles size={17} /> Year in Review</NavLink>
          <NavLink to="/map"><MapIcon size={17} /> Member map</NavLink>
        </nav>
      </div>
    </aside>
  );
}

function RightRail() {
  const { data } = useApi<{ games: GameItem[]; live: GameItem[]; online: { id: number; username: string }[]; weekly: { thread_id: number; id: number; body: string; up: number; author: { username: string } | null } | null }>('/home');
  return (
    <aside className="right-rail" aria-label="Game day and community">
      <div className="rail-card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 14px 6px' }}>
          <p className="rail-title">Live Game Center</p>
          <strong>{data?.live.length ? 'Game day!' : 'Upcoming Aggie games'}</strong>
        </div>
        {(data?.live.length ? data.live : data?.games.slice(0, 3) ?? []).map((g) => <GameRow key={g.id} game={g} />)}
        {data && !data.games.length && <div className="small muted" style={{ padding: '0 14px 12px' }}>No games scheduled yet. Schedules arrive automatically from the official athletics calendar.</div>}
        <div style={{ padding: 12 }}><Link to="/games" className="btn block small">Open Game Center</Link></div>
      </div>
      <div className="rail-card">
        <p className="rail-title">Online now</p>
        {data?.online.length ? (
          <div className="chip-row">{data.online.map((u) => <Link key={u.id} to={`/members/${u.id}`} className="chip gray">● {u.username}</Link>)}</div>
        ) : <div className="small muted">Nobody else right now.</div>}
      </div>
      {data?.weekly && (
        <div className="rail-card">
          <p className="rail-title">Most appreciated this week</p>
          <Link to={`/t/${data.weekly.thread_id}?post=${data.weekly.id}`} style={{ color: 'inherit' }}>
            <div className="small">“{data.weekly.body}”</div>
            <div className="tiny muted" style={{ marginTop: 4 }}>{data.weekly.author?.username} · 👍 {data.weekly.up}</div>
          </Link>
        </div>
      )}
      <div className="rail-card">
        <p className="rail-title">Help build the forum</p>
        <Link to="/f/suggestions" className="row small"><Lightbulb size={16} /> Suggest an improvement</Link>
      </div>
    </aside>
  );
}

function BottomNav() {
  const { pulse } = useApp();
  return (
    <nav className="bottom-nav" aria-label="Main">
      <NavLink to="/" end><Home size={22} /> Home</NavLink>
      <NavLink to="/forums"><MessagesSquare size={22} /> Forums{pulse.unread_threads > 0 && <span className="dot">{pulse.unread_threads > 99 ? '99+' : pulse.unread_threads}</span>}</NavLink>
      <NavLink to="/games"><Trophy size={22} /> Games</NavLink>
      <NavLink to="/chat"><MessageCircle size={22} /> Chat</NavLink>
      <NavLink to="/members"><Users size={22} /> Members</NavLink>
    </nav>
  );
}

export function Layout({ children, rail = true }: { children: ReactNode; rail?: boolean }) {
  return (
    <>
      <a href="#main" className="sr-only">Skip to content</a>
      <Header />
      <div className={`shell ${rail ? '' : 'wide'}`}>
        <LeftRail />
        <main id="main" className="main">{children}</main>
        {rail && <RightRail />}
      </div>
      <BottomNav />
    </>
  );
}

export function SettingsLink() {
  return <Link to="/settings" className="row small"><Settings size={16} /> Settings</Link>;
}

export function BookmarksLink() {
  return <Link to="/bookmarks" className="row small"><Bookmark size={16} /> Bookmarks</Link>;
}

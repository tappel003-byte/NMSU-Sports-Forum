import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BADGES } from '../../shared/sports';
import { TAGS } from '../../shared/forum';
import { useApp } from '../state';
import { Score, dateParts, gameTime, matchup, sportIcon, sportName, timeAgo } from '../format';

export interface MemberLite {
  id: number;
  username: string;
  display_name?: string | null;
  avatar_key?: string | null;
  role?: string;
  reputation?: number;
  post_count?: number;
  badges?: { badge: string; reason: string; awarded_at: number }[];
}

export function Avatar({ member, size = '' }: { member: MemberLite | null; size?: '' | 'sm' | 'lg' }) {
  if (!member) return <span className={`avatar system ${size}`}><img src="/brand/crest-160.webp" alt="" /></span>;
  const initials = (member.display_name || member.username).split(/[\s_]+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span className={`avatar ${size}`} aria-hidden="true">
      {member.avatar_key ? <img src={`/api/files/${member.avatar_key}`} alt="" loading="lazy" /> : initials}
    </span>
  );
}

export function MemberName({ member }: { member: MemberLite | null }) {
  if (!member) return <span className="post-author">NMSU Sports Forum</span>;
  if (member.username.startsWith('former_member_')) return <span className="post-author muted">Former member</span>;
  return <Link className="post-author" to={`/members/${member.id}`}>{member.display_name || member.username}</Link>;
}

export function Badges({ member, max = 3 }: { member: MemberLite; max?: number }) {
  const list = member.badges ?? [];
  return (
    <span className="badges">
      {member.role === 'admin' && <span className="badge admin" title="Community administrator">Admin</span>}
      {list.slice(0, max).map((b, i) => (
        <span key={i} className={`badge ${b.badge === 'founding' ? 'founding' : ''}`} title={b.reason}>{BADGES[b.badge]?.label ?? b.badge}</span>
      ))}
    </span>
  );
}

export function Loading() {
  return <div className="empty" aria-busy="true">Loading…</div>;
}

export function ErrorState({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="card card-pad">
      <div className="error-box">{error}</div>
      {retry && <button className="btn secondary small" style={{ marginTop: 10 }} onClick={retry}>Try again</button>}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn ghost small" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface ThreadItem {
  id: number;
  title: string;
  description: string;
  sport: string | null;
  forum: { slug: string; name: string; sport_label: string; icon: string };
  author: MemberLite | null;
  last_poster: { id: number; username: string } | null;
  last_post_at: number;
  reply_count: number;
  thumbs_up: number;
  pinned: boolean;
  locked: boolean;
  archived: boolean;
  unread: boolean;
  game_id: number | null;
  game_phase: string | null;
  suggestion_status: string | null;
  tags?: string[];
  pending?: boolean;
}

export const SUGGESTION_LABELS: Record<string, string> = {
  under_consideration: 'Under consideration', planned: 'Planned', implemented: 'Implemented', declined: 'Not planned',
};

export function ThreadList({ threads, showForum = true, empty, compact }: { threads: ThreadItem[]; showForum?: boolean; empty?: ReactNode; compact?: boolean }) {
  const { me } = useApp();
  if (!threads.length) return <div className="empty">{empty ?? 'No discussions yet.'}</div>;
  return (
    <ul className={`thread-list ${(compact ?? me?.prefs?.compact) ? 'compact' : ''}`}>
      {threads.map((t) => (
        <li key={t.id} className="thread-item">
          <span className="thread-icon" aria-hidden="true">{t.sport ? sportIcon(t.sport) : t.forum.icon}</span>
          <div className="thread-main">
            {showForum && <div className="thread-forum">{t.forum.name} · {t.sport ? sportName(t.sport) : t.forum.sport_label}</div>}
            <Link to={`/t/${t.id}${t.unread ? '?unread=1' : ''}`} className={`thread-title ${t.unread ? 'unread' : ''}`}>
              {t.pinned && '📌 '}{t.locked && '🔒 '}{t.title}
            </Link>
            {t.description && <div className="thread-desc">{t.description}</div>}
            <div className="thread-meta">
              <span>{t.author ? (t.author.username.startsWith('former_member_') ? 'Former member' : t.author.display_name || t.author.username) : 'NMSU Sports Forum'}</span>
              <span>·</span>
              <span>{t.last_poster && t.reply_count > 0 ? `last by ${t.last_poster.username.startsWith('former_member_') ? 'Former member' : t.last_poster.username} ${timeAgo(t.last_post_at)}` : timeAgo(t.last_post_at)}</span>
              {t.thumbs_up > 0 && <span>· 👍 {t.thumbs_up}</span>}
              {t.game_phase && <span className="chip">{t.game_phase === 'pregame' ? 'Pregame' : 'Postgame'}</span>}
              {t.archived && <span className="chip gray">Archived</span>}
              {t.suggestion_status && <span className={`status-pill status-${t.suggestion_status}`}>{SUGGESTION_LABELS[t.suggestion_status]}</span>}
              {t.tags?.map((tg) => <span key={tg} className="tag">{TAGS[tg]}</span>)}
              {t.pending && <span className="chip gray">Awaiting approval</span>}
            </div>
          </div>
          <div className="thread-count"><b>{t.reply_count}</b>replies</div>
        </li>
      ))}
    </ul>
  );
}

export interface GameItem {
  id: number;
  sport: string;
  opponent: string;
  home_away: string;
  venue: string | null;
  starts_at: number;
  time_tba: boolean;
  status: string;
  result: string | null;
  nmsu_score: number | null;
  opp_score: number | null;
  tv: string | null;
  radio: string | null;
  official_url: string;
  schedule_url: string;
  live: boolean;
  overridden?: boolean;
  pregame_thread_id?: number | null;
  postgame_thread_id?: number | null;
}

export function GameRow({ game, extra }: { game: GameItem; extra?: ReactNode }) {
  const d = dateParts(game.starts_at);
  return (
    <Link to={`/games/${game.id}`} className="game-row">
      <div className="game-date"><div className="m">{d.month}</div><div className="d">{d.day}</div></div>
      <div className="grow">
        <div className="tiny muted" style={{ fontWeight: 700 }}>{sportIcon(game.sport)} {sportName(game.sport).toUpperCase()}</div>
        <div style={{ fontWeight: 700 }}>NM State {matchup(game)}</div>
        <div className="small muted">{gameTime(game.starts_at, game.time_tba)}{game.tv ? ` · ${game.tv}` : ''}</div>
        {extra}
      </div>
      <div style={{ textAlign: 'right' }}>
        {game.live ? <span className="chip live">Game day</span> : <Score game={game} />}
      </div>
    </Link>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pages">
      <button className="btn secondary small" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span className="small muted" style={{ alignSelf: 'center' }}>Page {page} of {pages}</span>
      <button className="btn secondary small" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </nav>
  );
}

/** Shown to visitors in place of posting controls. */
export function JoinCta({ text = 'Join free to post, react and chat.' }: { text?: string }) {
  const { site } = useApp();
  return (
    <div className="note-box small spread">
      <span>{site.signupMode === 'open' ? text : 'Members can post, react and chat. Membership is by invitation right now.'}</span>
      <span className="row">{site.signupMode === 'open' && <Link className="btn small" to="/join">Join free</Link>}<Link className="btn secondary small" to="/login">Sign in</Link></span>
    </div>
  );
}

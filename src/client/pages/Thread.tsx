import { useEffect, useRef, useState } from 'react';
import { isVenueForum } from '../../shared/sports';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Bookmark, BookmarkCheck, Flag, History, MoreHorizontal, Pencil, Quote, ShieldAlert, ThumbsDown, ThumbsUp, Trash2, Star, VolumeX } from 'lucide-react';
import { api } from '../api';
import { useApi, useApp } from '../state';
import { PostBody, fullTime, matchup, sportName, timeAgo } from '../format';
import { Avatar, Badges, ErrorState, JoinCta, Loading, MemberName, Modal, Pager, SUGGESTION_LABELS, type MemberLite } from '../components/ui';
import { ReplyComposer, type QuoteRef } from '../components/Composer';
import { ShareModal } from '../components/Share';
import { TAGS, rankFor } from '../../shared/forum';

interface Post {
  id: number;
  author: (MemberLite & { reputation: number; post_count: number }) | null;
  body: string;
  deleted: boolean;
  created_at: number;
  edited_at: number | null;
  edit_count: number;
  up: number;
  down: number;
  my_reaction: number;
  bookmarked: boolean;
  muted: boolean;
  pending: boolean;
  hidden: boolean;
  can_flag: boolean;
  quote: { id: number; thread_id: number; username: string; body: string; deleted: boolean } | null;
  attachments: { id: string; content_type: string; expires_at: number | null }[];
  expired_attachments: number;
  can_edit: boolean;
}

interface ThreadData {
  thread: {
    id: number; title: string; description: string; sport: string | null; created_at: number; user_id: number | null;
    forum: { slug: string; name: string; sport_label: string; icon: string };
    pinned: boolean; locked: boolean; archived: boolean; deleted: boolean; reply_count: number; followed: boolean;
    game: { id: number; sport: string; opponent: string; starts_at: number; status: string; home_away: string } | null;
    game_phase: string | null; suggestion_status: string | null; can_reply: boolean; first_unread_post_id: number | null;
    tags: string[]; pending: boolean; last_post_id: number;
  };
  page: number;
  pages: number;
  poll: { id: number; question: string; closed: boolean; closes_at: number | null; allow_add: number; kind: string | null; options: { id: number; label: string; votes: number }[]; my_vote: number | null; total: number } | null;
  posts: Post[];
}

export function ThreadPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { me, toast, refreshPulse } = useApp();
  const query = params.get('page') ? `page=${params.get('page')}` : params.get('post') ? `post=${params.get('post')}` : params.get('unread') ? 'unread=1' : '';
  const { data, error, reload, setData } = useApi<ThreadData>(`/threads/${id}?${query}`);
  const [quote, setQuote] = useState<QuoteRef | null>(null);
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const [history, setHistory] = useState<{ current: string; edits: { old_body: string; edited_at: number; editor: string }[] } | null>(null);
  const [report, setReport] = useState<number | null>(null);
  const [bookmark, setBookmark] = useState<Post | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [share, setShare] = useState(false);
  const [newPosts, setNewPosts] = useState(0);
  const [nominee, setNominee] = useState('');
  const latestSeen = useRef(0);

  // Live thread: a WebSocket announces new posts; the last page refreshes itself.
  useEffect(() => {
    if (!data) return;
    latestSeen.current = Math.max(latestSeen.current, data.thread.last_post_id);
  }, [data]);
  const onLastPage = data ? data.page >= data.pages : false;
  useEffect(() => {
    if (!me) return;
    let closed = false;
    let sock: WebSocket | null = null;
    let timer: number | undefined;
    let tries = 0;
    const check = async () => {
      try {
        const r = await api<{ last_post_id: number }>(`/threads/${id}/latest`);
        if (r.last_post_id > latestSeen.current) {
          if (onLastPage) {
            const nearBottom = window.innerHeight + window.scrollY > document.body.scrollHeight - 400;
            await reload();
            if (!nearBottom) setNewPosts((n) => n + 1);
          } else setNewPosts((n) => n + 1);
          latestSeen.current = r.last_post_id;
        }
      } catch { /* offline; next signal retries */ }
    };
    const connect = () => {
      sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/threads/${id}/ws`);
      sock.onopen = () => { tries = 0; check(); };
      sock.onmessage = (ev) => { if (JSON.parse(ev.data).type === 'post') check(); };
      sock.onclose = () => { if (!closed) timer = window.setTimeout(connect, Math.min(15000, 1000 * 2 ** tries++)); };
    };
    connect();
    return () => { closed = true; window.clearTimeout(timer); sock?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, onLastPage, me]);

  useEffect(() => {
    if (!data) return;
    refreshPulse();
    const target = Number(params.get('post')) || (params.get('unread') ? data.thread.first_unread_post_id : null);
    if (target) {
      setHighlight(target);
      requestAnimationFrame(() => document.getElementById(`p${target}`)?.scrollIntoView({ block: 'start' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.page, data?.thread.id]);

  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  const t = data.thread;
  const isAdmin = me?.role === 'admin';

  const patchPost = (pid: number, patch: Partial<Post>) => setData({ ...data, posts: data.posts.map((p) => (p.id === pid ? { ...p, ...patch } : p)) });

  const react = async (p: Post, value: 1 | -1) => {
    const next = p.my_reaction === value ? 0 : value;
    try {
      const r = await api<{ up: number; down: number; my_reaction: number }>(`/posts/${p.id}/react`, { body: { value: next } });
      patchPost(p.id, r);
    } catch (e) { toast((e as Error).message); }
  };

  const follow = async () => {
    await api(`/threads/${t.id}/follow`, { body: { follow: !t.followed } });
    setData({ ...data, thread: { ...t, followed: !t.followed } });
    toast(t.followed ? 'Unfollowed' : "Following — you'll be notified of replies");
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await api(`/posts/${editing.id}`, { method: 'PATCH', body: { body: editing.body } });
      setEditing(null);
      reload();
    } catch (e) { toast((e as Error).message); }
  };

  const remove = async (p: Post) => {
    // Moderators removing someone else's post give a reason the member sees (and can appeal).
    if (p.author?.id !== me?.id) {
      const reason = prompt('Reason for removing this post (the member sees it and can appeal):');
      if (!reason) return;
      try { await api(`/posts/${p.id}`, { method: 'DELETE', body: { reason } }); toast('Removed'); } catch (e) { toast((e as Error).message); }
    } else {
      if (!confirm('Remove this post?')) return;
      await api(`/posts/${p.id}`, { method: 'DELETE' });
    }
    reload();
  };

  const vote = async (optionId: number) => {
    if (!data.poll) return;
    try {
      const poll = await api<ThreadData['poll']>(`/polls/${data.poll.id}/vote`, { body: { option_id: optionId } });
      setData({ ...data, poll });
    } catch (e) { toast((e as Error).message); }
  };

  const adminAction = async (body: Record<string, unknown>, msg: string) => {
    try {
      await api(`/admin/threads/${t.id}`, { method: 'PATCH', body });
      toast(msg);
      setAdminOpen(false);
      if (body.deleted) nav(isVenueForum(t.forum.slug) ? '/feed' : `/f/${t.forum.slug}`);
      else reload();
    } catch (e) { toast((e as Error).message); }
  };

  const muteUser = async (m: MemberLite) => {
    await api('/mutes', { body: { target_type: 'user', target_id: m.id, muted: true } });
    toast(`${m.username} muted. Their posts are hidden and they can't message you.`);
    reload();
  };

  const feature = async (p: Post) => {
    await api('/me/featured', { body: { post_id: p.id } });
    toast('Highlighted on your profile');
  };

  const goPage = (n: number) => setParams({ page: String(n) });

  const flagTroll = async (p: Post) => {
    if (!confirm('Flag this post as trolling? When three members flag a post it is hidden temporarily until a moderator reviews it. Flags never affect anyone’s Aggie Reputation.')) return;
    try {
      const r = await api<{ hidden: boolean; flags: number; threshold: number }>(`/posts/${p.id}/troll`, { method: 'POST' });
      toast(r.hidden ? 'Hidden pending moderator review. Moderators have been notified.' : `Flagged (${r.flags} of ${r.threshold} needed to hide it for review).`);
      if (r.hidden) reload();
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <div className="stack thread-page">
      {newPosts > 0 && (
        <button className="btn small live-banner" onClick={() => { setNewPosts(0); if (onLastPage) window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); else setParams({ post: String(latestSeen.current) }); }}>
          ↓ {newPosts} new {newPosts === 1 ? 'reply' : 'replies'}
        </button>
      )}
      {share && <ShareModal target={{ kind: 'thread', id: t.id, title: t.title }} onClose={() => setShare(false)} />}
      <nav className="small" aria-label="Breadcrumb">
        <Link to="/feed">Board</Link>{t.forum.slug !== 'general' && !isVenueForum(t.forum.slug) && <> › <Link to={`/f/${t.forum.slug}`}>{t.forum.name}</Link></>}{t.sport && <> · <span className="muted">{sportName(t.sport)}</span></>}
      </nav>
      <section className="card">
        <div className="card-pad" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="chip-row" style={{ marginBottom: 6 }}>
            {t.pinned && <span className="chip">📌 Pinned</span>}
            {t.locked && <span className="chip gray">🔒 Locked</span>}
            {t.archived && <span className="chip gray">Archived · read-only</span>}
            {t.deleted && <span className="chip gray">Removed (admins only)</span>}
            {t.game_phase && <span className="chip">{t.game_phase === 'pregame' ? 'Pregame' : 'Postgame'}</span>}
            {t.suggestion_status && <span className={`status-pill status-${t.suggestion_status}`}>{SUGGESTION_LABELS[t.suggestion_status]}</span>}
            {t.tags.map((tg) => <Link key={tg} to={`/feed?tag=${tg}`} className="tag">{TAGS[tg]}</Link>)}
          </div>
          {t.pending && <div className="note-box small" style={{ marginBottom: 8 }}>This discussion is waiting for an administrator to approve it. Only you and the admins can see it for now.</div>}
          {editTitle ? (
            <TitleEditor thread={t} onDone={() => { setEditTitle(false); reload(); }} />
          ) : (
            <>
              <h1 style={{ overflowWrap: 'anywhere' }}>{t.title}</h1>
              <p className="muted" style={{ margin: 0 }}>{t.description}</p>
            </>
          )}
          {t.game && (
            <Link to={`/games/${t.game.id}`} className="note-box small" style={{ display: 'block', marginTop: 10 }}>
              🏟️ {sportName(t.game.sport)}: NM State {matchup(t.game)} — open the game page for chat, predictions and official links
            </Link>
          )}
          {me && <div className="row" style={{ marginTop: 12 }}>
            <button className="btn secondary small" onClick={follow}>{t.followed ? 'Following ✓' : 'Follow'}</button>
            {t.first_unread_post_id && <Link className="btn secondary small" to={`/t/${t.id}?post=${t.first_unread_post_id}`}>Jump to first unread</Link>}
            {t.can_reply && <button className="btn secondary small desktop-only" onClick={() => { setReplyOpen(true); document.getElementById('reply')?.scrollIntoView({ behavior: 'smooth' }); }}>Reply</button>}
            {t.can_reply && <button className="btn secondary small" onClick={() => setShare(true)}>Share a tweet</button>}
            {(t.user_id === me?.id || isAdmin) && !editTitle && <button className="btn ghost small" onClick={() => setEditTitle(true)}>Edit title</button>}
            {isAdmin && <button className="btn ghost small" onClick={() => setAdminOpen(true)}><MoreHorizontal size={16} /> Moderate</button>}
          </div>}
        </div>

        {data.poll && (
          <div className="poll">
            <div className="spread"><strong>📊 {data.poll.question}</strong><span className="tiny muted">{data.poll.total} votes{data.poll.closed ? ' · closed' : data.poll.closes_at ? ` · closes ${fullTime(data.poll.closes_at)}` : ''}</span></div>
            {data.poll.options.map((o) => {
              const pct = data.poll!.total ? Math.round((o.votes / data.poll!.total) * 100) : 0;
              return (
                <button key={o.id} className={`poll-option ${data.poll!.my_vote === o.id ? 'mine' : ''}`} disabled={data.poll!.closed} onClick={() => vote(o.id)}>
                  <span className="bar" style={{ width: `${data.poll!.my_vote || data.poll!.closed ? pct : 0}%` }} />
                  <span>{o.label}{data.poll!.my_vote === o.id ? ' ✓' : ''}</span>
                  <span>{data.poll!.my_vote || data.poll!.closed ? `${pct}% (${o.votes})` : ''}</span>
                </button>
              );
            })}
            {!data.poll.my_vote && !data.poll.closed && <div className="tiny muted" style={{ marginTop: 6 }}>Vote to see results. One vote per member; you can change it.</div>}
            {Boolean(data.poll.allow_add) && !data.poll.closed && (
              <form className="row" style={{ marginTop: 8 }} onSubmit={async (e) => {
                e.preventDefault();
                try { const poll = await api<ThreadData['poll']>(`/polls/${data.poll!.id}/options`, { body: { label: nominee } }); setData({ ...data, poll }); setNominee(''); } catch (err) { toast((err as Error).message); }
              }}>
                <input className="input grow" value={nominee} onChange={(e) => setNominee(e.target.value)} placeholder="Nominate a player (adds your vote)" aria-label="Nominate a player" maxLength={60} />
                <button className="btn small" disabled={nominee.trim().length < 2}>Nominate</button>
              </form>
            )}
          </div>
        )}

        <Pager page={data.page} pages={data.pages} onPage={goPage} />

        {data.posts.map((p) => p.muted ? (
          <div key={p.id} id={`p${p.id}`} className="muted-post">Post from a member you muted. <button className="btn ghost small" onClick={() => patchPost(p.id, { muted: false })}>Show</button></div>
        ) : (
          <article key={p.id} id={`p${p.id}`} className={`post ${highlight === p.id ? 'highlight' : ''}`}>
            <div className="post-side"><Avatar member={p.author} /></div>
            <div className="post-main">
              <div className="post-head">
                <MemberName member={p.author} />
                {p.author && <Badges member={p.author} max={2} />}
                {p.author && <span className="rank">{rankFor(p.author.post_count)}</span>}
                {p.author && <span className="tiny muted">· {p.author.reputation} rep</span>}
                {p.pending && <span className="chip gray">Waiting for approval</span>}
                <span className="tiny muted">· <a href={`#p${p.id}`} title={fullTime(p.created_at)} style={{ color: 'inherit' }}>{timeAgo(p.created_at)}</a></span>
                {p.edit_count > 0 && <button className="tiny muted" style={{ border: 0, background: 'none', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => api(`/posts/${p.id}/history`).then(setHistory)}>edited</button>}
              </div>
              {p.hidden && <div className="chip gray" style={{ marginBottom: 6 }}>Temporarily hidden while moderators review it. This isn't a judgment about the author.</div>}
              {p.hidden && !p.body ? null : p.deleted ? <div className="muted small"><em>This post was removed.</em></div> : editing?.id === p.id ? (
                <div>
                  <textarea className="textarea" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} aria-label="Edit post" />
                  <div className="row" style={{ marginTop: 8 }}><button className="btn small" onClick={saveEdit}>Save</button><button className="btn ghost small" onClick={() => setEditing(null)}>Cancel</button></div>
                </div>
              ) : (
                <>
                  {p.quote && (
                    <div className="quote-embed">
                      <div className="who">{p.quote.username} wrote:</div>
                      <div className="small">{p.quote.deleted ? <em>Removed post</em> : p.quote.body.slice(0, 400)}{p.quote.body.length > 400 ? '…' : ''}</div>
                    </div>
                  )}
                  <PostBody text={p.body} />
                  {p.attachments.length > 0 && (
                    <div className="post-photos">
                      {p.attachments.map((a) => <img key={a.id} src={`/api/files/${a.id}`} alt="Photo attached to post" loading="lazy" onClick={() => setLightbox(`/api/files/${a.id}`)} />)}
                    </div>
                  )}
                  {p.expired_attachments > 0 && <div className="tiny muted">{p.expired_attachments} photo{p.expired_attachments > 1 ? 's' : ''} expired (photos are kept 90 days).</div>}
                </>
              )}
              {me && !p.deleted && !(p.hidden && !p.body) && editing?.id !== p.id && (
                <div className="post-actions">
                  <button className={`react ${p.my_reaction === 1 ? 'on' : ''}`} aria-pressed={p.my_reaction === 1} aria-label={`Thumbs up, ${p.up}`} disabled={!p.author || p.author.id === me?.id} onClick={() => react(p, 1)}><ThumbsUp size={16} /> {p.up}</button>
                  <button className={`react down ${p.my_reaction === -1 ? 'on' : ''}`} aria-pressed={p.my_reaction === -1} aria-label={`Thumbs down, ${p.down}`} disabled={!p.author || p.author.id === me?.id} onClick={() => react(p, -1)}><ThumbsDown size={16} /> {p.down}</button>
                  {t.can_reply && <button onClick={() => setQuote({ id: p.id, username: p.author?.username ?? 'NMSU Sports Forum', body: p.body })}><Quote size={15} /> Quote</button>}
                  <button onClick={() => (p.bookmarked ? api(`/posts/${p.id}/bookmark`, { body: { bookmarked: false } }).then(() => { patchPost(p.id, { bookmarked: false }); toast('Bookmark removed'); }) : setBookmark(p))} aria-label={p.bookmarked ? 'Remove bookmark' : 'Bookmark'}>
                    {p.bookmarked ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
                  </button>
                  {p.can_edit && <button onClick={() => setEditing({ id: p.id, body: p.body })} aria-label="Edit"><Pencil size={15} /></button>}
                  {(p.author?.id === me?.id || isAdmin) && <button onClick={() => remove(p)} aria-label="Remove"><Trash2 size={15} /></button>}
                  {p.author?.id === me?.id && <button onClick={() => feature(p)} title="Highlight on my profile" aria-label="Highlight on my profile"><Star size={15} /></button>}
                  {p.can_flag && <button onClick={() => flagTroll(p)} title="Flag as trolling" aria-label="Flag as trolling"><ShieldAlert size={15} /> Troll</button>}
                  {p.author && p.author.id !== me?.id && <button onClick={() => setReport(p.id)} aria-label="Report"><Flag size={15} /></button>}
                  {p.author && p.author.id !== me?.id && <button onClick={() => muteUser(p.author!)} title={`Mute ${p.author.username}`} aria-label={`Mute ${p.author.username}`}><VolumeX size={15} /></button>}
                </div>
              )}
            </div>
          </article>
        ))}

        <Pager page={data.page} pages={data.pages} onPage={goPage} />

        {!me ? <div className="composer"><JoinCta text="Join free to reply, react and follow this discussion." /></div> : t.can_reply ? (
          <ReplyComposer threadId={t.id} quote={quote} clearQuote={() => setQuote(null)} open={replyOpen} setOpen={setReplyOpen}
            onPosted={(pid, pending) => { if (pending) toast('Thanks! Your first post will appear once an admin approves it.'); setParams({ post: String(pid) }); reload(); }} />
        ) : (
          <div className="composer small muted">{t.archived ? 'This discussion is archived because it had no replies for 90 days. It stays searchable; an administrator can reopen it.' : 'This discussion is locked.'}</div>
        )}
      </section>

      {history && (
        <Modal title="Edit history" onClose={() => setHistory(null)}>
          <div className="label">Current</div>
          <div className="card card-pad" style={{ marginBottom: 12 }}><PostBody text={history.current} /></div>
          {history.edits.map((e, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div className="label">Before edit by {e.editor} · {fullTime(e.edited_at)}</div>
              <div className="card card-pad"><PostBody text={e.old_body} /></div>
            </div>
          ))}
        </Modal>
      )}
      {report && <ReportModal path={`/posts/${report}/report`} onClose={() => setReport(null)} />}
      {bookmark && <BookmarkModal post={bookmark} onClose={() => setBookmark(null)} onSaved={() => { patchPost(bookmark.id, { bookmarked: true }); setBookmark(null); }} />}
      {lightbox && <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Photo"><img src={lightbox} alt="Full-size photo" /></div>}
      {adminOpen && (
        <Modal title="Moderate discussion" onClose={() => setAdminOpen(false)}>
          <div className="stack">
            <div className="row">
              <button className="btn secondary" onClick={() => adminAction({ pinned: !t.pinned }, t.pinned ? 'Unpinned' : 'Pinned')}>{t.pinned ? 'Unpin' : 'Pin'}</button>
              <button className="btn secondary" onClick={() => adminAction({ locked: !t.locked }, t.locked ? 'Unlocked' : 'Locked')}>{t.locked ? 'Unlock' : 'Lock'}</button>
              {t.archived && <button className="btn secondary" onClick={() => adminAction({ reopen: true }, 'Reopened')}>Reopen archived</button>}
              <button className="btn secondary" onClick={() => confirm('Remove this whole discussion?') && adminAction({ deleted: !t.deleted }, t.deleted ? 'Restored' : 'Discussion removed')}>{t.deleted ? 'Restore' : 'Remove discussion'}</button>
            </div>
            <MoveForum current={t.forum.slug} onMove={(slug) => adminAction({ forum: slug }, 'Moved')} />
            <MergeThread onMerge={async (into) => {
              try { await api(`/admin/threads/${t.id}/merge`, { body: { into } }); toast('Merged'); nav(`/t/${into}`); } catch (e) { toast((e as Error).message); }
            }} />
            {t.forum.slug === 'suggestions' && (
              <div>
                <div className="label">Suggestion status</div>
                <div className="row" style={{ marginTop: 6 }}>
                  {Object.entries(SUGGESTION_LABELS).map(([k, v]) => <button key={k} className={`btn small ${t.suggestion_status === k ? '' : 'secondary'}`} onClick={() => adminAction({ suggestion_status: k }, `Marked ${v}${k === 'implemented' ? ' — Idea Contributor awarded' : ''}`)}>{v}</button>)}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function TitleEditor({ thread, onDone }: { thread: { id: number; title: string; description: string; tags: string[] }; onDone: () => void }) {
  const [title, setTitle] = useState(thread.title);
  const [desc, setDesc] = useState(thread.description);
  const [tags, setTags] = useState<string[]>(thread.tags);
  const { toast } = useApp();
  const save = async () => {
    try { await api(`/threads/${thread.id}`, { method: 'PATCH', body: { title, description: desc, tags } }); onDone(); } catch (e) { toast((e as Error).message); }
  };
  return (
    <div>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
      <input className="input" style={{ marginTop: 8 }} value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Description" />
      <TagPicker value={tags} onChange={setTags} />
      <div className="row" style={{ marginTop: 8 }}><button className="btn small" onClick={save}>Save</button><button className="btn ghost small" onClick={onDone}>Cancel</button></div>
    </div>
  );
}

function MoveForum({ current, onMove }: { current: string; onMove: (slug: string) => void }) {
  const { data } = useApi<{ forums: { slug: string; name: string }[] }>('/forums');
  const [slug, setSlug] = useState(current);
  return (
    <div>
      <label className="label" htmlFor="move">Move to forum</label>
      <div className="row" style={{ marginTop: 6 }}>
        <select id="move" className="select grow" value={slug} onChange={(e) => setSlug(e.target.value)}>{data?.forums.map((f) => <option key={f.slug} value={f.slug}>{f.name}</option>)}</select>
        <button className="btn small" disabled={slug === current} onClick={() => onMove(slug)}>Move</button>
      </div>
    </div>
  );
}

export function ReportModal({ path, extra, onClose, note }: { path: string; extra?: Record<string, unknown>; onClose: () => void; note?: string }) {
  const [reason, setReason] = useState('');
  const { toast } = useApp();
  const send = async () => {
    try {
      await api(path, { body: { reason, ...extra } });
      toast('Reported to the administrators. Thank you.');
      onClose();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <Modal title="Report to administrators" onClose={onClose}>
      {note && <p className="small muted">{note}</p>}
      <div className="field"><label htmlFor="reason">What's wrong?</label><textarea id="reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <button className="btn" disabled={reason.trim().length < 3} onClick={send}>Send report</button>
    </Modal>
  );
}

function BookmarkModal({ post, onClose, onSaved }: { post: Post; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = useState('');
  const [remind, setRemind] = useState('');
  const { toast } = useApp();
  const quick = (hours: number) => {
    const d = new Date(Date.now() + hours * 3_600_000);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setRemind(local);
  };
  const save = async () => {
    try {
      await api(`/posts/${post.id}/bookmark`, { body: { bookmarked: true, note: note || null, remind_at: remind ? new Date(remind).getTime() : null } });
      toast(remind ? "Bookmarked — we'll remind you" : 'Bookmarked');
      onSaved();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <Modal title="Bookmark post" onClose={onClose}>
      <div className="field"><label htmlFor="bn">Note (optional)</label><input id="bn" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="field">
        <label htmlFor="br">Remind me (optional)</label>
        <input id="br" type="datetime-local" className="input" value={remind} onChange={(e) => setRemind(e.target.value)} />
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="btn secondary small" onClick={() => quick(3)}>In 3 hours</button>
          <button type="button" className="btn secondary small" onClick={() => quick(24)}>Tomorrow</button>
          <button type="button" className="btn secondary small" onClick={() => quick(24 * 7)}>Next week</button>
        </div>
      </div>
      <button className="btn" onClick={save}>Save bookmark</button>
    </Modal>
  );
}

export function TagPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="chip-row" style={{ marginTop: 8 }} role="group" aria-label="Tags (up to 3)">
      {Object.entries(TAGS).map(([k, label]) => {
        const on = value.includes(k);
        return (
          <button key={k} type="button" className={`btn small ${on ? '' : 'secondary'}`} aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== k) : value.length < 3 ? [...value, k] : value)}>{label}</button>
        );
      })}
    </div>
  );
}

function MergeThread({ onMerge }: { onMerge: (into: number) => void }) {
  const [into, setInto] = useState('');
  const id = Number(into.match(/(\d+)\s*$/)?.[1] ?? into.match(/\/t\/(\d+)/)?.[1]);
  return (
    <div>
      <label className="label" htmlFor="merge">Merge into another discussion</label>
      <div className="row" style={{ marginTop: 6 }}>
        <input id="merge" className="input grow" placeholder="Paste the other discussion's link or number" value={into} onChange={(e) => setInto(e.target.value)} />
        <button className="btn small" disabled={!id} onClick={() => confirm('Move all posts into that discussion and remove this one?') && onMerge(id)}>Merge</button>
      </div>
    </div>
  );
}

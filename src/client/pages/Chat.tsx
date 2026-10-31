import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Flag, Quote, Reply, Save, Send, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useApi, useApp } from '../state';
import { PostBody, fullTime, gameTime, timeAgo } from '../format';
import { ErrorState, Loading, Modal, type GameItem, LiveScore } from '../components/ui';
import { ReportModal } from './Thread';

interface Msg { id: number; user_id: number; username: string; display_name: string | null; body: string; created_at: number }

export function ChatRooms() {
  const { data, error, reload } = useApi<{ rooms: { room: string; title: string; subtitle: string; active: number; game: GameItem | null }[] }>('/chat/rooms');
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <div className="page-head"><div className="eyebrow">Live chat</div><h1>Talk it over in real time</h1><p className="muted small" style={{ margin: 0 }}>The Aggie Lounge is always open. A chat room opens automatically the day before every football and men's basketball game, and each one is archived permanently on its game page.</p></div>
      <section className="card">
        {data.rooms.map((r) => (
          <Link key={r.room} to={`/chat/${r.room}`} className="list-row">
            <span className="thread-icon" aria-hidden="true">{r.game ? '🏟️' : '💬'}</span>
            <div className="grow"><strong>{r.title}</strong><div className="small muted">{r.subtitle}{r.game ? ` · ${gameTime(r.game.starts_at, r.game.time_tba)}` : ''}</div></div>
            {r.active > 0 ? <span className="chip live">{r.active} chatting</span> : r.game?.live ? <span className="chip live">Live</span> : null}
          </Link>
        ))}
        {data.rooms.length === 1 && <div className="small muted card-pad">No football or men's basketball game chat right now. One opens automatically the day before each game.</div>}
      </section>
    </div>
  );
}

export function ChatRoomPage() {
  const { room = '' } = useParams();
  const { me, toast } = useApp();
  const nav = useNavigate();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [game, setGame] = useState<GameItem | null>(null);
  const [presence, setPresence] = useState<{ id: number; username: string }[]>([]);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [text, setText] = useState('');
  // Reply puts @name in front of the message; Quote adds a quoted line above it (shown as a quote by PostBody).
  const [ctx, setCtx] = useState<{ mode: 'reply' | 'quote'; username: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [report, setReport] = useState<number | null>(null);
  const [muted, setMuted] = useState<Set<number>>(new Set());
  const ws = useRef<WebSocket | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const retry = useRef(0);
  const stuckToBottom = useRef(true);

  const loadHistory = useCallback(async () => {
    const r = await api<{ messages: Msg[]; game: GameItem | null }>(`/chat/${room}/history`);
    setMessages(r.messages);
    setGame(r.game);
  }, [room]);

  useEffect(() => {
    api<{ users: { id: number }[] }>('/mutes').then((r) => setMuted(new Set(r.users.map((u) => u.id)))).catch(() => {});
  }, []);

  // Connect with automatic reconnect (exponential backoff) and history refresh on every reconnect.
  useEffect(() => {
    let closed = false;
    let timer: number | undefined;
    let ping: number | undefined;
    const connect = () => {
      setStatus('connecting');
      loadHistory().catch((e) => setError((e as Error).message));
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const sock = new WebSocket(`${proto}://${location.host}/api/chat/${room}/ws`);
      ws.current = sock;
      sock.onopen = () => {
        setStatus('open');
        retry.current = 0;
        ping = window.setInterval(() => sock.readyState === 1 && sock.send(JSON.stringify({ type: 'ping' })), 25_000);
      };
      sock.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.type === 'message') setMessages((prev) => (prev.some((x) => x.id === m.message.id) ? prev : [...prev, m.message].slice(-500)));
        else if (m.type === 'deleted') setMessages((prev) => prev.filter((x) => x.id !== m.id));
        else if (m.type === 'presence') setPresence(m.members);
        else if (m.type === 'error') toast(m.message);
      };
      sock.onclose = () => {
        window.clearInterval(ping);
        setStatus('closed');
        if (closed) return;
        const delay = Math.min(15_000, 1000 * 2 ** retry.current++);
        timer = window.setTimeout(connect, delay);
      };
    };
    connect();
    const onVisible = () => { if (document.visibilityState === 'visible' && ws.current?.readyState !== 1) { window.clearTimeout(timer); retry.current = 0; connect(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      closed = true;
      window.clearTimeout(timer);
      window.clearInterval(ping);
      document.removeEventListener('visibilitychange', onVisible);
      ws.current?.close();
    };
  }, [room, loadHistory, toast]);

  useEffect(() => {
    if (stuckToBottom.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages]);

  const send = () => {
    let body = text.trim();
    if (!body || ws.current?.readyState !== 1) return;
    if (ctx?.mode === 'quote') {
      const said = ctx.body.split('\n').filter((l) => !l.startsWith('>')).join(' ').trim();
      body = `> ${ctx.username}: ${said.length > 140 ? `${said.slice(0, 140)}…` : said}\n${body}`;
    } else if (ctx?.mode === 'reply' && !body.includes(`@${ctx.username}`)) body = `@${ctx.username} ${body}`;
    ws.current.send(JSON.stringify({ type: 'send', body: body.slice(0, 1000) }));
    setText('');
    setCtx(null);
    stuckToBottom.current = true;
  };

  const del = (id: number) => ws.current?.send(JSON.stringify({ type: 'delete', id }));
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const title = room === 'lounge' ? 'Aggie Lounge' : game ? `NM State ${game.home_away === 'away' ? 'at' : 'vs.'} ${game.opponent}` : 'Game chat';

  if (error) return <ErrorState error={error} />;
  return (
    <div className="card chat-wrap">
      <div className="section-head">
        <div className="grow">
          <h2 style={{ fontSize: '1rem' }}>{title}</h2>
          <div className="tiny muted">
            <span className={`conn ${status === 'open' ? 'ok' : 'bad'}`}>{status === 'open' ? '● Connected' : status === 'connecting' ? '● Connecting…' : '● Reconnecting…'}</span>
            {' · '}{presence.length} here{presence.length ? `: ${presence.slice(0, 6).map((p) => p.username).join(', ')}${presence.length > 6 ? '…' : ''}` : ''}
          </div>
        </div>
        <div className="row">
          {game && <Link to={`/games/${game.id}`} className="btn ghost small">Game</Link>}
          <Link to={`/chat/${room}/archive`} className="btn ghost small">Archive</Link>
          <button className="btn secondary small" onClick={() => { setSelecting(!selecting); setSelected([]); }}>{selecting ? 'Cancel' : 'Save to thread'}</button>
        </div>
      </div>
      {game && <LiveScore game={game} compact />}
      {selecting && (
        <div className="note-box small" style={{ margin: 8 }}>
          Tap messages to select them, then save them as a permanent discussion thread.
          <button className="btn small" style={{ marginLeft: 8 }} disabled={!selected.length} onClick={() => setSaveOpen(true)}><Save size={14} /> Save {selected.length || ''}</button>
        </div>
      )}
      <div className="chat-log" ref={log} onScroll={(e) => { const el = e.currentTarget; stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }} aria-live="polite">
        {messages.length === 0 && <div className="empty">No messages yet. Say hello!</div>}
        {messages.filter((m) => !muted.has(m.user_id)).map((m) => (
          <div key={m.id} className={`chat-msg ${m.user_id === me?.id ? 'mine' : ''} ${selected.includes(m.id) ? 'selected' : ''}`} onClick={() => selecting && toggle(m.id)}>
            <div className="bubble">
              <div className="spread"><span className="who">{m.display_name || m.username}</span><span className="tiny muted" title={fullTime(m.created_at)}>{timeAgo(m.created_at)}</span></div>
              <PostBody text={m.body} />
              {!selecting && (
                <div className="row" style={{ gap: 2 }}>
                  <button className="btn ghost small chat-act" onClick={() => { setCtx({ mode: 'reply', username: m.username, body: m.body }); document.getElementById('chat-text')?.focus(); }}><Reply size={12} /> Reply</button>
                  <button className="btn ghost small chat-act" onClick={() => { setCtx({ mode: 'quote', username: m.username, body: m.body }); document.getElementById('chat-text')?.focus(); }}><Quote size={12} /> Quote</button>
                  {m.user_id !== me?.id && <button className="btn ghost small" style={{ minHeight: 24, padding: '0 6px' }} aria-label="Report message" onClick={() => setReport(m.id)}><Flag size={12} /></button>}
                  {(me?.role === 'admin' || me?.role === 'moderator') && <button className="btn ghost small" style={{ minHeight: 24, padding: '0 6px' }} aria-label="Remove message" onClick={() => del(m.id)}><Trash2 size={12} /></button>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {ctx && (
        <div className="chat-ctx">
          <span className="grow">{ctx.mode === 'reply' ? <>Replying to <strong>{ctx.username}</strong></> : <>Quoting <strong>{ctx.username}</strong>: “{ctx.body.split('\n').filter((l) => !l.startsWith('>')).join(' ').slice(0, 80)}”</>}</span>
          <button type="button" className="btn ghost small" aria-label="Cancel reply" onClick={() => setCtx(null)}>✕</button>
        </div>
      )}
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label htmlFor="chat-text" className="sr-only">Message</label>
        <input id="chat-text" className="input grow" placeholder={status === 'open' ? 'Message' : 'Reconnecting…'} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} autoComplete="off" />
        <button className="btn" disabled={status !== 'open' || !text.trim()} aria-label="Send"><Send size={16} /></button>
      </form>
      {saveOpen && <SaveToThread room={room} ids={selected} onClose={() => setSaveOpen(false)} onSaved={(id) => nav(`/t/${id}`)} />}
      {report && <ReportModal path="/chat/report" extra={{ message_id: report }} onClose={() => setReport(null)} />}
    </div>
  );
}

function SaveToThread({ room, ids, onClose, onSaved }: { room: string; ids: number[]; onClose: () => void; onSaved: (id: number) => void }) {
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const { toast } = useApp();
  const save = async () => {
    try {
      const r = await api<{ id: number }>('/chat/to-thread', { body: { room, message_ids: ids, title, comment: comment || undefined } });
      onSaved(r.id);
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <Modal title="Save chat moment as a thread" onClose={onClose}>
      <div className="field"><label htmlFor="st">Thread title</label><input id="st" className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="field"><label htmlFor="sc">Add a comment (optional)</label><textarea id="sc" className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
      <button className="btn" disabled={title.trim().length < 4} onClick={save}>Create thread</button>
    </Modal>
  );
}

export function ChatArchive() {
  const { room = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());
  const day = params.get('day') ?? today;
  const { data, error, reload } = useApi<{ messages: Msg[]; game: GameItem | null; hasMore: boolean }>(`/chat/${room}/archive${room === 'lounge' ? `?day=${day}` : ''}`);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <div className="page-head">
        <div className="eyebrow">Chat archive</div>
        <h1>{room === 'lounge' ? 'Aggie Lounge' : data.game ? `NM State ${data.game.home_away === 'away' ? 'at' : 'vs.'} ${data.game.opponent}` : 'Game chat'}</h1>
        {data.game && <Link to={`/games/${data.game.id}`} className="small">Back to the game page</Link>}
      </div>
      {room === 'lounge' && (
        <div className="row"><label className="label" htmlFor="day">Day</label><input id="day" type="date" className="input" style={{ width: 'auto' }} value={day} max={today} onChange={(e) => setParams({ day: e.target.value })} /></div>
      )}
      <section className="card card-pad">
        {data.messages.length ? data.messages.map((m) => (
          <div key={m.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <span className="small"><strong>{m.display_name || m.username}</strong> <span className="muted tiny">{fullTime(m.created_at)}</span></span>
            <PostBody text={m.body} />
          </div>
        )) : <div className="empty">No messages {room === 'lounge' ? 'that day' : 'in this game chat'}.</div>}
        {data.hasMore && <div className="small muted">Showing the first 1,000 messages.</div>}
      </section>
    </div>
  );
}

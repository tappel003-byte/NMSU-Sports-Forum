import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardPaste } from 'lucide-react';
import { api } from '../api';
import { useApi, useApp } from '../state';
import { LinkPreview } from '../format';
import { Modal, type ThreadItem } from './ui';
import { TAGS } from '../../shared/forum';
import { parseTweetUrl } from '../../shared/forum';

export type ShareTarget = { kind: 'thread'; id: number; title: string } | { kind: 'player'; id: number; name: string } | null;

/** The fastest way to bring a tweet (or any link) into the forum: paste, comment, post. */
export function ShareForm({ initialUrl = '', initialText = '', target = null, onDone }: { initialUrl?: string; initialText?: string; target?: ShareTarget; onDone?: () => void }) {
  const nav = useNavigate();
  const { toast } = useApp();
  const [url, setUrl] = useState(initialUrl);
  const [comment, setComment] = useState(initialText);
  const [dest, setDest] = useState<'existing' | 'new'>(target ? 'existing' : 'new');
  const [threadId, setThreadId] = useState<number | ''>(target?.kind === 'thread' ? target.id : '');
  const [forum, setForum] = useState('');
  const [title, setTitle] = useState('');
  const [tag, setTag] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: forums } = useApi<{ forums: { slug: string; name: string; sport_label: string }[] }>(target ? null : '/forums');
  const { data: recent } = useApi<{ threads: ThreadItem[] }>(target ? null : '/feed?tab=latest&games=1');
  const validUrl = /^https?:\/\/\S+$/.test(url.trim());
  const isTweet = Boolean(parseTweetUrl(url.trim()));

  useEffect(() => { if (isTweet && !tag) setTag('recruiting'); }, [isTweet, tag]);

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      const found = text.match(/https?:\/\/\S+/)?.[0];
      if (found) setUrl(found);
      else setError('No link found on your clipboard. Copy the tweet link first (Share → Copy link in the X app).');
    } catch {
      setError('Your browser blocked clipboard access. Press and hold in the link box and choose Paste.');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const link = url.trim();
    const body = comment.trim() ? `${comment.trim()}\n\n${link}` : link;
    try {
      if (target?.kind === 'player') {
        const r = await api<{ thread_id: number; post_id: number }>(`/players/${target.id}/news`, { body: { url: link, note: comment.trim() || null } });
        toast(`Shared to ${target.name}'s card`);
        onDone?.();
        nav(`/t/${r.thread_id}?post=${r.post_id}`);
      } else if (dest === 'existing' && threadId) {
        const r = await api<{ id: number; pending: boolean }>(`/threads/${threadId}/posts`, { body: { body } });
        toast(r.pending ? 'Posted — waiting for admin approval' : 'Shared');
        onDone?.();
        nav(`/t/${threadId}?post=${r.id}`);
      } else {
        const r = await api<{ id: number }>('/threads', { body: { forum, title, description: isTweet ? 'Shared from X' : 'Shared link', body, tags: tag ? [tag] : [] } });
        toast('Shared');
        onDone?.();
        nav(`/t/${r.id}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="share-url">Tweet or link</label>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input id="share-url" className="input grow" type="url" inputMode="url" placeholder="https://x.com/…/status/…" value={url} onChange={(e) => setUrl(e.target.value)} required />
          <button type="button" className="btn secondary" onClick={paste}><ClipboardPaste size={16} /> Paste</button>
        </div>
        <span className="hint">In the X app: tap Share → Copy link, then tap Paste here.</span>
      </div>
      {validUrl && <LinkPreview url={url.trim()} />}
      <div className="field"><label htmlFor="share-comment">Your comment (optional)</label><textarea id="share-comment" className="textarea" style={{ minHeight: 80 }} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
      {target ? (
        <p className="small muted">Posting to <strong>{target.kind === 'player' ? `${target.name}'s player card and discussion` : target.title}</strong>.</p>
      ) : (
        <>
          <div className="row" role="radiogroup" aria-label="Where to post" style={{ marginBottom: 10 }}>
            <button type="button" role="radio" aria-checked={dest === 'new'} className={`btn small ${dest === 'new' ? '' : 'secondary'}`} onClick={() => setDest('new')}>New discussion</button>
            <button type="button" role="radio" aria-checked={dest === 'existing'} className={`btn small ${dest === 'existing' ? '' : 'secondary'}`} onClick={() => setDest('existing')}>Add to a discussion</button>
          </div>
          {dest === 'existing' ? (
            <div className="field">
              <label htmlFor="share-thread">Discussion</label>
              <select id="share-thread" className="select" value={threadId} onChange={(e) => setThreadId(Number(e.target.value) || '')} required>
                <option value="">Choose a recent discussion…</option>
                {recent?.threads.map((t) => <option key={t.id} value={t.id}>{t.title} — {t.forum.name}</option>)}
              </select>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="share-forum">Forum</label>
                <select id="share-forum" className="select" value={forum} onChange={(e) => setForum(e.target.value)} required>
                  <option value="">Choose a forum…</option>
                  {forums?.forums.map((f) => <option key={f.slug} value={f.slug}>{f.name} — {f.sport_label}</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor="share-title">Title</label><input id="share-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={4} maxLength={140} placeholder={isTweet ? 'e.g. 3-star WR commits to NM State' : ''} /></div>
              <div className="field">
                <label htmlFor="share-tag">Tag</label>
                <select id="share-tag" className="select" value={tag} onChange={(e) => setTag(e.target.value)}>
                  <option value="">None</option>
                  {Object.entries(TAGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </>
          )}
        </>
      )}
      {error && <div className="error-box" style={{ marginBottom: 10 }}>{error}</div>}
      <button className="btn block" disabled={busy || !validUrl}>{busy ? 'Sharing…' : 'Share'}</button>
    </form>
  );
}

export function ShareModal({ onClose, target = null, initialUrl }: { onClose: () => void; target?: ShareTarget; initialUrl?: string }) {
  return (
    <Modal title={target?.kind === 'player' ? 'Share news about this player' : 'Share a tweet or link'} onClose={onClose}>
      <ShareForm target={target} onDone={onClose} initialUrl={initialUrl} />
    </Modal>
  );
}

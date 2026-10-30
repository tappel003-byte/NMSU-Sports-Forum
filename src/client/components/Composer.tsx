import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Send, X } from 'lucide-react';
import { api, uploadImage } from '../api';

export interface QuoteRef { id: number; username: string; body: string }

/** Text box with server-side autosaved drafts and photo attachments. */
export function useDraft(key: string) {
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const loaded = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    loaded.current = false;
    api<{ draft: { title: string | null; body: string } | null }>(`/drafts/${encodeURIComponent(key)}`)
      .then((r) => {
        if (r.draft) { setBody(r.draft.body); setTitle(r.draft.title ?? ''); setStatus('saved'); }
      })
      .catch(() => {})
      .finally(() => { loaded.current = true; });
  }, [key]);

  const save = (nextBody: string, nextTitle: string) => {
    if (!loaded.current) return;
    window.clearTimeout(timer.current);
    setStatus('saving');
    timer.current = window.setTimeout(() => {
      api(`/drafts/${encodeURIComponent(key)}`, { method: 'PUT', body: { body: nextBody, title: nextTitle } })
        .then(() => setStatus('saved'))
        .catch(() => setStatus('idle'));
    }, 900);
  };

  return {
    body, title, status,
    setBody: (v: string) => { setBody(v); save(v, title); },
    setTitle: (v: string) => { setTitle(v); save(body, v); },
    clear: () => { window.clearTimeout(timer.current); setBody(''); setTitle(''); setStatus('idle'); },
  };
}

export function PhotoPicker({ photos, setPhotos, onError }: { photos: { id: string; url: string }[]; setPhotos: (p: { id: string; url: string }[]) => void; onError: (m: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const added: { id: string; url: string }[] = [];
    try {
      for (const f of Array.from(files).slice(0, 6 - photos.length)) {
        const r = await uploadImage(f, 'post');
        added.push({ id: r.id, url: URL.createObjectURL(f) });
      }
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setPhotos([...photos, ...added]);
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={(e) => pick(e.target.files)} />
      <button type="button" className="btn secondary small" disabled={busy || photos.length >= 6} onClick={() => input.current?.click()}>
        <ImagePlus size={16} /> {busy ? 'Uploading…' : 'Photo'}
      </button>
    </>
  );
}

export function PhotoThumbs({ photos, setPhotos }: { photos: { id: string; url: string }[]; setPhotos: (p: { id: string; url: string }[]) => void }) {
  if (!photos.length) return null;
  return (
    <>
      <div className="thumbs">
        {photos.map((p) => (
          <div key={p.id} className="thumb">
            <img src={p.url} alt="Attached photo" />
            <button type="button" aria-label="Remove photo" onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))}><X size={14} /></button>
          </div>
        ))}
      </div>
      <div className="tiny muted" style={{ marginTop: 4 }}>Discussion photos are automatically deleted 90 days after upload.</div>
    </>
  );
}

export function ReplyComposer({ threadId, quote, clearQuote, onPosted }: { threadId: number; quote: QuoteRef | null; clearQuote: () => void; onPosted: (postId: number) => void }) {
  const draftKey = `reply-${threadId}`;
  const draft = useDraft(draftKey);
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (quote) area.current?.focus(); }, [quote]);

  const submit = async () => {
    if (!draft.body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: number }>(`/threads/${threadId}/posts`, { body: { body: draft.body, quote_post_id: quote?.id ?? null, attachments: photos.map((p) => p.id), draft_key: draftKey } });
      draft.clear();
      setPhotos([]);
      clearQuote();
      onPosted(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer" id="reply">
      {quote && (
        <div className="quote-embed spread">
          <div className="grow"><div className="who">Quoting {quote.username}</div><div className="small">{quote.body.slice(0, 160)}{quote.body.length > 160 ? '…' : ''}</div></div>
          <button className="btn ghost small" onClick={clearQuote}>Remove</button>
        </div>
      )}
      <label className="sr-only" htmlFor="reply-box">Your reply</label>
      <textarea id="reply-box" ref={area} className="textarea" placeholder="Write a reply… use @username to mention someone" value={draft.body}
        onChange={(e) => draft.setBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }} />
      <PhotoThumbs photos={photos} setPhotos={setPhotos} />
      {error && <div className="error-box" style={{ marginTop: 8 }}>{error}</div>}
      <div className="composer-tools">
        <PhotoPicker photos={photos} setPhotos={setPhotos} onError={setError} />
        <span className="tiny muted grow">{draft.status === 'saving' ? 'Saving draft…' : draft.status === 'saved' && draft.body ? 'Draft saved' : ''}</span>
        <button className="btn" disabled={busy || !draft.body.trim()} onClick={submit}><Send size={16} /> {busy ? 'Posting…' : 'Post reply'}</button>
      </div>
    </div>
  );
}

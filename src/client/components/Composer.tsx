import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ClipboardPaste, EyeOff, ImagePlus, Send, X } from 'lucide-react';
import type React from 'react';
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

/** Textarea with @mention suggestions while typing. */
export function MentionTextarea({ value, onChange, textareaRef, ...rest }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & { value: string; onChange: (v: string) => void; textareaRef?: React.RefObject<HTMLTextAreaElement | null> }) {
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? own;
  const [list, setList] = useState<{ id: number; username: string; display_name: string | null }[]>([]);
  const [active, setActive] = useState(0);
  const query = useRef<string | null>(null);
  const pendingCaret = useRef<number | null>(null);
  // Place the caret right after an inserted mention once the new value has rendered (before any further typing).
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    ref.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [value, ref]);

  const check = (text: string, caret: number) => {
    const m = text.slice(0, caret).match(/(^|\s)@([A-Za-z0-9_]{1,24})$/);
    if (!m) { query.current = null; setList([]); return; }
    query.current = m[2];
    api<{ members: { id: number; username: string; display_name: string | null }[] }>(`/members/suggest?q=${encodeURIComponent(m[2])}`)
      .then((r) => { if (query.current === m[2]) { setList(r.members); setActive(0); } })
      .catch(() => {});
  };
  const pick = (username: string) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([A-Za-z0-9_]{1,24})$/, `@${username} `);
    const next = before + value.slice(caret);
    pendingCaret.current = before.length;
    onChange(next);
    setList([]);
    query.current = null;
    el?.focus();
  };
  return (
    <div className="mention-box">
      {list.length > 0 && (
        <div className="mention-list" role="listbox" aria-label="Mention a member">
          {list.map((m, i) => (
            <button key={m.id} type="button" role="option" aria-selected={i === active} className={i === active ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); pick(m.username); }}>
              <strong>@{m.username}</strong>{m.display_name && <span className="small muted">{m.display_name}</span>}
            </button>
          ))}
        </div>
      )}
      <textarea {...rest} ref={ref} value={value}
        onChange={(e) => { onChange(e.target.value); check(e.target.value, e.target.selectionStart); }}
        onKeyDown={(e) => {
          if (list.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % list.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + list.length) % list.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(list[active].username); return; }
            if (e.key === 'Escape') { setList([]); return; }
          }
          rest.onKeyDown?.(e);
        }} />
    </div>
  );
}

/** Formatting helpers under a text box: spoiler and paste-a-link. */
export function ComposerTools({ value, onChange, textareaRef, onError }: { value: string; onChange: (v: string) => void; textareaRef: React.RefObject<HTMLTextAreaElement | null>; onError: (m: string) => void }) {
  const insert = (fn: (sel: string) => string) => {
    const el = textareaRef.current;
    const a = el?.selectionStart ?? value.length;
    const b = el?.selectionEnd ?? value.length;
    const text = fn(value.slice(a, b));
    const next = value.slice(0, a) + text + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + text.length, a + text.length); });
  };
  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return onError('Your clipboard is empty. Copy a link first.');
      insert(() => `${value && !/\s$/.test(value) ? '\n' : ''}${text}\n`);
    } catch {
      onError('Your browser blocked clipboard access. Press and hold in the box and choose Paste instead.');
    }
  };
  return (
    <>
      <button type="button" className="btn secondary small" onClick={paste} title="Paste a tweet or link you copied"><ClipboardPaste size={16} /> Paste link</button>
      <button type="button" className="btn secondary small" onClick={() => insert((sel) => `||${sel || 'spoiler'}||`)} title="Hide text until tapped"><EyeOff size={16} /> Spoiler</button>
    </>
  );
}

export function ReplyComposer({ threadId, quote, clearQuote, onPosted, open, setOpen }: { threadId: number; quote: QuoteRef | null; clearQuote: () => void; onPosted: (postId: number, pending: boolean) => void; open: boolean; setOpen: (v: boolean) => void }) {
  const draftKey = `reply-${threadId}`;
  const draft = useDraft(draftKey);
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (quote) { setOpen(true); area.current?.focus(); } }, [quote, setOpen]);
  useEffect(() => { if (open) requestAnimationFrame(() => area.current?.focus({ preventScroll: true })); }, [open]);

  const submit = async () => {
    if (!draft.body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: number; pending: boolean }>(`/threads/${threadId}/posts`, { body: { body: draft.body, quote_post_id: quote?.id ?? null, attachments: photos.map((p) => p.id), draft_key: draftKey } });
      draft.clear();
      setPhotos([]);
      clearQuote();
      setOpen(false);
      onPosted(r.id, r.pending);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`reply-area ${open ? 'open' : ''}`}>
      <div className="dock-bar">
        <button type="button" className="fake-input" onClick={() => setOpen(true)}>{draft.body ? `Draft: ${draft.body.slice(0, 40)}…` : 'Write a reply…'}</button>
      </div>
      <div className="composer" id="reply">
        <div className="spread phone-only" style={{ marginBottom: 8 }}>
          <strong>Reply</strong>
          <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>Close</button>
        </div>
        {quote && (
          <div className="quote-embed spread">
            <div className="grow"><div className="who">Quoting {quote.username}</div><div className="small">{quote.body.slice(0, 160)}{quote.body.length > 160 ? '…' : ''}</div></div>
            <button className="btn ghost small" onClick={clearQuote}>Remove</button>
          </div>
        )}
        <label className="sr-only" htmlFor="reply-box">Your reply</label>
        <MentionTextarea id="reply-box" textareaRef={area} className="textarea" placeholder="Write a reply… @ to mention, paste a tweet link to share it" value={draft.body}
          onChange={draft.setBody} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }} />
        <PhotoThumbs photos={photos} setPhotos={setPhotos} />
        {error && <div className="error-box" style={{ marginTop: 8 }}>{error}</div>}
        <div className="composer-tools">
          <PhotoPicker photos={photos} setPhotos={setPhotos} onError={setError} />
          <ComposerTools value={draft.body} onChange={draft.setBody} textareaRef={area} onError={setError} />
          <span className="tiny muted grow">{draft.status === 'saving' ? 'Saving draft…' : draft.status === 'saved' && draft.body ? 'Draft saved' : ''}</span>
          <button className="btn" disabled={busy || !draft.body.trim()} onClick={submit}><Send size={16} /> {busy ? 'Posting…' : 'Post reply'}</button>
        </div>
      </div>
    </div>
  );
}

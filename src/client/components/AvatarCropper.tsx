import { useEffect, useRef, useState } from 'react';
import { Modal } from './ui';

const OUT = 512;
const MAX_ZOOM = 4;

/**
 * Profile photo cropper: drag to move, pinch or use the slider to zoom, and the circle shows exactly
 * what will appear on the profile. Saves a 512×512 JPEG.
 */
export function AvatarCropper({ file, onCancel, onSave }: { file: File; onCancel: () => void; onSave: (blob: Blob) => Promise<void> | void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const size = Math.min(300, (typeof window !== 'undefined' ? window.innerWidth : 360) - 72);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => setImg(el);
    el.onerror = () => setError("That photo couldn't be opened. Try a different one.");
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // The photo always covers the circle: at zoom 1 its shorter side fits the circle exactly.
  const base = img ? Math.max(size / img.naturalWidth, size / img.naturalHeight) : 1;
  const dw = img ? img.naturalWidth * base * zoom : size;
  const dh = img ? img.naturalHeight * base * zoom : size;
  const clamp = (p: { x: number; y: number }, w = dw, h = dh) => ({
    x: Math.max(-(w - size) / 2, Math.min((w - size) / 2, p.x)),
    y: Math.max(-(h - size) / 2, Math.min((h - size) / 2, p.y)),
  });
  const setZoomClamped = (z: number) => {
    const nz = Math.max(1, Math.min(MAX_ZOOM, z));
    setZoom(nz);
    if (img) setPos((p) => clamp(p, img.naturalWidth * base * nz, img.naturalHeight * base * nz));
  };

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      setZoomClamped(pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist));
    } else if (pointers.current.size === 1) {
      setPos((p) => clamp({ x: p.x + e.clientX - prev.x, y: p.y + e.clientY - prev.y }));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const save = async () => {
    if (!img) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUT;
      canvas.height = OUT;
      const k = OUT / size;
      const left = (size - dw) / 2 + pos.x;
      const top = (size - dh) / 2 + pos.y;
      canvas.getContext('2d')!.drawImage(img, left * k, top * k, dw * k, dh * k);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
      if (!blob) throw new Error("Couldn't prepare the photo.");
      await onSave(blob);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Position your photo" onClose={onCancel}>
      <p className="small muted" style={{ marginTop: 0 }}>Drag to move. Pinch or use the slider to zoom. The circle is what shows on your profile.</p>
      <div className="crop-stage" style={{ width: size, height: size }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onWheel={(e) => setZoomClamped(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))} aria-label="Photo position: drag to move">
        {img && <img src={img.src} alt="" draggable={false} style={{ width: dw, height: dh, left: (size - dw) / 2 + pos.x, top: (size - dh) / 2 + pos.y }} />}
        <div className="crop-ring" aria-hidden="true" />
      </div>
      <label className="crop-zoom">
        <span aria-hidden="true">−</span>
        <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => setZoomClamped(Number(e.target.value))} aria-label="Zoom" />
        <span aria-hidden="true">+</span>
      </label>
      {error && <div className="error-box" style={{ marginTop: 8 }}>{error}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={save} disabled={!img || busy}>{busy ? 'Saving…' : 'Save photo'}</button>
        <button className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </Modal>
  );
}

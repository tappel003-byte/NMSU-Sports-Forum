import { useEffect, useRef, useState } from 'react';

/** Pull down at the top of the page to refresh. Installed home-screen apps have no browser refresh button. */
export function PullToRefresh() {
  const [state, setState] = useState<'idle' | 'pull' | 'ready' | 'refreshing'>('idle');
  const start = useRef<number | null>(null);
  useEffect(() => {
    const onStart = (e: TouchEvent) => { start.current = window.scrollY <= 0 ? e.touches[0].clientY : null; };
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return;
      const d = e.touches[0].clientY - start.current;
      if (d > 20) setState(d > 80 ? 'ready' : 'pull');
      else setState('idle');
    };
    const onEnd = () => {
      setState((s) => {
        if (s === 'ready') {
          window.dispatchEvent(new Event('nsf:refresh'));
          window.setTimeout(() => setState('idle'), 900);
          return 'refreshing';
        }
        return 'idle';
      });
      start.current = null;
    };
    const onVisible = () => { if (document.visibilityState === 'visible') window.dispatchEvent(new Event('nsf:refresh')); };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  if (state === 'idle') return null;
  return <div className="ptr" role="status">{state === 'pull' ? '↓ Pull to refresh' : state === 'ready' ? '↻ Release to refresh' : 'Refreshing…'}</div>;
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider } from './state';
import { App } from './App';
import './styles.css';

// After a new release, a page opened earlier can ask for code files that no longer exist (the map, for example).
// Reload once to pick up the current release; the timestamp guard prevents a reload loop.
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('nsf-reloaded') || 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem('nsf-reloaded', String(Date.now()));
  } catch { /* storage unavailable: still reload once */ }
  e.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);

// A phone can keep the site open for days (especially from the home screen), still running an old release.
// When the site comes back to the screen, or every 10 minutes, check whether a newer release is live and,
// unless someone is typing, reload to it. Drafts are saved, so nothing is lost.
function currentBuild(doc: Document | string): string | null {
  const html = typeof doc === 'string' ? doc : doc.documentElement.outerHTML;
  return html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null;
}
if (import.meta.env.PROD) {
  const mine = currentBuild(document);
  let checking = false;
  const check = async () => {
    if (!mine || checking || document.visibilityState !== 'visible') return;
    checking = true;
    try {
      const res = await fetch('/', { cache: 'no-store', credentials: 'same-origin' });
      const live = res.ok ? currentBuild(await res.text()) : null;
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement | null)?.isContentEditable;
      if (live && live !== mine && !typing) window.location.reload();
    } catch { /* offline: try again later */ } finally { checking = false; }
  };
  document.addEventListener('visibilitychange', () => { void check(); });
  window.setInterval(() => { void check(); }, 10 * 60_000);
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

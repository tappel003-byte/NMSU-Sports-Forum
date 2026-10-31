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

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

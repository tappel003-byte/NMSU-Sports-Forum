import { ExternalLink, Radio } from 'lucide-react';
import { useApi, useApp } from '../state';
import { ErrorState, Loading } from '../components/ui';
import { Link } from 'react-router-dom';

export interface HubData {
  sports: { key: string; label: string; icon: string; roster_url: string; schedule_url: string }[];
  links: { label: string; url: string }[];
}

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;

export function Rosters() {
  const { me } = useApp();
  const { data, error, reload } = useApi<HubData>('/hub');
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <div className="page-head">
        <div className="eyebrow">One place for everything Aggie</div>
        <h1>Rosters &amp; links</h1>
        <div className="muted small">Rosters and schedules open on the official athletics site, so they're always current.</div>
      </div>
      <section className="card">
        <div className="section-head"><h2>Rosters</h2></div>
        <ul className="hub-list">
          {data.sports.map((s) => (
            <li key={s.key}>
              <span aria-hidden="true">{s.icon}</span>
              <strong className="grow">{s.label}</strong>
              <a href={s.roster_url} {...ext} className="btn small">Roster <ExternalLink size={14} /></a>
              <a href={s.schedule_url} {...ext} className="btn secondary small">Schedule</a>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <div className="section-head"><h2><Radio size={18} /> Radio, streams &amp; more</h2></div>
        {data.links.length ? (
          <ul className="hub-list">
            {data.links.map((l) => (
              <li key={l.url + l.label}><a href={l.url} {...ext} className="grow">{l.label} <ExternalLink size={14} /></a></li>
            ))}
          </ul>
        ) : (
          <div className="empty">No links yet.{me?.role === 'admin' && <> Add radio feeds and other links in <Link to="/admin/settings">Admin → Settings</Link>.</>}</div>
        )}
        <p className="tiny muted" style={{ padding: '0 16px 12px' }}>Each game's radio and TV also appear on its Game Center page when the official schedule lists them.</p>
      </section>
    </div>
  );
}

import { Hono } from 'hono';
import { isModerator } from '../auth';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { all, first, logMod, run } from '../db';
import { HttpError, now, parse } from '../util';
import { SPORT_BY_KEY } from '../../shared/sports';
import { memberSummaries } from '../lib/members';
import { getPreview } from '../lib/previews';
import { addPlayerNews, ensurePlayerThread, recruitingStatus, syncRecruiting } from '../lib/recruiting';

export const recruiting = new Hono<AppEnv>();

const STATUSES = ['tracking', 'offered', 'visiting', 'committed', 'signed', 'enrolled', 'decommitted', 'committed_elsewhere', 'in_portal', 'transferred'] as const;

recruiting.get('/players', async (c) => {
  const kind = c.req.query('kind');
  const sport = c.req.query('sport');
  const year = Number(c.req.query('year')) || null;
  let where = 'p.removed = 0';
  const params: (string | number)[] = [];
  if (kind === 'recruit') where += " AND p.kind = 'recruit'";
  else if (kind === 'portal') where += " AND p.kind IN ('transfer_in', 'transfer_out')";
  if (sport && sport in SPORT_BY_KEY) { where += ' AND p.sport = ?'; params.push(sport); }
  if (year) { where += ' AND p.class_year = ?'; params.push(year); }
  const rows = await all(c.env,
    `SELECT p.*, (SELECT COUNT(*) FROM player_news n WHERE n.player_id = p.id) AS news,
            (SELECT COUNT(*) FROM player_predictions x WHERE x.player_id = p.id AND x.pick = 'yes') AS yes,
            (SELECT COUNT(*) FROM player_predictions x WHERE x.player_id = p.id) AS predictions
       FROM players p WHERE ${where} ORDER BY p.updated_at DESC LIMIT 300`, ...params);
  const status = await recruitingStatus(c.env);
  return c.json({ players: rows, sync: { configured: Boolean(c.env.CFBD_API_KEY), ...status } });
});

recruiting.get('/players/:id', async (c) => {
  const user = c.get('user');
  const p = await first<Record<string, unknown> & { id: number; created_by: number | null; source_url: string | null }>(c.env, 'SELECT * FROM players WHERE id = ? AND removed = 0', Number(c.req.param('id')));
  if (!p) throw new HttpError(404, 'Player not found.');
  const news = await all<{ id: number; user_id: number; url: string; note: string | null; post_id: number | null; created_at: number }>(c.env,
    'SELECT n.* FROM player_news n LEFT JOIN posts ps ON ps.id = n.post_id WHERE n.player_id = ? AND (ps.id IS NULL OR ps.deleted = 0) ORDER BY n.id DESC LIMIT 100', p.id);
  const preds = await all<{ user_id: number; pick: string }>(c.env, 'SELECT user_id, pick FROM player_predictions WHERE player_id = ?', p.id);
  const members = await memberSummaries(c.env, [...news.map((n) => n.user_id), p.created_by]);
  return c.json({
    player: { ...p, added_by: p.created_by ? members.get(p.created_by)?.username ?? null : null },
    news: news.map((n) => ({ ...n, username: members.get(n.user_id)?.username ?? 'member' })),
    predictions: { yes: preds.filter((x) => x.pick === 'yes').length, no: preds.filter((x) => x.pick === 'no').length, mine: preds.find((x) => x.user_id === user.id)?.pick ?? null },
    can_edit: isModerator(user) || p.created_by === user.id,
  });
});

const sourceUrl = z.string().url('add a link to where this news came from').max(500).refine((u) => /^https?:\/\//.test(u), 'must be a web link');

recruiting.post('/players', async (c) => {
  const user = c.get('user');
  const body = parse(z.object({
    sport: z.string().refine((s) => s in SPORT_BY_KEY, 'choose a sport'),
    kind: z.enum(['recruit', 'transfer_in', 'transfer_out']),
    name: z.string().trim().min(3).max(80),
    position: z.string().trim().max(20).optional().nullable(),
    class_year: z.number().int().min(2000).max(2040).optional().nullable(),
    school: z.string().trim().max(120).optional().nullable(),
    hometown: z.string().trim().max(120).optional().nullable(),
    status: z.enum(STATUSES).default('tracking'),
    other_school: z.string().trim().max(120).optional().nullable(),
    source_url: sourceUrl,
  }), await c.req.json());
  const dupe = await first<{ id: number }>(c.env, 'SELECT id FROM players WHERE removed = 0 AND sport = ? AND lower(name) = lower(?) AND kind = ?', body.sport, body.name, body.kind);
  if (dupe) throw new HttpError(409, `That player is already tracked. Open /recruiting/${dupe.id} to add news.`);
  const t = now();
  const r = await run(c.env, `INSERT INTO players (sport, kind, source, name, position, class_year, school, hometown, status, other_school, source_url, created_by, created_at, updated_at)
                              VALUES (?, ?, 'member', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    body.sport, body.kind, body.name, body.position ?? null, body.class_year ?? null, body.school ?? null, body.hometown ?? null, body.status, body.other_school ?? null, body.source_url, user.id, t, t);
  const id = r.meta.last_row_id;
  await addPlayerNews(c.env, user, id, body.source_url, null);
  return c.json({ id });
});

recruiting.patch('/players/:id', async (c) => {
  const user = c.get('user');
  const p = await first<{ id: number; created_by: number | null; source: string }>(c.env, 'SELECT id, created_by, source FROM players WHERE id = ? AND removed = 0', Number(c.req.param('id')));
  if (!p) throw new HttpError(404, 'Player not found.');
  if (!isModerator(user) && p.created_by !== user.id) throw new HttpError(403, 'Only the member who added this player or an admin can edit it.');
  const body = parse(z.object({ status: z.enum(STATUSES).optional(), other_school: z.string().trim().max(120).nullable().optional(), position: z.string().trim().max(20).nullable().optional(), removed: z.boolean().optional() }), await c.req.json());
  if (body.removed && !isModerator(user)) throw new HttpError(403, 'Only moderators can remove players.');
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(body)) { sets.push(`${k} = ?`); vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : (v ?? null)); }
  if (!sets.length) return c.json({ ok: true });
  await run(c.env, `UPDATE players SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...vals, now(), p.id);
  if (isModerator(user)) await logMod(c.env, user.id, body.removed ? 'remove_player' : 'edit_player', 'player', p.id, JSON.stringify(body));
  return c.json({ ok: true });
});

// Share a tweet or link about a player: posts into the player's thread and shows on the card.
recruiting.post('/players/:id/news', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (!(await first(c.env, 'SELECT id FROM players WHERE id = ? AND removed = 0', id))) throw new HttpError(404, 'Player not found.');
  const body = parse(z.object({ url: sourceUrl, note: z.string().trim().max(1000).optional().nullable() }), await c.req.json());
  const res = await addPlayerNews(c.env, user, id, body.url, body.note || null);
  c.executionCtx.waitUntil(getPreview(c.env, body.url).catch(() => null));
  return c.json(res);
});

recruiting.post('/players/:id/thread', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await first(c.env, 'SELECT id FROM players WHERE id = ? AND removed = 0', id))) throw new HttpError(404, 'Player not found.');
  return c.json({ thread_id: await ensurePlayerThread(c.env, id) });
});

recruiting.post('/players/:id/predict', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const p = await first<{ status: string }>(c.env, 'SELECT status FROM players WHERE id = ? AND removed = 0', id);
  if (!p) throw new HttpError(404, 'Player not found.');
  if (['signed', 'enrolled', 'transferred'].includes(p.status)) throw new HttpError(400, 'This one is settled. Predictions are closed.');
  const { pick } = parse(z.object({ pick: z.enum(['yes', 'no']).nullable() }), await c.req.json());
  if (!pick) await run(c.env, 'DELETE FROM player_predictions WHERE player_id = ? AND user_id = ?', id, user.id);
  else await run(c.env, `INSERT INTO player_predictions (player_id, user_id, pick, created_at) VALUES (?, ?, ?, ?)
                         ON CONFLICT(player_id, user_id) DO UPDATE SET pick = excluded.pick, created_at = excluded.created_at`, id, user.id, pick, now());
  return c.json({ ok: true });
});

recruiting.post('/admin/recruiting/sync', async (c) => {
  if (c.get('user').role !== 'admin') throw new HttpError(403, 'Administrators only.');
  return c.json(await syncRecruiting(c.env));
});

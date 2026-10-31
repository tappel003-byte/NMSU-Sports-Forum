import { Hono } from 'hono';
import { isModerator } from '../auth';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { all, first, getSetting, logMod, notify, run, stmt, userPrefs } from '../db';
import { HttpError, now, parse } from '../util';
import { TAGS, cleanTags } from '../../shared/forum';
import { SPORT_BY_KEY } from '../../shared/sports';
import { starterPrompts } from '../lib/topics';
import { checkHonorary, memberSummaries } from '../lib/members';
import { notifyModerators, removePost } from '../lib/moderation';
import {
  PAGE_SIZE, THREAD_SELECT, assertWritable, createPost, isArchived, isUnread, loadThread, mutedSets, needsApproval, presentThreads, unreadBaseline, type ThreadRow,
} from '../lib/threads';

export const forum = new Hono<AppEnv>();

const idParam = (v: string | undefined) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid id.');
  return n;
};

// ---------- Forums ----------

forum.get('/forums', async (c) => {
  const user = c.get('user');
  const forums = await all<{ id: number; slug: string; name: string; sport_label: string; description: string; icon: string; sports: string; kind: string; archive_exempt: number }>(c.env,
    'SELECT id, slug, name, sport_label, description, icon, sports, kind, archive_exempt FROM forums ORDER BY sort');
  const baseline = unreadBaseline(user);
  const stats = await all<{ forum_id: number; threads: number; unread: number; last_post_at: number }>(c.env,
    `SELECT t.forum_id, COUNT(*) AS threads, MAX(t.last_post_at) AS last_post_at,
            SUM(CASE WHEN t.last_post_at > ? AND (tr.last_read_post_id IS NULL OR tr.last_read_post_id < t.last_post_id) THEN 1 ELSE 0 END) AS unread
       FROM threads t LEFT JOIN thread_reads tr ON tr.thread_id = t.id AND tr.user_id = ?
      WHERE t.deleted = 0 AND t.pending = 0 GROUP BY t.forum_id`, baseline, user.id);
  const muted = await mutedSets(c.env, user.id);
  const statMap = new Map(stats.map((s) => [s.forum_id, s]));
  return c.json({
    forums: forums.map((f) => ({
      ...f,
      sports: f.sports ? f.sports.split(',') : [],
      threads: statMap.get(f.id)?.threads ?? 0,
      unread: statMap.get(f.id)?.unread ?? 0,
      last_post_at: statMap.get(f.id)?.last_post_at ?? null,
      muted: muted.forums.has(f.id),
    })),
  });
});

forum.get('/forums/:slug', async (c) => {
  const user = c.get('user');
  const f = await first<{ id: number; slug: string; name: string; sport_label: string; description: string; icon: string; sports: string; kind: string }>(c.env,
    'SELECT id, slug, name, sport_label, description, icon, sports, kind FROM forums WHERE slug = ?', c.req.param('slug'));
  if (!f) throw new HttpError(404, 'Forum not found.');
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const sport = c.req.query('sport');
  const status = c.req.query('status');
  const muted = await mutedSets(c.env, user.id);
  let where = 't.forum_id = ? AND t.deleted = 0 AND (t.pending = 0 OR t.user_id = ?)';
  const params: (string | number)[] = [user.id, f.id, user.id];
  const tag = c.req.query('tag');
  if (tag && tag in TAGS) { where += " AND (',' || t.tags || ',') LIKE ?"; params.push(`%,${tag},%`); }
  if (sport) { where += ' AND t.sport = ?'; params.push(sport); }
  if (status) { where += ' AND t.suggestion_status = ?'; params.push(status); }
  const rows = await all<ThreadRow>(c.env, `${THREAD_SELECT} WHERE ${where} ORDER BY t.pinned DESC, t.last_post_at DESC LIMIT ? OFFSET ?`,
    ...params, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
  const visible = rows.filter((r) => !r.user_id || !muted.users.has(r.user_id));
  const sports = f.sports ? f.sports.split(',') : [];
  const games = sports.length
    ? await all(c.env, `SELECT * FROM games WHERE removed = 0 AND sport IN (${sports.map(() => '?').join(',')}) AND starts_at > ? ORDER BY starts_at LIMIT 5`, ...sports, now() - 6 * 3_600_000)
    : [];
  return c.json({
    forum: { ...f, sports, muted: muted.forums.has(f.id) },
    threads: await presentThreads(c.env, user, visible.slice(0, PAGE_SIZE)),
    hasMore: rows.length > PAGE_SIZE,
    games,
  });
});

// ---------- Feed ----------

forum.get('/feed', async (c) => {
  const user = c.get('user');
  const tab = c.req.query('tab') ?? 'latest';
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const muted = await mutedSets(c.env, user.id);
  const prefs = userPrefs(user.prefs);
  const params: (string | number)[] = [user.id, user.id];
  let where = 't.deleted = 0 AND (t.pending = 0 OR t.user_id = ?)';
  const tag = c.req.query('tag');
  if (tag && tag in TAGS) { where += " AND (',' || t.tags || ',') LIKE ?"; params.push(`%,${tag},%`); }
  // Automatic game threads are grouped under their game card instead of filling the main list.
  if ((tab === 'latest' || tab === 'popular') && c.req.query('games') !== '1') where += ' AND NOT (t.user_id IS NULL AND t.game_id IS NOT NULL)';
  let order = tab === 'latest' ? 't.pinned DESC, t.last_post_at DESC' : 't.last_post_at DESC';
  if (tab === 'following') {
    where += ' AND t.id IN (SELECT thread_id FROM follows WHERE user_id = ?)';
    params.push(user.id);
  } else if (tab === 'unread') {
    where += ' AND t.last_post_at > ? AND (tr.last_read_post_id IS NULL OR tr.last_read_post_id < t.last_post_id)';
    params.push(unreadBaseline(user));
  } else if (tab === 'mysports') {
    const sports = (Array.isArray(prefs.my_sports) ? prefs.my_sports : []).filter((s): s is string => typeof s === 'string' && s in SPORT_BY_KEY);
    const forums = [...new Set(sports.map((s) => SPORT_BY_KEY[s].forum))];
    if (!forums.length) return c.json({ threads: [], hasMore: false, needsSports: true });
    where += ` AND f.slug IN (${forums.map(() => '?').join(',')})`;
    params.push(...forums);
  } else if (tab === 'popular') {
    where += ' AND t.last_post_at > ?';
    params.push(now() - 14 * 86_400_000);
    order = 't.reply_count DESC, t.last_post_at DESC';
  }
  const rows = await all<ThreadRow>(c.env, `${THREAD_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
  const visible = rows.filter((r) => (!r.user_id || !muted.users.has(r.user_id)) && (tab === 'following' || !muted.forums.has(r.forum_id)));
  return c.json({ threads: await presentThreads(c.env, user, visible.slice(0, PAGE_SIZE)), hasMore: rows.length > PAGE_SIZE });
});

forum.post('/mark-all-read', async (c) => {
  await run(c.env, 'UPDATE users SET marked_read_at = ? WHERE id = ?', now(), c.get('user').id);
  return c.json({ ok: true });
});

// ---------- Threads ----------

const pollSchema = z.object({
  question: z.string().trim().min(3).max(200),
  options: z.array(z.string().trim().min(1).max(100)).min(2).max(10),
  closes_at: z.number().int().nullable().optional(),
});

forum.post('/threads', async (c) => {
  const user = c.get('user');
  const body = parse(z.object({
    forum: z.string().optional().nullable(),
    title: z.string().trim().min(4, 'needs at least 4 characters').max(140),
    description: z.string().trim().max(240).optional().default(''),
    body: z.string().trim().min(1, 'cannot be empty').max(20000),
    sport: z.string().optional().nullable(),
    attachments: z.array(z.string()).max(6).optional(),
    poll: pollSchema.optional().nullable(),
    game_id: z.number().int().optional().nullable(),
    game_phase: z.enum(['pregame', 'postgame']).optional().nullable(),
    draft_key: z.string().max(80).optional(),
    tags: z.array(z.string()).max(3).optional(),
  }), await c.req.json());
  // A game thread takes its sport from the game and is linked as that game's pregame/postgame discussion.
  const game = body.game_id ? await first<{ id: number; sport: string; pregame_thread_id: number | null; postgame_thread_id: number | null; opponent: string; home_away: string }>(c.env,
    'SELECT id, sport, pregame_thread_id, postgame_thread_id, opponent, home_away FROM games WHERE id = ? AND removed = 0', body.game_id) : null;
  if (body.game_id && !game) throw new HttpError(400, 'That game is no longer on the schedule.');
  const phaseCol = game && body.game_phase ? (`${body.game_phase}_thread_id` as const) : null;
  if (game && phaseCol && game[phaseCol] && (await first(c.env, 'SELECT id FROM threads WHERE id = ? AND deleted = 0', game[phaseCol]))) {
    throw new HttpError(409, `There's already a ${body.game_phase} thread for this game. Join that one instead.`);
  }
  const forumSlug = game ? SPORT_BY_KEY[game.sport]?.forum ?? 'other-sports' : body.forum || 'general';
  const f = await first<{ id: number; sports: string; kind: string }>(c.env, 'SELECT id, sports, kind FROM forums WHERE slug = ?', forumSlug);
  if (!f) throw new HttpError(400, 'Choose a forum.');
  const sports = f.sports ? f.sports.split(',') : [];
  const sport = game ? game.sport : body.sport && sports.includes(body.sport) ? body.sport : sports.length === 1 ? sports[0] : null;
  const t = now();
  const pending = await needsApproval(c.env, user);
  const r = await run(c.env, `INSERT INTO threads (forum_id, user_id, title, description, sport, created_at, last_post_at, game_id, game_phase, tags, pending)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    f.id, user.id, body.title, body.description, sport, t, t, body.game_id ?? null, body.game_id ? body.game_phase ?? null : null, cleanTags(body.tags), pending ? 1 : 0);
  const threadId = r.meta.last_row_id;
  await createPost(c.env, user, { id: threadId, title: body.title, user_id: user.id }, body.body, { attachmentIds: body.attachments, isFirst: true, pending });
  if (body.poll) await createPoll(c.env, threadId, body.poll);
  if (game && phaseCol) {
    await run(c.env, `UPDATE games SET ${phaseCol} = ? WHERE id = ?`, threadId, game.id);
    // Postgame threads get the Player of the Game vote: members nominate players and vote for 48 hours.
    if (body.game_phase === 'postgame' && !body.poll) {
      await run(c.env, "INSERT INTO polls (thread_id, question, closes_at, created_at, allow_add, kind) VALUES (?, ?, ?, ?, 1, 'potg')",
        threadId, `Player of the Game: ${game.home_away === 'away' ? 'at' : 'vs.'} ${game.opponent}`, now() + 2 * 86_400_000, now());
    }
  }
  if (body.draft_key) await run(c.env, 'DELETE FROM drafts WHERE user_id = ? AND key = ?', user.id, body.draft_key);
  return c.json({ id: threadId, pending });
});

async function createPoll(env: AppEnv['Bindings'], threadId: number, poll: z.infer<typeof pollSchema>) {
  const r = await run(env, 'INSERT INTO polls (thread_id, question, closes_at, created_at) VALUES (?, ?, ?, ?)', threadId, poll.question, poll.closes_at ?? null, now());
  const pollId = r.meta.last_row_id;
  await env.DB.batch(poll.options.map((label, i) => stmt(env, 'INSERT INTO poll_options (poll_id, label, sort) VALUES (?, ?, ?)', pollId, label, i)));
}

forum.post('/threads/:id/poll', async (c) => {
  const user = c.get('user');
  const t = await loadThread(c.env, user, idParam(c.req.param('id')));
  if (t.user_id !== user.id && !isModerator(user)) throw new HttpError(403, 'Only the thread starter can add a poll.');
  if (await first(c.env, 'SELECT id FROM polls WHERE thread_id = ?', t.id)) throw new HttpError(409, 'This thread already has a poll.');
  await createPoll(c.env, t.id, parse(pollSchema, await c.req.json()));
  return c.json({ ok: true });
});

// 🎲 Random topic button on the new-post page: a suggestion from the conversation-starter list.
forum.get('/topics/random', async (c) => {
  const prompts = await starterPrompts(c.env);
  return c.json({ topic: prompts[Math.floor(Math.random() * prompts.length)] });
});

// View count (like Aggie Alert): counted once each time a member opens the discussion, not when paging or refreshing.
forum.post('/threads/:id/view', async (c) => {
  const t = await loadThread(c.env, c.get('user'), idParam(c.req.param('id')));
  await run(c.env, 'UPDATE threads SET view_count = view_count + 1 WHERE id = ?', t.id);
  return c.json({ ok: true });
});

forum.get('/threads/:id', async (c) => {
  const user = c.get('user');
  const t = await loadThread(c.env, user, idParam(c.req.param('id')));
  const muted = await mutedSets(c.env, user.id);
  const visibleSql = isModerator(user) ? '1 = 1' : `(pending = 0 OR user_id = ${Number(user.id)})`;
  const firstUnread = isUnread(t, user)
    ? (await first<{ id: number }>(c.env, `SELECT id FROM posts WHERE thread_id = ? AND id > ? AND ${visibleSql} ORDER BY id LIMIT 1`, t.id, t.last_read_post_id ?? 0))?.id ?? null
    : null;
  const total = (await first<{ n: number }>(c.env, `SELECT COUNT(*) AS n FROM posts WHERE thread_id = ? AND ${visibleSql}`, t.id))?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  let page = Number(c.req.query('page')) || 0;
  const target = Number(c.req.query('post')) || (c.req.query('unread') ? firstUnread : 0);
  if (!page && target) {
    const before = (await first<{ n: number }>(c.env, `SELECT COUNT(*) AS n FROM posts WHERE thread_id = ? AND id < ? AND ${visibleSql}`, t.id, target))?.n ?? 0;
    page = Math.floor(before / PAGE_SIZE) + 1;
  }
  page = Math.min(Math.max(page || 1, 1), pages);
  const posts = await all<{ id: number; user_id: number | null; body: string; quote_post_id: number | null; reply_to_post_id: number | null; created_at: number; edited_at: number | null; edit_count: number; deleted: number; pending: number; hidden: number }>(c.env,
    `SELECT id, user_id, body, quote_post_id, reply_to_post_id, created_at, edited_at, edit_count, deleted, pending, hidden FROM posts WHERE thread_id = ? AND ${visibleSql} ORDER BY id LIMIT ? OFFSET ?`,
    t.id, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const postIds = posts.map((p) => p.id);
  const ph = postIds.map(() => '?').join(',') || 'NULL';
  // Quoted posts and replied-to posts are looked up together.
  const quoteIds = [...new Set(posts.flatMap((p) => [p.quote_post_id, p.reply_to_post_id]).filter((x): x is number => Boolean(x)))];
  const [reactions, mine, attachments, bookmarks, quotes, poll, followed, game] = await Promise.all([
    all<{ post_id: number; up: number; down: number }>(c.env,
      `SELECT post_id, SUM(value = 1) AS up, SUM(value = -1) AS down FROM reactions WHERE post_id IN (${ph}) GROUP BY post_id`, ...postIds),
    all<{ post_id: number; value: number }>(c.env, `SELECT post_id, value FROM reactions WHERE user_id = ? AND post_id IN (${ph})`, user.id, ...postIds),
    all<{ id: string; post_id: number; content_type: string; expires_at: number | null; deleted: number }>(c.env,
      `SELECT id, post_id, content_type, expires_at, deleted FROM attachments WHERE post_id IN (${ph})`, ...postIds),
    all<{ post_id: number; remind_at: number | null }>(c.env, `SELECT post_id, remind_at FROM bookmarks WHERE user_id = ? AND post_id IN (${ph})`, user.id, ...postIds),
    quoteIds.length
      ? all<{ id: number; user_id: number | null; body: string; deleted: number; thread_id: number }>(c.env,
          `SELECT id, user_id, body, deleted, thread_id FROM posts WHERE id IN (${quoteIds.map(() => '?').join(',')})`, ...quoteIds)
      : Promise.resolve([]),
    pollFor(c.env, t.id, user.id),
    first(c.env, 'SELECT 1 AS f FROM follows WHERE user_id = ? AND thread_id = ?', user.id, t.id),
    t.game_id ? first(c.env, 'SELECT id, sport, opponent, starts_at, status, home_away FROM games WHERE id = ?', t.game_id) : Promise.resolve(null),
  ]);
  const members = await memberSummaries(c.env, [...posts.map((p) => p.user_id), ...quotes.map((q) => q.user_id), t.user_id]);
  const rMap = new Map(reactions.map((r) => [r.post_id, r]));
  const mineMap = new Map(mine.map((r) => [r.post_id, r.value]));
  const bmMap = new Map(bookmarks.map((b) => [b.post_id, b]));
  const qMap = new Map(quotes.map((q) => [q.id, q]));
  const archived = isArchived(t);
  const canReply = isModerator(user) || (user.role !== 'guest' && !t.locked && !archived && !t.deleted);
  // Mark read up to the last post shown.
  if (posts.length && user.role !== 'guest') {
    const lastShown = posts[posts.length - 1].id;
    c.executionCtx.waitUntil(run(c.env, `INSERT INTO thread_reads (user_id, thread_id, last_read_post_id) VALUES (?, ?, ?)
      ON CONFLICT(user_id, thread_id) DO UPDATE SET last_read_post_id = MAX(last_read_post_id, excluded.last_read_post_id)`, user.id, t.id, lastShown));
  }
  return c.json({
    thread: {
      id: t.id, title: t.title, description: t.description, sport: t.sport, created_at: t.created_at,
      forum: { slug: t.forum_slug, name: t.forum_name, sport_label: t.forum_sport_label, icon: t.forum_icon },
      user_id: t.user_id, pinned: Boolean(t.pinned), locked: Boolean(t.locked), archived, deleted: Boolean(t.deleted),
      reply_count: t.reply_count, followed: Boolean(followed), game, game_phase: t.game_phase, suggestion_status: t.suggestion_status,
      tags: t.tags ? t.tags.split(',') : [], pending: Boolean(t.pending), last_post_id: t.last_post_id,
      can_reply: canReply, first_unread_post_id: firstUnread,
    },
    page, pages,
    poll,
    posts: posts.map((p) => {
      const q = p.quote_post_id ? qMap.get(p.quote_post_id) : undefined;
      const author = p.user_id ? members.get(p.user_id) : undefined;
      return {
        id: p.id,
        author: author ?? null,
        // Posts hidden by troll flags stay visible to admins and their author only.
        body: p.deleted || (p.hidden && !isModerator(user) && p.user_id !== user.id) ? '' : p.body,
        hidden: Boolean(p.hidden),
        deleted: Boolean(p.deleted),
        pending: Boolean(p.pending),
        created_at: p.created_at,
        edited_at: p.edited_at,
        edit_count: p.edit_count,
        up: Number(rMap.get(p.id)?.up ?? 0),
        down: Number(rMap.get(p.id)?.down ?? 0),
        my_reaction: mineMap.get(p.id) ?? 0,
        bookmarked: bmMap.has(p.id),
        muted: Boolean(p.user_id && muted.users.has(p.user_id)),
        reply_to: p.reply_to_post_id && qMap.get(p.reply_to_post_id) ? { id: p.reply_to_post_id, username: (() => { const r = qMap.get(p.reply_to_post_id!)!; return r.user_id ? members.get(r.user_id)?.username ?? 'member' : 'NMSU Sports Forum'; })() } : null,
        quote: q ? { id: q.id, thread_id: q.thread_id, username: q.user_id ? members.get(q.user_id)?.username ?? 'member' : 'member', body: q.deleted ? '' : q.body.slice(0, 600), deleted: Boolean(q.deleted) } : null,
        attachments: p.hidden && !isModerator(user) && p.user_id !== user.id ? [] : attachments.filter((a) => a.post_id === p.id && !a.deleted).map((a) => ({ id: a.id, content_type: a.content_type, expires_at: a.expires_at })),
        expired_attachments: attachments.filter((a) => a.post_id === p.id && a.deleted).length,
        can_edit: !p.deleted && (isModerator(user) || (p.user_id === user.id && canReply)),
        can_flag: isModerator(user) || (user.role !== 'guest' && (Boolean(user.trusted) || !user.joined_open) && p.user_id !== user.id && !p.hidden),
      };
    }),
  });
});

async function pollFor(env: AppEnv['Bindings'], threadId: number, userId: number) {
  const poll = await first<{ id: number; question: string; closes_at: number | null; allow_add: number; kind: string | null }>(env, 'SELECT id, question, closes_at, allow_add, kind FROM polls WHERE thread_id = ?', threadId);
  if (!poll) return null;
  const options = await all<{ id: number; label: string; votes: number }>(env,
    `SELECT o.id, o.label, (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) AS votes FROM poll_options o WHERE o.poll_id = ? ORDER BY o.sort`, poll.id);
  const mine = await first<{ option_id: number }>(env, 'SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?', poll.id, userId);
  return { ...poll, closed: Boolean(poll.closes_at && poll.closes_at < now()), options, my_vote: mine?.option_id ?? null, total: options.reduce((s, o) => s + o.votes, 0) };
}

forum.patch('/threads/:id', async (c) => {
  const user = c.get('user');
  const t = await loadThread(c.env, user, idParam(c.req.param('id')));
  if (t.user_id !== user.id && !isModerator(user)) throw new HttpError(403, 'You can only edit your own discussions.');
  assertWritable(t, user);
  const body = parse(z.object({ title: z.string().trim().min(4).max(140), description: z.string().trim().max(240).optional().default(''), tags: z.array(z.string()).max(3).optional() }), await c.req.json());
  await run(c.env, 'UPDATE threads SET title = ?, description = ?, tags = COALESCE(?, tags) WHERE id = ?', body.title, body.description, body.tags ? cleanTags(body.tags) : null, t.id);
  return c.json({ ok: true });
});

// Cheap check used by live threads after a broadcast or when the app returns to the foreground.
forum.get('/threads/:id/latest', async (c) => {
  const user = c.get('user');
  const t = await loadThread(c.env, user, idParam(c.req.param('id')));
  const r = await first<{ n: number; last: number }>(c.env, `SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS last FROM posts WHERE thread_id = ? AND (pending = 0 OR user_id = ?)`, t.id, user.id);
  return c.json({ count: r?.n ?? 0, last_post_id: r?.last ?? 0, locked: Boolean(t.locked) });
});

forum.post('/threads/:id/read', async (c) => {
  const user = c.get('user');
  const { post_id } = parse(z.object({ post_id: z.number().int() }), await c.req.json());
  await run(c.env, `INSERT INTO thread_reads (user_id, thread_id, last_read_post_id) VALUES (?, ?, ?)
    ON CONFLICT(user_id, thread_id) DO UPDATE SET last_read_post_id = MAX(last_read_post_id, excluded.last_read_post_id)`, user.id, idParam(c.req.param('id')), post_id);
  return c.json({ ok: true });
});

forum.post('/threads/:id/follow', async (c) => {
  const user = c.get('user');
  const id = idParam(c.req.param('id'));
  await loadThread(c.env, user, id);
  const { follow } = parse(z.object({ follow: z.boolean() }), await c.req.json());
  if (follow) await run(c.env, 'INSERT OR IGNORE INTO follows (user_id, thread_id, created_at) VALUES (?, ?, ?)', user.id, id, now());
  else await run(c.env, 'DELETE FROM follows WHERE user_id = ? AND thread_id = ?', user.id, id);
  return c.json({ ok: true, followed: follow });
});

// ---------- Posts ----------

forum.post('/threads/:id/posts', async (c) => {
  const user = c.get('user');
  const t = await loadThread(c.env, user, idParam(c.req.param('id')));
  assertWritable(t, user);
  const body = parse(z.object({
    body: z.string().trim().min(1, 'cannot be empty').max(20000),
    quote_post_id: z.number().int().optional().nullable(),
    reply_to_post_id: z.number().int().optional().nullable(),
    attachments: z.array(z.string()).max(6).optional(),
    draft_key: z.string().max(80).optional(),
  }), await c.req.json());
  // A reply must point at a post in the same discussion.
  const replyTo = body.reply_to_post_id ? await first<{ id: number }>(c.env, 'SELECT id FROM posts WHERE id = ? AND thread_id = ? AND deleted = 0', body.reply_to_post_id, t.id) : null;
  if (body.quote_post_id && !(await first(c.env, 'SELECT id FROM posts WHERE id = ?', body.quote_post_id))) throw new HttpError(400, 'Quoted post not found.');
  const pending = await needsApproval(c.env, user);
  const id = await createPost(c.env, user, t, body.body, { quotePostId: body.quote_post_id, replyToPostId: replyTo?.id ?? null, attachmentIds: body.attachments, pending });
  if (body.draft_key) await run(c.env, 'DELETE FROM drafts WHERE user_id = ? AND key = ?', user.id, body.draft_key);
  return c.json({ id, pending });
});

async function loadPost(env: AppEnv['Bindings'], id: number) {
  const p = await first<{ id: number; thread_id: number; user_id: number | null; body: string; deleted: number }>(env, 'SELECT id, thread_id, user_id, body, deleted FROM posts WHERE id = ?', id);
  if (!p) throw new HttpError(404, 'Post not found.');
  return p;
}

forum.patch('/posts/:id', async (c) => {
  const user = c.get('user');
  const p = await loadPost(c.env, idParam(c.req.param('id')));
  if (p.deleted) throw new HttpError(400, 'This post was removed.');
  if (p.user_id !== user.id && !isModerator(user)) throw new HttpError(403, 'You can only edit your own posts.');
  assertWritable(await loadThread(c.env, user, p.thread_id), user);
  const { body } = parse(z.object({ body: z.string().trim().min(1).max(20000) }), await c.req.json());
  if (body === p.body) return c.json({ ok: true });
  const t = now();
  await c.env.DB.batch([
    stmt(c.env, 'INSERT INTO post_edits (post_id, editor_id, old_body, edited_at) VALUES (?, ?, ?, ?)', p.id, user.id, p.body, t),
    stmt(c.env, 'UPDATE posts SET body = ?, edited_at = ?, edit_count = edit_count + 1 WHERE id = ?', body, t, p.id),
  ]);
  return c.json({ ok: true });
});

forum.get('/posts/:id/history', async (c) => {
  const p = await loadPost(c.env, idParam(c.req.param('id')));
  await loadThread(c.env, c.get('user'), p.thread_id);
  const edits = await all<{ old_body: string; edited_at: number; editor: string }>(c.env,
    'SELECT e.old_body, e.edited_at, u.username AS editor FROM post_edits e LEFT JOIN users u ON u.id = e.editor_id WHERE e.post_id = ? ORDER BY e.id DESC', p.id);
  return c.json({ current: p.deleted ? '' : p.body, edits: p.deleted ? [] : edits });
});

forum.delete('/posts/:id', async (c) => {
  const user = c.get('user');
  const p = await loadPost(c.env, idParam(c.req.param('id')));
  if (p.user_id !== user.id && !isModerator(user)) throw new HttpError(403, 'You can only remove your own posts.');
  if (isModerator(user) && p.user_id !== user.id) {
    // Moderator removals carry a reason, are recorded, and can be appealed.
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'give a short reason (the member sees it)').max(500) }), await c.req.json().catch(() => ({})));
    await removePost(c.env, user.id, p.id, reason);
  } else {
    await run(c.env, 'UPDATE posts SET deleted = 1, deleted_by = ? WHERE id = ?', user.id, p.id);
  }
  return c.json({ ok: true });
});

forum.post('/posts/:id/react', async (c) => {
  const user = c.get('user');
  const p = await loadPost(c.env, idParam(c.req.param('id')));
  if (p.deleted) throw new HttpError(400, 'This post was removed.');
  if (p.user_id === user.id) throw new HttpError(400, "You can't react to your own post.");
  await loadThread(c.env, user, p.thread_id);
  const { value } = parse(z.object({ value: z.union([z.literal(1), z.literal(-1), z.literal(0)]) }), await c.req.json());
  if (value === 0) await run(c.env, 'DELETE FROM reactions WHERE post_id = ? AND user_id = ?', p.id, user.id);
  else await run(c.env, `INSERT INTO reactions (post_id, user_id, value, created_at) VALUES (?, ?, ?, ?)
                         ON CONFLICT(post_id, user_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`, p.id, user.id, value, now());
  if (value === 1 && p.user_id) c.executionCtx.waitUntil(checkHonorary(c.env, p.user_id));
  const r = await first<{ up: number; down: number }>(c.env, 'SELECT COALESCE(SUM(value = 1), 0) AS up, COALESCE(SUM(value = -1), 0) AS down FROM reactions WHERE post_id = ?', p.id);
  return c.json({ up: Number(r?.up ?? 0), down: Number(r?.down ?? 0), my_reaction: value });
});

forum.post('/posts/:id/report', async (c) => {
  const user = c.get('user');
  const p = await loadPost(c.env, idParam(c.req.param('id')));
  await loadThread(c.env, user, p.thread_id);
  const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'tell the admins what is wrong').max(500) }), await c.req.json());
  await run(c.env, 'INSERT INTO reports (reporter_id, post_id, snapshot, reason, created_at) VALUES (?, ?, ?, ?, ?)', user.id, p.id, p.body.slice(0, 2000), reason, now());
  return c.json({ ok: true });
});

// Troll flag. Three different members temporarily hide a post pending moderator review.
// It is a precaution, not a verdict: the author is not penalized and Aggie Reputation is untouched.
forum.post('/posts/:id/troll', async (c) => {
  const user = c.get('user');
  const p = await loadPost(c.env, idParam(c.req.param('id')));
  await loadThread(c.env, user, p.thread_id);
  if (p.deleted) throw new HttpError(400, 'This post was removed.');
  if (p.user_id === user.id) throw new HttpError(400, "You can't flag your own post.");
  // Invited members are vouched for; open sign-ups can flag once their first post is approved.
  if (!isModerator(user) && !user.trusted && user.joined_open) throw new HttpError(403, 'Flagging opens up once your first post has been approved.');
  const me = await first<{ can_flag: number }>(c.env, 'SELECT can_flag FROM users WHERE id = ?', user.id);
  if (!me?.can_flag) throw new HttpError(403, 'A moderator has turned off flagging for your account. You can still report posts.');
  const ins = await run(c.env, `INSERT OR IGNORE INTO reports (reporter_id, post_id, snapshot, reason, kind, created_at) VALUES (?, ?, ?, 'Flagged as trolling', 'troll', ?)`, user.id, p.id, p.body.slice(0, 2000), now());
  if (!ins.meta.changes) throw new HttpError(409, 'You already flagged this post.');
  const threshold = Math.max(1, Number(await getSetting(c.env, 'troll_threshold')) || 3);
  const flags = (await first<{ n: number }>(c.env, "SELECT COUNT(DISTINCT reporter_id) AS n FROM reports WHERE post_id = ? AND kind = 'troll' AND status = 'open'", p.id))?.n ?? 0;
  const already = await first<{ hidden: number }>(c.env, 'SELECT hidden FROM posts WHERE id = ?', p.id);
  const hide = flags >= threshold;
  if (hide && !already?.hidden) {
    await run(c.env, 'UPDATE posts SET hidden = 1 WHERE id = ?', p.id);
    const author = p.user_id ? await first<{ username: string }>(c.env, 'SELECT username FROM users WHERE id = ?', p.user_id) : null;
    await logMod(c.env, null, 'auto_hide_pending_review', 'post', p.id, `${flags} member flags`, p.user_id);
    await notifyModerators(c.env, `A post by ${author?.username ?? 'a member'} is hidden after ${flags} troll flags and needs review.`, '/admin/reports');
    if (p.user_id) await notify(c.env, p.user_id, 'moderation', 'One of your posts is temporarily hidden while moderators review it. This is not a judgment about you; most reviews finish quickly.', `/t/${p.thread_id}?post=${p.id}`);
  }
  return c.json({ ok: true, hidden: hide || Boolean(already?.hidden), flags, threshold });
});

// ---------- Polls ----------

forum.post('/polls/:id/vote', async (c) => {
  const user = c.get('user');
  const pollId = idParam(c.req.param('id'));
  const poll = await first<{ thread_id: number; closes_at: number | null }>(c.env, 'SELECT thread_id, closes_at FROM polls WHERE id = ?', pollId);
  if (!poll) throw new HttpError(404, 'Poll not found.');
  await loadThread(c.env, user, poll.thread_id);
  if (poll.closes_at && poll.closes_at < now()) throw new HttpError(400, 'This poll is closed.');
  const { option_id } = parse(z.object({ option_id: z.number().int() }), await c.req.json());
  if (!(await first(c.env, 'SELECT id FROM poll_options WHERE id = ? AND poll_id = ?', option_id, pollId))) throw new HttpError(400, 'Invalid option.');
  await run(c.env, `INSERT INTO poll_votes (poll_id, user_id, option_id) VALUES (?, ?, ?)
                    ON CONFLICT(poll_id, user_id) DO UPDATE SET option_id = excluded.option_id`, pollId, user.id, option_id);
  return c.json(await pollFor(c.env, poll.thread_id, user.id));
});

// Member-nominated options (used by the automatic Player of the Game vote).
forum.post('/polls/:id/options', async (c) => {
  const user = c.get('user');
  const pollId = idParam(c.req.param('id'));
  const poll = await first<{ thread_id: number; closes_at: number | null; allow_add: number }>(c.env, 'SELECT thread_id, closes_at, allow_add FROM polls WHERE id = ?', pollId);
  if (!poll) throw new HttpError(404, 'Poll not found.');
  await loadThread(c.env, user, poll.thread_id);
  if (!poll.allow_add) throw new HttpError(400, 'This poll does not take nominations.');
  if (poll.closes_at && poll.closes_at < now()) throw new HttpError(400, 'This poll is closed.');
  const { label } = parse(z.object({ label: z.string().trim().min(2).max(60) }), await c.req.json());
  const existing = await first<{ id: number }>(c.env, 'SELECT id FROM poll_options WHERE poll_id = ? AND lower(label) = lower(?)', pollId, label);
  let optionId = existing?.id;
  if (!optionId) {
    const count = await first<{ n: number }>(c.env, 'SELECT COUNT(*) AS n FROM poll_options WHERE poll_id = ?', pollId);
    if ((count?.n ?? 0) >= 30) throw new HttpError(400, 'This poll already has the maximum number of choices.');
    optionId = (await run(c.env, 'INSERT INTO poll_options (poll_id, label, sort, added_by) VALUES (?, ?, ?, ?)', pollId, label, count?.n ?? 0, user.id)).meta.last_row_id;
  }
  await run(c.env, `INSERT INTO poll_votes (poll_id, user_id, option_id) VALUES (?, ?, ?) ON CONFLICT(poll_id, user_id) DO UPDATE SET option_id = excluded.option_id`, pollId, user.id, optionId);
  return c.json(await pollFor(c.env, poll.thread_id, user.id));
});

// ---------- Bookmarks & reminders ----------

forum.post('/posts/:id/bookmark', async (c) => {
  const user = c.get('user');
  const p = await loadPost(c.env, idParam(c.req.param('id')));
  await loadThread(c.env, user, p.thread_id);
  const body = parse(z.object({ bookmarked: z.boolean(), note: z.string().max(200).optional().nullable(), remind_at: z.number().int().optional().nullable() }), await c.req.json());
  if (!body.bookmarked) await run(c.env, 'DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?', user.id, p.id);
  else await run(c.env, `INSERT INTO bookmarks (user_id, post_id, note, remind_at, created_at) VALUES (?, ?, ?, ?, ?)
                         ON CONFLICT(user_id, post_id) DO UPDATE SET note = excluded.note, remind_at = excluded.remind_at, reminded = 0`,
    user.id, p.id, body.note ?? null, body.remind_at ?? null, now());
  return c.json({ ok: true, bookmarked: body.bookmarked });
});

forum.get('/bookmarks', async (c) => {
  const user = c.get('user');
  const rows = await all(c.env,
    `SELECT b.id, b.post_id, b.note, b.remind_at, b.reminded, b.created_at, p.body, p.deleted, p.thread_id, t.title, u.username
       FROM bookmarks b JOIN posts p ON p.id = b.post_id JOIN threads t ON t.id = p.thread_id LEFT JOIN users u ON u.id = p.user_id
      WHERE b.user_id = ? AND t.deleted = 0 ORDER BY b.created_at DESC`, user.id);
  return c.json({ bookmarks: rows });
});

// ---------- Drafts (server-side, so a reply started on the phone can be finished on desktop) ----------

forum.get('/drafts', async (c) => {
  const rows = await all(c.env, 'SELECT key, title, body, updated_at FROM drafts WHERE user_id = ? ORDER BY updated_at DESC', c.get('user').id);
  return c.json({ drafts: rows });
});

forum.get('/drafts/:key', async (c) => {
  const d = await first(c.env, 'SELECT key, title, body, updated_at FROM drafts WHERE user_id = ? AND key = ?', c.get('user').id, c.req.param('key'));
  return c.json({ draft: d });
});

forum.put('/drafts/:key', async (c) => {
  const body = parse(z.object({ title: z.string().max(300).optional().nullable(), body: z.string().max(20000) }), await c.req.json());
  const key = c.req.param('key').slice(0, 80);
  if (!body.body.trim() && !body.title?.trim()) await run(c.env, 'DELETE FROM drafts WHERE user_id = ? AND key = ?', c.get('user').id, key);
  else await run(c.env, `INSERT INTO drafts (user_id, key, title, body, updated_at) VALUES (?, ?, ?, ?, ?)
                         ON CONFLICT(user_id, key) DO UPDATE SET title = excluded.title, body = excluded.body, updated_at = excluded.updated_at`,
    c.get('user').id, key, body.title ?? null, body.body, now());
  return c.json({ ok: true });
});

forum.delete('/drafts/:key', async (c) => {
  await run(c.env, 'DELETE FROM drafts WHERE user_id = ? AND key = ?', c.get('user').id, c.req.param('key'));
  return c.json({ ok: true });
});

// ---------- Search ----------

forum.get('/search', async (c) => {
  const user = c.get('user');
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2) return c.json({ threads: [], posts: [] });
  const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
  const forumSlug = c.req.query('forum');
  const fWhere = forumSlug ? ' AND f.slug = ?' : '';
  const fParams = forumSlug ? [forumSlug] : [];
  const threads = await all<ThreadRow>(c.env,
    `${THREAD_SELECT} WHERE t.deleted = 0 AND t.pending = 0 AND (t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')${fWhere} ORDER BY t.last_post_at DESC LIMIT 25`,
    user.id, like, like, ...fParams);
  const posts = await all<{ id: number; thread_id: number; body: string; created_at: number; username: string; title: string; forum_name: string }>(c.env,
    `SELECT p.id, p.thread_id, p.body, p.created_at, u.username, t.title, f.name AS forum_name, f.slug AS forum_slug
       FROM posts p JOIN threads t ON t.id = p.thread_id JOIN forums f ON f.id = t.forum_id LEFT JOIN users u ON u.id = p.user_id
      WHERE p.deleted = 0 AND p.pending = 0 AND p.hidden = 0 AND t.deleted = 0 AND t.pending = 0 AND p.body LIKE ? ESCAPE '\\'${fWhere} ORDER BY p.id DESC LIMIT 40`, like, ...fParams);
  const members = await all(c.env,
    `SELECT id, username, display_name, legacy_moniker, avatar_key FROM users
      WHERE status = 'active' AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR legacy_moniker LIKE ? ESCAPE '\\') LIMIT 10`, like, like, like);
  return c.json({ threads: await presentThreads(c.env, user, threads), posts, members: user.role === 'guest' ? [] : members });
});

// ---------- Mutes ----------

forum.get('/mutes', async (c) => {
  const user = c.get('user');
  const users = await all(c.env, "SELECT u.id, u.username, u.display_name FROM mutes m JOIN users u ON u.id = m.target_id WHERE m.user_id = ? AND m.target_type = 'user'", user.id);
  const forums = await all(c.env, "SELECT f.id, f.slug, f.name FROM mutes m JOIN forums f ON f.id = m.target_id WHERE m.user_id = ? AND m.target_type = 'forum'", user.id);
  return c.json({ users, forums });
});

forum.post('/mutes', async (c) => {
  const user = c.get('user');
  const body = parse(z.object({ target_type: z.enum(['user', 'forum']), target_id: z.number().int(), muted: z.boolean() }), await c.req.json());
  if (body.target_type === 'user' && body.target_id === user.id) throw new HttpError(400, "You can't mute yourself.");
  if (body.muted) await run(c.env, 'INSERT OR IGNORE INTO mutes (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)', user.id, body.target_type, body.target_id, now());
  else await run(c.env, 'DELETE FROM mutes WHERE user_id = ? AND target_type = ? AND target_id = ?', user.id, body.target_type, body.target_id);
  return c.json({ ok: true });
});

// ---------- Notifications ----------

forum.get('/notifications', async (c) => {
  const rows = await all(c.env, 'SELECT id, type, text, link, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60', c.get('user').id);
  return c.json({ notifications: rows });
});

forum.post('/notifications/read', async (c) => {
  const body = parse(z.object({ ids: z.array(z.number().int()).optional(), all: z.boolean().optional() }), await c.req.json());
  const user = c.get('user');
  if (body.all) await run(c.env, 'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now(), user.id);
  else if (body.ids?.length) {
    await run(c.env, `UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN (${body.ids.map(() => '?').join(',')})`, now(), user.id, ...body.ids);
  }
  return c.json({ ok: true });
});

/** Lightweight counters polled by the client for badges in the navigation. */
forum.get('/pulse', async (c) => {
  const user = c.get('user');
  const [n, dm, unread, reports] = await Promise.all([
    first<{ n: number }>(c.env, 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', user.id),
    first<{ n: number }>(c.env,
      `SELECT COUNT(*) AS n FROM dm_messages m JOIN dm_conversations cv ON cv.id = m.conversation_id
         LEFT JOIN dm_reads r ON r.conversation_id = cv.id AND r.user_id = ?
        WHERE (cv.user_a = ? OR cv.user_b = ?) AND m.sender_id != ? AND m.id > COALESCE(r.last_read_id, 0)`, user.id, user.id, user.id, user.id),
    first<{ n: number }>(c.env,
      `SELECT COUNT(*) AS n FROM threads t LEFT JOIN thread_reads tr ON tr.thread_id = t.id AND tr.user_id = ?
        WHERE t.deleted = 0 AND t.pending = 0 AND t.last_post_at > ? AND (tr.last_read_post_id IS NULL OR tr.last_read_post_id < t.last_post_id)
          AND t.forum_id NOT IN (SELECT target_id FROM mutes WHERE user_id = ? AND target_type = 'forum')`, user.id, unreadBaseline(user), user.id),
    isModerator(user) ? first<{ n: number }>(c.env, "SELECT (SELECT COUNT(*) FROM reports WHERE status = 'open' AND kind = 'report') + (SELECT COUNT(*) FROM posts WHERE pending = 1 AND deleted = 0) + (SELECT COUNT(*) FROM posts WHERE hidden = 1 AND deleted = 0) + (SELECT COUNT(*) FROM appeals WHERE status = 'open') + (SELECT COUNT(*) FROM ban_proposals WHERE status = 'open') AS n") : Promise.resolve({ n: 0 }),
  ]);
  return c.json({ notifications: n?.n ?? 0, messages: dm?.n ?? 0, unread_threads: unread?.n ?? 0, open_reports: reports?.n ?? 0 });
});

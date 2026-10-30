import { Hono } from 'hono';
import type { AppEnv, Env } from './env';
import { loadSession, requireUser } from './auth';
import { HttpError } from './util';
import { auth } from './routes/auth';
import { forum } from './routes/forum';
import { games } from './routes/games';
import { community } from './routes/community';
import { chat } from './routes/chat';
import { admin } from './routes/admin';
import { dailyJobs, frequentJobs } from './cron';

export { ChatRoom } from './chat';

const app = new Hono<AppEnv>().basePath('/api');

app.use('*', async (c, next) => {
  const method = c.req.method;
  // CSRF: state-changing requests must carry a header that cross-site forms cannot send.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && c.req.header('x-nsf') !== '1') throw new HttpError(403, 'Request blocked.');
  // WebSockets: reject cross-site connection attempts.
  if (c.req.header('Upgrade') === 'websocket') {
    const origin = c.req.header('Origin');
    if (origin && new URL(origin).host !== new URL(c.req.url).host) throw new HttpError(403, 'Request blocked.');
  }
  await next();
  if (c.res.status !== 101) {
    c.res.headers.set('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store');
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Referrer-Policy', 'same-origin');
  }
});

app.use('*', loadSession);

app.get('/health', (c) => c.json({ ok: true }));
app.route('/auth', auth);

// Everything below requires a signed-in, active member.
app.use('*', requireUser);
app.route('/admin', admin);
app.route('/', forum);
app.route('/', games);
app.route('/', community);
app.route('/', chat);

app.notFound((c) => c.json({ error: 'Not found.' }, 404));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  console.error(err);
  return c.json({ error: 'Something went wrong. Please try again.' }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (controller.cron === '17 9 * * *') ctx.waitUntil(dailyJobs(env));
    else ctx.waitUntil(frequentJobs(env));
  },
} satisfies ExportedHandler<Env>;

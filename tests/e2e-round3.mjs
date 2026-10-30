// Open-community checks: sign-up switch, public reading, troll flags.
// Run after tests/e2e.mjs and tests/e2e-round2.mjs on the same local database.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const SHOTS = 'tests/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const sql = (q) => execSync(`npx wrangler d1 execute DB --local --command "${q.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });

async function api(page, path, opts = {}) {
  return page.evaluate(async ({ path, opts }) => {
    const r = await fetch(`/api${path}`, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'x-nsf': '1', 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { path, opts });
}
async function login(page, u, p) {
  await page.goto(BASE + '/login');
  await page.fill('#u', u);
  await page.fill('#p', p);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(BASE + '/');
}

const browser = await chromium.launch();
try {
  const anonCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 });
  const anon = await anonCtx.newPage();
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await login(admin, 'AggieAdmin', 'admin-password-123');
  const member = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
  await login(member, 'CrimsonFan', 'brand-new-password-1');
  const threadId = (await api(member, '/feed?tab=latest&tag=recruiting')).body.threads[0].id;

  // ---------- Defaults: invite-only and private ----------
  await anon.goto(BASE + '/');
  await anon.waitForURL('**/login');
  check('By default visitors are sent to sign in (private forum)', true);
  const closed = await api(anon, '/auth/register', { body: { username: 'Nobody1', email: 'n1@example.test', password: 'nobody-password-1' } });
  check('By default sign-up without an invitation is refused', closed.status === 400);

  // ---------- Admin switches to open sign-up + public reading ----------
  await admin.goto(BASE + '/admin/settings');
  await admin.selectOption('#sm', 'open');
  await admin.check('text=Anyone can read discussions without an account');
  await admin.fill('#tt', '2');
  await admin.click('button:has-text("Save settings")');
  await admin.waitForSelector('text=Settings saved');
  check('Admin switches on open sign-up and public reading', true);

  // ---------- Visitors read, but can't post ----------
  await anon.goto(BASE + '/');
  await anon.waitForSelector('h1:has-text("NMSU Sports Forum")');
  check('Visitors see the home page with a Join prompt', await anon.isVisible('a:has-text("Join free")'));
  await anon.screenshot({ path: `${SHOTS}/visitor-home.png`, fullPage: true });
  await anon.goto(`${BASE}/t/${threadId}`);
  await anon.waitForSelector('article.post');
  check('Visitors can read a discussion, with no reply box or reaction buttons', (await anon.isVisible('text=Join free to reply')) && !(await anon.isVisible('#reply-box')) && !(await anon.isVisible('.post-actions')));
  const reads = await Promise.all(['/feed?tab=latest', `/threads/${threadId}`, '/games', '/players?kind=recruit', '/forums'].map((p) => api(anon, p)));
  check('Public read APIs work without an account', reads.every((r) => r.status === 200));
  const privateApis = await Promise.all(['/members', '/messages', '/chat/rooms', '/calendar', '/map', '/notifications', '/admin/overview'].map((p) => api(anon, p)));
  check('Members, messages, chat, calendar, map and admin stay private', privateApis.every((r) => r.status === 401), privateApis.map((r) => r.status).join(','));
  const write = await api(anon, `/threads/${threadId}/posts`, { body: { body: 'drive-by' } });
  check('Visitors cannot post', write.status === 401);
  const online = (await api(anon, '/home')).body;
  check('Visitors do not see who is online or birthdays', online.online.length === 0 && online.birthdays.length === 0);

  // ---------- Open sign-up ----------
  await anon.goto(BASE + '/login');
  await anon.click('a:has-text("Join free")');
  await anon.waitForURL('**/join');
  await anon.screenshot({ path: `${SHOTS}/visitor-join.png`, fullPage: true });
  await anon.fill('#un', 'RivalTroll');
  await anon.fill('#em', 'troll@example.test');
  await anon.fill('#pw', 'troll-password-1');
  await anon.fill('#pc', 'troll-password-1');
  await anon.click('button:has-text("Join free")');
  await anon.waitForURL('**/settings?welcome=1');
  check('Anyone can join free when sign-up is open', true);
  const troll = anon;
  const first = await api(troll, `/threads/${threadId}/posts`, { body: { body: 'First post from an open sign-up.' } });
  check('Open sign-ups have their first post reviewed', first.body.pending === true);
  const earlyFlag = await api(troll, `/posts/${(await api(admin, `/threads/${threadId}`)).body.posts[0].id}/troll`, { method: 'POST' });
  check('New open sign-ups cannot flag until approved', earlyFlag.status === 403);
  await api(admin, `/admin/pending/${first.body.id}`, { body: { approve: true } });

  // ---------- Troll flags ----------
  const bad = await api(troll, `/threads/${threadId}/posts`, { body: { body: 'Aggies are trash, go Miners!!! (troll test)' } });
  check('After approval the member posts immediately', bad.body.pending === false);
  const inv = (await api(admin, '/admin/invites', { body: { note: 'flag helper' } })).body.link;
  const helper = await (await browser.newContext()).newPage();
  await helper.goto(inv);
  await helper.fill('#un', 'FlagHelper');
  await helper.fill('#em', 'helper@example.test');
  await helper.fill('#pw', 'helper-password-1');
  await helper.fill('#pc', 'helper-password-1');
  await helper.click('button:has-text("Join NMSU Sports Forum")');
  await helper.waitForURL('**/settings?welcome=1');

  await member.goto(`${BASE}/t/${threadId}?post=${bad.body.id}`);
  await member.waitForSelector(`#p${bad.body.id} button:has-text("Troll")`);
  member.once('dialog', (d) => d.accept());
  await member.click(`#p${bad.body.id} button:has-text("Troll")`);
  await member.waitForSelector('text=Flagged (1 of 2 needed to hide it)');
  check('First flag is counted but the post stays up', !(await api(anon, `/threads/${threadId}?post=${bad.body.id}`)).body.posts.find((p) => p.id === bad.body.id).hidden);
  const second = await api(helper, `/posts/${bad.body.id}/troll`, { method: 'POST' });
  check('Second member\'s flag hides the post immediately (threshold 2)', second.body.hidden === true);
  const asVisitor = (await api(await (await browser.newContext()).newPage().then(async (p) => { await p.goto(BASE + '/'); return p; }), `/threads/${threadId}?post=${bad.body.id}`)).body.posts.find((p) => p.id === bad.body.id);
  check('Hidden post text is no longer shown to others', asVisitor.hidden === true && asVisitor.body === '');
  const own = (await api(troll, `/threads/${threadId}?post=${bad.body.id}`)).body.posts.find((p) => p.id === bad.body.id);
  check('The author still sees their own hidden post with a notice', own.hidden === true && own.body.includes('troll test'));
  const next = await api(troll, `/threads/${threadId}/posts`, { body: { body: 'Another one' } });
  check("The flagged member's next posts go to approval", next.body.pending === true);
  const notes = (await api(admin, '/notifications')).body.notifications;
  check('Admins are notified right away', notes.some((n) => n.type === 'troll'));
  await admin.goto(BASE + '/admin/reports');
  await admin.waitForSelector('text=Troll flags');
  await admin.screenshot({ path: `${SHOTS}/admin-troll-flags.png`, fullPage: true });
  await admin.click('button:has-text("Not trolling: restore")');
  await admin.waitForSelector('text=Restored');
  const restored = (await api(member, `/threads/${threadId}?post=${bad.body.id}`)).body.posts.find((p) => p.id === bad.body.id);
  check('Admin can restore a wrongly flagged post', restored.hidden === false && restored.body.includes('troll test'));
  const adminFlag = await api(admin, `/posts/${bad.body.id}/troll`, { method: 'POST' });
  check("An admin's flag hides a post at once", adminFlag.body.hidden === true);
  await api(admin, `/admin/flagged/${bad.body.id}`, { body: { action: 'remove' } });
  const removed = (await api(member, `/threads/${threadId}?post=${bad.body.id}`)).body.posts.find((p) => p.id === bad.body.id);
  check('Admin removes the flagged post', removed.deleted === true);
  const selfFlag = await api(member, `/posts/${(await api(member, `/threads/${threadId}`)).body.posts.find((p) => p.author?.username === 'CrimsonFan').id}/troll`, { method: 'POST' });
  check("Members can't flag their own posts", selfFlag.status === 400);

  // ---------- Unconfirmed email ----------
  sql("UPDATE users SET email_verified = 0 WHERE username = 'FlagHelper'");
  const unverified = await api(helper, `/threads/${threadId}/posts`, { body: { body: 'should be blocked' } });
  const canRead = await api(helper, `/threads/${threadId}`);
  check('Members who have not confirmed their email can read but not post', unverified.status === 403 && /confirm your email/i.test(unverified.body.error) && canRead.status === 200);
  sql("UPDATE users SET email_verified = 1 WHERE username = 'FlagHelper'");

  // Put things back the way the earlier suites expect.
  await api(admin, '/admin/settings', { method: 'PUT', body: { signup_mode: 'invite', public_read: '0', troll_threshold: '3' } });
  const back = await api(await (await browser.newContext()).newPage().then(async (p) => { await p.goto(BASE + '/login'); return p; }), '/feed');
  check('Switching back to private takes effect immediately', back.status === 401);
} catch (e) {
  check('Unexpected error', false, e.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} open-community checks passed`);
  process.exit(failed.length ? 1 : 0);
}

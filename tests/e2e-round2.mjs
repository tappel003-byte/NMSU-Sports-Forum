// Round-two end-to-end checks. Run after tests/e2e.mjs on the same local database
// (it reuses the AggieAdmin and CrimsonFan accounts that suite creates).
// Needs .dev.vars with CFBD_API_KEY=anything and CFBD_BASE=http://localhost:8798 (served below)
// plus VAPID keys from `node scripts/vapid.mjs`.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const SHOTS = 'tests/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const year = new Date().getUTCFullYear();

// Synthetic CollegeFootballData responses (fake names) and an article page for link previews.
const mock = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (d) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
  if (url.pathname === '/recruiting/players') {
    if (req.headers.authorization !== 'Bearer local-test-key') { res.writeHead(401); return res.end(); }
    return json(Number(url.searchParams.get('year')) === year ? [
      { id: 9001, year, name: 'Sample Receiver', school: 'Sample High School', committedTo: 'New Mexico State', position: 'WR', stars: 3, rating: 0.8612, city: 'Las Cruces', stateProvince: 'NM', ranking: 1450 },
      { id: 9002, year, name: 'Example Lineman', school: 'Example Prep', committedTo: 'New Mexico State', position: 'OT', stars: 2, rating: 0.79, city: 'El Paso', stateProvince: 'TX' },
    ] : []);
  }
  if (url.pathname === '/player/portal') {
    return json([
      { season: year, firstName: 'Test', lastName: 'Transfer', position: 'QB', origin: 'Other University', destination: 'New Mexico State', stars: 3, rating: 0.85 },
      { season: year, firstName: 'Departing', lastName: 'Player', position: 'RB', origin: 'New Mexico State', destination: null },
      { season: year, firstName: 'Unrelated', lastName: 'Athlete', position: 'LB', origin: 'Somewhere', destination: 'Elsewhere' },
    ]);
  }
  if (url.pathname === '/article') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<html><head><title>x</title><meta property="og:title" content="Aggies land sample receiver"><meta property="og:site_name" content="Sample News"><meta property="og:description" content="Synthetic article for testing link previews."></head><body>hi</body></html>');
  }
  res.writeHead(404); res.end();
}).listen(8798);

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
async function openReply(page) {
  if (await page.isVisible('.dock-bar .fake-input')) await page.click('.dock-bar .fake-input');
  await page.waitForSelector('#reply-box', { state: 'visible' });
}
const sql = (q) => execSync(`npx wrangler d1 execute DB --local --command "${q.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });

const browser = await chromium.launch();
try {
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminCtx.newPage();
  await login(admin, 'AggieAdmin', 'admin-password-123');
  const memberCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const member = await memberCtx.newPage();
  await login(member, 'CrimsonFan', 'brand-new-password-1');

  // ---------- Phone refinements ----------
  await member.waitForSelector('.hero');
  check('Phone home hides the desktop-only sections (venues, extras)', !(await member.isVisible('text=Sports venues')));
  check('Floating new-thread button on phone', await member.isVisible('.fab'));
  const homeTitles = await member.$$eval('.thread-title', (els) => els.map((e) => e.textContent));
  const all = (await api(member, '/feed?tab=latest&games=1')).body.threads.map((t) => t.title);
  check('Automatic game threads are grouped under the game card, not in the home list', !homeTitles.some((t) => /^(Pregame|Postgame):/.test(t)) && all.some((t) => /^(Pregame|Postgame):/.test(t)));
  await member.click('button[title="Compact list"]');
  await member.waitForSelector('.thread-list.compact');
  check('Compact list option', true);
  await member.click('button[title="Compact list"]');

  // ---------- Tags ----------
  await member.goto(BASE + '/new?forum=aggie-memorial');
  await member.fill('#title', 'Commitment watch for this weekend');
  await member.fill('#desc', 'Who flips to the Aggies?');
  await member.fill('#body', 'Hearing good things. ||Big news coming Saturday||');
  await member.click('button[aria-pressed]:has-text("Recruiting")');
  await member.click('button:has-text("Post discussion")');
  await member.waitForURL(/\/t\/\d+/);
  const tagThread = Number(member.url().split('/t/')[1].split('?')[0]);
  await member.waitForSelector('.tag:has-text("Recruiting")');
  check('Thread created with a tag', true);
  const tagged = (await api(member, '/feed?tab=latest&tag=recruiting')).body.threads;
  const rumor = (await api(member, '/feed?tab=latest&tag=rumor')).body.threads;
  check('Tag filter shows only matching discussions', tagged.some((t) => t.id === tagThread) && !rumor.some((t) => t.id === tagThread));

  // ---------- Spoilers ----------
  const spoiler = member.locator('.spoiler-text').first();
  check('Spoiler text is hidden until tapped', (await spoiler.getAttribute('class')).includes('spoiler-text') && !(await spoiler.getAttribute('class')).includes('shown'));
  await spoiler.click();
  check('Tapping reveals the spoiler', (await spoiler.getAttribute('class')).includes('shown'));
  const notif = (await api(member, '/feed?tab=latest')).body.threads;
  void notif;

  // ---------- Reply dock + mention autocomplete + tweet + link previews ----------
  check('Reply bar pinned to the bottom on phone', await member.isVisible('.dock-bar .fake-input'));
  await openReply(member);
  await member.click('#reply-box');
  await member.keyboard.type('Thanks @Aggie');
  await member.waitForSelector('.mention-list button:has-text("@AggieAdmin")');
  await member.keyboard.press('Enter');
  check('@mention autocomplete suggests and inserts a member', (await member.inputValue('#reply-box')).includes('@AggieAdmin '));
  await member.keyboard.type('check this https://x.com/SampleReporter/status/1851234567890123456 and http://localhost:8798/article');
  await member.click('button:has-text("Post reply")');
  await member.waitForSelector('.preview.x');
  check('Pasted tweet link shows as a tweet card', (await member.textContent('.preview.x')).includes('@SampleReporter'));
  await member.waitForSelector('.preview:has-text("Aggies land sample receiver")');
  check('Pasted article link shows a preview card (title and site)', (await member.textContent('.preview:has-text("Aggies land")')).includes('Sample News'));
  const mentionNote = (await api(admin, '/notifications')).body.notifications.some((n) => n.type === 'mention' && n.text.includes('Crimson'));
  check('Mentioned member is notified', mentionNote);

  // ---------- Live-updating thread ----------
  await admin.goto(`${BASE}/t/${tagThread}`);
  await member.goto(`${BASE}/t/${tagThread}`);
  await member.waitForTimeout(1500);
  await api(admin, `/threads/${tagThread}/posts`, { body: { body: 'Live update test — this should appear without refreshing.' } });
  await member.waitForSelector('text=Live update test', { timeout: 15000 });
  check('New replies appear in an open thread without refreshing', true);

  // ---------- Share a tweet ----------
  await member.goto(BASE + '/share?url=' + encodeURIComponent('https://x.com/SampleReporter/status/1851234567890123999'));
  await member.waitForSelector('#share-url');
  check('Share page (for the iPhone Shortcut) arrives with the link filled in', (await member.inputValue('#share-url')).includes('1851234567890123999'));
  await member.selectOption('#share-forum', 'aggie-memorial');
  await member.fill('#share-title', 'Sample reporter on the WR target');
  await member.click('button:has-text("Share")');
  await member.waitForURL(/\/t\/\d+/);
  await member.waitForSelector('.preview.x');
  await member.waitForSelector('.tag:has-text("Recruiting")');
  check('Sharing a tweet creates a discussion with the tweet card and a Recruiting tag', true);

  // ---------- Recruiting ----------
  await admin.goto(BASE + '/admin/data');
  await admin.click('button:has-text("Update now")');
  await admin.waitForSelector('text=4 players', { timeout: 20000 });
  const recruits = (await api(member, '/players?kind=recruit')).body.players;
  const portal = (await api(member, '/players?kind=portal')).body.players;
  check('Football recruits import automatically (CollegeFootballData format)', recruits.length === 2 && recruits.some((p) => p.name === 'Sample Receiver' && p.stars === 3 && p.status === 'committed'));
  check('Transfer portal keeps only NM State moves, in and out', portal.length === 2 && portal.some((p) => p.kind === 'transfer_in') && portal.some((p) => p.kind === 'transfer_out' && p.status === 'in_portal'));
  await admin.click('button:has-text("Update now")');
  await admin.waitForTimeout(1500);
  check('Re-syncing recruiting does not duplicate players', (await api(member, '/players?kind=recruit')).body.players.length === 2);
  const wr = recruits.find((p) => p.name === 'Sample Receiver');
  await member.goto(`${BASE}/recruiting`);
  await member.waitForSelector('.player-card:has-text("Sample Receiver")');
  await member.screenshot({ path: `${SHOTS}/iphone-recruiting.png`, fullPage: true });
  await member.click('.player-card:has-text("Sample Receiver")');
  await member.waitForSelector('h1:has-text("Sample Receiver")');
  await member.click('button:has-text("Yes")');
  await member.waitForSelector('text=100% of 1 member say yes');
  check('Members predict on a recruit', true);
  await member.click('button:has-text("Share a tweet about him")');
  await member.fill('#share-url', 'http://localhost:8798/article');
  await member.fill('#share-comment', 'Great get for the Aggies.');
  await member.click('.modal button:has-text("Share")');
  await member.waitForURL(/\/t\/\d+/);
  await member.waitForSelector('text=Great get for the Aggies.');
  const card = (await api(member, `/players/${wr.id}`)).body;
  check('A tweet/link shared on a player card posts to his discussion and shows on the card', card.news.length === 1 && card.player.thread_id > 0);
  const added = await api(member, '/players', { body: { sport: 'mbb', kind: 'transfer_in', name: 'Sample Guard', position: 'G', status: 'committed', source_url: 'http://localhost:8798/article' } });
  const noSource = await api(member, '/players', { body: { sport: 'mbb', kind: 'recruit', name: 'No Source Kid', status: 'tracking', source_url: '' } });
  check('Members add basketball players with a required source link', added.status === 200 && noSource.status === 400);
  await member.goto(`${BASE}/recruiting/${wr.id}`);
  await member.waitForSelector('.preview');
  await member.screenshot({ path: `${SHOTS}/iphone-player.png`, fullPage: true });

  // ---------- Player of the Game ----------
  const games = (await api(member, '/games?range=season')).body.games;
  const vb = games.find((g) => g.opponent === 'Placeholder U');
  const post = (await api(member, `/games/${vb.id}`)).body.threads.find((t) => t.game_phase === 'postgame');
  await member.goto(`${BASE}/t/${post.id}`);
  await member.waitForSelector('text=Player of the Game');
  await member.fill('input[aria-label="Nominate a player"]', 'Sample Setter');
  await member.click('button:has-text("Nominate")');
  await member.waitForSelector('.poll-option.mine:has-text("Sample Setter")');
  const second = await api(admin, `/polls/${(await api(admin, `/threads/${post.id}`)).body.poll.id}/options`, { body: { label: 'sample setter' } });
  check('Postgame Player of the Game vote: nominate and vote, duplicates merge', second.body.options.length === 1 && second.body.total === 2);

  // ---------- First-post approval, timed suspension, merge ----------
  await api(admin, '/admin/settings', { method: 'PUT', body: { approve_first_post: '1' } });
  const inv = (await api(admin, '/admin/invites', { body: { note: 'round two' } })).body.link;
  const newCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const newbie = await newCtx.newPage();
  await newbie.goto(inv);
  await newbie.fill('#un', 'NewFan');
  await newbie.fill('#em', 'newfan@example.test');
  await newbie.fill('#pw', 'newfan-password-1');
  await newbie.fill('#pc', 'newfan-password-1');
  await newbie.click('button:has-text("Join NMSU Sports Forum")');
  await newbie.waitForURL('**/settings?welcome=1');
  const pend = await api(newbie, '/threads', { body: { forum: 'general', title: 'Hello from a new fan', description: 'First post', body: 'Glad to be here!' } });
  const othersSee = (await api(member, `/threads/${pend.body.id}`)).status;
  const ownSee = (await api(newbie, `/threads/${pend.body.id}`)).status;
  check('New member\'s first post waits for approval and is hidden from others', pend.body.pending === true && othersSee === 404 && ownSee === 200);
  await admin.goto(BASE + '/admin/approvals');
  await admin.waitForSelector('text=Glad to be here!');
  await admin.click('button:has-text("Approve")');
  await admin.waitForSelector('text=Nothing waiting.');
  const second2 = await api(newbie, `/threads/${pend.body.id}/posts`, { body: { body: 'Second post goes straight up.' } });
  check('After approval the post is public and later posts appear immediately', (await api(member, `/threads/${pend.body.id}`)).status === 200 && second2.body.pending === false);
  await api(admin, '/admin/settings', { method: 'PUT', body: { approve_first_post: '0' } });

  const newfanId = (await api(admin, '/admin/members')).body.members.find((m) => m.username === 'NewFan').id;
  await api(admin, `/admin/members/${newfanId}`, { method: 'PATCH', body: { status: 'suspended', days: 3, reason: 'test' } });
  const blocked = await api(newbie, '/auth/login', { body: { username: 'NewFan', password: 'newfan-password-1' } });
  check('Timed suspension blocks sign-in and says until when', blocked.status === 403 && /until/.test(blocked.body.error));
  sql("UPDATE users SET suspended_until = 1 WHERE username = 'NewFan'");
  const back = await api(newbie, '/auth/login', { body: { username: 'NewFan', password: 'newfan-password-1' } });
  check('Suspension lifts itself when the time is up', back.status === 200);

  const dupe = await api(admin, '/threads', { body: { forum: 'general', title: 'Duplicate thread', description: 'dupe', body: 'Duplicate post body.' } });
  await admin.goto(`${BASE}/t/${dupe.body.id}`);
  await admin.click('button:has-text("Moderate")');
  await admin.fill('#merge', String(tagThread));
  admin.once('dialog', (d) => d.accept());
  await admin.click('.modal button:has-text("Merge")');
  await admin.waitForURL(`**/t/${tagThread}`);
  const merged = (await api(member, `/threads/${tagThread}?page=99`)).body;
  check('Admin merges a duplicate thread into another', merged.posts.some((p) => p.body === 'Duplicate post body.') && (await api(member, `/threads/${dupe.body.id}`)).status === 404);

  // ---------- Push notifications (server side; real delivery needs a phone) ----------
  const key = (await api(member, '/push/key')).body.key;
  const sub = await api(member, '/push/subscribe', { body: { endpoint: 'https://push.example.test/device-1', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } } });
  const status = (await api(member, '/push/status')).body;
  check('Phone notifications: key published and device registered', typeof key === 'string' && key.length > 80 && sub.status === 200 && status.devices === 1);

  // ---------- Dark mode ----------
  await api(member, '/me/prefs', { method: 'PATCH', body: { theme: 'dark' } });
  await member.goto(BASE + '/');
  await member.waitForSelector('.hero');
  check('Dark mode applies', (await member.getAttribute('html', 'data-theme')) === 'dark');
  await member.screenshot({ path: `${SHOTS}/iphone-home-dark.png`, fullPage: true });
  await member.goto(`${BASE}/t/${tagThread}`);
  await member.waitForSelector('article.post');
  await member.screenshot({ path: `${SHOTS}/iphone-thread-dark.png` });
  await api(member, '/me/prefs', { method: 'PATCH', body: { theme: 'system' } });
  await member.goto(`${BASE}/t/${tagThread}`);
  await member.waitForSelector('article.post');
  await member.screenshot({ path: `${SHOTS}/iphone-thread-v2.png` });
  check('Aggie rank shows next to member names', await member.isVisible('.rank:has-text("Walk-on")'));

  // ---------- Data download and account deletion ----------
  const exp = await newbie.evaluate(async () => { const r = await fetch('/api/me/export'); return { status: r.status, cd: r.headers.get('content-disposition'), body: await r.json() }; });
  check('Member downloads their data', exp.status === 200 && /attachment/.test(exp.cd) && exp.body.posts.length >= 2 && Array.isArray(exp.body.private_messages));
  const wrong = await api(newbie, '/me/delete', { body: { password: 'nope', confirm: 'DELETE' } });
  const del = await api(newbie, '/me/delete', { body: { password: 'newfan-password-1', confirm: 'DELETE' } });
  const after = await api(newbie, '/auth/login', { body: { username: 'NewFan', password: 'newfan-password-1' } });
  const kept = (await api(member, `/threads/${pend.body.id}`)).body.posts[0];
  check('Account deletion needs the password, erases the account and keeps posts as "Former member"', wrong.status === 400 && del.status === 200 && after.status === 401 && kept.author.username.startsWith('former_member_'));

  await admin.goto(BASE + '/');
  await admin.waitForSelector('.hero');
  await admin.screenshot({ path: `${SHOTS}/desktop-home-v2.png`, fullPage: true });
  await admin.goto(BASE + '/recruiting?kind=portal');
  await admin.waitForSelector('.player-card');
  await admin.screenshot({ path: `${SHOTS}/desktop-portal.png`, fullPage: true });
} catch (e) {
  check('Unexpected error', false, e.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await browser.close();
  mock.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} round-two checks passed`);
  process.exit(failed.length ? 1 : 0);
}

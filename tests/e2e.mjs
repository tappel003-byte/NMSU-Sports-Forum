// End-to-end verification against a running `wrangler dev` (default http://localhost:8787).
// Usage: npm run build && npx wrangler dev --port 8787 & node tests/e2e.mjs
// Requires a fresh local database and BOOTSTRAP_TOKEN=local-dev-bootstrap-token in .dev.vars.
// Serves a synthetic iCalendar feed (clearly fake teams) to exercise the automatic schedule import.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const TOKEN = process.env.BOOTSTRAP_TOKEN ?? 'local-dev-bootstrap-token';
const SHOTS = 'tests/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---- Synthetic feed (relative to now) ----
const H = 3_600_000;
const fmt = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const now = Date.now();
const feed = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//E2E synthetic feed//EN
BEGIN:VEVENT
UID:e2e-fb-upcoming
DTSTART:${fmt(now + 48 * H)}
SUMMARY:Football vs Sample State
LOCATION:Las Cruces\\, N.M.
DESCRIPTION:TV: ESPN+\\nRadio: Aggie Radio Network
URL:https://nmstatesports.com/sports/football/schedule
END:VEVENT
BEGIN:VEVENT
UID:e2e-mbb-today
DTSTART:${fmt(now + 3 * H)}
SUMMARY:Men's Basketball at Example Tech
LOCATION:Lubbock\\, Texas
DESCRIPTION:Watch: CBS Sports Network
END:VEVENT
BEGIN:VEVENT
UID:e2e-vb-final
DTSTART:${fmt(now - 30 * H)}
SUMMARY:Volleyball vs Placeholder U (W\\, 3-1)
LOCATION:Las Cruces\\, N.M.
END:VEVENT
END:VCALENDAR
`;
const feedServer = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/calendar' }); res.end(feed); }).listen(8799);

// On phones the reply box lives in a bottom bar until tapped.
async function openReply(page) {
  if (await page.isVisible('.dock-bar .fake-input')) await page.click('.dock-bar .fake-input');
  await page.waitForSelector('#reply-box', { state: 'visible' });
}

async function api(page, path, opts = {}) {
  return page.evaluate(async ({ path, opts }) => {
    const r = await fetch(`/api${path}`, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'x-nsf': '1', 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { path, opts });
}

const browser = await chromium.launch();
try {
  // ---------- Unauthenticated access ----------
  const anon = await browser.newContext();
  const ap = await anon.newPage();
  await ap.goto(BASE + '/');
  await ap.waitForURL('**/login');
  check('Unauthenticated visitor is sent to the login page', ap.url().endsWith('/login'));
  for (const path of ['/feed', '/forums', '/threads/1', '/members', '/home', '/games', '/messages', '/chat/rooms', '/files/abc', '/admin/overview', '/search?q=aggie']) {
    const r = await api(ap, path);
    check(`Unauthenticated GET /api${path} is rejected`, r.status === 401, `status ${r.status}`);
  }
  const csrf = await ap.evaluate(async () => (await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
  check('POST without the CSRF header is blocked', csrf === 403, `status ${csrf}`);
  const wsAnon = await ap.evaluate(() => new Promise((res) => { const w = new WebSocket(location.origin.replace('http', 'ws') + '/api/chat/lounge/ws'); w.onopen = () => res('open'); w.onerror = () => res('error'); w.onclose = () => res('closed'); }));
  check('Unauthenticated chat WebSocket is refused', wsAnon !== 'open', wsAnon);

  // ---------- 1. Admin setup + invitation ----------
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminCtx.newPage();
  await admin.goto(BASE + '/setup');
  await admin.fill('#tk', TOKEN);
  await admin.fill('#su', 'AggieAdmin');
  await admin.fill('#se', 'admin@example.test');
  await admin.fill('#sp', 'admin-password-123');
  await admin.click('button:has-text("Create administrator")');
  await admin.waitForURL('**/admin');
  check('First administrator created through one-time setup', admin.url().endsWith('/admin'));
  const setupAgain = await api(admin, '/auth/setup', { body: { token: TOKEN, username: 'Second', email: 'x@example.test', password: 'whatever-123' } });
  check('Setup cannot be run a second time', setupAgain.status === 409, `status ${setupAgain.status}`);

  await admin.goto(BASE + '/admin/invites');
  await admin.fill('#in', 'E2E member');
  await admin.click('button:has-text("Create invitation")');
  const inviteLink = await admin.inputValue('input[aria-label="Invitation link"]');
  check('Administrator creates an invitation link', /\/join\/[\w-]{20,}$/.test(inviteLink), inviteLink.replace(/join\/.*/, 'join/…'));
  await admin.click('button:has-text("Close")');

  // ---------- 2. New member registers and logs in (iPhone-sized) ----------
  const memberCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const member = await memberCtx.newPage();
  await member.goto(inviteLink);
  await member.fill('#un', 'CrimsonFan');
  await member.fill('#dn', 'Crimson Fan');
  await member.fill('#em', 'member@example.test');
  await member.fill('#pw', 'member-password-123');
  await member.fill('#pc', 'member-password-123');
  await member.click('button:has-text("Join NMSU Sports Forum")');
  await member.waitForURL('**/settings?welcome=1');
  check('Invited member registers and is signed in', member.url().includes('/settings'));
  const reuse = await api(ap, '/auth/register', { body: { token: inviteLink.split('/join/')[1], username: 'Another', email: 'another@example.test', password: 'another-pass-123' } });
  check('A one-use invitation cannot be reused', reuse.status === 400, `status ${reuse.status}`);
  // Sign out and back in through the UI.
  await api(member, '/auth/logout', { method: 'POST' });
  await member.goto(BASE + '/login');
  await member.fill('#u', 'CrimsonFan');
  await member.fill('#p', 'member-password-123');
  await member.click('button:has-text("Sign in")');
  await member.waitForURL(BASE + '/');
  check('Member signs out and back in', member.url() === BASE + '/');
  const badLogin = await api(ap, '/auth/login', { body: { username: 'CrimsonFan', password: 'wrong-password' } });
  check('Wrong password is rejected', badLogin.status === 401);
  await api(member, '/me/prefs', { method: 'PATCH', body: { my_sports: ['fb', 'mbb'] } });

  // ---------- 3. Member creates a thread (with a poll) ----------
  await member.goto(BASE + '/new?forum=aggie-memorial');
  await member.fill('#title', 'Predictions for the home opener');
  await member.fill('#desc', 'How do you see Saturday going?');
  await member.fill('#body', 'I think the defense carries us. **Aggies by 10.**');
  await member.click('button:has-text("Add a poll")');
  await member.fill('#pq', 'Who wins?');
  await member.fill('#po0', 'NM State');
  await member.fill('#po1', 'Sample State');
  await member.click('button:has-text("Post discussion")');
  await member.waitForURL(/\/t\/\d+/);
  const threadUrl = member.url().split('?')[0];
  const threadId = Number(threadUrl.split('/t/')[1]);
  await member.waitForSelector('h1:has-text("Predictions for the home opener")');
  check('Member creates a discussion thread', threadId > 0, `thread ${threadId}`);
  await member.click('.poll-option:has-text("NM State")');
  await member.waitForSelector('.poll-option.mine');
  check('Member votes in the poll', await member.isVisible('.poll-option.mine'));
  await member.screenshot({ path: `${SHOTS}/iphone-thread.png`, fullPage: true });

  // ---------- 4. Another member replies and reacts ----------
  // The member leaves the thread; while it is open, live updates would mark new replies read immediately.
  await member.goto(BASE + '/forums');
  const adminBaselinePulse = (await api(member, '/pulse')).body;
  await admin.goto(`${BASE}/t/${threadId}`);
  await admin.waitForSelector('article.post');
  await admin.click('article.post button[aria-label^="Thumbs up"]');
  await admin.waitForSelector('article.post button.react.on');
  check('Administrator gives a thumbs-up', await admin.isVisible('article.post button.react.on'));
  await admin.click('article.post button:has-text("Quote")');
  await admin.fill('#reply-box', 'Great call @CrimsonFan, the defense looked ready.');
  await admin.click('button:has-text("Post reply")');
  await admin.waitForSelector('article.post >> nth=1');
  const replyText = await admin.textContent('article.post >> nth=1');
  check('Administrator replies with a quote and a mention', replyText.includes('defense looked ready') && replyText.includes('wrote:'));
  // Look up the post id as the admin: fetching the thread as the member would mark it read.
  const firstPostId = (await api(admin, `/threads/${threadId}`)).body.posts[0].id;
  const selfReact = await api(member, `/posts/${firstPostId}/react`, { body: { value: 1 } });
  check('Members cannot react to their own posts', selfReact.status === 400);

  // ---------- 5. Reputation and unread ----------
  const prof = await api(member, '/members/2');
  check('Aggie Reputation counts the thumbs-up', prof.body.member.reputation === 1, `reputation ${prof.body.member.reputation}`);
  const down = await api(admin, `/posts/${(await api(admin, `/threads/${threadId}`)).body.posts[0].id}/react`, { body: { value: -1 } });
  const prof2 = await api(member, '/members/2');
  check('Thumbs-down records disagreement without subtracting reputation', down.body.down === 1 && prof2.body.member.reputation === 0, `rep ${prof2.body.member.reputation} (thumbs-up replaced by thumbs-down)`);
  await api(admin, `/posts/${(await api(admin, `/threads/${threadId}`)).body.posts[0].id}/react`, { body: { value: 1 } });
  const pulse = (await api(member, '/pulse')).body;
  check('Member sees the reply as unread and gets notified', pulse.unread_threads >= 1 && pulse.notifications >= 1, `unread ${pulse.unread_threads}, notifications ${pulse.notifications} (before: ${adminBaselinePulse.unread_threads})`);
  await member.goto(BASE + '/?tab=unread');
  await member.waitForSelector(`a[href^="/t/${threadId}"]`);
  check('Unread tab lists the discussion', await member.isVisible(`.thread-title.unread`));
  await member.click(`a[href^="/t/${threadId}"]`);
  await member.waitForSelector('article.post >> nth=1');
  await member.waitForTimeout(500);
  const pulseAfter = (await api(member, '/pulse')).body;
  check('Opening the discussion clears its unread state', pulseAfter.unread_threads === pulse.unread_threads - 1, `unread now ${pulseAfter.unread_threads}`);

  // Draft autosave survives a reload.
  await openReply(member);
  await member.fill('#reply-box', 'Draft that should survive a reload');
  await member.waitForTimeout(1600);
  await member.reload();
  await member.waitForTimeout(800);
  await openReply(member);
  check('Reply drafts autosave on the server', (await member.inputValue('#reply-box')) === 'Draft that should survive a reload');

  // Photo attachment.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8AARwxkiQEAd8gH+aWr8m0AAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync('tests/screenshots/tiny.png', png);
  await member.setInputFiles('.composer input[type=file]', 'tests/screenshots/tiny.png');
  await member.waitForSelector('.thumbs .thumb');
  await member.fill('#reply-box', 'Here is a photo from the tailgate.');
  await member.click('button:has-text("Post reply")');
  await member.waitForSelector('.post-photos img');
  const imgOk = await member.evaluate(() => { const i = document.querySelector('.post-photos img'); return fetch(i.src).then((r) => r.status); });
  check('Member attaches a photo that only signed-in members can load', imgOk === 200 && (await api(ap, '/files/x')).status === 401);

  // ---------- 6. Search and navigation ----------
  await member.goto(BASE + '/search?q=home%20opener');
  await member.waitForSelector(`.thread-title:has-text("Predictions for the home opener")`);
  check('Search finds the discussion', true);
  await member.goto(BASE + '/forums');
  await member.waitForURL('**/feed');
  await member.waitForSelector('h2:has-text("The Board")');
  const onBoard = await member.waitForSelector(`.thread-list a[href^="/t/${threadId}"]`, { timeout: 8000 }).then(() => true, () => false);
  check('One Board holds every discussion (old forum links land there)', onBoard);
  await member.screenshot({ path: `${SHOTS}/iphone-board.png`, fullPage: true });
  await member.goto(BASE + '/rosters');
  await member.waitForSelector('h1:has-text("Rosters")');
  const rosterHref = await member.getAttribute('.hub-list li:has-text("Football") a:has-text("Roster")', 'href');
  check('Rosters & links page links every sport to its official roster', rosterHref === 'https://nmstatesports.com/sports/football/roster' && (await member.locator('.hub-list li').count()) >= 13);

  // ---------- 7. Game Center from the automatic feed ----------
  await admin.goto(BASE + '/admin/data');
  await admin.selectOption('#fs', 'auto');
  await admin.fill('#fu', 'http://localhost:8799/feed.ics');
  await admin.click('button:has-text("Add feed")');
  await admin.waitForSelector('td:has-text("localhost:8799")');
  await admin.click('button:has-text("Sync now")');
  await admin.waitForSelector('td:has-text("3 events")', { timeout: 20000 });
  check('Schedule feed imports games automatically', true, '3 events imported');
  const resync = await api(admin, '/admin/feeds/sync', { method: 'POST' });
  const gamesList = (await api(member, '/games?range=season')).body.games;
  check('Re-syncing is idempotent (no duplicates)', resync.status === 200 && gamesList.length === 3, `${gamesList.length} games after second sync`);
  await member.goto(BASE + '/games');
  await member.waitForSelector('.game-row');
  const gc = await member.textContent('main');
  check('Game Center lists upcoming games with opponent and TV', gc.includes('Sample State') && gc.includes('ESPN+') && gc.includes('Example Tech'));
  const fb = gamesList.find((g) => g.opponent === 'Sample State');
  const vb = gamesList.find((g) => g.opponent === 'Placeholder U');
  check('Final result read from the official feed', vb.status === 'final' && vb.result === 'W' && vb.nmsu_score === 3 && vb.opp_score === 1);
  await member.goto(`${BASE}/games/${fb.id}`);
  await member.waitForSelector('h2:has-text("Sample State")');
  const gp = await member.textContent('main');
  check('Game page shows date, venue, TV/radio and an automatic pregame thread', gp.includes('Las Cruces') && gp.includes('Aggie Radio Network') && gp.includes('Pregame: NM State vs. Sample State'));
  check('Postgame thread created automatically for the finished game', (await api(member, `/games/${vb.id}`)).body.threads.some((t) => t.game_phase === 'postgame'));
  await member.click('button:has-text("NM State wins")');
  await member.fill('label:has-text("NM State") input', '28');
  await member.fill(`label:has-text("Sample State") input`, '17');
  await member.click('button:has-text("Save pick")');
  await member.waitForSelector('text=Your pick');
  check('Member makes a prediction', true);
  await member.screenshot({ path: `${SHOTS}/iphone-game.png`, fullPage: true });
  // Score it: simulate the final arriving (admin emergency override path), then lifecycle scoring.
  await api(admin, `/admin/games/${fb.id}`, { method: 'PATCH', body: { status: 'final', result: 'W', nmsu_score: 28, opp_score: 17 } });
  await api(admin, '/admin/feeds/sync', { method: 'POST' });
  const standings = (await api(member, '/predictions/standings')).body.standings;
  check('Predictions are scored automatically when a final arrives (exact score = 3 pts)', standings[0]?.username === 'CrimsonFan' && standings[0]?.points === 3, JSON.stringify(standings[0] ?? {}));
  const after = (await api(admin, '/admin/feeds/sync', { method: 'POST' }), (await api(member, `/games/${fb.id}`)).body.game);
  check('Admin correction is protected from being overwritten by the next sync', after.status === 'final' && after.overridden === true);

  // ---------- 8. Live chat between two members ----------
  const mbb = gamesList.find((g) => g.opponent === 'Example Tech');
  const room = `/chat/game-${mbb.id}`;
  await admin.goto(BASE + room);
  await member.goto(BASE + room);
  await admin.waitForSelector('.conn.ok');
  await member.waitForSelector('.conn.ok');
  await admin.fill('#chat-text', 'Tip-off soon, Aggies!');
  await admin.press('#chat-text', 'Enter');
  await member.waitForSelector('.chat-msg:has-text("Tip-off soon, Aggies!")', { timeout: 10000 });
  check('Member receives the administrator\'s chat message in real time', true);
  await member.fill('#chat-text', 'Let\'s go! 🏀');
  await member.press('#chat-text', 'Enter');
  await admin.waitForSelector('.chat-msg:has-text("Let\'s go!")', { timeout: 10000 });
  check('Administrator receives the member\'s reply in real time', true);
  const presence = await admin.textContent('.section-head .tiny');
  check('Chat shows who is in the room', presence.includes('CrimsonFan') && presence.includes('AggieAdmin'), presence.trim());
  await member.screenshot({ path: `${SHOTS}/iphone-chat.png` });
  // Reconnect: drop the member's socket by reloading, message should still be in history.
  await member.reload();
  await member.waitForSelector('.chat-msg:has-text("Tip-off soon, Aggies!")');
  check('Chat history reloads after reconnecting', true);
  const archive = (await api(member, `${room}/archive`)).body.messages;
  check('Game chat is archived permanently', archive.length === 2);
  // Admin removes a chat message; it disappears for the member live.
  const firstMsgId = archive[0].id;
  await admin.click(`.chat-msg:has-text("Tip-off soon") button[aria-label="Remove message"]`);
  await member.waitForSelector('.chat-msg:has-text("Tip-off soon")', { state: 'detached', timeout: 10000 });
  check('Admin removes a chat message and it disappears for everyone', (await api(member, `${room}/archive`)).body.messages.every((m) => m.id !== firstMsgId));
  // Save chat moment as thread.
  const save = await api(member, '/chat/to-thread', { body: { room: `game-${mbb.id}`, message_ids: [archive[1].id], title: 'Great energy before tip-off' } });
  check('A chat moment can be saved as a permanent thread', save.status === 200 && save.body.id > 0);

  // ---------- Private messages ----------
  await member.goto(BASE + '/messages/1');
  await member.fill('#dm', 'Thanks for the invite!');
  await member.press('#dm', 'Enter');
  await member.waitForSelector('.chat-msg:has-text("Thanks for the invite!")');
  const adminPulse = (await api(admin, '/pulse')).body;
  check('Private message delivered and counted as unread for the recipient', adminPulse.messages === 1);
  const routes = await api(admin, '/admin/messages');
  check('No administrator route exists to read private messages', routes.status === 404);

  // ---------- 9. Moderation and invitation management ----------
  await admin.goto(`${BASE}/t/${threadId}`);
  await admin.click('button:has-text("Moderate")');
  await admin.click('.modal button:has-text("Lock")');
  await admin.waitForSelector('.chip:has-text("Locked")');
  const lockedReply = await api(member, `/threads/${threadId}/posts`, { body: { body: 'Can I still reply?' } });
  check('Admin locks a discussion and members can no longer reply', lockedReply.status === 403);
  await admin.click('button:has-text("Moderate")');
  await admin.click('.modal button:has-text("Pin")');
  await admin.waitForSelector('.chip:has-text("Pinned")');
  check('Admin pins a discussion', true);
  const board = (await api(member, '/feed?tab=latest&games=1')).body.threads;
  check('Pinned topics sit at the top of the Board', board[0]?.id === threadId && board[0].pinned === true);
  const reportRes = await api(member, `/posts/${(await api(member, `/threads/${threadId}`)).body.posts[1].id}/report`, { body: { reason: 'Testing the report flow' } });
  const reports = (await api(admin, '/admin/reports')).body.reports;
  check('Member reports a post and admins see it', reportRes.status === 200 && reports.length === 1);
  await api(admin, `/admin/reports/${reports[0].id}`, { method: 'PATCH', body: { status: 'resolved', note: 'ok' } });
  const remove = await api(admin, `/posts/${(await api(admin, `/threads/${threadId}`)).body.posts[2].id}`, { method: 'DELETE', body: { reason: 'Off-topic test removal' } });
  check('Admin removes a post', remove.status === 200 && (await api(member, `/threads/${threadId}`)).body.posts[2].deleted === true);
  await admin.goto(BASE + '/admin/invites');
  await admin.fill('#in', 'To be revoked');
  await admin.click('button:has-text("Create invitation")');
  const revokeLink = await admin.inputValue('input[aria-label="Invitation link"]');
  await admin.click('button:has-text("Close")');
  await admin.click('tr:has-text("To be revoked") button:has-text("Revoke")');
  await admin.waitForSelector('tr:has-text("To be revoked") td:has-text("Revoked")');
  const revokedCheck = await api(ap, `/auth/invite/${revokeLink.split('/join/')[1]}`);
  check('Admin revokes an invitation and it stops working', revokedCheck.body.valid === false);
  const lastAdmin = await api(admin, '/admin/members/1', { method: 'PATCH', body: { role: 'member' } });
  check('The last administrator cannot be removed', lastAdmin.status === 400);
  const memberAdmin = await api(member, '/admin/overview');
  check('Regular members cannot use admin APIs', memberAdmin.status === 403);
  // Suspension signs the member out.
  await api(admin, '/admin/members/2', { method: 'PATCH', body: { status: 'suspended', days: 1, reason: 'e2e test' } });
  const suspended = await api(member, '/home');
  check('Suspending a member ends their session immediately', suspended.status === 401);
  await api(admin, '/admin/members/2', { method: 'PATCH', body: { status: 'active', reason: 'e2e test over' } });
  await api(member, '/auth/login', { body: { username: 'CrimsonFan', password: 'member-password-123' } });
  // Suggestion implemented → Idea Contributor badge.
  const sug = await api(admin, '/threads', { body: { forum: 'suggestions', title: 'Add a rivalry countdown', description: 'For UTEP and UNM weeks', body: 'Countdown banner idea.' } });
  await api(admin, `/admin/threads/${sug.body.id}`, { method: 'PATCH', body: { suggestion_status: 'implemented' } });
  const contributions = (await api(admin, '/contributions')).body.contributions;
  check('Implemented suggestion awards Idea Contributor automatically', contributions.some((c) => c.badge === 'idea'));


  // ---------- Additional coverage ----------
  const t2 = await api(member, '/threads', { body: { forum: 'general', title: 'Editing test thread', description: 'Checks edit history', body: 'Original text' } });
  const p2 = (await api(member, `/threads/${t2.body.id}`)).body.posts[0].id;
  await api(member, `/posts/${p2}`, { method: 'PATCH', body: { body: 'Edited text' } });
  const hist = (await api(admin, `/posts/${p2}/history`)).body;
  check('Members edit their posts and the edit history is kept', hist.current === 'Edited text' && hist.edits[0]?.old_body === 'Original text');
  const otherEdit = await api(admin, `/posts/${p2}`, { method: 'PATCH', body: { body: 'Admin edit' } });
  const memberEditsAdmin = await api(member, `/posts/${(await api(member, `/threads/${threadId}`)).body.posts[1].id}`, { method: 'PATCH', body: { body: 'hijack' } });
  check("Members can't edit other people's posts (admins can)", otherEdit.status === 200 && memberEditsAdmin.status === 403);

  const resetLink = (await api(admin, '/admin/members/2/reset-link', { method: 'POST' })).body.link;
  const resetCtx = await browser.newContext();
  const rp = await resetCtx.newPage();
  await rp.goto(resetLink);
  await rp.fill('#np', 'brand-new-password-1');
  await rp.fill('#nc', 'brand-new-password-1');
  await rp.click('button:has-text("Save password")');
  await rp.waitForURL(BASE + '/');
  const oldPw = await api(ap, '/auth/login', { body: { username: 'CrimsonFan', password: 'member-password-123' } });
  const reuseReset = await api(ap, '/auth/reset', { body: { token: resetLink.split('/reset/')[1], password: 'another-password-9' } });
  check('Admin-issued password reset link works once and replaces the old password', oldPw.status === 401 && reuseReset.status === 400);
  await resetCtx.close();
  const relog = await api(member, '/auth/login', { body: { username: 'CrimsonFan', password: 'brand-new-password-1' } });
  check('Member signs in with the new password', relog.status === 200);

  const profile = await api(member, '/me/profile', { method: 'PATCH', body: { display_name: 'Crimson Fan', bio: 'Season ticket holder since 1998.', grad_year: 1998, city: '', state: '', interests: 'Football', legacy_moniker: 'CrimsonDave', legacy_join_year: 2003, legacy_post_count: 12000, legacy_upvotes: 1368, show_email: false, show_on_map: false, birthday_md: '04-15', show_birthday: true, } });
  const seen = (await api(admin, '/members/2')).body.member;
  check('Profile edits, Aggie Alert legacy fields and private email work', profile.status === 200 && seen.legacy_moniker === 'CrimsonDave' && seen.legacy_post_count === 12000 && seen.legacy_upvotes === 1368 && seen.email === null && seen.post_count >= 1);
  const found = (await api(admin, '/search?q=CrimsonDave')).body.members;
  check('Members can be found by their old Aggie Alert moniker', found.some((m) => m.username === 'CrimsonFan'));

  await api(admin, '/mutes', { body: { target_type: 'user', target_id: 2, muted: true } });
  const mutedView = (await api(admin, `/threads/${threadId}`)).body.posts[0].muted;
  const blockedDm = await api(member, '/messages/1', { body: { body: 'are you there?' } });
  check('Muting hides a member\'s posts and blocks their private messages', mutedView === true && blockedDm.status === 403);
  await api(admin, '/mutes', { body: { target_type: 'user', target_id: 2, muted: false } });

  const ev = await api(member, '/events', { body: { kind: 'watch_party', title: 'Watch party at the sports bar', location: 'Las Cruces', starts_at: Date.now() + 47 * H, game_id: fb.id } });
  await api(admin, `/events/${ev.body.id}/rsvp`, { body: { status: 'going' } });
  const evd = (await api(member, `/events/${ev.body.id}`)).body;
  const cal = (await api(member, '/calendar')).body;
  check('Community calendar shows games, events with RSVPs and opt-in birthdays', evd.rsvps.length === 2 && cal.games.length >= 1 && cal.events.length === 1 && cal.birthdays.some((b) => b.username === 'CrimsonFan'));

  const bm = await api(member, `/posts/${(await api(member, `/threads/${threadId}`)).body.posts[0].id}/bookmark`, { body: { bookmarked: true, note: 'read later', remind_at: Date.now() - 1000 } });
  const cron = await fetch(`${BASE}/__scheduled?cron=*/30+*+*+*+*`);
  await new Promise((r) => setTimeout(r, 1500));
  const notes = (await api(member, '/notifications')).body.notifications;
  check('Scheduled job runs and delivers bookmark reminders', bm.status === 200 && cron.status === 200 && notes.some((n) => n.type === 'reminder'));
  const daily = await fetch(`${BASE}/__scheduled?cron=17+9+*+*+*`);
  check('Daily housekeeping job runs', daily.status === 200);

  const mine = (await api(member, '/feed?tab=mysports')).body.threads;
  check('“My sports” feed shows only chosen sports', mine.length > 0 && mine.every((t) => ['aggie-memorial', 'the-pan-am'].includes(t.forum.slug)));
  for (const path of ['/time-machine', '/year-in-review', '/contributions', '/map', '/predictions', '/calendar', '/drafts', '/bookmarks']) {
    await member.goto(BASE + path);
    await member.waitForSelector('main h1', { timeout: 10000 });
    const err = await member.$('.error-box');
    check(`Page ${path} loads`, !err);
  }
  const tm = (await api(member, '/time-machine')).body.games;
  check('Time Machine lists past games with their discussion and chat counts', tm.some((g) => g.opponent === 'Placeholder U'));

  // ---------- 10. Screens at iPhone and desktop sizes ----------
  await member.goto(BASE + '/login').catch(() => {});
  await memberCtx.clearCookies();
  await member.goto(BASE + '/login');
  await member.fill('#u', 'CrimsonFan');
  await member.fill('#p', 'brand-new-password-1');
  await member.click('button:has-text("Sign in")');
  await member.waitForURL(BASE + '/');
  await member.waitForSelector('.hero h2');
  await member.screenshot({ path: `${SHOTS}/iphone-home.png`, fullPage: true });
  const mobileOverflow = await member.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('iPhone-sized home has no horizontal scrolling', !mobileOverflow);
  check('iPhone layout shows the bottom navigation', await member.isVisible('.bottom-nav'));
  await admin.goto(BASE + '/');
  await admin.waitForSelector('.hero h2');
  await admin.waitForSelector('.right-rail .game-row');
  await admin.screenshot({ path: `${SHOTS}/desktop-home.png`, fullPage: true });
  check('Desktop layout shows three columns (navigation, discussions, game center)', (await admin.isVisible('.left-rail')) && (await admin.isVisible('.right-rail')) && !(await admin.isVisible('.bottom-nav')));
  await admin.goto(`${BASE}/t/${threadId}`);
  await admin.screenshot({ path: `${SHOTS}/desktop-thread.png`, fullPage: true });
  await admin.goto(`${BASE}/games/${fb.id}`);
  await admin.screenshot({ path: `${SHOTS}/desktop-game.png`, fullPage: true });
  await admin.goto(`${BASE}/admin`);
  await admin.screenshot({ path: `${SHOTS}/desktop-admin.png`, fullPage: true });
  await admin.goto(`${BASE}/forums`);
  await admin.screenshot({ path: `${SHOTS}/desktop-forums.png`, fullPage: true });
  await member.goto(`${BASE}/members/2`);
  await member.waitForSelector('.rep');
  await member.screenshot({ path: `${SHOTS}/iphone-profile.png`, fullPage: true });
  const ring = (await admin.content()).toLowerCase().includes('ring of honor') || (await member.content()).toLowerCase().includes('ring of honor');
  check('Ring of Honor is not shown anywhere in the site', !ring);
} catch (e) {
  check('Unexpected error', false, e.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await browser.close();
  feedServer.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

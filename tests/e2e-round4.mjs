// Moderation v2: fair troll flags, moderator review with reasons, warnings, timed suspensions,
// three-moderator bans, appeals decided by a different moderator, and flag-abuse controls.
// Run after the other three suites on the same local database.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const SHOTS = 'tests/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

async function api(page, path, opts = {}) {
  return page.evaluate(async ({ path, opts }) => {
    const r = await fetch(`/api${path}`, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'x-nsf': '1', 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { path, opts });
}
async function login(browser, u, p, viewport = { width: 1280, height: 900 }) {
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto(BASE + '/login');
  await page.fill('#u', u);
  await page.fill('#p', p);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(BASE + '/');
  return page;
}
const answer = (page, text) => page.once('dialog', (d) => d.accept(text));

const browser = await chromium.launch();
try {
  const admin = await login(browser, 'AggieAdmin', 'admin-password-123');
  const crimson = await login(browser, 'CrimsonFan', 'brand-new-password-1');
  const helper = await login(browser, 'FlagHelper', 'helper-password-1');
  const troll = await login(browser, 'RivalTroll', 'troll-password-1', { width: 390, height: 844 });
  const inv = (await api(admin, '/admin/invites', { body: { note: 'second helper' } })).body.link;
  const helper2 = await (await browser.newContext()).newPage();
  await helper2.goto(inv);
  await helper2.fill('#un', 'FlagHelperTwo');
  await helper2.fill('#em', 'helper2@example.test');
  await helper2.fill('#pw', 'helper2-password-1');
  await helper2.fill('#pc', 'helper2-password-1');
  await helper2.click('button:has-text("Join NMSU Sports Forum")');
  await helper2.waitForURL('**/settings?welcome=1');
  const members = (await api(admin, '/admin/members')).body.members;
  const id = (u) => members.find((m) => m.username === u)?.id ?? null;
  const ids = { crimson: id('CrimsonFan'), helper: id('FlagHelper'), troll: id('RivalTroll') };
  const threadId = (await api(crimson, '/feed?tab=latest&tag=recruiting')).body.threads[0].id;
  const post = (body) => api(troll, `/threads/${threadId}/posts`, { body: { body } });
  const view = async (page, postId) => (await api(page, `/threads/${threadId}?post=${postId}`)).body.posts.find((p) => p.id === postId);
  const rep = async () => (await api(crimson, `/members/${ids.troll}`)).body.member.reputation;

  // ---------- Three flags temporarily hide; no author penalty, reputation untouched ----------
  const p1 = (await post('Borderline hot take for the flag test.')).body.id;
  await api(crimson, `/posts/${p1}/react`, { body: { value: 1 } });
  const repBefore = await rep();
  const f1 = await api(crimson, `/posts/${p1}/troll`, { method: 'POST' });
  const dup = await api(crimson, `/posts/${p1}/troll`, { method: 'POST' });
  check('A member cannot flag the same post twice', f1.body.flags === 1 && dup.status === 409);
  const f2 = await api(helper, `/posts/${p1}/troll`, { method: 'POST' });
  check('Two flags are not enough to hide a post', f2.body.hidden === false && !(await view(crimson, p1)).hidden);
  const f3 = await api(admin, `/posts/${p1}/troll`, { method: 'POST' });
  check("A moderator's flag counts as one flag (third flag hides)", f3.body.flags === 3 && f3.body.hidden === true);
  const hiddenView = await view(crimson, p1);
  check('Hidden post text is withheld from others', hiddenView.hidden === true && hiddenView.body === '');
  await crimson.goto(`${BASE}/t/${threadId}?post=${p1}`);
  await crimson.waitForSelector("text=Temporarily hidden while moderators review it");
  check('Members see "temporarily hidden while moderators review it"', true);
  check('Flags never reduce Aggie Reputation', (await rep()) === repBefore, `before ${repBefore}, after ${await rep()}`);
  const next = await post('A normal follow-up post.');
  check('The author is not penalized: their next post appears immediately', next.body.pending === false);
  const authorNote = (await api(troll, '/notifications')).body.notifications.some((n) => /temporarily hidden while moderators review/.test(n.text));
  const modNotes = await Promise.all([admin, crimson].map(async (pg) => (await api(pg, '/notifications')).body.notifications));
  check('The author is told, and moderators are notified', authorNote && modNotes[0].some((n) => /needs review/.test(n.text)));

  // ---------- Moderator review: restore with a reason ----------
  await admin.goto(BASE + '/admin/reports');
  await admin.waitForSelector('text=Flagged posts');
  const flaggedText = await admin.textContent('main');
  check('Review queue shows who flagged and their flag history', /Flagged by:/.test(flaggedText) && /past flags dismissed/.test(flaggedText));
  check('A decision requires a reason', await admin.isDisabled('button:has-text("Restore")'));
  await admin.fill('input[aria-label="Reason"]', 'Hot take, not trolling.');
  await admin.screenshot({ path: `${SHOTS}/admin-flag-review.png`, fullPage: true });
  await admin.click('button:has-text("Restore")');
  await admin.waitForSelector('text=Restored');
  const restored = await view(crimson, p1);
  check('Moderator restores the post', restored.hidden === false && restored.body.includes('Borderline'));
  check('The author is told it was restored', (await api(troll, '/notifications')).body.notifications.some((n) => /reviewed and restored/.test(n.text)));

  // ---------- Remove + warning, member appeal, decided by a different moderator ----------
  const p2 = (await post('Go Miners, Aggies stink (flag test two).')).body.id;
  for (const pg of [crimson, helper, helper2]) await api(pg, `/posts/${p2}/troll`, { method: 'POST' });
  await admin.goto(BASE + '/admin/reports');
  await admin.waitForSelector('text=flag test two');
  await admin.fill('input[aria-label="Reason"]', 'Baiting other members.');
  await admin.check('text=Also send a warning');
  await admin.click('button:has-text("Remove")');
  await admin.waitForSelector('text=Removed');
  check('Moderator removes the post and issues a warning', (await view(crimson, p2)).deleted === true);
  await troll.goto(BASE + '/settings#moderation');
  await troll.waitForSelector('#moderation >> text=Baiting other members', { timeout: 10000 }).catch(() => {});
  const hist = await troll.textContent('#moderation');
  check("The member sees the removal and warning with the moderator's reason", /Post removed/.test(hist) && /Warning/.test(hist) && /Baiting other members/.test(hist));
  await troll.locator('#moderation > div').filter({ hasText: 'Post removed' }).locator('button:has-text("Appeal")').click();
  await troll.fill('textarea[aria-label="Appeal message"]', 'I was joking with friends; I did not mean to bait anyone.');
  await troll.click('button:has-text("Send appeal")');
  await troll.waitForSelector('text=Appeal under review');
  check('Member files an appeal from Settings', true);
  const appealId = (await api(admin, '/admin/appeals')).body.appeals.find((a) => a.status === 'open').id;
  const self = await api(admin, `/admin/appeals/${appealId}`, { body: { decision: 'overturned', note: 'Own decision' } });
  check('The moderator who acted cannot decide the appeal', self.status === 403);
  await api(admin, `/admin/members/${ids.crimson}`, { method: 'PATCH', body: { role: 'admin', reason: 'Second moderator' } });
  const granted = await api(crimson, `/admin/appeals/${appealId}`, { body: { decision: 'overturned', note: 'Context makes it clear it was banter.' } });
  check('A different moderator grants the appeal and the decision is undone', granted.status === 200 && (await view(helper, p2)).deleted === false);

  // ---------- Suspensions: one moderator, temporary only ----------
  const noDays = await api(admin, `/admin/members/${ids.troll}`, { method: 'PATCH', body: { status: 'suspended', reason: 'test' } });
  const tooLong = await api(admin, `/admin/members/${ids.troll}`, { method: 'PATCH', body: { status: 'suspended', days: 365, reason: 'test' } });
  check('One moderator cannot suspend indefinitely or beyond 90 days', noDays.status === 400 && tooLong.status === 400);
  await api(admin, `/admin/members/${ids.troll}`, { method: 'PATCH', body: { status: 'suspended', days: 2, reason: 'Cooling-off period.' } });
  const blocked = await api(helper2, '/auth/login', { body: { username: 'RivalTroll', password: 'troll-password-1' } });
  check('Suspended member sees the reason when signing in', blocked.status === 403 && /Cooling-off period/.test(blocked.body.error));
  await api(admin, `/admin/members/${ids.troll}`, { method: 'PATCH', body: { status: 'active', reason: 'Lifted early after talking it over.' } });

  // ---------- Permanent ban needs three moderators ----------
  await api(admin, `/admin/members/${ids.helper}`, { method: 'PATCH', body: { role: 'admin', reason: 'Third moderator' } });
  const troll2 = await login(browser, 'RivalTroll', 'troll-password-1');
  const prop = await api(admin, '/admin/bans', { body: { user_id: ids.troll, reason: 'Repeated baiting after warnings and a suspension.' } });
  check('Proposing a ban counts as one approval; the member stays active', prop.body.status === 'open' && prop.body.approvals === 1 && (await api(troll2, '/home')).status === 200);
  const second = await api(crimson, `/admin/bans/${prop.body.id}/vote`, { body: { vote: 'approve', reason: 'Agree, pattern of behavior.' } });
  check('Two approvals are still not enough', second.body.status === 'open' && (await api(troll2, '/home')).status === 200);
  await helper.goto(BASE + '/admin/bans');
  await helper.waitForSelector('text=Permanent ban proposals');
  await helper.screenshot({ path: `${SHOTS}/admin-bans.png`, fullPage: true });
  answer(helper, 'Agree after reviewing the history.');
  await helper.click('button:has-text("Approve")');
  await helper.waitForSelector('text=Ban approved by three moderators');
  check('Third moderator approval bans the member immediately', (await api(troll2, '/home')).status === 401);

  // ---------- Ban appeal from the sign-in page, decided by a moderator who did not vote ----------
  const loginPage = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await loginPage.goto(BASE + '/login');
  await loginPage.fill('#u', 'RivalTroll');
  await loginPage.fill('#p', 'troll-password-1');
  await loginPage.click('button:has-text("Sign in")');
  await loginPage.waitForSelector('text=permanently banned');
  await loginPage.fill('#appeal', 'I understand the concerns and will follow the rules. Please reconsider.');
  await loginPage.click('button:has-text("Send appeal")');
  await loginPage.waitForSelector('text=Your appeal was sent');
  await loginPage.screenshot({ path: `${SHOTS}/banned-appeal.png`, fullPage: true });
  check('A banned member can appeal from the sign-in page', true);
  const banAppeal = (await api(admin, '/admin/appeals')).body.appeals.find((a) => a.status === 'open' && a.action === 'ban');
  const voterTry = await api(crimson, `/admin/appeals/${banAppeal.id}`, { body: { decision: 'overturned', note: 'test' } });
  check('Moderators who voted for the ban cannot decide its appeal', voterTry.status === 403);
  await api(admin, `/admin/members/${id('FlagHelperTwo') ?? (await api(admin, '/admin/members')).body.members.find((m) => m.username === 'FlagHelperTwo').id}`, { method: 'PATCH', body: { role: 'admin', reason: 'Fourth moderator' } });
  const decided = await api(helper2, `/admin/appeals/${banAppeal.id}`, { body: { decision: 'upheld', note: 'The pattern of behavior is clear; the ban stands.' } });
  check('An uninvolved moderator decides the ban appeal', decided.status === 200);

  // ---------- Flag-abuse controls ----------
  const flaggers = (await api(admin, '/admin/flaggers')).body.flaggers;
  check('Moderators can review each member\'s flagging history', flaggers.some((f) => f.username === 'CrimsonFan' && f.flags >= 2 && f.dismissed >= 1));
  const memberInv = (await api(admin, '/admin/invites', { body: { note: 'flag abuser' } })).body.link;
  const abuser = await (await browser.newContext()).newPage();
  await abuser.goto(memberInv);
  await abuser.fill('#un', 'FlagHappy');
  await abuser.fill('#em', 'flaghappy@example.test');
  await abuser.fill('#pw', 'flaghappy-password-1');
  await abuser.fill('#pc', 'flaghappy-password-1');
  await abuser.click('button:has-text("Join NMSU Sports Forum")');
  await abuser.waitForURL('**/settings?welcome=1');
  const abuserId = (await api(admin, '/admin/members')).body.members.find((m) => m.username === 'FlagHappy').id;
  await api(admin, `/admin/members/${abuserId}/flagging`, { body: { enabled: false, reason: 'Repeated bad-faith flags.' } });
  const denied = await api(abuser, `/posts/${p1}/troll`, { method: 'POST' });
  check('A moderator can switch off flagging for an abusive flagger', denied.status === 403);

  // ---------- Inviting by text and email ----------
  await admin.goto(BASE + '/admin/invites');
  await admin.fill('#iname', 'Rick');
  await admin.fill('#iphone', '(575) 555-0123');
  await admin.fill('#ie', 'rick@example.test');
  await admin.click('button:has-text("Create invitation")');
  await admin.waitForSelector('text=Invitation ready');
  const sms = await admin.getAttribute('a:has-text("Text it")', 'href');
  const mail = await admin.getAttribute('a:has-text("Email it")', 'href');
  const link = await admin.inputValue('input[aria-label="Invitation link"]');
  check('Text it opens Messages with the number and a ready-written invitation', sms.startsWith('sms:+15755550123') && decodeURIComponent(sms).includes('Hey Rick') && decodeURIComponent(sms).includes(link));
  check('Email it opens the email app with subject and invitation', mail.startsWith('mailto:rick%40example.test?subject=') && decodeURIComponent(mail).includes(link));
  await admin.screenshot({ path: `${SHOTS}/admin-invite-text.png`, fullPage: true });
  await admin.click('button:has-text("Close")');
  const invList = (await api(admin, '/admin/invites')).body.invites;
  const rick = invList[0];
  check('The phone number is not stored on the site, and the invite is not locked to the email', !JSON.stringify(invList).includes('555') && rick.note.startsWith('Rick') && rick.email === null);
  const reg = await (await browser.newContext()).newPage();
  await reg.goto(link);
  await reg.fill('#un', 'RickFromTailgate');
  await reg.fill('#em', 'rick.other@example.test');
  await reg.fill('#pw', 'rick-password-123');
  await reg.fill('#pc', 'rick-password-123');
  await reg.click('button:has-text("Join NMSU Sports Forum")');
  await reg.waitForURL('**/settings?welcome=1');
  check('The texted invitation link works for sign-up', true);

  // ---------- One-tap invite (pick the person in Messages or Mail) ----------
  await admin.goto(BASE + '/admin/invites');
  await admin.click('button:has-text("Invite someone from my phone")');
  await admin.waitForSelector('text=Invitation ready');
  const qsms = await admin.getAttribute('a:has-text("Text it")', 'href');
  const qmail = await admin.getAttribute('a:has-text("Email it")', 'href');
  const qlink = await admin.inputValue('input[aria-label="Invitation link"]');
  check('One tap creates an invitation that opens Messages or Mail ready to pick a contact', /^sms:[?&]body=/.test(qsms) && decodeURIComponent(qsms).includes(qlink) && qmail.startsWith('mailto:?subject=') && decodeURIComponent(qmail).includes(qlink));
  await admin.screenshot({ path: `${SHOTS}/admin-invite-quick.png` });
  await admin.click('button:has-text("Close")');

  // ---------- Members invite friends ----------
  await reg.goto(BASE + '/invite');
  await reg.click('button:has-text("Invite someone from my phone")');
  await reg.waitForSelector('text=Invitation ready');
  const mlink = await reg.inputValue('input[aria-label="Invitation link"]');
  const msms = await reg.getAttribute('a:has-text("Text it")', 'href');
  await reg.screenshot({ path: `${SHOTS}/iphone-invite-friends.png` });
  await reg.click('button:has-text("Close")');
  const friend = await (await browser.newContext()).newPage();
  await friend.goto(mlink);
  await friend.fill('#un', 'FriendOfRick');
  await friend.fill('#em', 'friend.of.rick@example.test');
  await friend.fill('#pw', 'friend-password-123');
  await friend.fill('#pc', 'friend-password-123');
  await friend.click('button:has-text("Join NMSU Sports Forum")');
  await friend.waitForURL('**/settings?welcome=1');
  const mine = (await api(reg, '/invites/mine')).body.invites;
  check('A member invites a friend from their phone and the friend joins', /^sms:[?&]body=/.test(msms) && mine[0]?.used_by === 'FriendOfRick');
  await api(admin, '/admin/settings', { method: 'PUT', body: { member_invites: '0' } });
  const off = await api(reg, '/invites', { body: {} });
  await api(admin, '/admin/settings', { method: 'PUT', body: { member_invites: '1' } });
  check('Admins can switch member invitations off', off.status === 403);

  // ---------- Start a game thread (members pick the game) ----------
  await api(admin, '/admin/settings', { method: 'PUT', body: { auto_game_threads: '0' } });
  // The test feed's upcoming games already got automatic threads; a moderator removing one frees the game for a member-started thread.
  const before = (await api(reg, '/games/pickable')).body.games.find((g) => g.status === 'scheduled' && g.starts_at > Date.now());
  if (before?.pregame_thread_id) await api(admin, `/admin/threads/${before.pregame_thread_id}`, { method: 'PATCH', body: { deleted: true } });
  const pickable = (await api(reg, '/games/pickable')).body.games;
  const target = pickable.find((g) => g.status === 'scheduled' && g.starts_at > Date.now() && !g.pregame_thread_id);
  let pickOk = false;
  if (target) {
    await reg.goto(BASE + '/new');
    await reg.waitForSelector('text=Start a game thread');
    const row = reg.locator('.game-picker li', { hasText: target.opponent }).first();
    if (!(await row.isVisible())) await reg.click('.more-sports summary');
    await row.locator('a:has-text("Start pregame thread")').click();
    await reg.waitForFunction(() => document.querySelector('#title')?.value.startsWith('Pregame:'));
    await reg.screenshot({ path: `${SHOTS}/iphone-game-thread.png` });
    await reg.fill('#body', 'Who starts at quarterback?');
    await reg.click('button:has-text("Post discussion")');
    await reg.waitForURL(/\/t\/\d+/);
    const gtid = Number(reg.url().split('/t/')[1].split('?')[0]);
    const linked = (await api(reg, `/games/${target.id}`)).body.game.pregame_thread_id === gtid;
    const dup = await api(reg, '/threads', { body: { title: 'Another pregame', body: 'x', game_id: target.id, game_phase: 'pregame' } });
    pickOk = linked && dup.status === 409;
  }
  check('Members start a game thread by picking the game; it links to the game page and duplicates are refused', pickOk, target ? '' : 'no pickable game');
  await reg.goto(BASE + '/new');
  await reg.waitForSelector('text=Start a game thread');
  await reg.screenshot({ path: `${SHOTS}/iphone-game-picker.png`, fullPage: true });

  // ---------- Headline sports first ----------
  const feat = (await api(reg, '/games?range=season&sport=featured')).body.games;
  const allG = (await api(reg, '/games?range=season')).body.games;
  const home = (await api(reg, '/home')).body;
  check('Football and men\'s basketball lead the Game Center and home; other sports stay listed separately',
    feat.length > 0 && feat.every((g) => ['fb', 'mbb'].includes(g.sport)) && allG.length > feat.length
    && home.games.every((g) => ['fb', 'mbb'].includes(g.sport)) && home.other_games.every((g) => !['fb', 'mbb'].includes(g.sport)));

  // ---------- Crest full screen; chats only for the Lounge and headline sports ----------
  await reg.goto(BASE + '/feed');
  await reg.click('button[aria-label="View the crest full screen"]');
  await reg.waitForSelector('.crest-viewer img');
  await reg.screenshot({ path: `${SHOTS}/iphone-crest-full.png` });
  await reg.click('.crest-viewer');
  const crestClosed = await reg.waitForSelector('.crest-viewer', { state: 'detached', timeout: 3000 }).then(() => true, () => false);
  check('Tapping the header crest opens it full screen, and a tap closes it', crestClosed);
  const rooms = (await api(reg, '/chat/rooms')).body.rooms;
  const season = (await api(reg, '/games?range=season')).body.games;
  const minor = season.find((g) => !['fb', 'mbb'].includes(g.sport));
  const minorChat = minor ? await api(reg, `/chat/game-${minor.id}/history`) : { status: 404 };
  const lounge = await api(reg, '/chat/lounge/history');
  check('Chat rooms: the Aggie Lounge plus football and men\'s basketball games only', rooms[0].room === 'lounge' && rooms.slice(1).every((r) => ['fb', 'mbb'].includes(r.game.sport)) && minorChat.status === 404 && lounge.status === 200);

  // ---------- ESPN link and live score bar ----------
  const fbGame = season.find((g) => g.sport === 'fb');
  const fbLive = fbGame ? (await api(reg, `/games/${fbGame.id}/live`)).body : null;
  const minorLive = minor ? (await api(reg, `/games/${minor.id}/live`)).body : null;
  await reg.goto(BASE + `/games/${fbGame.id}`);
  const espnBtn = await reg.waitForSelector('a:has-text("on ESPN"), a:has-text("ESPN Gamecast")', { timeout: 8000 }).then(() => true, () => false);
  check('Football and men\'s basketball games link to ESPN (live score bar during the game); other sports don\'t', espnBtn && fbLive?.espn_url?.startsWith('https://www.espn.com/college-football/') && minorLive?.espn_url === null);

  // ---------- Admin → Members: compact rows with an Actions menu ----------
  await admin.setViewportSize({ width: 390, height: 844 });
  await admin.goto(BASE + '/admin/members');
  await admin.waitForSelector('select[aria-label="Actions for RickFromTailgate"]');
  await admin.screenshot({ path: `${SHOTS}/iphone-admin-members.png` });
  await admin.selectOption('select[aria-label="Actions for RickFromTailgate"]', 'reset');
  const resetModal = await admin.waitForSelector('input[aria-label="Reset link"]', { timeout: 5000 }).then(() => true, () => false);
  check('Admin member actions live in one compact menu on a phone', resetModal && (await admin.inputValue('input[aria-label="Reset link"]')).includes('/reset/'));
  await admin.click('button:has-text("Close")');
  await admin.setViewportSize({ width: 1440, height: 900 });

  // ---------- Game Center: Football and Men's Hoops are separate ----------
  await reg.setViewportSize({ width: 390, height: 844 });
  await reg.goto(BASE + '/games?range=season');
  await reg.waitForSelector('section.card .game-row');
  const fbOnly = await reg.$$eval('section.card .game-row .tiny', (els) => els.map((e) => e.textContent || ''));
  await reg.click('button:has-text("Men\'s Hoops")');
  await reg.waitForFunction(() => [...document.querySelectorAll('section.card .game-row .tiny')].length > 0 && [...document.querySelectorAll('section.card .game-row .tiny')].every((e) => /MEN'S BASKETBALL/i.test(e.textContent || '')));
  await reg.screenshot({ path: `${SHOTS}/iphone-games.png` });
  check('Game Center opens on football, with men\'s basketball as its own button', fbOnly.length > 0 && fbOnly.every((t) => /FOOTBALL/i.test(t)));

  // ---------- Member map starts ----------
  await reg.goto(BASE + '/map');
  const mapOk = await reg.waitForSelector('.leaflet-control-zoom', { timeout: 10000 }).then(() => true, () => false);
  check('The member map loads (zoom controls appear; map images come from OpenStreetMap)', mapOk);

  // ---------- Founding Members: first N who join by the deadline ----------
  const badgeOf = async (uid) => ((await api(admin, `/members/${uid}`)).body.member.badges || []).some((b) => b.badge === 'founding');
  const allMembers = (await api(admin, '/admin/members')).body.members;
  const firstId = Math.min(...allMembers.map((m) => m.id));
  const laterId = allMembers.find((m) => m.username === 'RickFromTailgate').id;
  await api(admin, '/admin/settings', { method: 'PUT', body: { founding_limit: '2' } });
  const capped = (await badgeOf(firstId)) && !(await badgeOf(laterId));
  await api(admin, '/admin/settings', { method: 'PUT', body: { founding_limit: '', founding_until: '2020-01-01' } });
  const pastDeadline = !(await badgeOf(firstId));
  await api(admin, '/admin/settings', { method: 'PUT', body: { founding_limit: '', founding_until: '' } });
  check('Founding Member goes to the first members who join by the deadline, up to the limit (defaults: Thanksgiving, 30)', capped && pastDeadline && (await badgeOf(laterId)));

  // ---------- Posting without gatekeeping ----------
  await reg.goto(BASE + '/new');
  await reg.fill('#title', 'Tailgate spot this Saturday?');
  await reg.fill('#body', 'Where is everyone setting up?');
  await reg.click('button:has-text("Post discussion")');
  await reg.waitForURL(/\/t\/\d+/);
  const newTid = Number(reg.url().split('/t/')[1]);
  const newT = (await api(reg, `/threads/${newTid}`)).body;
  check('A discussion posts with just a title and message, filed under General Discussion', JSON.stringify(newT).includes('General Discussion'));
  await reg.screenshot({ path: `${SHOTS}/new-thread-simple.png`, fullPage: true });

  // ---------- Aggie Alert history on the profile ----------
  await reg.setViewportSize({ width: 390, height: 844 });
  await reg.goto(BASE + '/settings');
  await reg.fill('#legacy_moniker', 'RioRanchoAggie');
  await reg.fill('#legacy_join_year', '08/24/2010');
  await reg.fill('#legacy_post_count', '3,901');
  await reg.fill('#legacy_upvotes', '1,368');
  await reg.click('button:has-text("Save profile")');
  const savedMsg = await reg.waitForSelector('text=✓ Profile saved', { timeout: 8000 }).then(() => true, () => false);
  check('Saving shows a message that stays on screen, and a full date works for the join year', savedMsg);
  const rickId = (await api(admin, '/admin/members')).body.members.find((m) => m.username === 'RickFromTailgate').id;
  await reg.goto(BASE + `/members/${rickId}`);
  await reg.waitForSelector('text=up votes received');
  const aa = await reg.textContent('.note-box');
  check('Members add Aggie Alert up votes (commas OK) and they show on the profile', aa.includes('RioRanchoAggie') && aa.includes('3,901 posts') && aa.includes('1,368 up votes received') && aa.includes('since 2010'));
  await reg.screenshot({ path: `${SHOTS}/profile-aggie-alert.png`, fullPage: true });

  // ---------- webcal:// feed links ----------
  const wc = await api(admin, '/admin/feeds', { body: { sport: 'auto', url: 'webcal://calendar.example.test/feed.ics' } });
  const feedsNow = (await api(admin, '/admin/overview')).body.feeds;
  check('Calendar links starting with webcal:// are accepted as https feeds', wc.status === 200 && feedsNow.some((f) => f.url === 'https://calendar.example.test/feed.ics'));
  const wcFeed = feedsNow.find((f) => f.url === 'https://calendar.example.test/feed.ics');
  if (wcFeed) await api(admin, `/admin/feeds/${wcFeed.id}`, { method: 'DELETE' });

  // ---------- Rosters & links, scores strip ----------
  const hubSave = await api(admin, '/admin/settings', { method: 'PUT', body: { hub_links: 'Aggie radio | https://radio.example.test/live\nBad link | http://insecure.example.test\nnot a link' } });
  const hub = (await api(reg, '/hub')).body;
  check('Admins add radio and other links; only https links are shown', hubSave.status === 200 && hub.links.length === 1 && hub.links[0].label === 'Aggie radio');
  await reg.goto(BASE + '/rosters');
  await reg.waitForSelector('a:has-text("Aggie radio")');
  await reg.screenshot({ path: `${SHOTS}/iphone-rosters.png`, fullPage: true });
  const sb = (await api(reg, '/scoreboard')).body;
  await reg.goto(BASE + '/feed');
  await reg.waitForSelector('.score-chip');
  check('The Board opens with the latest score', sb.recent.length > 0 && (await reg.textContent('.scoreboard')).includes('–'));
  await reg.screenshot({ path: `${SHOTS}/iphone-board-scores.png` });

  // ---------- Audit history ----------
  const log = (await api(admin, '/admin/log')).body.log;
  const actions = new Set(log.map((l) => l.action));
  const needed = ['auto_hide_pending_review', 'restore_post', 'remove_post', 'warn', 'appeal_overturned', 'suspend', 'lift_suspension', 'ban_proposed', 'ban_vote_approve', 'ban', 'appeal_upheld', 'revoke_flagging'];
  check('Every decision is recorded in the audit history with its reason', needed.every((a) => actions.has(a)) && log.find((l) => l.action === 'restore_post').detail === 'Hot take, not trolling.', needed.filter((a) => !actions.has(a)).join(', '));
} catch (e) {
  check('Unexpected error', false, e.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} moderation checks passed`);
  process.exit(failed.length ? 1 : 0);
}

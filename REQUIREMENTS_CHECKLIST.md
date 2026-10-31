# Requirements Checklist
Every owner decision, where it is documented, and its build status. Update the status column at each delivery; never mark something Verified without an end-to-end test.

Status values: **Planned** · **Built** (code exists) · **Verified** (tested end-to-end) · **Blocked** (named reason)

Audit, October 30, 2026 (after first live review): 65 rows. 56 Verified, 8 Built (working, but still waiting on a key, a file, real data or a real-device check), 1 Blocked (recruiting data needs a free key). Owner changes: one Board instead of venue forums (row 8), open sign-up as a switch alongside invites (row 56), member-picked game threads instead of automatic ones (row 18), and optional thread descriptions (row 9).

| # | Requirement | Documented in | Status |
| --- | --- | --- | --- |
| 1 | Name is NMSU Sports Forum (never Aggie Clubhouse); independent, not NMSU-affiliated | VISION, DECISIONS | Verified — name everywhere; independence disclaimer on sign-in and home |
| 2 | Approved cowboy crest used as supplied; no crossed pistols; derivatives (icon, badges) need owner approval | CLAUDE, BRAND_COLORS | Verified — the owner supplied the approved crest (Oct 30, 2026), stored at `assets/approved-crest.webp`; header, favicons, app and home-screen icons are generated from it unchanged. No other derivatives made. The owner reviewed the trademark considerations and chose to keep the crest as is (DECISIONS, Oct 31). |
| 3 | Official NMSU colors (#8C0B42, #FFFFFF, #B6A5AD, #D7C9C4, #6D6E71); screenshots are layout-only | BRAND_COLORS | Verified — CSS tokens in `src/client/styles.css` |
| 4 | Mobile-first, polished desktop; phone bottom nav, desktop three columns | VISION, DECISIONS | Verified — e2e checks bottom nav at 390px and three columns at 1440px, no horizontal scroll |
| 5 | Installable PWA with crest home-screen icon | MILESTONE 1 | Built — manifest, icons, service worker; site is live. Add to Home Screen not yet confirmed on the owner's iPhone |
| 6 | Invite-only accounts: one-use/expiring invites, login, password reset, secure sessions, server-side protection | MILESTONE 3 | Verified — one-use expiring invites, login, admin reset links, sessions, suspension ends sessions. Self-service reset email needs an email service (optional). Admins invite by text (opens Messages with the invitation written; phone numbers are never stored) or email (opens the email app, or sends automatically once Resend is configured) |
| 7 | No member content or APIs visible without login | MILESTONE 3 | Verified — every private API returns 401 signed out; WebSocket refused; photos require sign-in |
| 8 | ~~Venue forums in navigation~~ superseded: one Board with pinned topics on top; sport labels on game threads | MILESTONE 4, DECISIONS | Verified — old forum links land on the Board; pinned first |
| 9 | Threads with optional description, replies, quote, edit (with history), links, photo attachments; posting needs only a title and message (files under General Discussion unless a venue is picked) | MILESTONE 5, DECISIONS | Verified — quote, edit with history, photo attachments, links; title-and-message-only posting lands in General Discussion |
| 10 | Pinned/locked threads, search, follows, unread + jump to first unread | MILESTONE 5 | Verified — pin, lock, search, follow, unread and jump to first unread |
| 11 | Thumbs-up/down; Aggie Reputation counts thumbs-up only; no self-reactions | MILESTONE 6 | Verified |
| 12 | Most appreciated post on profile (member may choose to highlight); weekly highlight on home | MILESTONE 6–7 | Verified — profile most appreciated post, weekly highlight on home; members can highlight a chosen post |
| 13 | Directory, profiles, avatar, Aggie Alert legacy moniker + self-reported join year, post count and up votes received (separate from forum count and reputation) | MILESTONE 7, DECISIONS | Verified |
| 14 | Founding Member (30 days after configurable launch date); honorary founders | DECISIONS | Built — Founding Member from configurable launch date; optional automatic honorary threshold (off by default) plus admin award |
| 15 | 4–5 admins; invite, pin/lock/move/remove, reports, member suspension; can't remove last admin; owner/hosting separate from admin | MILESTONE 8 | Verified |
| 16 | **Schedules and results self-populate from official sources; manual = emergency override only** | SPORTS_DATA | Verified live — the official nmstatesports.com composite feed is connected in production (181 games, syncing without errors) |
| 17 | ~~No live scores at launch~~ superseded: live score and clock for football and men's basketball from ESPN's public scoreboard (30-second refresh, shared cache), ESPN Gamecast link, official live stats link; never invent scores | SPORTS_DATA, DECISIONS | Built — parsing unit-tested with ESPN-shaped data; ESPN links e2e-tested. **The live lookup can only be confirmed during the first game (Nov 3, men's basketball)**, because ESPN is unreachable from the build environment |
| 18 | Game-day lifecycle: member-started game threads from a game picker (automatic pregame/postgame threads optional, off by default), game chat rooms | SPORTS_DATA, DECISIONS | Verified — picker links threads to games and refuses duplicates; automatic mode still tested with the switch on |
| 19 | Authenticated live chat, moderation, reconnect; rolling window; permanent per-game archive. Rooms: the Aggie Lounge, plus automatic game chats for football and men's basketball only | MILESTONE 10, DECISIONS | Verified — two members chatting live, presence, reconnect, admin removal, permanent archive |
| 20 | Turn a chat moment into a thread | MILESTONE 10 | Verified |
| 21 | Polls (one vote per member, optional close date) | MILESTONE 11 | Verified |
| 22 | Bookmarks with reminders | MILESTONE 13 | Verified — reminder delivered by the scheduled job |
| 23 | Notifications and preferences | MILESTONE 11 | Verified — in-app notifications and per-member preferences (phone push: see row 43) |
| 24 | Auto-saved drafts | MILESTONE 13 | Verified — server-side drafts survive reload and cross-device |
| 25 | Spoiler-free scores mode | MILESTONE 13 | Built |
| 26 | Personal feed (my sports / following / unread); tabs removed from the Board at the owner's request, Following still on the home page | MILESTONE 13 | Verified |
| 27 | Mute a member or a forum | MILESTONE 13 | Verified |
| 28 | Strictly private 1:1 messages; block; voluntary report of a specific message | MILESTONE 13, DECISIONS | Verified — no admin route exists; block via mute; voluntary single-message report |
| 29 | Predictions with season standings, auto-scored from results | MILESTONE 13 | Verified — locks at game time, auto-scored, season standings |
| 30 | Community calendar: games, watch parties, gatherings, opt-in birthdays | MILESTONE 13 | Verified |
| 31 | Aggie History forum exempt from archive; Aggie Time Machine | MILESTONE 13 | Verified — Aggie History forum never archives; Time Machine page |
| 32 | Year in Review | MILESTONE 13 | Built — page loads; content grows with data |
| 33 | Suggestions & Improvements board with statuses; Idea Contributor auto-credit | MILESTONE 13, VISION | Verified — statuses and automatic Idea Contributor |
| 34 | Recognition badges with reasons; contribution history; recognition never buys authority | VISION, DECISIONS | Verified |
| 35 | Opt-in approximate member map; never precise locations | VISION, MILESTONE 13 | Built — city-level, rounded ~10 km. Geocoding uses OpenStreetMap and could not be tested from the build environment |
| 36 | Threads read-only 90 days after last reply (admins can reopen); discussion photos deleted 90 days after upload | DECISIONS | Built and unit-tested; photo expiry runs in the daily job |
| 37 | Ring of Honor (Rojo) hidden from site and navigation | AGGIE_RING_OF_HONOR, MILESTONE | Verified — e2e confirms it appears nowhere |
| 38 | Politics forum not at launch | MILESTONE | Verified — no Politics forum |
| 39 | Low maintenance: no daily chores; automated jobs; failures alert admins | MILESTONE 14 | Verified — scheduled jobs run; feed failures notify admins |
| 40 | Cloudflare hosting at NMSUSportsForum.com via repeatable GitHub deploy; inspect DNS first; no surprise costs | CLAUDE, MILESTONE 2 | Verified — live at nmsusportsforum.com; every merge to main deploys through GitHub Actions |
| 41 | No secrets, invites or member data in the public repo | README, CLAUDE | Verified — secrets via Wrangler/GitHub secrets only |
| 42 | Live-updating game threads | DECISIONS (Oct 30 research round), MILESTONE | Verified — WebSocket signal; new replies appear in an open thread (e2e) |
| 43 | Phone push notifications (iPhone home-screen app) | DECISIONS (Oct 30 research round), MILESTONE | Built — Web Push with VAPID; payload encryption unit-tested; device registration verified. Real delivery needs a phone after deployment (iPhone: add to Home Screen first) |
| 44 | Dark mode | DECISIONS (Oct 30 research round), MILESTONE | Verified — follows the phone setting or member choice |
| 45 | Spoiler tags inside posts | DECISIONS (Oct 30 research round), MILESTONE | Verified — ||text|| or [spoiler]…[/spoiler]; hidden in notification excerpts |
| 46 | @mention autocomplete | DECISIONS (Oct 30 research round), MILESTONE | Verified |
| 47 | Link previews (YouTube, articles) | DECISIONS (Oct 30 research round), MILESTONE | Verified for articles and YouTube. Tweet text comes from X's free embed service, which was blocked in the build environment, so tweet cards were tested only in their "unavailable" state |
| 48 | Thread tags (filter buttons removed from the Board at the owner's request; tags still show on threads) | DECISIONS (Oct 30 research round), MILESTONE | Verified |
| 49 | Moderation extras: auto-expiring suspensions, thread merge, first-post approval | DECISIONS (Oct 30 research round), MILESTONE | Verified — timed suspensions lift themselves; merge; first-post approval (off by default, toggle in Admin → Settings) |
| 50 | Member data download and account deletion | DECISIONS (Oct 30 research round), MILESTONE | Verified |
| 51 | Aggie-themed ranks by post count | DECISIONS (Oct 30 research round), MILESTONE | Verified |
| 52 | Automatic postgame Player of the Game vote | DECISIONS (Oct 30 research round), MILESTONE | Verified — automatic poll on every postgame thread; members nominate and vote |
| 53 | Recruiting and transfer portal tracker (automatic where a free permitted source exists) | DECISIONS (Oct 30 research round), MILESTONE | Built and verified with synthetic CollegeFootballData responses. **Blocked: needs the free CFBD_API_KEY and network access; confirm CFBD terms before launch** |
| 54 | Effortless tweet sharing: pasted links embed, Share a tweet button, iPhone share-sheet Shortcut, tweets attach to recruit cards | DECISIONS, MILESTONE | Verified — paste-to-embed, Share a tweet (home, threads, player cards), clipboard Paste button, /share page for the iPhone Shortcut (setup steps in Settings) |
| 55 | Phone refinements: pinned reply bar, floating new-thread button, pull to refresh, shorter phone home, game threads grouped under the game card, bigger reaction buttons, compact list option | DECISIONS (Oct 30) | Verified |
| 56 | Sign-up mode switch (invite-only / open) with Turnstile, email confirmation, newcomer first-post approval | DECISIONS (open community) | Verified — admin switch; open sign-up rate-limited, newcomer first post reviewed. Turnstile and email confirmation are built but switch on only once their keys are added (not testable here without them) |
| 57 | Public reading switch: read without an account, sign up to post | DECISIONS (open community) | Verified — visitors read discussions, games, recruiting; members-only areas and all writes return 401 |
| 58 | Troll flagging with moderator review: 3 member flags temporarily hide a post, all moderators notified, restore/remove/warn with reasons, no reputation or author penalty from flags | DECISIONS (refined troll flagging) | Verified — three flags hide pending review; no author penalty; reputation unchanged; moderators notified; restore/remove/warn with reasons |
| 59 | Temporary suspensions by one moderator (max 90 days); permanent bans require 3 moderator approvals | DECISIONS (refined troll flagging) | Verified — single moderator limited to 1–90 day suspensions; bans take effect only at three approvals; proposals expire after 14 days |
| 60 | Appeals for removals, warnings, suspensions and bans, decided by a different moderator; suspended members can appeal from sign-in | DECISIONS (refined troll flagging) | Verified — appeals from Settings and the sign-in page; the acting moderator (or approving voters) cannot decide; granting undoes the decision |
| 61 | Abusive-flagging review: one flag per member per post, flag accuracy history, repeated flags against one person, revoke flagging privilege | DECISIONS (refined troll flagging) | Verified — duplicate flags refused; flagger history and per-author repeat flags shown in review; flagging can be revoked |
| 62 | Audit history: every moderation decision recorded with its reason | DECISIONS (refined troll flagging) | Verified — audit log entries with reasons for every decision |
| 63 | Latest scores strip on top of the Board (automatic results, spoiler-free respected; football and men's basketball first) | DECISIONS (after first live review) | Verified — e2e, plus the owner saw live NM State results |
| 64 | Rosters & links hub: official roster/schedule links per sport, admin-curated radio/stream links | DECISIONS (after first live review) | Verified — the owner confirmed the roster links work on the live site; only https links accepted |
| 65 | Members invite friends from their phone (one tap; daily limit; admin switch) | DECISIONS (after first live review) | Verified — member invites a friend who joins; switch off refuses |

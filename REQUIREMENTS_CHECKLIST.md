# Requirements Checklist
Every owner decision, where it is documented, and its build status. Update the status column at each delivery; never mark something Verified without an end-to-end test.

Status values: **Planned** · **Built** (code exists) · **Verified** (tested end-to-end) · **Blocked** (named reason)

| # | Requirement | Documented in | Status |
| --- | --- | --- | --- |
| 1 | Name is NMSU Sports Forum (never Aggie Clubhouse); independent, not NMSU-affiliated | VISION, DECISIONS | Verified — name everywhere; independence disclaimer on sign-in and home |
| 2 | Approved cowboy crest used as supplied; no crossed pistols; derivatives (icon, badges) need owner approval | CLAUDE, BRAND_COLORS | Built — interim icons cropped from the owner's screenshot; **needs the original crest file**. Derivatives beyond icon crops not made. |
| 3 | Official NMSU colors (#8C0B42, #FFFFFF, #B6A5AD, #D7C9C4, #6D6E71); screenshots are layout-only | BRAND_COLORS | Verified — CSS tokens in `src/client/styles.css` |
| 4 | Mobile-first, polished desktop; phone bottom nav, desktop three columns | VISION, DECISIONS | Verified — e2e checks bottom nav at 390px and three columns at 1440px, no horizontal scroll |
| 5 | Installable PWA with crest home-screen icon | MILESTONE 1 | Built — manifest, icons, service worker. Not yet tested on a physical iPhone (needs deployment) |
| 6 | Invite-only accounts: one-use/expiring invites, login, password reset, secure sessions, server-side protection | MILESTONE 3 | Verified — one-use expiring invites, login, admin reset links, sessions, suspension ends sessions. Self-service reset email needs an email service (optional) |
| 7 | No member content or APIs visible without login | MILESTONE 3 | Verified — every private API returns 401 signed out; WebSocket refused; photos require sign-in |
| 8 | Venue forums with sport labels: Pan Am, Aggie Memorial, Presley Askew Field, Softball Complex, The Pitch, Track & Field, Other Sports, General | MILESTONE 4 | Verified |
| 9 | Threads with description, replies, quote, edit (with history), links, photo attachments | MILESTONE 5 | Verified — quote, edit with history, photo attachments, links |
| 10 | Pinned/locked threads, search, follows, unread + jump to first unread | MILESTONE 5 | Verified — pin, lock, search, follow, unread and jump to first unread |
| 11 | Thumbs-up/down; Aggie Reputation counts thumbs-up only; no self-reactions | MILESTONE 6 | Verified |
| 12 | Most appreciated post on profile (member may choose to highlight); weekly highlight on home | MILESTONE 6–7 | Verified — profile most appreciated post, weekly highlight on home; members can highlight a chosen post |
| 13 | Directory, profiles, avatar, Aggie Alert legacy moniker + self-reported post count (separate from forum count) | MILESTONE 7 | Verified |
| 14 | Founding Member (30 days after configurable launch date); honorary founders | DECISIONS | Built — Founding Member from configurable launch date; optional automatic honorary threshold (off by default) plus admin award |
| 15 | 4–5 admins; invite, pin/lock/move/remove, reports, member suspension; can't remove last admin; owner/hosting separate from admin | MILESTONE 8 | Verified |
| 16 | **Schedules and results self-populate from official sources; manual = emergency override only** | SPORTS_DATA | Built and verified with a synthetic feed (import, idempotent re-sync, overrides, alerts). **Blocked: real nmstatesports.com feed URLs not yet confirmed** (network blocked in build environment) |
| 17 | No live in-game scores at launch; link to official live stats; never invent scores | SPORTS_DATA | Verified |
| 18 | Automatic pregame → live chat → postgame lifecycle | SPORTS_DATA | Verified — pregame thread ~3 days out, postgame at final, game chat rooms |
| 19 | Authenticated live chat, moderation, reconnect; rolling window; permanent per-game archive | MILESTONE 10 | Verified — two members chatting live, presence, reconnect, admin removal, permanent archive |
| 20 | Turn a chat moment into a thread | MILESTONE 10 | Verified |
| 21 | Polls (one vote per member, optional close date) | MILESTONE 11 | Verified |
| 22 | Bookmarks with reminders | MILESTONE 13 | Verified — reminder delivered by the scheduled job |
| 23 | Notifications and preferences | MILESTONE 11 | Verified — in-app notifications and per-member preferences. Phone push notifications not built |
| 24 | Auto-saved drafts | MILESTONE 13 | Verified — server-side drafts survive reload and cross-device |
| 25 | Spoiler-free scores mode | MILESTONE 13 | Built |
| 26 | Personal feed (my sports / following / unread) | MILESTONE 13 | Verified |
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
| 40 | Cloudflare hosting at NMSUSportsForum.com via repeatable GitHub deploy; inspect DNS first; no surprise costs | CLAUDE, MILESTONE 2 | Built — GitHub Actions deploy workflow. **Blocked: needs Cloudflare access** (docs/DEPLOYMENT.md) |
| 41 | No secrets, invites or member data in the public repo | README, CLAUDE | Verified — secrets via Wrangler/GitHub secrets only |
| 42 | Live-updating game threads | DECISIONS (Oct 30 research round), MILESTONE | Planned |
| 43 | Phone push notifications (iPhone home-screen app) | DECISIONS (Oct 30 research round), MILESTONE | Planned |
| 44 | Dark mode | DECISIONS (Oct 30 research round), MILESTONE | Planned |
| 45 | Spoiler tags inside posts | DECISIONS (Oct 30 research round), MILESTONE | Planned |
| 46 | @mention autocomplete | DECISIONS (Oct 30 research round), MILESTONE | Planned |
| 47 | Link previews (YouTube, articles) | DECISIONS (Oct 30 research round), MILESTONE | Planned |
| 48 | Thread tags with filtering | DECISIONS (Oct 30 research round), MILESTONE | Planned |
| 49 | Moderation extras: auto-expiring suspensions, thread merge, first-post approval | DECISIONS (Oct 30 research round), MILESTONE | Planned |
| 50 | Member data download and account deletion | DECISIONS (Oct 30 research round), MILESTONE | Planned |
| 51 | Aggie-themed ranks by post count | DECISIONS (Oct 30 research round), MILESTONE | Planned |
| 52 | Automatic postgame Player of the Game vote | DECISIONS (Oct 30 research round), MILESTONE | Planned |
| 53 | Recruiting and transfer portal tracker (automatic where a free permitted source exists) | DECISIONS (Oct 30 research round), MILESTONE | Planned |

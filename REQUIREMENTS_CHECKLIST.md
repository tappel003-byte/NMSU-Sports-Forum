# Requirements Checklist
Every owner decision, where it is documented, and its build status. Update the status column at each delivery; never mark something Verified without an end-to-end test.

Status values: **Planned** · **Built** (code exists) · **Verified** (tested end-to-end) · **Blocked** (named reason)

| # | Requirement | Documented in | Status |
| --- | --- | --- | --- |
| 1 | Name is NMSU Sports Forum (never Aggie Clubhouse); independent, not NMSU-affiliated | VISION, DECISIONS | Planned |
| 2 | Approved cowboy crest used as supplied; no crossed pistols; derivatives (icon, badges) need owner approval | CLAUDE, BRAND_COLORS | Planned |
| 3 | Official NMSU colors (#8C0B42, #FFFFFF, #B6A5AD, #D7C9C4, #6D6E71); screenshots are layout-only | BRAND_COLORS | Planned |
| 4 | Mobile-first, polished desktop; phone bottom nav, desktop three columns | VISION, DECISIONS | Planned |
| 5 | Installable PWA with crest home-screen icon | MILESTONE 1 | Planned |
| 6 | Invite-only accounts: one-use/expiring invites, login, password reset, secure sessions, server-side protection | MILESTONE 3 | Planned |
| 7 | No member content or APIs visible without login | MILESTONE 3 | Planned |
| 8 | Venue forums with sport labels: Pan Am, Aggie Memorial, Presley Askew Field, Softball Complex, The Pitch, Track & Field, Other Sports, General | MILESTONE 4 | Planned |
| 9 | Threads with description, replies, quote, edit (with history), links, photo attachments | MILESTONE 5 | Planned |
| 10 | Pinned/locked threads, search, follows, unread + jump to first unread | MILESTONE 5 | Planned |
| 11 | Thumbs-up/down; Aggie Reputation counts thumbs-up only; no self-reactions | MILESTONE 6 | Planned |
| 12 | Most appreciated post on profile (member may choose to highlight); weekly highlight on home | MILESTONE 6–7 | Planned |
| 13 | Directory, profiles, avatar, Aggie Alert legacy moniker + self-reported post count (separate from forum count) | MILESTONE 7 | Planned |
| 14 | Founding Member (30 days after configurable launch date); honorary founders | DECISIONS | Planned |
| 15 | 4–5 admins; invite, pin/lock/move/remove, reports, member suspension; can't remove last admin; owner/hosting separate from admin | MILESTONE 8 | Planned |
| 16 | **Schedules and results self-populate from official sources; manual = emergency override only** | SPORTS_DATA | Planned |
| 17 | No live in-game scores at launch; link to official live stats; never invent scores | SPORTS_DATA | Planned |
| 18 | Automatic pregame → live chat → postgame lifecycle | SPORTS_DATA | Planned |
| 19 | Authenticated live chat, moderation, reconnect; rolling window; permanent per-game archive | MILESTONE 10 | Planned |
| 20 | Turn a chat moment into a thread | MILESTONE 10 | Planned |
| 21 | Polls (one vote per member, optional close date) | MILESTONE 11 | Planned |
| 22 | Bookmarks with reminders | MILESTONE 13 | Planned |
| 23 | Notifications and preferences | MILESTONE 11 | Planned |
| 24 | Auto-saved drafts | MILESTONE 13 | Planned |
| 25 | Spoiler-free scores mode | MILESTONE 13 | Planned |
| 26 | Personal feed (my sports / following / unread) | MILESTONE 13 | Planned |
| 27 | Mute a member or a forum | MILESTONE 13 | Planned |
| 28 | Strictly private 1:1 messages; block; voluntary report of a specific message | MILESTONE 13, DECISIONS | Planned |
| 29 | Predictions with season standings, auto-scored from results | MILESTONE 13 | Planned |
| 30 | Community calendar: games, watch parties, gatherings, opt-in birthdays | MILESTONE 13 | Planned |
| 31 | Aggie History forum exempt from archive; Aggie Time Machine | MILESTONE 13 | Planned |
| 32 | Year in Review | MILESTONE 13 | Planned |
| 33 | Suggestions & Improvements board with statuses; Idea Contributor auto-credit | MILESTONE 13, VISION | Planned |
| 34 | Recognition badges with reasons; contribution history; recognition never buys authority | VISION, DECISIONS | Planned |
| 35 | Opt-in approximate member map; never precise locations | VISION, MILESTONE 13 | Planned |
| 36 | Threads read-only 90 days after last reply (admins can reopen); discussion photos deleted 90 days after upload | DECISIONS | Planned |
| 37 | Ring of Honor (Rojo) hidden from site and navigation | AGGIE_RING_OF_HONOR, MILESTONE | Planned |
| 38 | Politics forum not at launch | MILESTONE | Planned |
| 39 | Low maintenance: no daily chores; automated jobs; failures alert admins | MILESTONE 14 | Planned |
| 40 | Cloudflare hosting at NMSUSportsForum.com via repeatable GitHub deploy; inspect DNS first; no surprise costs | CLAUDE, MILESTONE 2 | Planned |
| 41 | No secrets, invites or member data in the public repo | README, CLAUDE | Planned |

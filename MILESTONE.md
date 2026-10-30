# NMSU Sports Forum — Single Integrated Initial Build

**Current authorization (October 29, 2026):** Build a substantial, working, integrated first release. The owner explicitly does NOT want repeated tiny prototype phases or cosmetic-only milestones. Claude Code (CC) is lead developer. Deliver functioning software on **Cloudflare at NMSUSportsForum.com**, not a mockup that pretends to be a forum.

## Product and visual authority
Read README.md, CLAUDE.md, VISION.md, DECISIONS.md, BRAND_COLORS.md, AGGIE_RING_OF_HONOR.md and all existing repository content. Owner supplies the **approved cowboy crest**, website header and mobile/desktop screenshots directly to CC. Screenshots demonstrate layout and design direction **but their colors are not authoritative**. Website palette MUST follow **BRAND_COLORS.md**, led by official NMSU Aggie Crimson **#8C0B42** and White **#FFFFFF**. Do not replace or redraw approved cowboy artwork without permission.

## Required initial working functionality
1. Responsive mobile-first installable PWA, excellent desktop layout, clear header and navigation, fast performance, accessibility, polished empty/error/loading states.
2. Cloudflare hosting and safe, repeatable GitHub-sourced deployment to NMSUSportsForum.com. First inspect existing Cloudflare DNS, project and site to avoid damage.
3. Real, secure invite-only member accounts: one-use/expiring invitations by admins, login, password reset, appropriate session/security controls, server-side private routes and APIs. **No production community discussions should be public**.
4. Actual database-backed forums: The Pan Am (basketball/volleyball), Aggie Memorial (football), Presley Askew Field (baseball), Softball Complex (softball), The Pitch (women's soccer), Track & Field, Other Sports and General as appropriate. Sport names remain plainly visible.
5. Actual threads, topic description, replies, quote, edit, links/attachments, pinned/locked topics, search, follows, unread tracking and jump-to-unread, reporting and moderation.
6. Thumbs-up/down reactions; earned reputation counts thumbs-up only, never subtracts on thumbs-down; most appreciated post on member profile and weekly highlights if practical.
7. Member directory and profiles, profile edits/avatar, optional self-reported Aggie Alert moniker and old post count separate from forum-created count; Founding Member logic with configurable official launch date.
8. Multiple admins, member invitations, basic report handling, lock/pin/move/remove threads, member moderation. Owner/hosting control must be distinct from community admin authority.
9. Game Center: sports-specific schedules/event pages, opponent/date/time/venue, official broadcast/ticket/live-stats links, automatic pregame → live chat → postgame lifecycle. **All schedule and result data self-populates from external official sources per [SPORTS_DATA.md](SPORTS_DATA.md). Admin entry is an emergency override only, never the normal workflow.** Do not fabricate scores or rely on unsupported APIs. No live in-game scores at launch; link to official live stats.
10. Functional authenticated game-day live chat, game room moderation, reconnect handling. Chat shows a rolling recent window while live; **every game's full chat is archived permanently** and linked to its game page (general lounge archived by day). Members can turn a chat moment into a permanent thread.
11. Polls, bookmarks, notifications and thoughtful user preferences where feasible, implemented end-to-end rather than decorative controls.
12. Persistent data, migrations, secure environment secrets, backup/export approach, sensible logs and test coverage.
13. **Additional features approved Oct 30, 2026 — all in the first build:** auto-saved drafts; jump to first unread; spoiler-free scores mode; personal feed (my sports / following / unread); bookmarks with reminders; mute a member or a whole forum; **strictly private 1:1 messages** (admins cannot read them; recipients can block and may voluntarily report a specific message); predictions (pick winners/scores, season standings, auto-scored); community calendar (games, watch parties, gatherings, opt-in birthdays); Aggie History forum exempt from archiving; Aggie Time Machine (past games with their pregame predictions, chat archive, postgame thread and most appreciated posts); Year in Review; Suggestions & Improvements board with Under Consideration / Planned / Implemented statuses and automatic Idea Contributor credit; recognition badges with recorded reasons and a community contribution history; opt-in approximate member map.
14. **Low maintenance by design:** schedules, game threads, archiving, photo expiry, reminders and backups run automatically. The owner has no daily chores; admins handle invitations and reports only.

If a feature is blocked by unavailable credentials, licensing or a consequential owner decision, deliver the rest fully and name that specific blocker clearly. The owner does not want to approve trivial stages; make normal engineering choices independently.

## Next build round (approved Oct 30, 2026)
Live-updating game threads; phone push notifications; dark mode; spoiler tags; @mention autocomplete; link previews; thread tags; moderation extras (auto-expiring suspensions, thread merge, first-post approval); member data download and account deletion; Aggie-themed ranks; automatic Player of the Game vote; recruiting and transfer portal tracker (automatic from a free permitted source where possible, see SPORTS_DATA.md); effortless tweet sharing (paste a link to embed, Share a tweet button, iPhone share-sheet Shortcut, tweets attach to recruit cards; see DECISIONS.md). Same standard as the first build: working end to end, tested, no decorative controls.

## Deliberately not in launch UI
- **Ring of Honor:** future simple moniker list; Rojo is first. Do NOT place it in launch navigation or public UI until requested.
- Politics forum: not approved for initial launch until opt-in/visibility decision.
- Payments/subscriptions and elaborate memorial systems: not required.
- Advanced gamification beyond the features above. The member map is in scope (item 13) but must never reveal precise locations.

## Build workflow
- Inspect GitHub repo first and establish coherent architecture. Reconcile attached screenshots against BRAND_COLORS.md.
- One sustained implementation effort, with internal testing/checkpoints **not repeated product-owner approval gates**.
- Cloudflare is the target hosting platform; assess actual account/project/DNS before setting up, and do not clobber an existing website or incur unexpected expenses without consent.
- Prefer clear GitHub deploy path. Do not commit API tokens, passwords, member emails, invite secrets or private member data to this **public repo**.
- Avoid unnecessary PRs, branches, agent proliferation and overlapping Cursor/CC edits. Maintain readable commits.
- Test end-to-end flows: invite → register → login → create topic → reply → react → forum browse/search → game chat → admin moderation. Test on phone-sized and desktop-sized views.
- Deploy functional version to NMSUSportsForum.com with verified permissions; otherwise report the exact access blocker, not a claim of deployment.
- Report working features, tests, Cloudflare deployment URL, admin bootstrap procedure, limitations and costs. No placeholder buttons falsely represented as working.

## Acceptance
The owner can use the real website on iPhone and desktop, with correct NMSU colors, approved branding, secure invited-member entry, active forum posting/replying/reactions, sport navigation, Game Center and working chat, and functional administrative controls. One integrated first build, then focused fixes.

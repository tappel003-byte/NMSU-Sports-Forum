# NMSU Sports Forum — Product Vision
Status: Concept baseline, October 29, 2026. This is a planning document, not permission to implement unspecified features.

## Purpose and philosophy
An independent, invitation-only, member-run New Mexico State Aggies sports forum. A welcoming alternative/companion to existing fan message boards, centered on real conversation, athletics, and long-lived community history. Not affiliated with or endorsed by New Mexico State University. No ads, mandatory subscriptions, or commercial ambition. Initial founder is simply a Founding Member in public-facing community life. Forum administrators run the community; technical ownership of repository/domain/hosting can be transferred later.

**Operating principles:** mobile-first, excellent desktop layout, easy to use, low cost, accessible, privacy-preserving, sustainable, community-governed. Start with a manageable build; avoid feature creep and unnecessary branches/PRs. Document decisions before coding.

## Audience and scale
Invite roughly 12 existing Aggie acquaintances initially, perhaps 20–30 early members; plan for eventual 300–500 members and concurrent game-day chat. An account is required for all member content; optional public landing/welcome page only.

## Branding and visual direction
**Approved reference asset (October 29, 2026):** The user's uploaded cowboy crest image `IMG_3489(2).jpeg` is the visual authority. Do not substitute newly generated crossed-pistol graphics or unrelated mascots. The owner supplied the approved crest on October 30, 2026; it is versioned at `assets/approved-crest.webp`, and the site's header and icons are generated from it.

**Brand-color authority:** [BRAND_COLORS.md](BRAND_COLORS.md) — NMSU's verified official palette. Website primary crimson **#8C0B42**, white **#FFFFFF**; secondary **#B6A5AD** and **#D7C9C4**; gray **#6D6E71**. Old colors sampled from the crest are NOT official brand colors. Keep the approved crest composition unchanged unless owner approves edits.\n\n- Crimson, white, charcoal, with a Southwestern collegiate sports-forum character.
- **Use the previously selected cowboy crest as the primary design reference**, not the later crossed-revolver experiments. The crest includes a cowboy with hat and mustache, mountain landscape, adobe architecture, large NMSU lettering, SPORTS FORUM ribbon, and small sports symbols. Preserve that composition as the creative starting point; design derivative header, square PWA shortcut, favicon, sport-category graphics, and badges. The existing generated image is a reference, not a production-ready licensed asset; the actual image must be supplied to the implementation repository before coding.
- A previously discussed website header also exists as a design reference, but the exact asset must be located/provided; do not invent a replacement and call it approved.
- Avoid copying university trademarks, official Pistol Pete art, official lettering, or restricted cultural symbols. The current crest contains elements requiring review (including NMSU/NM STATE lettering and a Zia-style symbol). Develop original alternatives and assess trademark permissions before publication; AI-generated art is not automatically legally cleared.
- App icon must remain legible at small iPhone/desktop shortcut sizes; full crest can remain on website.
- Responsive: phone has compact header, bottom or accessible primary navigation, readable threads, thumb-friendly reactions, game-day chat; tablet/desktop use sidebars, multi-column dashboard, wider reading area, and clear moderation tools. Keyboard and screen-reader usability.

## Home / NMSU Sports Forum
- Featured next NMSU game with sport, opponent, local start time, home/away, venue, score/status when available, TV/radio/streaming links, and entry to Game Center.
- Recent and active forum threads, unread updates, most appreciated post this week, active game chat, upcoming games, optional announcements.
- Member directory and opt-in approximate member map.
- Clean mobile presentation, expanded desktop layout.

## Invitation and account system
- Invitation issued by authorized administrator, unique limited-use/expiring invite link or token; member chooses username/password.
- Secure authentication, reset flow, rate limits, server-side authorization; protect every private route, API, attachment, and live chat channel, not merely the UI.
- Optional member real name, avatar, bio, interests, graduation year, city/state. Email private by default, share only by affirmative opt-in. No precise location or home address collection for map.
- Member may self-report prior Aggie Alert username, join year, and post count, editable at any time and clearly labeled self-reported. Forum's own post count is automatic and not member-editable.
- Founding Member badge for joining in first 30 days after official launch; later Honorary Founding Member possible based on community contribution, criteria not yet finalized.

## Venue-inspired sports forum navigation
The site name and public-facing identity are **NMSU Sports Forum**, not “Aggie Clubhouse.” Organize sports forums around familiar Aggie venues while keeping the sport itself unmistakable in navigation, labels, search, and accessibility:
- **The Pan Am** — basketball (men's and women's); volleyball may share this venue identity while retaining its own sport filter.
- **Aggie Memorial** — football.
- **Presley Askew Field** — baseball.
- **Softball Complex** — softball (official venue naming to confirm before launch).
- **The Pitch** — women's soccer (friendly forum label, not a claim about official facility naming).
- **Track & Field** — track and cross-country; venue naming to verify.
- Other sports (swimming, tennis, golf, etc.) can be added without creating empty forums before participation warrants them.
Mobile: compact category tiles or lists, not an oversized gallery. Desktop: richer venue cards and clear forum directory. Each forum opens recent threads, sport-specific schedules, and associated game-day discussions. Photography must be licensed or owned; reference photos are not production assets.

## Ring of Honor — planned, initially hidden community memorial
The **Aggie Ring of Honor** is a simple permanent list honoring deceased Aggie Alert posters by their **Aggie Alert monikers only**. No biographies, dates, personal details, memorial profiles, reactions, rankings, or tribute workflow are required. Its content lives in [AGGIE_RING_OF_HONOR.md](AGGIE_RING_OF_HONOR.md), starting with Rojo.

**Launch behavior:** leave room for a Ring of Honor page/route and its future navigation, but **do not show the Ring of Honor or its unfinished navigation item at initial launch**. Enable when the owner/community decides the list is ready. Avoid building unnecessary memorial-management complexity now; eventual admins may maintain a simple list.

## Forum and threads
- Categories: Basketball, Football, Other Sports, General; a distinct Politics category is contemplated. Whether Politics is opt-in is **undecided**. No politics in sports discussions.
- Members create threads with required title, primary category, and short topic description. Replies, quoting, mentions, links, appropriately licensed GIFs/images, editing with sensible history/audit, notifications, follow/unfollow, unread markers, search, pinned posts, reports, moderation.
- All members can create polls within threads: choices, optional closing date, one vote/account, results.
- Reactions: thumbs-up and thumbs-down. Explore asking for a reason on thumbs-down to encourage constructive disagreement; precise UX not settled.
- Automatic read-only archive after **90 days since last reply**, retaining original category and searchable text; administrators can reopen. This can be a query/status rule rather than physical migration.
- User-uploaded discussion images deleted **90 days after upload**, independently of thread archive; avatars and site branding stored separately. Clearly warn members about image expiry and do not promise archived pictures persist. Compress/resize images, constrain file types/sizes.

## Aggie Reputation and recognition
- Aggie Reputation: positive thumbs-up received on posts accumulates as a member reputation score. Thumbs-down captures disagreement but does **not** subtract reputation. No self-reactions; one reaction/member/post, changing reaction should recalculate accurately.
- Member profile highlights their **most appreciated post** (highest thumbs-up count), linked to the discussion. Home can feature **most appreciated this week**, based on reactions received during the week; exact tie-break and abuse controls TBD.
- Permanent, administrator-awarded recognition with recorded reasons and dates: Clubhouse Supporter (helped with domain/hosting costs), Forum Architect (designed feature/layout), Forum Developer (code/fixes), Idea Contributor (adopted suggestion), Community Builder, and Founding Member. Badges may appear subtly next to usernames and with explanations in profile.
- A Suggestions & Improvements forum enables proposals, discussion, thumbs-up, and statuses such as Under Consideration / Planned / Implemented. When implemented, credit the contributor. Contributions do not grant moderation authority.
- Supporters history and optional homepage renewal countdown based on actual domain/service renewal data. Sponsorship voluntary, no integrated payment system in initial build, no special access or power for donors. Actual hosting and domain costs must be disclosed rather than assuming a $20 contribution covers everything.

## Games and live chat
- NMSU athletics schedule by sport: opponent, date/time, venue, home/away, links to official schedule, TV/stream/radio, tickets, stats and live scores where available.
- **Schedules and results self-populate from official sources; see SPORTS_DATA.md. Manual entry is an emergency override only.**
- Game Center per event with game-specific chat room and relevant forum links. Live chat shows a rolling window; every game's full chat is archived permanently and linked to the game.
- Automatic game reminders and pregame → live → postgame lifecycle; member opt-in notifications (in-app, and PWA push only when supported and explicitly permitted).
- Official nmstatesports.com can be used for outbound reference links; any automated feed must have permitted, dependable data access. Do not rely on undocumented ESPN endpoints as guaranteed production integrations. Provide graceful fallback (keep last good data, alert admins); manual edits are emergency overrides only.
- Live chat must handle bursts, moderation, blocked users, and reconnect behavior.

## Community features approved October 30, 2026
- Auto-saved drafts, jump to first unread, bookmarks with reminders, personal feeds, mute member/forum, spoiler-free scores mode.
- Strictly private 1:1 messages (admins cannot read; block and voluntary report).
- Predictions with season standings; community calendar (games, watch parties, gatherings, opt-in birthdays).
- Aggie History forum (never archived); **Aggie Time Machine**: every past game keeps its predictions, chat archive, pregame/postgame threads and most appreciated posts; Year in Review.
- Turn a chat moment into a permanent thread.
- Low maintenance by design: no daily chores for the owner.

## Member directory and map
- Searchable member cards and profiles. Optional approximate city/state map pins, member controlled and opt-in; never display precise coordinates or addresses. Pin opens profile. Allow members to hide location and email independently.

## Administration and governance
- Four or five admins anticipated. Admin dashboard: invitations, member status/suspension, reports, category and thread management, announcements, chats, reminders, recognition, archive reopening, suggestions.
- Separate **technical ownership** (domain/GitHub/hosting) from **forum administration**. Founder need not be admin and has no special public owner badge. Lead administrator may be selected/transferred among admins; avoid accidental removal of the final admin. Record significant moderation/admin actions privately.
- Provide documented ownership handoff procedure for repository, domain, infrastructure, secrets, backups and service accounts; don't presume one provider's ownership automatically transfers another.
- Community rules: respectful disagreement, no harassment/personal attacks/doxxing/spam, no politics outside designated area, clear reporting and proportionate moderation. Admins may move, lock, remove, or suspend as needed.

## Approved hosting and proposed technical architecture
- **Approved:** Cloudflare will host the site at **NMSUSportsForum.com**, the domain controlled by the product owner. GitHub is the source of truth. Claude Code is to configure/verify a repeatable deployment to the live domain so the owner can review visual iterations directly on iPhone and desktop. Inspect existing Cloudflare project and DNS before changing them; do not assume hosting is already connected. Protect any existing live site.\n- **Proposed, pending implementation choice:** Installable responsive PWA. React front end; Cloudflare Pages or Workers as appropriate, D1 for persistent records, R2 for images, and Durable Objects or another justified real-time chat approach. Do not provision future data services for the first visual-only milestone.
- Single source of truth for identity and permissions. Backups/export and clear retention policy. Monitor cost as usage grows.
- Private website content requires authentication regardless of whether GitHub repo is public/private.
- Current GitHub repo is **public**; never commit secrets, personal contact lists, invitation tokens, member data, or private conversations.
- Target domain: NMSUSportsForum.com; ownership/registration and renewal schedule to verify rather than assume.
- Mobile and desktop acceptance testing, including iPhone PWA install, chat, offline/reconnect behavior, and desktop layout.

## Integrated first-build authorization and possible future expansion
**Authorized first build:** Implement a usable, secure, invite-only community in one integrated pass: responsive design, sport/venue forums, member identity, threads/replies, moderation, reactions/reputation, profiles, persistent records, Game Center with reliable schedule links, and functional event chat. See **MILESTONE.md** for scope and acceptance. The owner has rejected a visual-only initial milestone and repeated incremental approval gates.

**Later improvements:** richer feeds, more badges and supporter history, advanced historical archives, optional map and future Ring of Honor visibility. Future enhancements should not be an excuse to leave basic launched features nonfunctional.

## Open decisions before full functional build
1. Politics category: visible to everyone or opt-in?
2. Final approved logo/header source assets and independent trademark-safe production branding.
3. ~~Whether launch requires live game chat~~ Decided: live chat is in the first build.
4. Final category list and moderation/reaction rules.
5. Hosting/domain account ownership and allowed data-source licensing.
6. Launch date used to calculate Founding Member window; honorary badge thresholds.
7. ~~Live-chat retention~~ Decided: rolling live window, permanent archive per game.
8. Site cost/renewal disclosure and voluntary sponsor confirmation process.\n9. Confirm venue names, photo licensing, and which sports receive dedicated forums at launch.\n10. When to make the simple moniker-only Ring of Honor visible; until then, hide it.

## Working agreement for coding agents
- Read CLAUDE.md, this vision, DECISIONS.md, MILESTONE.md and the repository's current state before making changes.
- The product owner approves scope. Do not open unnecessary PRs or branches or change agreed product scope. The full integrated initial build in MILESTONE.md is already authorized; make ordinary implementation decisions without asking for a sequence of micro-approvals.
- Distinguish decided requirements from proposals. Ask about consequential unknowns instead of silently choosing.
- Work in small, reviewable stages with visible acceptance criteria. Do not claim something is complete without verifying it.

# NMSU Sports Forum — Product Vision
Status: Concept baseline, October 29, 2026. This is a planning document, not permission to implement unspecified features.

## Purpose and philosophy
An independent, invitation-only, member-run New Mexico State Aggies sports clubhouse. A welcoming alternative/companion to existing fan message boards, centered on real conversation, athletics, and long-lived community history. Not affiliated with or endorsed by New Mexico State University. No ads, mandatory subscriptions, or commercial ambition. Initial founder is simply a Founding Member in public-facing community life. Forum administrators run the community; technical ownership of repository/domain/hosting can be transferred later.

**Operating principles:** mobile-first, excellent desktop layout, easy to use, low cost, accessible, privacy-preserving, sustainable, community-governed. Start with a manageable build; avoid feature creep and unnecessary branches/PRs. Document decisions before coding.

## Audience and scale
Invite roughly 12 existing Aggie acquaintances initially, perhaps 20–30 early members; plan for eventual 300–500 members and concurrent game-day chat. An account is required for all member content; optional public landing/welcome page only.

## Branding and visual direction
- Crimson, white, charcoal, with a Southwestern collegiate clubhouse character.
- **Use the previously selected cowboy crest as the primary design reference**, not the later crossed-revolver experiments. The crest includes a cowboy with hat and mustache, mountain landscape, adobe architecture, large NMSU lettering, SPORTS FORUM ribbon, and small sports symbols. Preserve that composition as the creative starting point; design derivative header, square PWA shortcut, favicon, sport-category graphics, and badges. The existing generated image is a reference, not a production-ready licensed asset; the actual image must be supplied to the implementation repository before coding.
- A previously discussed website header also exists as a design reference, but the exact asset must be located/provided; do not invent a replacement and call it approved.
- Avoid copying university trademarks, official Pistol Pete art, official lettering, or restricted cultural symbols. The current crest contains elements requiring review (including NMSU/NM STATE lettering and a Zia-style symbol). Develop original alternatives and assess trademark permissions before publication; AI-generated art is not automatically legally cleared.
- App icon must remain legible at small iPhone/desktop shortcut sizes; full crest can remain on website.
- Responsive: phone has compact header, bottom or accessible primary navigation, readable threads, thumb-friendly reactions, game-day chat; tablet/desktop use sidebars, multi-column dashboard, wider reading area, and clear moderation tools. Keyboard and screen-reader usability.

## Home / clubhouse
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
- Game Center per event with game-specific chat room and relevant forum links. Chat is distinct from permanent threads; design retention policy before launch.
- Admin-created scheduled chats and game reminders; member opt-in notifications (in-app, and PWA push only when supported and explicitly permitted).
- Official nmstatesports.com can be used for outbound reference links; any automated feed must have permitted, dependable data access. Do not rely on undocumented ESPN endpoints as guaranteed production integrations. Provide graceful fallback and admin manual updates.
- Live chat must handle bursts, moderation, blocked users, and reconnect behavior.

## Member directory and map
- Searchable member cards and profiles. Optional approximate city/state map pins, member controlled and opt-in; never display precise coordinates or addresses. Pin opens profile. Allow members to hide location and email independently.

## Administration and governance
- Four or five admins anticipated. Admin dashboard: invitations, member status/suspension, reports, category and thread management, announcements, chats, reminders, recognition, archive reopening, suggestions.
- Separate **technical ownership** (domain/GitHub/hosting) from **forum administration**. Founder need not be admin and has no special public owner badge. Lead administrator may be selected/transferred among admins; avoid accidental removal of the final admin. Record significant moderation/admin actions privately.
- Provide documented ownership handoff procedure for repository, domain, infrastructure, secrets, backups and service accounts; don't presume one provider's ownership automatically transfers another.
- Community rules: respectful disagreement, no harassment/personal attacks/doxxing/spam, no politics outside designated area, clear reporting and proportionate moderation. Admins may move, lock, remove, or suspend as needed.

## Proposed technical direction — validate before implementation
- Installable responsive PWA. React front end; Cloudflare Pages/Workers, D1 for persistent records, R2 for images, and Durable Objects or another justified real-time chat approach.
- Single source of truth for identity and permissions. Backups/export and clear retention policy. Monitor cost as usage grows.
- Private website content requires authentication regardless of whether GitHub repo is public/private.
- Current GitHub repo is **public**; never commit secrets, personal contact lists, invitation tokens, member data, or private conversations.
- Target domain: NMSUSportsForum.com; ownership/registration and renewal schedule to verify rather than assume.
- Mobile and desktop acceptance testing, including iPhone PWA install, chat, offline/reconnect behavior, and desktop layout.

## Release sequencing (proposal, not authorization)
**Initial usable release:** identity/invitations; responsive clubhouse; categories/threads/replies; basic reactions; member cards; admin moderation; simple schedule links; approved branding.
**Next:** game chat and Game Center, polls, notifications, member map, archive/image lifecycle, reputation/featured posts.
**Later:** suggestion workflow, richer badges and sponsor history, refined feeds/automations, more live-data integrations, advanced admin and community features.

This sequencing does not remove any feature from the overall vision. Review it before implementation.

## Open decisions before build
1. Politics category: visible to everyone or opt-in?
2. Final approved logo/header source assets and independent trademark-safe production branding.
3. Whether launch requires live game chat or can follow basic forum.
4. Final category list and moderation/reaction rules.
5. Hosting/domain account ownership and allowed data-source licensing.
6. Launch date used to calculate Founding Member window; honorary badge thresholds.
7. Live-chat retention and notification preferences.
8. Site cost/renewal disclosure and voluntary sponsor confirmation process.

## Working agreement for coding agents
- Read this vision and the repository's current state before making changes.
- The product owner approves scope. Do not open PRs, create branches, implement features, or change architecture on your own.
- Distinguish decided requirements from proposals. Ask about consequential unknowns instead of silently choosing.
- Work in small, reviewable stages with visible acceptance criteria. Do not claim something is complete without verifying it.

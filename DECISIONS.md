# NMSU Sports Forum — Current decisions
Updated October 29, 2026.

## Approved
- Public name **NMSU Sports Forum**. Independent NMSU fan community, not officially endorsed. Avoid "Aggie Clubhouse" branding.
- The owner controls **NMSUSportsForum.com**; **Cloudflare is the hosting platform**. GitHub repo is the code source. Publish approved iterations to the website for direct iPhone and desktop review, after checking DNS and Cloudflare project permissions. Site deployment may not yet be configured.
- Invite-only forum eventually, starting with 20–30 members, scalable toward a few hundred; 4–5 community administrators. Owner need not be public moderator or have a special badge.
- **Mobile first, but excellent desktop.** PWA approach.
- Approved cowboy crest and header/screenshots supplied directly by owner to Claude Code; do not use generated crossed-guns replacement. **Brand-color authority:** [BRAND_COLORS.md](BRAND_COLORS.md) — NMSU's verified official palette. Website primary crimson **#8C0B42**, white **#FFFFFF**; secondary **#B6A5AD** and **#D7C9C4**; gray **#6D6E71**. Old colors sampled from the crest are NOT official brand colors. Keep the approved crest composition unchanged unless owner approves edits.\n
- Sports forums: The Pan Am (basketball and volleyball), Aggie Memorial (football), Presley Askew Field (baseball), Softball Complex (softball), The Pitch (women's soccer), Track & Field. Clear sport labels always.
- Topics, replies, reactions, polls, follows, game center, game chat, member directory and profiles, badges and moderation appear in **overall vision**. Presence in vision does not mean implement all at once.
- Reputation rises with received thumbs-up; thumbs-down does not reduce points. Show member's most appreciated post and optionally weekly highlights.
- Legacy Aggie Alert moniker and self-reported legacy post count may appear on profiles, clearly separate from this forum's automatic count.
- 30-day Founding Member period after eventual launch, with honorary founders possible later.
- Read-only thread archive after 90 days since last reply; uploaded discussion photos expire 90 days after upload, excluding avatar and brand assets.
- **Aggie Ring of Honor** is a future **moniker-only** list, starting with **Rojo**. It remains **hidden from launch navigation and website** until ready. No memorial details required.
- No mandatory subscriptions, advertisements or commercial ownership model. Voluntary hosting/domain contributions may be recognized without voting/moderation privileges.
- Github repo currently public: no member addresses, invitations, secrets, account data or private messages in code.

## Approved October 30, 2026 (brainstorm with Claude Code)
- **Sports data self-populates** from official external sources; see [SPORTS_DATA.md](SPORTS_DATA.md). Manual schedule entry is an emergency override only. Earlier wording permitting admin-managed schedules is withdrawn.
- **Live scores:** not at launch. Schedules and final results update automatically; during games, link to official live stats.
- **Private messages are strictly private.** Admins cannot read them. Recipients can block senders and may choose to report a specific message.
- **Chat:** rolling live window; every game's full chat archived permanently (text is tiny) and linked to the game for the Aggie Time Machine.
- **Everything discussed goes into the first build** (see MILESTONE.md item 13), including drafts, spoiler-free mode, personal feeds, mute, predictions, calendar, history/Time Machine, Year in Review, Suggestions board and member map.
- **Low maintenance:** the site runs itself; the owner should not have to operate it daily.
- Recognition never buys authority: badges, sponsorship or code contributions grant no moderation power. Reputation (appreciated posts) and badges (things done for the forum) stay separate.
- Home screen tests: a member immediately sees what is happening with the Aggies, reaches a good conversation in one or two taps, and feels recognized in a clubhouse-like community.
- Layout: phone bottom navigation (Home · Forums · Games · Chat · Members); desktop three columns (navigation/venues · conversations · games/online/upcoming).

## Decisions pending
- Politics category and possible opt-in.
- Confirm official feed URLs/terms (SPORTS_DATA.md); any future licensed live-score source and its cost.
- Cloudflare deployment configuration and domain DNS/current live site assessment.
- Trademark/mascot/Zia artwork clearance and source photo licensing before wide public launch.
- Official launch date (Founding Member window), honorary founder criteria, category growth, Ring of Honor visibility.

## Build policy
**Single integrated initial release is authorized.** Claude Code should implement the functional forum, membership/invitations, real discussions, profiles/admin features and game chat together with the responsive UI, as specified in MILESTONE.md. This supersedes the prior visual-only prototype policy. Don't require approval at every trivial milestone; protect security, costs and existing Cloudflare site.

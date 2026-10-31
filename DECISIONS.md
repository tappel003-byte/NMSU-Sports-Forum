# NMSU Sports Forum — Current decisions
Updated October 29, 2026.

## Approved
- Public name **NMSU Sports Forum**. Independent NMSU fan community, not officially endorsed. Avoid "Aggie Clubhouse" branding.
- The owner controls **NMSUSportsForum.com**; **Cloudflare is the hosting platform**. GitHub repo is the code source. Publish approved iterations to the website for direct iPhone and desktop review, after checking DNS and Cloudflare project permissions. Site deployment may not yet be configured.
- Starts invite-only with 20–30 members; switchable to open sign-up (see open community decisions below), scalable toward a few hundred or more; 4–5 community administrators. Owner need not be public moderator or have a special badge.
- **Mobile first, but excellent desktop.** PWA approach.
- Approved cowboy crest and header/screenshots supplied directly by owner to Claude Code; do not use generated crossed-guns replacement. **Brand-color authority:** [BRAND_COLORS.md](BRAND_COLORS.md) — NMSU's verified official palette. Website primary crimson **#8C0B42**, white **#FFFFFF**; secondary **#B6A5AD** and **#D7C9C4**; gray **#6D6E71**. Old colors sampled from the crest are NOT official brand colors. Keep the approved crest composition unchanged unless owner approves edits.\n
- Sports forums: The Pan Am (basketball and volleyball), Aggie Memorial (football), Presley Askew Field (baseball), Softball Complex (softball), The Pitch (women's soccer), Track & Field. Clear sport labels always.
- Topics, replies, reactions, polls, follows, game center, game chat, member directory and profiles, badges and moderation appear in **overall vision**. Presence in vision does not mean implement all at once.
- Reputation rises with received thumbs-up; thumbs-down does not reduce points. Show member's most appreciated post and optionally weekly highlights.
- Legacy Aggie Alert moniker and self-reported legacy post count may appear on profiles, clearly separate from this forum's automatic count.
- ~~30-day Founding Member period after eventual launch~~ superseded Oct 31, 2026: see Founding Members below. Honorary founders remain possible.
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

## Approved October 30, 2026 (feature research round)
- **Guiding principle:** a fun, very easy-to-use fan site. To win people over it must clearly offer more than the Aggie Alert board on Rivals. Money is not a goal; modest income later is acceptable but not planned.
- **Next build round (approved):** (1) live-updating game threads, (2) phone push notifications, (3) dark mode, (4) spoiler tags in posts, (5) @mention autocomplete, (6) link previews (YouTube, articles), (7) thread tags with filtering, (8) moderation extras: auto-expiring suspensions, merging threads, approval of a new member's first posts, (9) member data download and account deletion, (10) Aggie-themed ranks by post count, (11) automatic postgame "Player of the Game" vote.
- **Recruiting and transfer portal (wanted):** automatic where a free, permitted source exists. CollegeFootballData.com (free API key) is the leading candidate for football recruits and the transfer portal; confirm its terms before launch. Anything not covered is community-maintained with source links. See SPORTS_DATA.md.
- **Posting tweets must be effortless (owner requirement, Oct 30, 2026).** Recruiting news largely breaks on X, and automatic X search is paid, so members bring tweets in by hand and it must take seconds:
  - Paste an x.com/twitter.com link anywhere (post, reply, chat, recruit card) and it shows as an embedded tweet card: author, text, date, and a link to view it on X.
  - A **Share a tweet** button on Home, each forum and each recruit card: paste the link, add an optional comment, pick a thread (or start one), done.
  - A **Paste link** button that reads the clipboard on iPhone (iOS asks permission), plus an optional iPhone Shortcut so members can send a tweet from the X app's share sheet straight to the forum.
  - On a recruit's card, a shared tweet is attached to that player's news and discussion.
  - Tweet text is fetched through X's free embed service (no paid API). If a tweet is deleted, the card says so.
  - Automatic X search stays out unless the owner later approves the cost.
- **Deliberately skipped:** paid tiers or premium-only boards, extra reaction types, clubs/sub-groups, automatic paid X search.

## Approved October 30, 2026 (open community)
- **Migration strategy:** the forum only works if the Aggie Alert conversation moves here, so it must be easy to join. **Supersedes invite-only as the permanent model.**
- **Sign-up mode is an admin switch:** *invite-only* or *open sign-up*. Plan: launch invite-only for 2–4 weeks with the core group, then switch to open.
- **Public reading, sign up to post** (also a switch). Discussions, games, recruiting and the Time Machine are readable without an account; posting, reacting, chat, private messages, the member directory, map and calendar require an account. Private messages stay strictly private.
- **Open sign-up protections:** Cloudflare Turnstile human check, email confirmation (requires an email service), first-post approval for newcomers, sign-up rate limits.
- **Troll flagging and moderator review (refined Oct 30, 2026; supersedes the first troll-flag design):**
  1. Three different registered members flagging a post as trolling temporarily hides it **pending moderator review**. This is a precaution, not a finding that the author is a troll: no automatic penalty for the author, and **flags never reduce Aggie Reputation**. A moderator's flag counts as one flag.
  2. Hidden posts show "temporarily hidden while moderators review it."
  3. All moderators are notified.
  4. A moderator restores the post, removes it, or issues a warning (with or without removing). Every decision needs a reason.
  5. One moderator may impose **temporary suspensions only** (up to 90 days). A **permanent ban needs approval from at least three moderators**.
  6. Every decision and reason goes into the internal audit history.
  7. Members can appeal a removal, warning, suspension or ban. Appeals are decided by a **different moderator** than the one who acted. Suspended or banned members can appeal from the sign-in page.
  - Safeguards: one flag per member per post; flag history per member (flags upheld vs. dismissed, repeated flags against the same person) is visible to moderators, who can switch off an abuser's flagging privilege.
  - "Moderators" are the forum's 4–5 community administrators.
- **Old Aggie Alert posts cannot be imported** (Rivals' terms, no export). Members bring their moniker and post count, and can re-post favorite memories in Aggie History.

## Approved October 30, 2026 (after first live review)
- **No gatekeeping when posting:** a new discussion needs only a title and a message. It files under General Discussion unless the member picks a venue ("File under", optional). The short description is optional.
- **Invite by text and email:** in Admin → Invitations, enter a name plus a cell number and/or email. "Text it" opens the admin's own Messages app with the invitation written; "Email it" opens their email app (or the site emails it automatically once an email service is set up). Phone numbers are never stored on the site, and sending costs nothing.
  - **One-tap invite:** "Invite someone from my phone" creates the invitation at once; Text it / Email it open Messages or Mail with the message written and an empty To: line, so the admin picks anyone from their contacts. Phones that support the Contact Picker also get "Choose from contacts" on the detailed form.
- **Members invite friends:** every member gets Invite friends (one tap, pick a contact in Messages or Mail), up to 10 invitations a day, each single-use and expiring in 14 days. They see who joined from their invitations. Admins can switch member invitations off in Admin → Settings (on by default).
- **Start a game thread instead of automatic threads:** members tap "🏟️ Game thread" and pick from recent and upcoming games (football and men's basketball first, other sports one tap away). The thread is linked to the game as its pregame or postgame discussion, the title fills in, one per game and phase, and postgame threads get the Player of the Game vote. Automatic pregame/postgame threads are now an admin switch, off by default. The 8 automatic threads already created stay.
- **Headline sports first:** with all 11 sports loaded the pages felt overwhelming. Football and men's basketball now lead everywhere: the home "Next game" banner, the side column's upcoming games and rosters, the scores strip, and the Game Center (football by default, with Men's Hoops as its own button; 15 games at a time, Show more). Other sports are one tap away ("All sports", "Another sport…", and an "Other sports" line in the side column).
- **Chats:** only the Aggie Lounge is always open. Game chat rooms open automatically, but only for football and men's basketball games. Other sports get no game chat; any past chat archives stay readable.
- **Crest:** larger in the header (68px desktop, 58px phone); tapping it opens the approved crest full screen. The site name next to it still goes home.
- **Live scores (supersedes "no live scores at launch"):** for football and men's basketball, the game page and game chat show the in-game score and clock from ESPN's public scoreboard feed, refreshed every 30 seconds from 30 minutes before kickoff/tip-off to 5 hours after (one shared lookup per 30 seconds, cached). There's also an ESPN Gamecast button. ESPN doesn't formally offer this feed to outside sites; if it changes, the score bar hides and the ESPN link remains. Final results still come from the official NMSU calendar.
- **Crest trademark review — owner decision (Oct 31, 2026):** the owner was told about the NMSU/NM State lettering, the mascot resemblance and the Zia symbol, and chose to keep the crest as supplied. If anyone objects, the owner will change it then. Don't raise this again unless the owner asks.
- **Founding Members (Oct 31, 2026):** anyone who joins through **Thanksgiving, November 26, 2026**, up to **30** people (the first 30 by join time). No launch date is needed. Both values are adjustable in Admin → Settings.
- **Plain Board (Oct 31, 2026):** the Board and the home page's discussion list are just the thread list, like Sports Trough: no Latest/Unread/Following/Popular tabs and no topic filter buttons. Unread threads still get a dot, and tags still show on threads.
- **Predictions as a weekly contest (Oct 31, 2026):** no standings page in the menus. Members pick on game pages. Each week (Monday–Sunday, Mountain Time), Home shows "🎯 Predictions this week", the picks that came true (exact scores first; scores hidden in spoiler-free mode). When the week ends, whoever earned the most points becomes **🏆 Nostradamus of the Week** (ties share it): a permanent award on the member card, announced on Home the following week. Member pages show the number of Nostradamus wins; repeat awards show as one chip with a count.
- **Reply and Quote everywhere (Oct 31, 2026):** thread posts have Reply next to Quote, like Aggie Alert. A Reply starts with @name (they're notified) and shows "↩ Replying to X's post", linking to the original comment; Quote embeds their words. Live chat messages have Reply (@name) and Quote (the original line shown above the answer), with a cancelable "Replying to / Quoting" bar.
- **Content engine, so the Board never goes quiet (Oct 31, 2026):** the owner noted that on Aggie Alert one poster (KrimsonKrazy) starts most topics to keep the site active. The site now does that job itself, all capped, non-repeating and switchable in Admin → Settings → Automatic topics:
  - **Aggie Alert-style topic list:** crimson title until read, then grey; "starter ➜ last poster · time"; replies and **view counts**. Descriptions, tags and the compact toggle are gone from the list.
  - **Automatic game threads for football and men's basketball (default):** one thread per game ("NM State vs. Liberty") two days ahead. At the final, the score is posted and the Player of the Game vote opens in the same thread. Other options: every sport (pregame + postgame) or off.
  - **📰 Aggie News:** every two hours, new NM State stories from the official athletics feed and a news search become topics (headline + link only, at most 3 a day by default, no duplicates, other schools' "Aggies" filtered out). There's a "Check news now" button.
  - **Only football, men's basketball and baseball news (Oct 31):** women's and other sports rarely get discussion, so their stories are skipped (the sport comes from the official link or the headline). **Automatic topics nobody answers are cleared after two days** (news, topic of the day, weekly topics; game threads and player cards stay).
  - **🎲 Topic of the day:** if no member starts a topic for 24 hours, the site posts one from a conversation-starter list (9 AM–8 PM, at most one a day, no repeats until the list is used up). Admins can post one any time, and members have a **🎲 Random topic** button on the new-post page (the old off-topic random topic generator).
  - **Weekly topics:** admins list "day | time | title" (e.g. "Mon | 6:00 PM | Radio Show Tonight") and each posts once a week.
- **Admin → Members:** compact one-line rows; all member actions (make/remove admin, suspend/reinstate, warn, propose ban, password reset link, recognize) live in one Actions menu.
- **Aggie Alert up votes on profiles:** members can add their Aggie Alert up votes received (self-reported, beside moniker, join year and post count). Shown on the profile only; it does not change Aggie Reputation here.
- **One Board instead of venue forums (supersedes the venue-navigation layout):** like Aggie Alert's Sports Trough, all discussion lives on a single Board, pinned topics on top. Venue forums are gone from navigation and from the new-post form. Since Oct 31, old venue links redirect to the Board and venue names no longer appear on threads, breadcrumbs or search results; the venues survive only internally to file game threads by sport. Automatic game threads still carry their sport label (e.g. FOOTBALL), and old venue pages remain reachable only by direct link. Aggie History and Suggestions stay as their own sections.
- **Latest scores on top of the Board:** a strip shows the most recent results (from the automatic schedule feed; spoiler-free mode respected) and the next game.
- **Rosters & links hub:** every sport links to its official roster and schedule (always current, nothing to maintain), plus an admin-maintained list of useful links (radio feeds, streams, tickets) in Admin → Settings. Shown in the desktop side column and from the phone home page.
- **Admins and moderators (Oct 31, 2026):** two staff roles. **Admins** control everything: settings, invitations, sports data, password reset links, recognitions and who is an admin or moderator. **Moderators** keep discussions in line: review reports, lock/pin/move/remove posts and threads, approve new posts, warn, suspend, propose bans and see the moderation log, and remove game-chat messages. Moderators never see member email addresses. Only admins change roles, and the last admin can't be removed.

## Decisions pending
- Politics category and possible opt-in.
- Confirm official feed URLs/terms (SPORTS_DATA.md); any future licensed live-score source and its cost.
- Cloudflare deployment configuration and domain DNS/current live site assessment.
- Trademark/mascot/Zia artwork clearance and source photo licensing before wide public launch.
- Honorary founder criteria, category growth, Ring of Honor visibility.

## Build policy
**Single integrated initial release is authorized.** Claude Code should implement the functional forum, membership/invitations, real discussions, profiles/admin features and game chat together with the responsive UI, as specified in MILESTONE.md. This supersedes the prior visual-only prototype policy. Don't require approval at every trivial milestone; protect security, costs and existing Cloudflare site.

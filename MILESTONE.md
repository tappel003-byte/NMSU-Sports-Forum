# Build plan — NMSU Sports Forum

## Active: Milestone 01 — visual foundation deployed on Cloudflare
Create a polished, working **responsive front-end** using **fictional, visibly demonstration-only data**, based on the approved cowboy crest and owner-provided mobile/desktop screenshots. Put the result onto the owner's **NMSUSportsForum.com** using **Cloudflare hosting**, after confirming existing domain/site state and safely configuring a repeatable deployment. GitHub is authoritative.

### Step 1: Inspect and plan
- Check repo contents and current architecture. Confirm owner-provided screenshots and source crest are accessible to Claude Code. Do not assume the source image is already committed.
- Inspect Cloudflare domain DNS, existing hosting/project, permissions, and whether NMSUSportsForum.com currently serves anything. Do not clobber an existing site.
- Recommend a minimal app and deployment setup (for example Cloudflare Pages or Workers, as appropriate) and document how publishing works. Don't provision future databases just to make a visual mockup.

### Step 2: Implement visual shell
- Mobile home with approved crest/header, example next-game display, latest/unread/popular discussions, quick navigation, forum activity and game chat teaser.
- Desktop home that uses width well with meaningful columns, not an enlarged phone card.
- Mobile and desktop sports directory for Pan Am, Aggie Memorial, Presley Askew Field, Softball Complex, The Pitch and Track & Field; always label sports plainly.
- Readable thread list and example thread detail to review hierarchy/typography; clear mock interactions.
- Game Center, Chat and Members as polished but clearly nonfunctional preview destinations when needed for navigation.
- **Do not show Ring of Honor** at this stage.
- Follow screenshots and palette; provide clear empty/loading states, keyboard access, legible contrast, iPhone safe areas, and touch-friendly controls.

### Step 3: Verify and publish
- Build and test locally with documented commands. Inspect actual mobile and desktop layouts and fix visual issues.
- After verifying Cloudflare connection and approval of any consequential existing-site changes, deploy to **NMSUSportsForum.com**. If access isn't available, report precise setup required instead of claiming it is published.
- Report changed files, test results, actual live URL, and functions still mock-only. Stop for user visual review.
- Don't create unnecessary branches or PRs, open autonomous subprojects or work in parallel with Cursor.

## Future, not authorized by this document
**Milestone 02: functional forum.** Invite-only membership, secure authentication/authorization, categories/posts/replies, editing, thumbs and reputation, member profiles and admin/moderation, search/unread, database and backup strategy.

**Milestone 03: game day.** Schedule, Game Center, live chat, notifications, licensed feed integration or honest manual fallback.

**Milestone 04: community features.** Polls, badges, contribution recognition, map, suggestions, image lifecycle, archives and other features in VISION.md.

**Ring of Honor remains hidden until specifically requested.**

## Acceptance
Owner can open NMSUSportsForum.com on iPhone and desktop and compare it to the screenshots. Site is mobile-first, credible and consistent with cowboy crest; headings say NMSU Sports Forum, all visible information is demo or verified current, and future/private functionality is not falsely presented as live.

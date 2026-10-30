# Claude Code instructions — NMSU Sports Forum

Read **VISION.md**, **DECISIONS.md**, **MILESTONE.md**, then **AGGIE_RING_OF_HONOR.md** and inspect all current files before work. The owner supplies approved logo/header and four mobile/desktop screenshots directly to Claude Code. Those screenshots are visual acceptance references; do not invent replacement images.

## Purpose
Build NMSU Sports Forum, an independent, invite-only Aggie sports forum. **Mobile-first and desktop polished.** Site name must remain NMSU Sports Forum, never Aggie Clubhouse. The approved cowboy crest—not the rejected crossed-pistols concepts—is the visual authority. **Website colors MUST follow [BRAND_COLORS.md](BRAND_COLORS.md): official Aggie Crimson #8C0B42, White #FFFFFF, Organ Mountain #B6A5AD, Desert Sand #D7C9C4, Desert Monsoon #6D6E71. Do not use previous colors sampled from the logo or invent an athletics HEX value.**

## Hosting and iteration — approved
- **Cloudflare hosts the website**, with **NMSUSportsForum.com** as the real owner-review destination. GitHub repo `tappel003-byte/NMSU-Sports-Forum` is source of truth.
- Start by inspecting this repository and the owner's Cloudflare deployment/DNS/account project. **Do not assume** a configured Pages/Workers project, repository connection, credentials or a functioning website just because the domain is owned.
- Prefer a straightforward GitHub-to-Cloudflare CI deployment flow supported by the chosen application, if suitable. Explain the proposed Cloudflare products (Pages or Workers, and future D1/R2/Durable Objects) rather than provision everything prematurely.
- With verified deployment permissions and without overwriting an existing site unexpectedly, publish the **integrated functional first release** so the owner can review it **directly at NMSUSportsForum.com**, on iPhone and desktop. Keep public demo content clearly fictional; do not expose private member material.
- Never put Cloudflare API tokens, secrets, credentials or private invitation lists in public source control. Do not buy services or change unrelated DNS records without approval.
- Local preview is useful, but **live website review is the workflow**.

## Current scope — functional integrated first release
The product owner explicitly directs **one substantial initial build**, not a visual-only proof of concept or serial micro-milestones. **MILESTONE.md is the build specification.** Implement actual secure invitations/accounts, persistent threads/replies, reactions, profiles, admin features, sports navigation, Game Center and real game chat, in one cohesive effort. Use self-checks and tests rather than repeatedly pausing for approval of small UI details. Never claim a feature works when it is mocked.

**Screenshots are layout references; colors must come from BRAND_COLORS.md** (primary crimson #8C0B42). Use the actual approved cowboy crest and do not redraw or replace it.

## Venue navigation
The Pan Am = men's/women's basketball and volleyball; Aggie Memorial = football; Presley Askew Field = baseball; Softball Complex = softball; The Pitch = women's soccer; Track & Field = track and cross-country. Sport labels must always be visible alongside venue names.

## Later-only Ring of Honor
A simple list of Aggie Alert monikers, beginning with **Rojo**, in AGGIE_RING_OF_HONOR.md. **No initial visible Ring of Honor or navigation**. No biographies, memorial profiles, dates or reactions.

## Development discipline
Do not spawn parallel coding agents, generate unnecessary branches/PRs, or implement unapproved scope. First describe the repository/deployment state, needed screenshots/assets and a short plan. Build continuously to the integrated release while testing internally, confirm mobile and desktop rendering, and report exactly what is functioning versus blocked at delivery. Do not require owner sign-off for every small implementation step. Cursor may later be used for targeted screenshot-based visual refinement, but avoid concurrent conflicting edits. Protect existing working code and site. This is an independent forum: do not assert university affiliation or treat generated mascots/marks as legally cleared.

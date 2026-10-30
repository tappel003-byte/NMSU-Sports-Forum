# NMSU Sports Forum

Independent, invitation-only fan forum for New Mexico State Aggies. **Mobile-first with a polished desktop experience.** Built for community discussion, sports-specific forums and game-day conversation.

**Website:** https://NMSUSportsForum.com (owner-controlled domain; Cloudflare hosting is intended, but deployment readiness must be verified before claiming the site is live).

**Repository:** https://github.com/tappel003-byte/NMSU-Sports-Forum

## Start here — Claude Code (CC, lead builder)
1. Read **[CLAUDE.md](CLAUDE.md)** for coding rules, screenshots and Cloudflare workflow.
2. Read **[VISION.md](VISION.md)** for the complete concept.
3. Read **[BRAND_COLORS.md](BRAND_COLORS.md)** for exact official NMSU color values.
4. Read **[DECISIONS.md](DECISIONS.md)** for approved vs unresolved decisions.
5. Read **[MILESTONE.md](MILESTONE.md)** for the **currently authorized** build stage.
6. Read **[SPORTS_DATA.md](SPORTS_DATA.md)** for self-populating schedules/results.
7. Read **[REQUIREMENTS_CHECKLIST.md](REQUIREMENTS_CHECKLIST.md)** to audit coverage.
8. Read **[AGGIE_RING_OF_HONOR.md](AGGIE_RING_OF_HONOR.md)** for the future-only moniker list.

## Current status (October 30, 2026)
The integrated first release is built and verified locally: an end-to-end browser suite (86 checks, iPhone and desktop sizes) plus unit tests pass. It is **not deployed yet** because this build environment has no access to the owner's Cloudflare account. Deployment is a one-time setup described in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**; after that, every merge to `main` deploys automatically.

- **Stack:** one Cloudflare Worker (Hono API + React/Vite app), D1 database, Durable Objects for live chat, Cron Triggers for schedule sync and housekeeping. Expected cost at launch: $0 beyond the domain.
- **Admins:** see **[docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md)**.
- **Status of every requirement:** **[REQUIREMENTS_CHECKLIST.md](REQUIREMENTS_CHECKLIST.md)**.
- **Crest:** the icons in `public/` are cropped from the owner's phone screenshot of the approved crest as an interim measure. Replace them with the original `Approved_Cowboy_Crest.jpeg` when it's added to the repo.

## Development approach
Claude Code takes the first controlled build. Cursor may help with screenshot-led polishing later. GitHub remains the single source of truth; don't let multiple agents make conflicting edits.

**Current build mandate:** a substantial, integrated functional first release—invites, accounts, persistent sports discussions, reactions, member/admin tools, Game Center and real live chat—plus polished mobile/desktop UI and Cloudflare deployment. See MILESTONE.md. Visual screenshots are layout references; BRAND_COLORS.md governs actual colors. Protect the current website and verify account access before changing DNS.

## Brand and navigation
NMSU Sports Forum is the name; **not** Aggie Clubhouse. The cowboy crest is the approved image; the exact website palette is defined by NMSU's published specifications in [BRAND_COLORS.md](BRAND_COLORS.md), led by #8C0B42 crimson and #FFFFFF white. Sports are organized around The Pan Am, Aggie Memorial, Presley Askew Field, Softball Complex, The Pitch and Track & Field with clear sport names.

The future **Aggie Ring of Honor** is a simple list of Aggie Alert monikers, starting with Rojo, and is hidden until the community is ready to show it.

## Privacy
This repository is public. Never commit secrets, invitation links, member emails, or private conversation content. The website is independent from NMSU; branding rights and images must be checked before public launch.

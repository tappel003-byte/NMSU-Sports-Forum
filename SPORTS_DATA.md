# NMSU Sports Forum — Sports Data Specification
Approved by the owner October 30, 2026. This document is authoritative for schedules, results and game information. It supersedes any earlier wording that allowed admin-entered schedules as the normal approach.

## Core requirement: self-populating
Schedules, opponents, dates/times, venues, home/away, TV/stream/radio details, and final results **populate and update automatically from existing external sources.** Nobody is expected to type NMSU games into the site.

- Manual editing exists **only as an emergency override** (e.g., to correct a wrong time while a feed is broken). It is never the normal maintenance path, and an override must not be silently overwritten or silently kept: overrides are flagged in the admin view.
- The site must keep running unattended. No daily chores for the owner or admins.

## What data, from where
| Data | Launch approach | Notes |
| --- | --- | --- |
| Schedules (all supported sports) | Automatic import from official NMSU Athletics calendar feeds (nmstatesports.com publishes per-sport and composite calendars intended for fan subscription) | Primary source. Feed URLs are configuration, not code. |
| Changes, postponements, cancellations | Same feeds, re-synced on a timer | Sync is idempotent: games are matched by the feed's stable event ID, updated in place, never duplicated. |
| TV / stream / radio, tickets, official game page links | Taken from the feed when present | Otherwise link to the sport's official schedule page. |
| Final results | Taken from the official feed when the source includes them | Never invented. If a source lacks results, the game shows "Final — see official recap" with the official link. |
| Live in-game scores | **Not at launch.** During games the site links to the official live stats | Owner decision (Oct 30, 2026). True live scoring needs a separate licensed source and may cost money. |

Undocumented endpoints (e.g., ESPN's unofficial API) are not a production foundation. They may be evaluated later only as an optional supplement.

## How it runs
- A Cloudflare scheduled job syncs every 30 minutes (free; no owner computer involved).
- One canonical `games` table feeds the home page, each venue forum, the Game Center and game pages.
- Each sport maps to its venue forum (basketball/volleyball → The Pan Am, football → Aggie Memorial, etc.).
- **Automatic game-day lifecycle:** a pregame thread is created ~3 days before each game; the game's live chat room opens on game day; a postgame thread is created at the final (or a few hours after start if no result arrives). All are linked from the game page.
- Predictions lock at game start and are scored automatically when the final result arrives.
- **Failure handling:** if a sync fails or a feed changes format, the forum keeps working with the last good data, the admin dashboard shows the problem, and admins are notified. Nothing fails silently.

## Verification status (be honest about this)
As of October 30, 2026 the exact official feed URLs and their field formats have **not yet been verified** from a build environment (network access to nmstatesports.com was blocked during development). The importer is built against the standard iCalendar format such feeds use and is unit-tested with synthetic sample data. Before the Game Center is considered complete, the real feed URLs must be confirmed, configured, and a live sync observed. Check nmstatesports.com terms of use when confirming.

## Recruiting and transfer portal (approved in principle Oct 30, 2026)
Paid networks (247Sports, On3, Rivals) have no free public API, and copying their pages would break their terms, so they are not sources.

| Data | Candidate free source | Notes |
| --- | --- | --- |
| Football high-school recruits (commits, star ratings, rankings) | **CollegeFootballData.com** API (free key; recruiting data back to 2000) | Confirm terms of use and attribution before launch |
| Football transfer portal (entries to/from NMSU) | CollegeFootballData.com `/player/portal` (2021 to present) | Same |
| Football and basketball results | CollegeFootballData.com / CollegeBasketballData.com | Possible second source to cross-check the official feed |
| Basketball recruits and portal | No confirmed free source | Community-maintained entries with required source links |
| Signings and roster additions | Official NMSU roster pages and announcements | Link out; headlines only |

The free tiers have monthly call limits (CollegeBasketballData.com: 1,000 calls/month), so this syncs about once a day, not every 30 minutes. Each recruit or transfer gets a player card, member predictions and a linked discussion thread.

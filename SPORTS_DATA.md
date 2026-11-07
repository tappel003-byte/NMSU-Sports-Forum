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

## Verified official feed format (October 30, 2026)
The owner downloaded the nmstatesports.com composite calendar (Calendar → All Games → Add To Calendar). It is a SIDEARM Sports iCalendar feed: 181 events across 11 sports. Every event mapped to a sport, and all 21 final scores parsed. The importer handles the format's details: results on the second description line ("W 34-13"), "TV:", "Radio:", "Streaming Audio:" and "Streaming Video:" lines, promotion suffixes ("vs Western Kentucky - Pink Game"), "Completed" events without a score, and `&amp;` in event URLs. Unit tests use the same format with fictional events. Still to do: paste the feed's subscription URL into Admin → Sports data and watch the first live sync.

## Live in-game scores (football and men's basketball)
Added October 30, 2026 at the owner's request. `src/worker/lib/livescore.ts` reads ESPN's public scoreboard JSON (`site.api.espn.com/apis/site/v2/sports/{football/college-football|basketball/mens-college-basketball}/scoreboard?dates=YYYYMMDD&groups=80|50`) and finds NM State by ESPN team id 166. Lookups only happen from 30 minutes before start to 5 hours after, at most once every 30 seconds per game (cached in the `live_scores` table), no matter how many members are watching. ESPN does not formally offer this feed to third parties, so the code fails quietly: no score bar, but the ESPN Gamecast or team-page link still shows. Official final results still come only from the NMSU calendar feed.

## Past seasons (Time Machine) — added Nov 2026
- Source: ESPN's public team-schedule feed (`src/worker/lib/history.ts`). Final scores only; no ESPN text or images are copied.
- Coverage: football 1999–now, men's basketball 2002–now, women's basketball 2001–now, volleyball 2025–now, baseball 2026–now, softball 2026–now, women's soccer current season only. Earlier volleyball/baseball/soccer seasons are mostly missing on ESPN, so they are skipped rather than shown half-empty. Golf, tennis, swimming, track and cross country have no game-by-game data on ESPN.
- Postseason games (bowls, conference and NCAA tournaments) are included; forfeits are left out.
- The 30-minute cron imports a few seasons per run until finished; a daily job re-checks this season and last, so early-season games the NM State calendar has already dropped (it lists only about a month back) still arrive.
- Games already on file from the NM State calendar are never duplicated or overwritten; missing final scores are filled in.
- Football before 1999: CollegeFootballData (`CFBD_API_KEY`), back to the program's start (1893), a few seasons per run.
- Not used: nmstatesports.com archives and its `/services/` calendar (its robots.txt disallows `/services/` for all crawlers); Sports Reference (terms forbid building a substitute database). Other sports' history would need NM State's permission.

## Rosters by season — added Nov 2026
- Table `roster_players` (migration 0015), keyed by Time Machine season (fall start year).
- Football: CollegeFootballData `/roster`, 2000–now (full details from about 2014; earlier years mostly names).
- Men's and women's basketball: Wikipedia season articles (`{{CBB roster/Player}}`), read slowly through the official API with an identifying User-Agent; credited "From Wikipedia (CC BY-SA)" with a link. Seasons without an article or roster are skipped.
- Any sport: members add or fix players (e.g. from media guides); admins and moderators remove. Imports only add rows and never overwrite a member's fix.
- The 30-minute cron shares a budget of 16 outside requests across history and roster imports.

## Other sources checked (Nov 2026) and why they're not used
- NCAA stats (stats.ncaa.org) and NCAA.com scoreboards: NCAA terms of service prohibit robots, scraping and harvesting.
- TFRRS / DirectAthletics (track, cross country): has sent demand letters to people collecting its results.
- Sports Reference: terms forbid building a substitute database.
- nmstatesports.com archive services: robots.txt disallows `/services/`; the pages behind bot protection.
- ESPN college softball/baseball rosters: stale (same list every season, positions "UN"), so not imported.
The route for older non-revenue history is NM State Athletics' permission (draft email on hold) or member contributions.

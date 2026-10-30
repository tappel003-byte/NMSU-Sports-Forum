# NMSU Sports Forum — Verified Color Specification

**Authoritative website palette, checked October 29, 2026.**

Source: New Mexico State University's official brand guide: https://brand.nmsu.edu/color/

The forum's CSS/design tokens **must use the documented NMSU values below**, rather than colors estimated from the approved cowboy-logo JPEG or previous approximations.

## Core brand colors — verified
| Role | NMSU name | Hex | RGB |
| --- | --- | --- | --- |
| Primary crimson | Aggie Crimson | **#8C0B42** | 140, 11, 66 |
| Primary white | White Sands | **#FFFFFF** | 255, 255, 255 |

## NMSU secondary and tertiary colors — verified
| Role | NMSU name | Hex | RGB |
| --- | --- | --- | --- |
| Secondary | Organ Mountain | **#B6A5AD** | 182, 165, 173 |
| Secondary | Desert Sand | **#D7C9C4** | 215, 201, 196 |
| Tertiary neutral | Desert Monsoon | **#6D6E71** | 109, 110, 113 |
| Tertiary blue | Azure Sky | **#009DB8** | 0, 157, 184 |
| Tertiary green | Sagebrush Mint | **#6CC3BC** | 108, 195, 188 |
| Tertiary warm accent | Mesilla Valley Sunset | **#F2824F** | 242, 130, 79 |

Black **#000000** is a practical neutral for text/outlines. It is not a replacement for NMSU's published primary colors.

## Implementation instructions
- Use **#8C0B42** as the forum website's dominant brand crimson, with **#FFFFFF**. Site header, navigation active state, buttons and key accents should reflect those values, subject to accessible contrast.
- Use Organ Mountain and Desert Sand as soft backgrounds and accents; Desert Monsoon as dark neutral. Keep tertiary colors sparse as recommended by NMSU.
- Prefer CSS tokens (e.g. `--color-crimson: #8C0B42;`) rather than hardcoded variations throughout components.
- The owner-approved cowboy crest remains the **approved composition**. Do **not** recreate it with new mascots or crossed-pistols designs. A JPEG may contain a variety of shades; do not use sampling from it to override the site's verified brand palette. Do not alter the approved artwork without approval.
- The old provisional values **#801828**, **#701020**, **#981830**, **#080808**, **#B0B0B0**, **#D0D0D0**, and **#D8C0A8** were guessed from the picture; they are **not the official NMSU site palette** and must not be treated as authoritative.
- NMSU's separate athletics-marks page discusses a distinct Athletics Crimson, but as checked it provides **no verified athletics HEX code** and still refers to Under Armour. The current Adidas sponsorship does not itself supply a color specification. Do not invent a new athletics crimson or label an unverified value official.
- This is an **independent fan forum**, not an NMSU-operated website. Color values are usable design references; separate licensing and permissions apply to official mascots, wordmarks, and cultural marks.

Sources:
- https://brand.nmsu.edu/color/
- https://brand.nmsu.edu/logos-marks/athletics.html

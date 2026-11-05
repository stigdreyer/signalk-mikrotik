# MikroTik Data Meter: logo guidelines

## 1. The logo

- **Idea:** a boat's through-hull valve (seacock), turned part-way open. The crew decides how much flows, which is what the plugin does to the router while the connection is metered.
- **Construction:** ring, lever and pivot on a 256 grid, rotated 45°. The ring is cut where the lever crosses it, so the lever reads as on top. One weight throughout: the ring is 28 units thick, the lever 28 wide.
- **Versions** (in `logo/`):

| File | Use |
|---|---|
| `data-meter-horizontal.svg` | Primary: README, docs, the Signal K appstore listing |
| `data-meter-stacked.svg` | Square spaces: social cards, slides |
| `valve-symbol.svg` | Symbol alone: avatars, app header, anything under 160 px wide |
| `valve-symbol-small.svg` | 16 to 24 px: favicons and tab icons (heavier ring and lever, wider gaps) |
| `valve-symbol-reversed.svg`, `*-reversed.svg` | On dark backgrounds (slightly thinner, light ink spreads) |
| `valve-symbol-night.svg` | Night mode: red only, for red-on-black screens |
| `*-black.svg`, `export/valve-symbol-white.svg`, `export/valve-symbol-mono-c8501c.svg` | One colour |
| `valve-app-icon.svg`, `export/` | App icon, favicon set, web manifest |

`source/build.py` regenerates every master from the construction; edit the numbers there, not the SVG files.

## 2. Clear space

Keep free space around the logo equal to the pivot's diameter (60 units on the 256 grid, about a quarter of the symbol's height). Nothing else, text or edge, enters that space.

## 3. Minimum size

| Version | Screen | Print |
|---|---|---|
| Horizontal | 160 px wide | 35 mm wide |
| Stacked | 96 px wide | 22 mm wide |
| Symbol | 24 px (`valve-symbol.svg`); 16 px with `valve-symbol-small.svg` | 6 mm |

Below those sizes the tagline and the ring's cut close up: use the symbol alone.

## 4. Colour

| Name | Use | HEX | RGB | CMYK (approx.) |
|---|---|---|---|---|
| Lever orange | The lever and pivot: the part the crew controls | `#C8501C` | 200 80 28 | 0 60 86 22 |
| Ink | Ring and wordmark on light | `#1A1A19` | 26 26 25 | 0 0 4 90 |
| Paper | Ring and wordmark on dark | `#FCFCFB` | 252 252 251 | 0 0 0 1 |
| Night red | Everything, in night mode | `#D82222` | 216 34 34 | 0 84 84 15 |

Lever orange reaches 4.4:1 on paper and 3.8:1 on ink, so the lever stays visible on both. No Pantone match has been chosen: pick one from a swatch book before anything is printed.

Colour rule: the lever is orange, everything else is ink (or paper on dark). In one colour, everything takes the same colour. At night, everything is night red; never use white or blue near a night-mode screen.

## 5. Typography

- **Name:** "MikroTik Data Meter", the app name in Signal K (the package stays `signalk-mikrotik`). MikroTik is MikroTik's trademark: the name describes what the app works with, it is not a MikroTik product.
- **Wordmark:** "MikroTik Data Meter" in DejaVu Sans Bold, tracking −2 %, outlined in the SVGs (no font ships with the logo). Tagline "for Signal K" in DejaVu Sans, tracking +1 %.
- **Licence:** DejaVu fonts use the Bitstream Vera / public-domain licence, which allows use and modification, including in logos.
- **In the app:** the pages use the system UI stack (`system-ui, sans-serif`); the wordmark there is live text, which is fine on screen.

## 6. Don'ts

- Don't rotate the symbol: the 45° lever is the idea (part-way open). Upright reads as a letter C, flat as a gauge.
- Don't colour the ring orange or the lever ink, and don't add a third colour, gradients or shadows.
- Don't close the gap where the lever crosses the ring, or move the lever off the centre.
- Don't use the master symbol below 24 px: switch to `valve-symbol-small.svg`.
- Don't put the two-colour logo on mid-tone or busy backgrounds; use the one-colour version.
- Don't combine the symbol with MikroTik's, Signal K's or Starlink's logos as one mark. The tagline names them in plain text only.

## 7. Notes

- Trademark clearance has not been checked. Run a search (trademark databases, reverse image search) before publishing the plugin.
- Concept round and test sheets: `concepts/` (exploration only, not for use). Presentation board: `presentation.html` (open in a browser).

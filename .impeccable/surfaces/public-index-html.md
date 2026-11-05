---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: []
---

# Data usage (public/index.html)

Scope: the Data usage page of the plugin webapp. Mode: Operate. Built code-led inside the established world (shared header, tokens, night mode with the Allowlist page).

Audience and job: skippers and crew checking metered data against the Starlink app's Data Usage page for the current billing cycle. Must keep: the per-day metered/normal graph (interactive) and the Local/UTC day switch. Dropped by request: cost estimate, daily table, per-day rows and hour charts (the user found the cycle log too complex). Router check shown only when the router needs a fix.

Constraints: offline (no external assets), red-on-black night mode, plain HTML/JS.

## Direction contract

THESIS: One stacked bar chart for the whole billing cycle; a day's exact numbers appear above its bar on hover or tap. Refuses rows, tables and drill-downs: the cycle's shape plus one day on demand is enough to check against Starlink.

OWN-WORLD: The app's shared system: system-ui, panel tiles, 3:1 control outlines, metered orange on top of muted normal blue (red-on-black at night, normal at 3:1). The tip uses the selected-state fill with a text-colour outline.

STORY: The visitor sees which cycle they are in and the metered and normal totals so far, scans the cycle's bars, and points at or taps a day to read its metered and normal GB.

FIRST VIEWPORT: App bar and tabs; cycle switcher (‹ 14 Oct – 13 Nov ›, "Billing cycle · day 23 of 31"); Metered (lead) and Normal totals; router profile and Days-in switch (Local / UTC, like Starlink); legend; the cycle chart with days labelled and Today in bold, future days empty.

FORM: Cycle chart, the user's simplification of the cycle log (position 3 of seven); seed:b05ae01fb2f364f5.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

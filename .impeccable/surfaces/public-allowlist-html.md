---
version: 1
slug: "public-allowlist-html"
primary_target: "public/allowlist.html"
related_targets: []
---

# Allowlist (public/allowlist.html)

Scope: the Allowlist page of the plugin webapp. Mode: Operate. Code-led inside the established world (shared header, tokens, night mode with Data usage).

Audience and jobs: skippers and crew, both setting up before going metered and keeping watch afterwards: block what eats data, unblock what stopped working. Must keep: data volume per service, v2fly catalog search, category filters. Also kept from the incumbent: adding an unseen domain, Save to the router with a preview, Discard, "Start counting from now", always-allowed lists.

Constraints: offline, red-on-black night mode, plain HTML/JS; saving writes to the router and can take tens of seconds.

## Direction contract

THESIS: The allowlist as a data share: one bar of the last 14 days split by service, solid where it gets through while metered and hatched where it is blocked, over one list sorted by data with a switch per row. Refuses sectioned lists and sort controls.

OWN-WORLD: The app's shared system: system-ui, panel tiles, 3:1 outlines, metered orange as warning, muted normal blue for allowed share, hatching for blocked (shape, not colour, so night mode keeps it). Switches are standard toggles.

STORY: The visitor sees what gets through now, sees which services take the data and which of them are blocked, and flips a switch (or searches the catalog) to allow or block, then saves.

FIRST VIEWPORT: App bar and tabs; status line; share bar with the top services named; search; category chips; the list sorted by data, each row name, category or blocked time, GB and share, switch; Save bar at the bottom.

FORM: Data share, position 7 on the ordered list of seven; seed:66ca5f31a4bae417.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Skippers and crew on boats that run Signal K on a boat computer and route the boat's internet through a MikroTik router, with a metered uplink: mainly Starlink Ocean Mode (billed per GB), also roaming LTE or other satellite plans. Published for any Signal K + MikroTik boat, not only the boat it was built on.

They open the plugin's pages from the Signal K admin UI on a phone or a chart-side tablet, at the dock and at sea, on day and night watches. Their job: keep metered data (and the bill) under control without cutting off what the crew actually needs.

## Product Purpose

The plugin switches the MikroTik router to an allowlist while signalk-internet reports a metered connection, so background traffic (OS updates, cloud sync, telemetry, streaming) is dropped at the router. It shows how much data went over the WAN, normal and metered, and which services and domains devices use, so the crew builds the allowlist from real usage instead of guessing domains.

Success: the crew trusts the numbers enough to act on them, and metered usage stays at what they chose to allow.

## Positioning

Enforcement happens at the boat's own router and follows the boat's own internet state, not a phone setting or a provider dashboard. Usage is counted at the router's WAN interface, per service via Traffic Flow and the router's DNS cache, grouped by v2fly's community service catalog.

## Operating Context

- Signal K server with the signalk-internet plugin, which decides online / metered / captive / offline; the user sets the override from Freeboard or the plugin.
- The pages are Signal K webapps behind the Signal K admin login.
- The Starlink app's Data Usage page is the reference the crew compares against: its days are UTC.
- At sea the boat may be offline or on an expensive link: the pages must work with no internet at all.
- Night watches: red-on-black night mode, following the vessel's `environment.mode` or forced per device.

## Capabilities and Constraints

- RouterOS v7 REST API; the router admin changes (Traffic Flow, DNS, DHCP) are made by the user from the documented commands.
- WAN byte counters per UTC day and hour (kept 400 days); GB = 10^9 bytes; counts include protocol overhead and the router's own traffic, not the dish's own.
- Per-service data volume needs the router's Traffic Flow export; names and volume are kept 14 days.
- Cost is an estimate from a user-configured price per GB and currency.
- Everything ships inside the plugin: no CDN, hosted fonts or external scripts.
- Undecided: whether the Data usage page follows a provider billing cycle instead of calendar months (no billing-cycle setting exists yet).

## Brand Commitments

- Name in Signal K: "MikroTik metered firewall"; header reads "Metered firewall · MikroTik · Signal K".
- Licence EUPL-1.2; v2fly/domain-list-community data under MIT, credited on the Allowlist page.

## Evidence on Hand

No testimonials, customers or benchmarks exist; do not invent them. Real usage data exists only on the pilot boat; previews use synthetic sample data, which must be labelled as such if ever shown publicly.

## Product Principles

1. Numbers you can check: every figure should line up with what the provider (Starlink) shows, or say why it differs.
2. Metered first: the data that costs money leads; normal data is context.
3. Night vision is a requirement, not a theme: no white or blue light at night, states carried by shape.
4. Works at sea: offline, on a phone, one-handed, with a moving deck.
5. The crew decides: the plugin shows and enforces, the crew chooses what gets through.

## Accessibility & Inclusion

Red-on-black night mode with secondary text at about 3.5:1 by deliberate choice (night vision over WCAG AA); states never by colour alone; 44 px touch targets; keyboard focus kept across redraws.

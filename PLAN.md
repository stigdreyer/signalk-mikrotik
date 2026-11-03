# signalk-mikrotik: implementation plan

The design is in [README.md](README.md). This file covers how we get there:
the phases, what each delivers, and what's still open.

**Audience.** The plugin is for any Signal K user with a MikroTik router, not
one boat. That rules some things out:

- no assumptions about addresses, interface names or a default config
- no assumption that the metered uplink is Starlink (roaming LTE works too)
- no change to anything on the router the plugin didn't create
- every requirement is checked and reported in the plugin status, not left to
  fail silently

A pilot boat runs each phase before it is released.

## Design rules for a shared router

These apply to every phase.

1. **Own only what we tag.** Every object carries
   `comment=signalk-mikrotik`. The plugin never edits or deletes user objects.
2. **Never lock anyone out.** We touch only the `forward` chain, never `input`
   or `output`, so WinBox, SSH and the router's own services keep working in
   every profile.
3. **Clean removal.** A "Remove from router" action deletes every tagged
   object. Stopping the plugin leaves the router in its current profile (fails
   safe), but removing it doesn't leave orphans behind.
4. **Preflight before writing.** On start, and from a "Check router" button,
   the plugin checks:
   - RouterOS version
   - REST reachable
   - user policies
   - WAN list exists and has members
   - fasttrack position
   - whether LAN clients use router DNS (DHCP `dns-server`)
   - IPv6 enabled

   Results go to the plugin status and the webapp. Missing required items block
   installation with a clear message.
5. **Feature gating, not version guessing.** Optional features, such as
   subdomain matching via DNS `FWD` + `address-list`, are probed and switched
   off with a warning when the router lacks them.
6. **No dependencies.** Node's built-in `fetch`, `node:test` and plain web
   components keep installs small on Pi-class hardware.

## Phase 0: router setup guide + pilot preparation

Documentation for every user, tried out on the pilot boat.

- `docs/router-setup.md` covers:
  - enabling `www-ssl` with a self-signed certificate
  - creating a least-privilege user (`read,write,rest-api`)
  - the WAN list
  - pointing DHCP DNS at the router
  - an optional DoH upstream
- **Known pitfalls (found in the pilot):** a dynamic IPv6 upstream returned
  SERVFAIL for large answers (fix: fixed IPv4 `servers`), and RouterOS
  compresses SRV target names, which strict c-ares 1.34.8 rejects.
- **Pilot:** go through the guide on the pilot boat and fix it wherever reality
  differs. Pilot-specific notes stay out of this repo.

## Phase 1: the switch (MVP)

> **Status:** code and tests done (15 tests against a fake RouterOS server).
> Pilot on a hAP ax S running RouterOS 7.25 (2026-11-03): install, metered,
> offline and back to normal all pass. `place-before` and the bulk connection
> remove work over REST, and the user needs the `api` policy as well as
> `rest-api`. The Signal K restart test exposed an upstream gap: signalk-internet
> didn't persist its override, now fixed on a local branch there. Still open:
> the removal test, the user-policy check in preflight, and the
> "Check router" / "Remove from router" buttons, which come with the Phase 2
> webapp and are REST endpoints for now.

The goal is that `metered` locks the router and `online` unlocks it. Only the
base list is allowed.

- **Plugin skeleton:** `index.js`, `package.json` (`EUPL-1.2`, keyword
  `signalk-node-server-plugin`).
- **Config:**
  - router URL, user, password
  - accept self-signed certificate
  - WAN interface list (default `WAN`)
  - uplink management presets: Starlink is on by default and covers the dish
    subnet (default `192.168.100.0/24`) plus the app's cloud hosts
- **REST client:** clear errors for authentication, TLS, timeout and missing
  path.
- **Preflight** (design rule 4).
- **Idempotent install**, all objects tagged:
  - address-list `skm-metered`
  - forward rules placed **above fasttrack**: accept to the list, accept to the
    uplink management subnets, drop `out-interface-list=<WAN list>`
    (disabled)
  - IPv6 forward drop to WAN, only if IPv6 is enabled (disabled)
  - dst-nat that sends LAN port 53 to the router, optional (disabled)
- **Profile switch:**
  - `metered`: enable the rules, then flush the connection table
  - `online`: disable them
  - `offline`, `captive`, `null`: do nothing
- **Startup reconcile:** read the current state and router rules, and fix any
  difference.
- **Remove from router** (design rule 3).
- **Status:** `app.setPluginStatus` plus `network.mikrotik.profile`
  (`normal` / `metered`).
- **Base list:** `profiles/base.json` with NTP, the signalk-internet probe
  hosts (Apple and Google) and safety comms.
- **Tests:** a fake RouterOS REST server on `node:http` that can simulate:
  - a default config
  - no defconf
  - a missing or empty WAN list
  - an old RouterOS without the optional features
  - auth failure

  Plus assertions for install twice (no duplicates), each transition,
  reconcile, removal, and user objects left untouched.

**Pilot test (in port):** set the override to Metered and check that streaming
fails, messaging works, the Starlink app can open Data Usage, and Signal K
still sees the dish. Then set Online and check everything works again. Run
Remove and verify that nothing tagged is left.

## Phase 2: data usage dashboard

> **Status:** built in 0.3.0 (24 tests): collector, JSON storage, Signal K
> paths, `GET /usage`, webapp page. The profile switch books the bytes up to
> the switch to the old profile first. Pilot: compare a week with Starlink.

The goal is to see how much data went over the uplink per day, split into
normal and metered. That makes Starlink's own figures (Roam vs Ocean Mode) easy
to check. It doesn't depend on profiles or traffic learning, so it comes first
and brings the webapp with it.

- **Counter collector:** every 60 s, read `rx-byte` / `tx-byte` of every member
  of the WAN interface list (`/interface` by name). Add the change since the
  last reading to the current day's bucket, labelled `normal` or `metered` by
  the router profile active at that moment.
  - **Counter reset** (router reboot, `reset-counters`): a reading lower than
    the last one counts from zero. The bytes between the last reading and the
    reset are lost.
  - **Plugin or HALPI2 down:** the router keeps counting, and the gap is
    booked to the day and profile of the first reading after restart.
- **Days in UTC**, like Starlink, so our days line up with theirs.
- **Storage:** one small JSON file in the plugin data directory, one entry per
  UTC day: `{ normal: { rx, tx }, metered: { rx, tx } }`. A year is a few
  hundred entries, so there's no database and no pruning needed.
- **Signal K paths:**
  - `network.mikrotik.usage.today.{normal,metered}` (bytes)
  - `network.mikrotik.usage.wan.{received,sent}` (bytes, running totals)

  These let KIP, Home Assistant or a history plugin (QuestDB, Grafana) use the
  same data.
- **Config:** price per metered GB and currency (e.g. `4.39` `FJD`), for the
  cost estimate. GB means 10⁹ bytes, like Starlink's.
- **Webapp, first page** (`public/`, plain web components like
  signalk-internet):
  - daily bars stacked normal/metered, one tab per month
  - period totals for normal and metered, plus the estimated metered cost
  - a day tooltip like Starlink's: normal GB, metered GB
  - current profile and router preflight results
  - a note that bytes are counted at the router, so they include Ethernet
    overhead and the router's own traffic but not the dish's own traffic
- **REST endpoint:** `GET /usage?from=&to=` returns the daily buckets
  (read-only).
- **Tests:**
  - collector against the fake router: counter growth, reset, profile switch
    in the middle of a day, UTC day boundary
  - storage round trip

**Pilot test:** run it for a week alongside Starlink's Data Usage page and
compare per day. A few percent difference is expected; a consistent large gap
is worth raising with Starlink.

## Phase 3: curated profiles

- `profiles/*.json`, one file per profile (weather, messaging, email,
  tracking): name, description, list of FQDNs, notes on known gaps.
- Seed from spidgrou's `whitelist.conf`, keeping the MIT notice.
- **Profiles are community data.** `CONTRIBUTING.md` explains how to add or
  fix a profile by PR, and a test validates the profile JSON (schema, valid
  FQDNs, no wildcards, no duplicates).
- Profile checkboxes in the plugin config.
- **Sync:** active profiles become DNS `FWD` entries with
  `match-subdomain=yes address-list=skm-metered`, like the base list already
  does since 0.2.0 (pulled forward: without it, clients on a public resolver
  got CDN IPs the router didn't allow, and signalk-internet's probe flapped).
  Routers without that feature fall back to plain FQDN address-list entries
  (no subdomains), with a warning.

## Phase 4: traffic monitor

- **Collector:** every 30 s, read:
  - `/ip/dns/cache`: domain → IP
  - `/ip/firewall/connection`: source, destination and bytes
  - DHCP leases: IP → device name

  The plugin joins these into domain × device × bytes and keeps rolling daily
  JSON files in the plugin data directory (retention configurable, default 14
  days). The connection table can be large on busy networks, so the poll
  interval is configurable.
  `shortcut: polling misses connections shorter than the interval; upgrade to
  Traffic Flow (IPFIX) export if the numbers look too low.`
- If clients don't use router DNS, the webapp says so instead of showing an
  empty or misleading log.
- **Webapp, second page** (next to the Phase 2 usage dashboard):
  - active lists
  - top domains by bytes, filterable by device
  - an "allow while metered" toggle per domain, which becomes a learned entry
  - an "export as profile" action that produces JSON ready to contribute
    upstream
- **REST endpoints:** for the webapp to list traffic, manage learned entries
  and trigger preflight or removal, admin only.

**Pilot test:** an afternoon in port using the Starlink app and the crew's
apps, then review the log. The real Starlink app hosts found this way go into
the Starlink preset.

## Phase 5: publish

- Public GitHub repo `stigdreyer/signalk-mikrotik`, CI running `npm test` on
  Node 20 and 22.
- npm publish so the plugin appears in the Signal K appstore, with appstore
  screenshot and description.
- README sections:
  - quick start
  - requirements
  - a "Tested on" table (router model + RouterOS version), extended by
    reports from users
  - troubleshooting, built from the preflight messages
- Issue templates: "profile missing or broken" and "router not supported".
- Optional: a PR to signalk-internet that links it as a downstream example.

## Open questions

1. ~~**Connection flush over REST**~~: answered in the pilot. The bulk
   `remove` with a comma-separated `.id` list works on RouterOS 7.25. Its
   speed with thousands of connections is still untested.
2. **Minimum RouterOS version:** the REST API needs v7. Settle the floor once
   the optional features are probed (likely 7.1 for the core, newer for
   subdomain matching).
3. **Safety comms:** a fixed default set, or simply the messaging profile on
   by default?
4. **Router password storage:** the plugin config is plain JSON on the Signal K
   host. Document that a least-privilege, LAN-only user is the mitigation.
5. **Later:** read the dish's `disablement_code` (needs an upstream PR to
   signalk-starlink) as a check that Ocean Mode is really on.

## Out of scope (agreed)

Notifications, debounce, per-device rules, data quota alerts (usage is tracked
and shown, see Phase 2, but nothing acts on it), SSH transport, using
spidgrou's `.rsc` scripts.

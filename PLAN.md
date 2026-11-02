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
- **Known pitfall to document:** depending on version and config, the RouterOS
  DNS forwarder may return replies without EDNS, and some clients (newer
  c-ares) reject those. Users should check with `dig @<router>` before
  switching clients to router DNS.
- **Pilot:** go through the guide on the pilot boat and fix it wherever reality
  differs. Pilot-specific notes stay out of this repo.

## Phase 1: the switch (MVP)

> **Status:** code and tests done (15 tests against a fake RouterOS server).
> Not yet run against a real router. Still open: the user-policy check in
> preflight, and the "Check router" / "Remove from router" buttons, which come
> with the Phase 3 webapp and are REST endpoints for now.

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

## Phase 2: curated profiles

- `profiles/*.json`, one file per profile (weather, messaging, email,
  tracking): name, description, list of FQDNs, notes on known gaps.
- Seed from spidgrou's `whitelist.conf`, keeping the MIT notice.
- **Profiles are community data.** `CONTRIBUTING.md` explains how to add or
  fix a profile by PR, and a test validates the profile JSON (schema, valid
  FQDNs, no wildcards, no duplicates).
- Profile checkboxes in the plugin config.
- **Sync:** active profiles become DNS `FWD` entries with
  `match-subdomain=yes address-list=skm-metered`. Routers without that feature
  fall back to plain FQDN address-list entries (no subdomains), with a
  warning.

## Phase 3: traffic monitor and webapp

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
- **Webapp** (`public/`, plain web components like signalk-internet):
  - router preflight results
  - current profile and active lists
  - top domains by bytes, filterable by device
  - an "allow while metered" toggle per domain, which becomes a learned entry
  - an "export as profile" action that produces JSON ready to contribute
    upstream
- **REST endpoints:** for the webapp to list traffic, manage learned entries
  and trigger preflight or removal, admin only.

**Pilot test:** an afternoon in port using the Starlink app and the crew's
apps, then review the log. The real Starlink app hosts found this way go into
the Starlink preset.

## Phase 4: publish

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

1. **Connection flush over REST:** listing and deleting thousands of IDs is
   slow. Check whether `/rest/execute` with
   `/ip firewall connection remove [find]` works, and from which version.
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

Notifications, debounce, per-device rules, data quota/budget, SSH transport,
using spidgrou's `.rsc` scripts.

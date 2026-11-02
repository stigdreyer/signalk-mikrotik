# signalk-mikrotik

> **Status: early development.** Phase 1 (the profile switch) is implemented
> and has been piloted on one router (hAP ax S, RouterOS 7.25). Still to come
> (see [PLAN.md](PLAN.md)): a data usage dashboard, curated profiles and the
> traffic monitor.

A Signal K plugin that switches a **MikroTik** router between a **normal** and a
**metered** firewall profile, following the internet state published by
[signalk-internet](https://github.com/meri-imperiumi/signalk-internet).

It works with any metered uplink signalk-internet can report, such as roaming
LTE or satellite. The main use case is **Starlink Ocean Mode**, which is billed
per GB (6 USD/GB on Roam Unlimited and Personal Maritime since 27 September
2026). While metered,
only the services you choose can reach the internet. Background traffic like OS
updates, cloud sync, telemetry and streaming is dropped at the router.

The plugin also watches your network traffic in normal mode, so you can build
the metered allowlist from what your crew actually uses rather than guessing
domains.

## How it fits together

```
 Starlink app ──(you)── Ocean Mode on/off      (billing, Starlink cloud)
                            │
 Freeboard / signalk-internet override ──(you)── metered / online
                            │
              network.internet.state
                            │
                    signalk-mikrotik ──REST──▶ MikroTik: metered / normal profile
```

| Plugin | Role |
|---|---|
| [signalk-internet](https://github.com/meri-imperiumi/signalk-internet) | **Decides.** Publishes `network.internet.state` (`online` / `metered` / `captive` / `offline`) and holds the manual override (Freeboard button or REST). |
| [signalk-starlink-offshore](https://github.com/night199uk/signalk-starlink-offshore) | **Backstop.** Publishes `navigation.maritimeZone`. signalk-internet's built-in `high-seas → metered` rule locks the router if you forget the override. |
| [signalk-starlink](https://github.com/itemir/signalk-starlink) | Dish status, which signalk-internet uses for its online/offline mapping. Optional. |
| **signalk-mikrotik** (this plugin) | **Enforces.** Switches the router profile and records traffic for the allowlist. |

signalk-mikrotik doesn't detect anything on its own. It does exactly what
`network.internet.state` says.

## Usage

Starlink Ocean Mode is an account setting that you switch in the Starlink app.
The dish can't tell the boat whether it's on, so the override is set by hand to
match it.

**Going offshore**

1. Turn on **Ocean Mode** in the Starlink app.
2. Set signalk-internet to **Metered** (Freeboard Internet button).
3. signalk-mikrotik applies the **metered profile** and closes connections that
   are already open.

**Coming back**

1. Turn off **Ocean Mode** in the Starlink app.
2. Set signalk-internet to **Online** (or **Auto**).
3. signalk-mikrotik applies the **normal profile**.

### State handling

| `network.internet.state` change | Router action |
|---|---|
| → `metered` | Apply metered profile and flush the connection table |
| → `online` | Apply normal profile |
| → `offline`, `captive` | **No change** |
| → `null` (signalk-internet stopped) | **No change** |
| Plugin start | Read the current state and bring the router in line with it |

Failing safe means staying in whatever profile is active. If you forget to set
the override back to online, the router stays locked, which costs nothing. The
profile survives a router reboot. Unlike
[mikrotik-starlink-ocean-mode](https://github.com/spidgrou/mikrotik-starlink-ocean-mode),
which always boots open, a power blip at sea doesn't reopen the gate.

## The metered profile

While metered, outbound WAN traffic is allowed only to the union of three
lists:

1. **Base list** (always on)
   - **Uplink management:** a preset per uplink. The **Starlink** preset is on
     by default and covers the dish on the LAN (default `192.168.100.0/24`)
     plus the Starlink cloud (account, subscription, data usage). Keep it on if
     you use Starlink: without it you can't turn Ocean Mode off.
   - **Boat systems:** NTP, the signalk-internet probe hosts, and the upstreams
     of the Signal K plugins you run.
   - **Safety comms:** a minimal messaging and email set for the crew.
2. **Curated profiles** (tick to enable)
   - **Weather / routing:** PredictWind, Windy, Saildocs / GRIB, NOAA, ECMWF
     open data, …
   - **Messaging:** WhatsApp, Signal, iMessage / FaceTime, Telegram
   - **Email:** Gmail, Outlook / Microsoft 365, iCloud Mail
   - **Tracking / logging:** NoForeignLand, AIS uploaders, PredictWind / Garmin
     tracking, …
3. **Learned entries:** domains you approved from the traffic monitor.

Everything else that goes out to WAN is dropped.

## Traffic monitor

In normal mode the plugin keeps a rolling log (about 14 days) of:

- **domain**: from the router's DNS cache
- **device**: from the DHCP lease or hostname
- **bytes**: from connection tracking

The plugin's webapp in Signal K admin lists the top domains per device. You
tick the ones that should stay reachable while metered, and they become learned
entries.

The easiest way to build the list is a short session in port. Use each app the
way you would at sea, including the Starlink app (open Data Usage, toggle a
setting), then review the log.

## What it does on the router

Everything the plugin creates carries a `signalk-mikrotik` comment and is
managed idempotently over the RouterOS REST API. The plugin never changes
objects it didn't create. It only touches the `forward` chain, so router
access via WinBox or SSH is never affected. On every start the plugin runs a
preflight (RouterOS version, WAN list, DNS, IPv6) before anything is written.
Until the webapp exists, the checks are also available over REST (admin only):

- `GET /plugins/signalk-mikrotik/preflight` runs the checks again.
- `POST /plugins/signalk-mikrotik/remove` deletes every tagged object.

- **Address-list** `skm-metered`: the FQDNs of the active lists. Subdomains are
  matched with DNS `FWD` static entries using `match-subdomain` plus
  `address-list`.
- **Forward-chain rules** at the top of the chain, so they run before
  defconf fasttrack:
  - accept to `skm-metered`
  - accept to the uplink management subnets (e.g. the Starlink dish)
  - drop `out-interface-list=WAN`

  The drop rule is enabled only while metered.
- **DNS:** while metered, port 53 from LAN is redirected to the router, so
  hard-coded resolvers can't bypass the list.
- **IPv6:** if IPv6 is enabled, all IPv6 forwarded to WAN is dropped while
  metered.
- **Connection flush** on the switch to metered, so streams and downloads that
  are already running (including fasttracked ones) stop immediately.

The router's own traffic (output chain) isn't touched.

## Requirements

- **RouterOS v7** with the REST API enabled (`www-ssl` recommended). The exact
  minimum version is still to be settled. Optional features, such as subdomain
  matching, are detected and switched off with a warning on older versions.
- **A dedicated router user** for the plugin, with only the `read`, `write`, `api` and
  `rest-api` policies (REST on RouterOS 7.25 refuses commands with "not
  allowed (9)" without `api`)
- **A WAN interface list** (name configurable) containing the metered uplink.
  For Starlink, use bypass mode so the dish connects straight to the
  MikroTik.
- **The router as DNS server for LAN clients.** Domain-based allowlisting and
  the traffic monitor both depend on clients resolving through the router.
  Before switching, check with `dig @<router>` that replies include EDNS,
  because some clients reject replies without it.
- **signalk-internet**. signalk-starlink-offshore is optional and provides
  the high-seas backstop.

Step-by-step router setup: `docs/router-setup.md` (planned).

## Configuration (planned)

| Setting | Description |
|---|---|
| Router address, user, password | REST endpoint and credentials |
| Accept self-signed certificate | For `www-ssl` with the router's own certificate |
| WAN interface list | Default `WAN` |
| Uplink presets | Starlink (default on, dish subnet configurable) |
| Profiles | Curated profiles to enable while metered |
| Learned entries | Managed in the webapp |
| Traffic log retention | Default 14 days |
| Price per metered GB, currency | For the cost estimate on the usage dashboard |

## Known limitations

- **Domains become IPs.** The router allows by IP, so a whitelisted domain on a
  shared CDN or cloud also opens everything else behind those IPs. Allowing
  Gmail effectively opens most of Google, and the same goes for Microsoft.
- **DNS over HTTPS** in browsers bypasses the router's DNS. It is blocked while
  metered unless its provider's IPs happen to be allowed, and in that case
  those clients' domains don't show up in the traffic monitor.
- **No billing truth.** Nothing tells the plugin whether Ocean Mode is actually
  on in your Starlink account. The override is yours to keep in sync. The dish's
  `disablement_code` (`IN_OCEAN` vs `OKAY`) may help on the high seas in future.
- **App host lists change.** Re-check the traffic monitor if an app stops
  working while metered, and please send fixed or new profiles back as a PR.
  The webapp can export your learned entries as a profile file.

## Credits

- [spidgrou/mikrotik-starlink-ocean-mode](https://github.com/spidgrou/mikrotik-starlink-ocean-mode):
  the whitelist-by-address-list approach
- [meri-imperiumi/signalk-internet](https://github.com/meri-imperiumi/signalk-internet):
  connectivity state and override
- [night199uk/signalk-starlink-offshore](https://github.com/night199uk/signalk-starlink-offshore):
  maritime zones

## License

[EUPL-1.2](LICENSE) (European Union Public Licence). Anything reused from
mikrotik-starlink-ocean-mode keeps its MIT notice.

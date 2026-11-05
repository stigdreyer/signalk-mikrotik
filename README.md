# signalk-mikrotik

> **Status: early development.** Phase 1 (the profile switch) is implemented
> and has been piloted on one router (hAP ax S, RouterOS 7.25). Phase 2 (the
> data usage dashboard) is in its pilot, and Phase 3 (the Allowlist page on
> v2fly's service catalog) is built as an MVP. See [PLAN.md](PLAN.md).

A Signal K plugin that switches a **MikroTik** router between a **normal** and a
**metered** firewall profile, following the internet state published by
[signalk-internet](https://github.com/meri-imperiumi/signalk-internet).

It works with any metered uplink signalk-internet can report, such as roaming
LTE or satellite. The main use case is **Starlink Ocean Mode**, which is billed
per GB (6 USD/GB on Roam Unlimited and Personal Maritime since 27 September
2026). While metered,
only the services you choose can reach the internet. Background traffic like OS
updates, cloud sync, telemetry and streaming is dropped at the router.

The plugin also shows which services and domains your devices look up, and
what got blocked while metered, so you build the allowlist from what your crew
actually uses rather than guessing domains.

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

1. **Always allowed**
   - **Uplink management:** a preset per uplink. The **Starlink** preset is on
     by default and covers the dish on the LAN (default `192.168.100.0/24`)
     plus the Starlink cloud (account, subscription, data usage). Keep it on if
     you use Starlink: without it you can't turn Ocean Mode off.
   - **Boat systems:** NTP and the signalk-internet probe hosts.
2. **What you pick on the Allowlist page** of the webapp:
   - **Services** from
     [v2fly/domain-list-community](https://github.com/v2fly/domain-list-community),
     about 1,400 of them (WhatsApp, Telegram, Docker, Netflix, …), with v2fly's
     categories. For crew safety comms, pick your messaging apps.
   - **Domains** the router has seen your devices look up that v2fly doesn't
     know.

   Everything you pick allows its subdomains too.

Everything else that goes out to WAN is dropped.

## Data usage dashboard

Every 60 seconds the plugin reads the byte counters of the WAN interfaces and
books the growth to the current UTC day and hour, split into **normal** and
**metered** by the profile that was active. The webapp shows days in the
device's own time zone, or in UTC to line up with Starlink's figures. The Signal K webapp **MikroTik
Data Usage** shows daily bars per month, the totals and, if you set a price
per metered GB, the estimated cost. You can check it against Starlink's own
Data Usage page.

The same numbers are published to Signal K for KIP, Home Assistant or a
history plugin:

| Path | Value |
|---|---|
| `network.mikrotik.usage.today.normal` | bytes today (UTC), normal profile |
| `network.mikrotik.usage.today.metered` | bytes today (UTC), metered profile |
| `network.mikrotik.usage.wan.received` | bytes received since the plugin started counting |
| `network.mikrotik.usage.wan.sent` | bytes sent since the plugin started counting |

`GET /plugins/signalk-mikrotik/usage?from=YYYY-MM-DD&to=YYYY-MM-DD` returns
the daily buckets. While the plugin or the Signal K server is down the router
keeps counting, and the gap is booked to the first sample after restart. A
router reboot loses the bytes since the last sample.

## Allowlist page

The webapp's **Allowlist** page is where you choose what stays reachable while
metered. Every minute the plugin reads the names in the router's DNS cache and
keeps, for 14 days, when each was last seen and on how many days. The page
shows:

- **Blocked while metered:** services and domains your devices looked up
  while metered that aren't allowed, newest first. Tick one to allow it after
  the fact, e.g. when a Docker update failed. While metered, saving also
  flushes the router's DNS cache, so devices ask again and get through.
- **Allowed**, then **Seen on board**: every name a device looked up, grouped
  into its v2fly service (or its domain when v2fly doesn't know it), most used
  first ("seen 3 min ago · 9 days"). Details show the names looked up, how
  many domains allowing it opens, and v2fly's hierarchy (Apple includes
  iCloud, Apple TV+, Apple update, …).
- **Data volume** per service and domain over the last 14 days, with the
  metered part, sorted by volume (optional, needs the router's Traffic Flow
  export, see [router-setup.md](docs/router-setup.md#5-optional-traffic-flow-for-data-volume-per-service)).
  **Start counting from now** starts a second count, e.g. right after
  switching to metered, to see what still uses data. The 14-day history stays.
  The router reports every connection, and the plugin books its bytes to the
  name the device looked up, following CNAMEs, so CDN traffic counts for the
  service using it.
- **Search** filters what was seen and also searches the whole v2fly catalog,
  so you can allow a service before anyone used it.
- **Category chips** from v2fly filter the list; ads and tracking are hidden
  unless you show them.
- **Always allowed:** the fixed lists, for reference.

Names that are only CNAME targets (CDN hosts) are left out: nobody asked for
them, so they'd show up as blocked although their service is allowed.

Saving updates only the changed router entries. The firewall rules stay as
they are.

The page learns from the router's DNS. While metered the DNS redirect sends
every lookup there. In normal mode it only sees devices that use the router
as their DNS server, so hand out the router first via DHCP if you want to
build your list in port. The easiest way: a short session in port using each
app the way you would at sea, including the Starlink app (open Data Usage,
toggle a setting), then pick from the list.

## Night mode

Both webapp pages have a night mode: red on black, so nobody on watch loses
their night vision. By default it follows the vessel's day/night mode
(`environment.mode`, e.g. from signalk-derived-data), like other Signal K
apps. **Night** or **Day** in the page header forces one on that device;
**Auto** goes back to following the vessel.

## What it does on the router

Everything the plugin creates carries a `signalk-mikrotik` comment and is
managed idempotently over the RouterOS REST API. The plugin never changes
objects it didn't create. It only touches the `forward` chain, so router
access via WinBox or SSH is never affected. On every start the plugin runs a
preflight (RouterOS version, WAN list, DNS, IPv6) before anything is written.
Until the webapp exists, the checks are also available over REST (admin only):

- `GET /plugins/signalk-mikrotik/preflight` runs the checks again.
- `POST /plugins/signalk-mikrotik/remove` deletes every tagged object.

- **Address-list** `skm-metered`: the hostnames and subnets of the active
  lists.
- **DNS `FWD` static entries**, one per hostname, with `match-subdomain` and
  `address-list=skm-metered`. Every IP the router hands out for an allowed
  domain or its subdomains joins the list, so the firewall allows the same
  CDN addresses your devices were given. They forward to the router's own
  upstream server and are enabled only while metered.
- **Forward-chain rules** at the top of the chain, so they run before
  defconf fasttrack:
  - accept to `skm-metered`
  - accept to the uplink management subnets (e.g. the Starlink dish)
  - drop `out-interface-list=WAN`

  The drop rule is enabled only while metered.
- **DNS redirect** (on by default): while metered, port 53 from LAN goes to
  the router, whatever server a device asks. That's what makes the `FWD`
  entries see every lookup, and hard-coded resolvers can't bypass the list.
  Turned off, DNS to any server stays allowed and only devices that already
  use the router get matching IPs.
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
- **Router DNS that works for your clients** while metered (the redirect
  sends them all there): `allow-remote-requests=yes`, an IPv4 upstream that
  handles large answers, and `address-list-extra-time` above zero. See
  [router-setup.md](docs/router-setup.md#4-router-dns).
- **signalk-internet**. signalk-starlink-offshore is optional and provides
  the high-seas backstop.

Step-by-step router setup: [docs/router-setup.md](docs/router-setup.md).

## Configuration

| Setting | Description |
|---|---|
| Router address, user, password | REST endpoint and credentials |
| Accept self-signed certificate | For `www-ssl` with the router's own certificate |
| WAN interface list | Default `WAN` |
| Uplink presets | Starlink (default on, dish subnet configurable) |
| Redirect LAN DNS to the router while metered | Default on |

What's allowed while metered is picked on the webapp's Allowlist page, not in
the plugin config.
| Price per metered GB, currency | For the cost estimate on the usage dashboard |

## Known limitations

- **Domains become IPs.** The router allows by IP, so a whitelisted domain on a
  shared CDN or cloud also opens everything else behind those IPs. Allowing
  Gmail effectively opens most of Google, and the same goes for Microsoft.
- **RouterOS compresses SRV answers**, which RFC 2782 forbids. Strict
  resolvers (c-ares 1.34.8, e.g. Music Assistant's radio search) reject them
  while metered. Normal mode isn't affected when DHCP hands out a public
  resolver first.
- **DNS over HTTPS** in browsers bypasses the router's DNS. It is blocked while
  metered unless its provider's IPs happen to be allowed, and in that case
  those clients' domains don't show up in the traffic monitor.
- **No billing truth.** Nothing tells the plugin whether Ocean Mode is actually
  on in your Starlink account. The override is yours to keep in sync. The dish's
  `disablement_code` (`IN_OCEAN` vs `OKAY`) may help on the high seas in future.
- **App host lists change.** If an app stops working while metered, check
  which hosts it uses, and please send fixed or new profiles back as a PR (see
  [CONTRIBUTING.md](CONTRIBUTING.md)).

## Credits

- [spidgrou/mikrotik-starlink-ocean-mode](https://github.com/spidgrou/mikrotik-starlink-ocean-mode):
  the whitelist-by-address-list approach
- [meri-imperiumi/signalk-internet](https://github.com/meri-imperiumi/signalk-internet):
  connectivity state and override
- [night199uk/signalk-starlink-offshore](https://github.com/night199uk/signalk-starlink-offshore):
  maritime zones

## License

[EUPL-1.2](LICENSE) (European Union Public Licence). `data/v2fly.json` is
compiled from v2fly/domain-list-community and keeps its MIT notice in
[data/NOTICE](data/NOTICE).

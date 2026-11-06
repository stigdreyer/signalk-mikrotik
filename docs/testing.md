# Testing on a real router

A checklist for trying signalk-mikrotik on a boat before relying on it. Do it
**in port**, where you have other ways online if something goes wrong. Please
report the results (router model, RouterOS version, what failed) as an issue.

## Before

1. Take a backup: `/export file=before-signalk-mikrotik`.
2. Note the router's version: `/system resource print`.
3. Install the plugin (from the Appstore, or from a tarball:
   `npm install ./signalk-mikrotik-<version>.tgz` in the Signal K config
   directory, then restart Signal K).
4. Follow the app's **Setup** tab: its script does
   [router-setup.md](router-setup.md) sections 1, 2, 4 and 5 in one go. Set the
   WAN interface list in the plugin settings only if yours isn't called `WAN`.
   **Save and start** enables the plugin.

## 1. Install

- [ ] Plugin status shows `Router profile: normal` and no error.
- [ ] On the router, `/ip firewall filter print where comment=signalk-mikrotik`
      shows the accept and drop rules **above** the defconf fasttrack rule,
      all disabled (`X`).
- [ ] `/ip firewall nat print where comment=signalk-mikrotik` shows two
      disabled redirect rules (if DNS redirect is on).
- [ ] `/ip firewall address-list print where list=skm-metered` shows the
      hostnames, plus dynamic entries with resolved IPs.
- [ ] `/ip dns static print where comment=signalk-mikrotik` shows one
      disabled `FWD` entry per hostname.
- [ ] Restart the plugin: there are no duplicate rules.

## 2. Metered

In Freeboard → Internet, set the override to **Metered**.

- [ ] Plugin status changes to `Router profile: metered`, and the rules are
      enabled on the router.
- [ ] A video stream that was already playing stops within seconds
      (connection flush).
- [ ] New sites (e.g. a news site) don't load.
- [ ] signalk-internet stays `metered` for 10 minutes, without flipping to
      `offline`.
- [ ] The Starlink app opens and shows Data Usage.
- [ ] Signal K still shows Starlink status (dish reachable).
- [ ] WinBox/SSH to the router still work.
- [ ] Apps you expected to work and didn't appear under **Blocked lately** on
      the Allowlist. Allow them, save (which flushes the router's DNS cache)
      and retry.

## 3. Things that must not change the profile

- [ ] Override set to **Offline**: the router stays metered.
- [ ] Restart the Signal K server: the router stays metered.
- [ ] Reboot the router (optional): it comes back metered.

## 4. Back to normal

Set the override to **Online** (or **Auto** when the link is unmetered).

- [ ] Plugin status shows `Router profile: normal`, and the rules are disabled.
- [ ] Everything loads again.

## 5. Removal

Set the override to **Online**, then `curl -X POST` (as admin) to
`/plugins/signalk-mikrotik/remove`, or run the `remove` commands from
[router-setup.md](router-setup.md#undo).

- [ ] Nothing tagged `signalk-mikrotik` is left, except dynamic
      address-list entries, which expire on their own.
- [ ] Your own rules are unchanged (compare with the backup export).

## If something goes wrong

The plugin only changes rules tagged `signalk-mikrotik`. To get back online
immediately:

```routeros
/ip firewall filter disable [find comment=signalk-mikrotik]
/ip firewall nat disable [find comment=signalk-mikrotik]
/ipv6 firewall filter disable [find comment=signalk-mikrotik]
/ip dns static disable [find comment=signalk-mikrotik]
```

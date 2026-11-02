# Router setup

These steps prepare a MikroTik router for signalk-mikrotik. Run them in the
RouterOS terminal (WinBox → New Terminal, or SSH).

> **Status: draft, not yet run end to end on a router.** Commands marked
> *verify* may differ between RouterOS versions. Please report what worked on
> yours.

Before you start, take a backup:

```routeros
/export file=before-signalk-mikrotik
/system backup save name=before-signalk-mikrotik
```

## 1. RouterOS v7 and the REST API

The plugin uses the REST API, which exists only in RouterOS v7.

```routeros
/system resource print
```

Turn on HTTPS for the REST API, using a self-signed certificate:

```routeros
/certificate add name=signalk-rest common-name=router days-valid=3650
/certificate sign signalk-rest
/ip service set www-ssl certificate=signalk-rest disabled=no
```

Limit the service to your LAN. Replace the subnet with yours:

```routeros
/ip service set www-ssl address=192.168.88.0/24
```

In the plugin config, keep **Accept self-signed router certificate** on.

## 2. A dedicated user for the plugin

Don't give the plugin your admin account. Create a group with only the
permissions it needs (*verify*: the `rest-api` policy name), and a user that
can only log in from your Signal K server:

```routeros
/user group add name=signalk policy=read,write,rest-api
/user add name=signalk group=signalk password=<long-random-password> address=<signalk-server-ip>/32
```

Check that it works from the Signal K server:

```sh
curl -k -u signalk:<password> https://<router-ip>/rest/system/resource
```

## 3. The WAN interface list

The plugin blocks traffic that leaves through a WAN interface list. The
default config already has a list called `WAN`. Make sure your metered uplink
is a member of it:

```routeros
/interface list member print where list=WAN
```

For **Starlink**, use bypass mode so the dish connects straight to the
MikroTik, and add that port to the list:

```routeros
/interface list member add list=WAN interface=ether1
```

If your list has a different name, set it in the plugin config.

## 4. The router as DNS server

The allowlist is made of domain names that the router resolves itself. This
only works reliably when your devices ask the router for DNS too, and so does
the traffic monitor.

```routeros
/ip dns set allow-remote-requests=yes
/ip dhcp-server network print
/ip dhcp-server network set [find] dns-server=<router-lan-ip>
```

Devices pick up the new DNS server when they renew their lease. To force it,
reconnect them. Containers using host networking need a restart.

The plugin's **Redirect LAN DNS to the router** option also redirects
hard-coded resolvers while metered. That needs `allow-remote-requests=yes`
too.

### Check EDNS before you switch

Depending on version and config, the RouterOS DNS forwarder may answer without
the EDNS `OPT` record. Some clients reject those replies, for example software
built on a newer c-ares ("Misformatted DNS reply"). Check from any machine on
the LAN:

```sh
dig @<router-ip> example.com
```

The answer should contain an `OPT PSEUDOSECTION`. If it doesn't, try a DoH
upstream (below) and check again before pointing your clients at the router.

### Optional: encrypted upstream (DoH)

```routeros
/tool fetch url=https://curl.se/ca/cacert.pem
/certificate import file-name=cacert.pem passphrase=""
/ip dns set use-doh-server=https://cloudflare-dns.com/dns-query verify-doh-cert=yes
```

## 5. Plugin config

In Signal K → Server → Plugin Config → **MikroTik metered firewall**:

| Setting | Value |
|---|---|
| Router REST URL | `https://<router-ip>` |
| Router user / password | from step 2 |
| WAN interface list | from step 3 |

On start the plugin checks the router and reports any problem in its status
line. You can run the check again any time:

```sh
curl -b <signalk-session-cookie> http://<signalk>/plugins/signalk-mikrotik/preflight
```

## Undo

`POST /plugins/signalk-mikrotik/remove` (admin) deletes everything the plugin
created. Everything it creates carries the comment `signalk-mikrotik`, so you
can also check by hand:

```routeros
/ip firewall filter print where comment=signalk-mikrotik
/ip firewall nat print where comment=signalk-mikrotik
/ip firewall address-list print where comment=signalk-mikrotik
/ipv6 firewall filter print where comment=signalk-mikrotik
```

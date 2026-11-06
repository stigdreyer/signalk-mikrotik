# Router setup

These steps prepare a MikroTik router for signalk-mikrotik. Run them in the
RouterOS terminal (WinBox → New Terminal, or SSH).

**Shortcut:** the app's **Setup** page writes one script for sections 1, 2, the
DNS options in 4, and 5, filled in with your Signal K server's address and a new
password, and safe to run again. This page explains each step, and the parts the
script leaves to you: the WAN interface list (3), the DNS upstream servers and
DHCP (4).

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
permissions it needs (`rest-api` alone is not enough: without `api`,
RouterOS 7.25 answers REST calls with "not allowed (9)"), and a user that can only log in from your Signal K
server. Give the server a static DHCP lease first, so the restriction keeps
working:

```routeros
/ip dhcp-server lease make-static [find address=<signalk-server-ip>]
/user group add name=signalk policy=read,write,api,rest-api
/user add name=signalk group=signalk password=<long-random-password> address=<signalk-server-ip>/32
```

Recent RouterOS versions print a deprecation warning for the user's `address`
setting. The user is still created and the restriction applies.

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

## 4. Router DNS

While metered, the plugin redirects all DNS from the LAN to the router. For
each allowed domain it adds a DNS `FWD` entry that puts every IP the router
hands out into the allowlist. So the router's DNS has to work for all your
devices:

```routeros
/ip dns set allow-remote-requests=yes
/ip dns print
```

**Upstream servers.** Set fixed IPv4 servers. On the pilot (RouterOS 7.25,
Starlink), the dynamic IPv6 upstream returned SERVFAIL for large answers:

```routeros
/ip dns set servers=1.1.1.1,1.0.0.1
/ip dns cache flush
```

**Address list lifetime.** An IP added by a `FWD` entry stays on the list for
its DNS lifetime plus `address-list-extra-time`. CDNs use lifetimes of a minute
or less, and the plugin's rules sit above "accept established", so with the
default `0s` a running download or call drops once its IP expires:

```routeros
/ip dns set address-list-extra-time=1d
```

**DHCP.** In normal mode your devices can keep any DNS server. Handing out a
public resolver first keeps strict clients happy (see below), and the redirect
takes over while metered:

```routeros
/ip dhcp-server network set [find] dns-server=1.1.1.1,<router-lan-ip>
```

Devices pick up DHCP changes when they renew their lease. Containers using host
networking need a restart.

**SRV answers.** RouterOS compresses the target name in SRV answers, which RFC
2782 forbids. Most resolvers accept it, but strict ones (c-ares 1.34.8, as used
by Music Assistant's radio search) reject the reply as misformatted. While
metered, such lookups fail. To check from a Mac or Linux machine:

```sh
dig @<router-ip> SRV _api._tcp.radio-browser.info
```

### Optional: encrypted upstream (DoH)

```routeros
/tool fetch url=https://curl.se/ca/cacert.pem
/certificate import file-name=cacert.pem passphrase=""
/ip dns set use-doh-server=https://cloudflare-dns.com/dns-query verify-doh-cert=yes
```

The `FWD` entries still forward to the first plain server in `servers`.

## 5. Optional: Traffic Flow for data volume per service

The Allowlist page can show how much data each service used. For that the
router exports its connections (NetFlow v9 or IPFIX) to the plugin, and the
plugin matches each remote address to the name a device looked up. Replace
the address with your Signal K server's:

```routeros
/ip traffic-flow set enabled=yes interfaces=all active-flow-timeout=1m inactive-flow-timeout=15s
/ip traffic-flow target add dst-address=<signalk-server-ip> port=2055 version=ipfix
```

The port must match **Traffic Flow port** in the plugin config (default
2055; 0 turns it off). The plugin's preflight warns when no target points at
it.

Check after a day that the volumes add up: the sum on the Allowlist page
should be close to the day's total on the Usage page. Traffic to addresses no
DNS lookup explains (hard-coded IPs, DNS over HTTPS) is shown as one extra
line.

To turn it off again:

```routeros
/ip traffic-flow set enabled=no
/ip traffic-flow target remove [find port=2055]
```

## 6. Plugin config

In Signal K → Server → Plugin Config → **MikroTik Data Meter**:

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
/ip dns static print where comment=signalk-mikrotik
/ipv6 firewall filter print where comment=signalk-mikrotik
```

Removal leaves the IPs that `FWD` entries added on the `skm-metered` list. No
rule uses them any more, and they expire on their own.

If you keep rules above the plugin's (for example an exemption for one
device), a normal restart keeps them there. After a full removal the plugin
installs at the top of the forward chain again. Put your rule back in front
of it with `place-before` (`move` refused with "cannot move builtin" on
RouterOS 7.25):

```routeros
/ip firewall filter remove [find comment="my exemption"]
/ip firewall filter add chain=forward action=accept src-address=<ip> comment="my exemption" place-before=[find comment=signalk-mikrotik and action=accept]
```

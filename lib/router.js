/**
 * Everything the plugin does on the router. Objects it creates carry
 * TAG as their comment; nothing else on the router is ever changed.
 */

const { isIP } = require("node:net");

const TAG = "signalk-mikrotik";
const LIST = "skm-metered";

const FILTER = "ip/firewall/filter";
const NAT = "ip/firewall/nat";
const ADDRESSES = "ip/firewall/address-list";
const FILTER6 = "ipv6/firewall/filter";
const DNS_STATIC = "ip/dns/static";

const isTrue = (v) => v === true || v === "true";
const tagged = (client, path) => client.get(path, { comment: TAG });
const isAddress = (host) => isIP(host.split("/")[0]) !== 0;
const togglable = (ipv6) => [FILTER, NAT, DNS_STATIC, ...(ipv6 ? [FILTER6] : [])];

/**
 * Check the router can host the plugin. Throws on connection/auth errors;
 * returns problems that block install as `errors`, advice as `warnings`.
 */
async function preflight(client, cfg) {
  const errors = [];
  const warnings = [];

  const { version } = await client.get("system/resource");
  if (parseInt(version, 10) < 7) errors.push(`RouterOS ${version} has no REST API; v7 is required`);

  const lists = await client.get("interface/list", { name: cfg.wanList });
  if (!lists.length) {
    errors.push(`Interface list "${cfg.wanList}" not found`);
  } else if (!(await client.get("interface/list/member", { list: cfg.wanList })).length) {
    errors.push(`Interface list "${cfg.wanList}" has no members, so nothing would be blocked`);
  }

  const dns = await client.get("ip/dns");
  if (cfg.redirectDns && !isTrue(dns["allow-remote-requests"])) {
    errors.push("DNS redirect needs /ip dns allow-remote-requests=yes");
  }

  // FWD entries need an explicit upstream; use the router's own.
  // shortcut: read once per start, so a changed upstream needs a plugin restart.
  const upstream = (dns.servers || dns["dynamic-servers"] || "").split(",").filter(Boolean)[0] || null;
  if (!upstream) warnings.push("Router has no upstream DNS server, so allowed domains only match by name, not subdomain");
  if (/^[0:s]*$/.test(dns["address-list-extra-time"] || "")) {
    warnings.push("/ip dns address-list-extra-time is 0s: allowed connections drop when a short DNS lifetime runs out; set it to e.g. 1d");
  }

  // Without the redirect, only clients that ask the router get their answers into the allowlist.
  if (!cfg.redirectDns) {
    const own = (await client.get("ip/address")).map((a) => a.address.split("/")[0]);
    for (const net of await client.get("ip/dhcp-server/network")) {
      const first = (net["dns-server"] || "").split(",").filter(Boolean)[0];
      if (first && !own.includes(first)) {
        warnings.push(`DHCP network ${net.address} hands out ${first} as DNS; allowlisting works best when clients use the router`);
      }
    }
  }

  // No ipv6 package, or IPv6 switched off: nothing to block there.
  const ipv6 = await client.get("ipv6/settings").then(
    (s) => !isTrue(s["disable-ipv6"]),
    () => false,
  );

  return { version, ipv6, upstream, errors, warnings };
}

/** The profile currently active on the router, or null when not installed. */
async function currentProfile(client) {
  const drop = (await tagged(client, FILTER)).find((r) => r.action === "drop");
  if (!drop) return null;
  return isTrue(drop.disabled) ? "normal" : "metered";
}

/** Rules in the order they must appear, each enabled only while metered. */
function rules(cfg) {
  const filter = [{ chain: "forward", action: "accept", "dst-address-list": LIST }];
  const nat = [];
  for (const protocol of ["udp", "tcp"]) {
    if (cfg.redirectDns) {
      nat.push({ chain: "dstnat", action: "redirect", protocol, "dst-port": "53", "to-ports": "53", "in-interface-list": `!${cfg.wanList}` });
    } else {
      filter.push({ chain: "forward", action: "accept", protocol, "dst-port": "53" });
    }
  }
  // Replies of port-forwarded (dstnat) connections still go out to WAN.
  const drop = { chain: "forward", action: "drop", "out-interface-list": cfg.wanList, "connection-nat-state": "!dstnat" };
  filter.push(drop);
  return { filter, nat, filter6: [{ ...drop, "connection-nat-state": undefined }] };
}

/**
 * The user rule our block goes in front of: the one right after our existing
 * rules, so rules a user placed above them stay above on reinstall. On first
 * install that's the chain's first rule.
 */
async function anchor(client, path, chain) {
  const rows = await client.get(path, { chain });
  const last = rows.findLastIndex((r) => r.comment === TAG);
  return rows.slice(last + 1).find((r) => r.comment !== TAG)?.[".id"];
}

/** Add rows, in order, in front of `before` (or at the end of the chain). */
async function addBefore(client, path, rows, disabled, before) {
  for (const row of rows) {
    const props = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
    await client.add(path, { ...props, comment: TAG, disabled, ...(before && { "place-before": before }) });
  }
}

async function remove(client, ipv6) {
  for (const path of togglable(ipv6)) {
    for (const row of await tagged(client, path)) await client.remove(path, row[".id"]);
  }
  // Resolved IPs show up as dynamic entries; RouterOS manages those itself.
  for (const row of await tagged(client, ADDRESSES)) {
    if (!isTrue(row.dynamic)) await client.remove(ADDRESSES, row[".id"]);
  }
}

/**
 * (Re)create every plugin object from scratch in the given profile.
 * shortcut: removes then re-adds, so the router is open for the few requests
 * in between; switch to diffing if that window ever matters at sea.
 */
async function install(client, cfg, hosts, profile, ipv6, upstream) {
  const { filter, nat, filter6 } = rules(cfg);
  const blocks = [[FILTER, filter], [NAT, nat], ...(ipv6 ? [[FILTER6, filter6]] : [])].filter(([, rows]) => rows.length);
  // Read before removal, so the new rules land where the old ones were.
  for (const block of blocks) block.push(await anchor(client, block[0], block[1][0].chain));
  await remove(client, ipv6);
  for (const address of hosts) await client.add(ADDRESSES, { list: LIST, address, comment: TAG });
  const disabled = profile === "metered" ? "no" : "yes";
  for (const [path, rows, before] of blocks) await addBefore(client, path, rows, disabled, before);
  // Every IP the router hands out for an allowed domain or its subdomains joins the list,
  // so clients and the firewall agree on CDN addresses.
  if (upstream) {
    for (const name of hosts.filter((h) => !isAddress(h))) {
      await client.add(DNS_STATIC, {
        type: "FWD", name, "match-subdomain": "yes", "forward-to": upstream, "address-list": LIST, comment: TAG, disabled,
      });
    }
  }
}

/** Enable (metered) or disable (normal) the plugin rules and DNS entries; metered also flushes connections. */
async function setProfile(client, profile, ipv6) {
  const disabled = profile === "metered" ? "no" : "yes";
  for (const path of togglable(ipv6)) {
    for (const row of await tagged(client, path)) await client.set(path, row[".id"], { disabled });
  }
  if (profile === "metered") {
    // Established and fasttracked connections bypass the new rules until dropped.
    // shortcut: one bulk remove by id list; unverified on real routers (PLAN open question 1).
    const ids = (await client.get("ip/firewall/connection", { ".proplist": ".id" })).map((c) => c[".id"]);
    if (ids.length) await client.command("ip/firewall/connection", "remove", { ".id": ids.join(",") });
  }
}

module.exports = { TAG, LIST, preflight, currentProfile, install, setProfile, remove };

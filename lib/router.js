/**
 * Everything the plugin does on the router. Objects it creates carry
 * TAG as their comment; nothing else on the router is ever changed.
 */

const TAG = "signalk-mikrotik";
const LIST = "skm-metered";

const FILTER = "ip/firewall/filter";
const NAT = "ip/firewall/nat";
const ADDRESSES = "ip/firewall/address-list";
const FILTER6 = "ipv6/firewall/filter";

const isTrue = (v) => v === true || v === "true";
const tagged = (client, path) => client.get(path, { comment: TAG });

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

  const own = (await client.get("ip/address")).map((a) => a.address.split("/")[0]);
  for (const net of await client.get("ip/dhcp-server/network")) {
    const first = (net["dns-server"] || "").split(",").filter(Boolean)[0];
    if (first && !own.includes(first)) {
      warnings.push(`DHCP network ${net.address} hands out ${first} as DNS; allowlisting works best when clients use the router`);
    }
  }

  // No ipv6 package, or IPv6 switched off: nothing to block there.
  const ipv6 = await client.get("ipv6/settings").then(
    (s) => !isTrue(s["disable-ipv6"]),
    () => false,
  );

  return { version, ipv6, errors, warnings };
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

/** Add rows above the user's first rule of their chain, keeping their order. */
async function addOnTop(client, path, rows, disabled) {
  for (const row of rows) {
    const first = (await client.get(path, { chain: row.chain })).find((r) => r.comment !== TAG);
    const props = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
    await client.add(path, { ...props, comment: TAG, disabled, ...(first && { "place-before": first[".id"] }) });
  }
}

async function remove(client, ipv6) {
  for (const path of [FILTER, NAT, ...(ipv6 ? [FILTER6] : [])]) {
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
async function install(client, cfg, hosts, profile, ipv6) {
  await remove(client, ipv6);
  for (const address of hosts) await client.add(ADDRESSES, { list: LIST, address, comment: TAG });
  const disabled = profile === "metered" ? "no" : "yes";
  const { filter, nat, filter6 } = rules(cfg);
  await addOnTop(client, FILTER, filter, disabled);
  await addOnTop(client, NAT, nat, disabled);
  if (ipv6) await addOnTop(client, FILTER6, filter6, disabled);
}

/** Enable (metered) or disable (normal) the plugin rules; metered also flushes connections. */
async function setProfile(client, profile, ipv6) {
  const disabled = profile === "metered" ? "no" : "yes";
  for (const path of [FILTER, NAT, ...(ipv6 ? [FILTER6] : [])]) {
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

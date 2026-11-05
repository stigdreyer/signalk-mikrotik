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
const DNS_STATIC = "ip/dns/static";

const isTrue = (v) => v === true || v === "true";
const tagged = (client, path) => client.get(path, { comment: TAG });
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
  if (!upstream) warnings.push("Router has no upstream DNS server, so allowed domains only match by name, not subdomain. Fix: /ip dns set servers=1.1.1.1");
  if (/^[0:s]*$/.test(dns["address-list-extra-time"] || "")) {
    warnings.push("/ip dns address-list-extra-time is 0s: allowed connections drop when a short DNS lifetime runs out; set it to e.g. 1d");
  }

  // The Allowlist page learns from the router's DNS cache, so in normal mode it only sees clients that ask the router.
  const own = (await client.get("ip/address")).map((a) => a.address.split("/")[0]);
  for (const net of await client.get("ip/dhcp-server/network")) {
    const first = (net["dns-server"] || "").split(",").filter(Boolean)[0];
    if (first && !own.includes(first)) {
      warnings.push(`DHCP network ${net.address} hands out ${first} as DNS first, so in normal mode the Allowlist page only sees devices that ask the router. ` +
        `Fix: /ip dhcp-server network set [find address=${net.address}] dns-server=${net.gateway || "<router IP>"}`);
    }
  }

  // Volume per service needs the router to export its connections to us.
  if (cfg.flowPort > 0) {
    const tf = await client.get("ip/traffic-flow").catch(() => null);
    const targets = tf ? await client.get("ip/traffic-flow/target").catch(() => []) : [];
    if (!tf || !isTrue(tf.enabled) || !targets.some((t) => Number(t.port) === cfg.flowPort && !isTrue(t.disabled))) {
      warnings.push(`Traffic Flow isn't exporting to port ${cfg.flowPort}, so the Allowlist page shows no data volume. ` +
        `Fix: /ip traffic-flow set enabled=yes, and /ip traffic-flow target add dst-address=<Signal K server IP> port=${cfg.flowPort} version=ipfix (docs/router-setup.md, section 5)`);
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
 * (Re)create every plugin object from scratch in the given profile. Returns what syncHosts returns.
 * shortcut: removes then re-adds, so the router is open for the few requests
 * in between; switch to diffing if that window ever matters at sea.
 */
async function install(client, cfg, targets, profile, ipv6, upstream) {
  const { filter, nat, filter6 } = rules(cfg);
  const blocks = [[FILTER, filter], [NAT, nat], ...(ipv6 ? [[FILTER6, filter6]] : [])].filter(([, rows]) => rows.length);
  // Read before removal, so the new rules land where the old ones were.
  for (const block of blocks) block.push(await anchor(client, block[0], block[1][0].chain));
  await remove(client, ipv6);
  const disabled = profile === "metered" ? "no" : "yes";
  for (const [path, rows, before] of blocks) await addBefore(client, path, rows, disabled, before);
  return syncHosts(client, targets, profile, upstream);
}

/**
 * Make the tagged address-list and DNS FWD entries match `targets`, adding
 * and removing only the difference, so the firewall rules stay untouched.
 * targets: { addresses: [hostname or IP/range], forward: Map(name -> matchSubdomain) }.
 * Returns { warnings, added, removed, ms }.
 */
async function syncHosts(client, { addresses, forward }, profile, upstream) {
  const started = Date.now();
  const want = new Set(addresses);
  const lists = (await tagged(client, ADDRESSES)).filter((r) => !isTrue(r.dynamic));
  const listed = new Set(lists.map((r) => r.address));
  const staleLists = lists.filter((r) => !want.has(r.address));
  const newLists = [...want].filter((a) => !listed.has(a));
  await inParallel(staleLists, (row) => client.remove(ADDRESSES, row[".id"]));
  await inParallel(newLists, (address) => client.add(ADDRESSES, { list: LIST, address, comment: TAG }));

  // Every IP the router hands out for an allowed name (and its subdomains, if so marked) joins the
  // list, so clients and the firewall agree on CDN addresses.
  const fwd = upstream ? forward : new Map();
  const key = (name, sub) => `${name}/${sub ? "sub" : "exact"}`;
  const existing = await tagged(client, DNS_STATIC);
  const wantKeys = new Set([...fwd].map(([name, sub]) => key(name, sub)));
  const staleFwd = existing.filter((row) => !wantKeys.has(key(row.name, isTrue(row["match-subdomain"]))));
  await inParallel(staleFwd, (row) => client.remove(DNS_STATIC, row[".id"]));
  const have = new Set(existing.map((r) => key(r.name, isTrue(r["match-subdomain"]))));
  const disabled = profile === "metered" ? "no" : "yes";
  const add = ([name, sub]) => client.add(DNS_STATIC, {
    type: "FWD", name, "match-subdomain": sub ? "yes" : "no", "forward-to": upstream, "address-list": LIST, comment: TAG, disabled,
  });
  const newFwd = [...fwd].filter(([name, sub]) => !have.has(key(name, sub)));
  const warnings = [];
  try {
    // One first, so a router without FWD address-lists fails once, not hundreds of times.
    if (newFwd.length) await add(newFwd[0]);
    await inParallel(newFwd.slice(1), add);
  } catch (err) {
    // Older RouterOS without FWD address-lists: hostname entries still work, minus subdomains.
    warnings.push(`No subdomain matching, allowing hostnames only: ${err.message}`);
  }
  return {
    warnings,
    added: newLists.length + newFwd.length,
    removed: staleLists.length + staleFwd.length,
    ms: Date.now() - started,
  };
}

/** Run `fn` over `items`, a few at a time: the REST client keeps 4 connections open. */
async function inParallel(items, fn, width = 4) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
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

module.exports = { TAG, LIST, preflight, currentProfile, install, syncHosts, setProfile, remove };

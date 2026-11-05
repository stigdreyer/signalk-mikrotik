const { createClient } = require("./lib/routeros");
const { join } = require("node:path");
const { isIP } = require("node:net");
const router = require("./lib/router");
const usage = require("./lib/usage");
const seen = require("./lib/seen");
const catalog = require("./lib/catalog");
const flows = require("./lib/flows");
const { readJson, writeJson } = require("./lib/store");

const PLUGIN_ID = "signalk-mikrotik";
const FQDN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// signalk-internet states we act on; offline, captive and null leave the router as it is.
const PROFILE_FOR = { metered: "metered", online: "normal" };
const SAMPLE_MS = 60_000;
const FLOW_WAIT_MS = 3 * 60_000; // how long a flow waits for its DNS answer to show up in the cache
const ADDRESS_KEEP_MS = 24 * 3_600_000; // connections outlive the DNS answer that started them
const MAX_PENDING = 20_000;

const schema = {
  type: "object",
  required: ["url", "username", "password"],
  properties: {
    url: { type: "string", title: "Router REST URL", default: "https://192.168.88.1" },
    username: { type: "string", title: "Router user", default: "signalk" },
    password: { type: "string", title: "Router password", default: "" },
    allowSelfSigned: { type: "boolean", title: "Accept self-signed router certificate", default: true },
    wanList: { type: "string", title: "WAN interface list", default: "WAN" },
    redirectDns: {
      type: "boolean",
      title: "Redirect LAN DNS to the router while metered",
      description:
        "Sends every DNS query to the router while metered, so the IPs devices get for allowed domains are the ones in the allowlist, and hard-coded DNS servers can't bypass it. Needs /ip dns allow-remote-requests=yes.",
      default: true,
    },
    starlink: {
      type: "boolean",
      title: "Starlink preset",
      description: "Always allow the dish and the Starlink app while metered. Without it, Ocean Mode can't be turned off from the app.",
      default: true,
    },
    starlinkSubnet: { type: "string", title: "Starlink dish subnet", default: "192.168.100.0/24" },
    pricePerGb: {
      type: "number",
      title: "Price per metered GB",
      description: "For the cost estimate on the usage dashboard. GB means 10^9 bytes, like Starlink's. 0 hides the estimate.",
      default: 0,
    },
    currency: { type: "string", title: "Currency", default: "USD" },
    flowPort: {
      type: "number",
      title: "Traffic Flow port",
      description: "UDP port for the router's Traffic Flow export (NetFlow v9 or IPFIX), for data volume per service. 0 turns it off. See docs/router-setup.md.",
      default: 2055,
    },
  },
};

const DEFAULTS = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, v.default]));

const fixedHosts = (cfg) => [...catalog.base.hosts, ...(cfg.starlink ? [...catalog.starlink.hosts, cfg.starlinkSubnet] : [])];
const isAddress = (host) => isIP(host.split("/")[0]) !== 0;

/**
 * Everything allowed while metered, as router targets. The fixed lists get
 * address-list entries (the router resolves those names itself) plus FWD
 * entries; picked v2fly services and domains get FWD entries only, since a
 * service can have hundreds of domains.
 */
function targetsFor(cfg, allow) {
  const fixed = fixedHosts(cfg);
  const forward = new Map(fixed.filter((h) => !isAddress(h)).map((h) => [h, true]));
  for (const id of allow.services) {
    const { domains, full } = catalog.hostsOf(id);
    for (const d of full) if (!forward.has(d)) forward.set(d, false);
    for (const d of domains) forward.set(d, true);
  }
  for (const d of allow.domains) forward.set(d, true);
  // An entry under a domain that already matches with subdomains adds nothing (mail.google.com under google.com).
  const covered = (name) => {
    const labels = name.split(".");
    for (let i = 1; i < labels.length - 1; i++) if (forward.get(labels.slice(i).join(".")) === true) return true;
    return false;
  };
  for (const name of [...forward.keys()]) if (covered(name)) forward.delete(name);
  return { addresses: fixed, forward };
}

/** Whether a looked-up name is allowed while metered. */
function allows(targets, name) {
  if (targets.addresses.some((h) => catalog.covers(h, name))) return true;
  const labels = name.split(".");
  if (targets.forward.has(name)) return true;
  for (let i = 1; i < labels.length - 1; i++) if (targets.forward.get(labels.slice(i).join(".")) === true) return true;
  return false;
}

module.exports = (app) => {
  let ctx = null; // { client, cfg, ipv6, upstream, profile, usage, seen, allow, addresses, pending, unmatched, reset } while running
  let unsubscribe = null;
  let timer = null;
  let stopFlows = null;
  let queue = Promise.resolve();

  // Serialise router work so quick state changes can't interleave on the router.
  const run = (fn) =>
    (queue = queue.then(fn).catch((err) => {
      app.setPluginError(err.message);
    }));

  function publish(profile) {
    ctx.profile = profile;
    app.handleMessage(PLUGIN_ID, { updates: [{ values: [{ path: "network.mikrotik.profile", value: profile }] }] });
    app.setPluginStatus(`Router profile: ${profile}`);
  }

  const dataFile = (name) => join(app.getDataDirPath(), name);
  const usageFile = () => dataFile("usage.json");

  /** Usage and seen names since the last sample. Never throws: a missed sample is caught up next time. */
  async function sample() {
    await sampleUsage();
    await sampleSeen();
  }

  async function sampleSeen() {
    try {
      const now = Date.now();
      const targets = targetsFor(ctx.cfg, ctx.allow);
      const blocked = (name) => ctx.profile === "metered" && !allows(targets, name);
      const cache = await seen.readCache(ctx.client);
      for (const [ip, name] of cache.addresses) ctx.addresses.set(ip, { name, t: now });
      for (const [ip, { t }] of ctx.addresses) if (now - t > ADDRESS_KEEP_MS) ctx.addresses.delete(ip);
      seen.prune(seen.record(ctx.seen, cache.names, now, blocked), now);
      settlePending(now);
      writeJson(dataFile("seen.json"), ctx.seen);
      writeJson(dataFile("unmatched.json"), ctx.unmatched);
      writeJson(dataFile("reset.json"), ctx.reset);
    } catch (err) {
      app.debug(`DNS sample failed: ${err.message}`);
    }
  }

  /** Book a flow's bytes to the name its remote address was resolved for, or park it until the DNS cache knows. */
  function onFlows(records) {
    if (!ctx) return;
    const now = Date.now();
    for (const record of records) {
      const remote = flows.remoteOf(record);
      if (!remote) continue; // stays on board
      const ip = flows.canonical(remote);
      const name = ctx.addresses.get(ip)?.name;
      if (name) seen.addBytes(ctx.seen, name, record.bytes, ctx.profile, now, ctx.reset.at);
      else if (ctx.pending.length < MAX_PENDING) ctx.pending.push({ ip, bytes: record.bytes, profile: ctx.profile, t: now });
      else unmatched(record.bytes, ctx.profile, now);
    }
  }

  function settlePending(now) {
    ctx.pending = ctx.pending.filter((f) => {
      const name = ctx.addresses.get(f.ip)?.name;
      if (name) seen.addBytes(ctx.seen, name, f.bytes, f.profile, f.t, ctx.reset.at);
      else if (now - f.t > FLOW_WAIT_MS) unmatched(f.bytes, f.profile, f.t);
      else return true;
      return false;
    });
    const oldest = usage.dayOf(now - (seen.KEEP_DAYS - 1) * 86_400_000);
    for (const day of Object.keys(ctx.unmatched)) if (day < oldest) delete ctx.unmatched[day];
  }

  /** Bytes to addresses no DNS answer explains (hard-coded IPs, DNS over HTTPS, answers older than a day). */
  function unmatched(bytes, profile, t) {
    const col = profile === "metered" ? 1 : 0;
    (ctx.unmatched[usage.dayOf(t)] ??= [0, 0])[col] += bytes;
    if (t >= ctx.reset.at) ctx.reset.unmatched[col] += bytes;
  }

  async function sampleUsage() {
    try {
      const readings = await usage.readCounters(ctx.client, ctx.cfg.wanList);
      usage.record(ctx.usage, readings, ctx.profile, Date.now());
      usage.save(usageFile(), ctx.usage);
      const today = ctx.usage.days[usage.dayOf(Date.now())];
      const total = usage.totals(ctx.usage);
      app.handleMessage(PLUGIN_ID, {
        updates: [{
          values: [
            { path: "network.mikrotik.usage.today.normal", value: today.normal.rx + today.normal.tx },
            { path: "network.mikrotik.usage.today.metered", value: today.metered.rx + today.metered.tx },
            { path: "network.mikrotik.usage.wan.received", value: total.rx },
            { path: "network.mikrotik.usage.wan.sent", value: total.tx },
          ],
        }],
      });
    } catch (err) {
      app.debug(`usage sample failed: ${err.message}`);
    }
  }

  function onState(state) {
    const profile = PROFILE_FOR[state];
    if (!profile) return;
    return run(async () => {
      if (!ctx || ctx.profile === profile) return;
      await sample(); // close the books on the old profile first
      await router.setProfile(ctx.client, profile, ctx.ipv6);
      publish(profile);
    });
  }

  /** A v2fly list as the webapp shows it. */
  function serviceView(id, hits = []) {
    const allowedVia = ctx.allow.services.find((a) => a !== id && catalog.withIncludes(a).has(id)) ?? null;
    const { domains, full } = catalog.hostsOf(id);
    const cats = catalog.categoriesOf[id] ?? [];
    return {
      id,
      categories: cats,
      parents: catalog.parents[id] ?? [],
      includes: catalog.lists[id].include ?? [],
      size: domains.length + full.length,
      allowed: ctx.allow.services.includes(id),
      allowedVia,
      ads: cats.includes("category-ads-all") || (hits.length > 0 && hits.every(([n]) => catalog.isAd(n))),
      seen: hits.length ? seen.merge(hits.map(([, e]) => e)) : null,
      names: hits.map(([n]) => n).sort().slice(0, 50),
    };
  }

  /** Seen names grouped by v2fly service (or by domain), with what is allowed and when each was seen or blocked. */
  function allowlistView() {
    const fixed = fixedHosts(ctx.cfg);
    const byList = {};
    const byDomain = {};
    for (const entry of Object.entries(ctx.seen)) {
      const [name] = entry;
      if (fixed.some((h) => catalog.covers(h, name))) continue;
      const id = catalog.listOf(name);
      if (id) (byList[id] ??= []).push(entry);
      else (byDomain[catalog.domainOf(name)] ??= []).push(entry);
    }
    for (const id of ctx.allow.services) byList[id] ??= [];
    for (const d of ctx.allow.domains) byDomain[d] ??= [];
    return {
      profile: ctx.profile,
      keepDays: seen.KEEP_DAYS,
      v2fly: catalog.commit,
      fixed: [catalog.base, ...(ctx.cfg.starlink ? [{ ...catalog.starlink, hosts: [...catalog.starlink.hosts, ctx.cfg.starlinkSubnet] }] : [])],
      flows: ctx.cfg.flowPort > 0,
      unmatched: Object.values(ctx.unmatched).reduce((a, [n, m]) => [a[0] + n, a[1] + m], [0, 0]),
      reset: ctx.reset,
      services: Object.entries(byList).map(([id, hits]) => serviceView(id, hits)),
      domains: Object.entries(byDomain).map(([domain, hits]) => ({
        domain,
        category: catalog.categoryOfName(domain),
        allowed: ctx.allow.domains.includes(domain),
        ads: hits.length > 0 && hits.every(([n]) => catalog.isAd(n)),
        seen: hits.length ? seen.merge(hits.map(([, e]) => e)) : null,
        names: hits.map(([n]) => n).sort().slice(0, 50),
      })),
    };
  }

  const plugin = {
    id: PLUGIN_ID,
    name: "MikroTik metered firewall",
    description: "Locks a MikroTik router down to an allowlist while signalk-internet reports a metered connection.",
    schema,

    start(options) {
      const cfg = { ...DEFAULTS, ...options };
      const client = createClient(cfg);
      return run(async () => {
        const check = await router.preflight(client, cfg);
        for (const w of check.warnings) app.debug(w);
        if (check.errors.length) throw new Error(check.errors.join("; "));
        // Keep whatever profile the router has until signalk-internet says otherwise.
        const profile = (await router.currentProfile(client)) || "normal";
        const allow = readJson(dataFile("allowlist.json"), { services: [], domains: [] });
        const { warnings } = await router.install(client, cfg, targetsFor(cfg, allow), profile, check.ipv6, check.upstream);
        for (const w of warnings) app.debug(w);
        ctx = {
          client, cfg, allow, ipv6: check.ipv6, upstream: check.upstream,
          usage: usage.load(usageFile()), seen: readJson(dataFile("seen.json"), {}),
          addresses: new Map(), pending: [], unmatched: readJson(dataFile("unmatched.json"), {}),
          reset: readJson(dataFile("reset.json"), { at: 0, unmatched: [0, 0] }), // at 0: never reset
        };
        if (cfg.flowPort > 0) stopFlows = flows.listen(cfg.flowPort, onFlows, (err) => app.debug(`Traffic Flow: ${err.message}`));
        publish(profile);
        await sample();
        timer = setInterval(() => run(sample), SAMPLE_MS);
        timer.unref?.();
        unsubscribe = app.streambundle.getSelfStream("network.internet.state").onValue(onState);
      }).then(() => ctx && onState(app.getSelfPath("network.internet.state")?.value)); // outside run(): queueing from inside it would deadlock
    },

    stop() {
      unsubscribe?.();
      unsubscribe = null;
      clearInterval(timer);
      timer = null;
      stopFlows?.();
      stopFlows = null;
      ctx?.client.close();
      ctx = null; // router keeps its current profile: fail safe
    },

    registerWithRouter(r) {
      r.get("/preflight", (req, res) => {
        if (!ctx) return res.status(503).json({ error: "plugin not running" });
        router.preflight(ctx.client, ctx.cfg).then(
          (check) => res.json(check),
          (err) => res.status(502).json({ error: err.message }),
        );
      });
      r.get("/usage", (req, res) => {
        if (!ctx) return res.status(503).json({ error: "plugin not running" });
        const { from = "", to = "9999" } = req.query;
        const pick = (buckets) => Object.fromEntries(Object.entries(buckets).filter(([k]) => k.slice(0, 10) >= from && k.slice(0, 10) <= to));
        res.json({ profile: ctx.profile, pricePerGb: ctx.cfg.pricePerGb, currency: ctx.cfg.currency, days: pick(ctx.usage.days), hours: pick(ctx.usage.hours) });
      });
      // Search the whole v2fly catalog, for services nobody on board has used yet.
      r.get("/catalog", (req, res) => {
        if (!ctx) return res.status(503).json({ error: "plugin not running" });
        const q = String(req.query.q ?? "").toLowerCase().trim();
        if (q.length < 2) return res.json({ services: [] });
        const ids = Object.keys(catalog.lists).filter((id) => id.includes(q) || catalog.lists[id].domains.some((d) => d.startsWith(q)));
        // Name matches first; among those, bigger lists first: they are the better-known services.
        const size = (id) => catalog.lists[id].domains.length + catalog.lists[id].full.length;
        ids.sort((a, b) => (a.startsWith(q) ? 0 : 1) - (b.startsWith(q) ? 0 : 1) || size(b) - size(a));
        res.json({ services: ids.slice(0, 30).map((id) => serviceView(id)) });
      });
      r.get("/allowlist", (req, res) => {
        if (!ctx) return res.status(503).json({ error: "plugin not running" });
        res.json(allowlistView());
      });
      r.post("/allowlist", (req, res) => {
        if (!ctx) return res.status(503).json({ error: "plugin not running" });
        const { services, domains } = req.body ?? {};
        const bad = [
          ...(Array.isArray(services) ? services.filter((id) => !catalog.lists[id]) : ["services must be a list"]),
          ...(Array.isArray(domains) ? domains.filter((d) => !FQDN.test(d)) : ["domains must be a list"]),
        ];
        if (bad.length) return res.status(400).json({ error: `invalid: ${bad.join(", ")}` });
        run(async () => {
          ctx.allow = { services: [...new Set(services)], domains: [...new Set(domains)] };
          writeJson(dataFile("allowlist.json"), ctx.allow);
          const sync = await router.syncHosts(ctx.client, targetsFor(ctx.cfg, ctx.allow), ctx.profile, ctx.upstream);
          for (const w of sync.warnings) app.debug(w);
          app.debug(`allowlist sync: ${sync.added} added, ${sync.removed} removed in ${sync.ms} ms`);
          // While metered, names the router has cached skip the new FWD entries: make devices ask again.
          if (ctx.profile === "metered") await ctx.client.command("ip/dns/cache", "flush", {});
          res.json({ ...allowlistView(), sync });
        }).then(() => res.headersSent || res.status(502).json({ error: "saving failed, see plugin status" }));
      });
      r.post("/reset", (req, res) => {
        if (!ctx) return res.status(503).json({ error: "plugin not running" });
        run(() => {
          seen.resetSince(ctx.seen);
          ctx.reset = { at: Date.now(), unmatched: [0, 0] };
          writeJson(dataFile("seen.json"), ctx.seen);
          writeJson(dataFile("reset.json"), ctx.reset);
          res.json(allowlistView());
        });
      });
      r.post("/remove", (req, res) => {
        run(async () => {
          if (!ctx) return res.status(503).json({ error: "plugin not running" });
          await router.remove(ctx.client, ctx.ipv6);
          plugin.stop();
          app.setPluginStatus("Removed from router; restart the plugin to reinstall");
          res.json({ removed: true });
        }).then(() => res.headersSent || res.status(502).json({ error: "remove failed, see plugin status" }));
      });
    },
  };

  return plugin;
};

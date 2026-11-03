const { createClient } = require("./lib/routeros");
const { join } = require("node:path");
const router = require("./lib/router");
const usage = require("./lib/usage");
const base = require("./profiles/base.json");
const starlink = require("./profiles/starlink.json");

const PLUGIN_ID = "signalk-mikrotik";

// signalk-internet states we act on; offline, captive and null leave the router as it is.
const PROFILE_FOR = { metered: "metered", online: "normal" };
const SAMPLE_MS = 60_000;

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
  },
};

const DEFAULTS = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, v.default]));

function hostsFor(cfg) {
  return [...base.hosts, ...(cfg.starlink ? [...starlink.hosts, cfg.starlinkSubnet] : [])];
}

module.exports = (app) => {
  let ctx = null; // { client, cfg, ipv6, profile, usage } while running
  let unsubscribe = null;
  let timer = null;
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

  const usageFile = () => join(app.getDataDirPath(), "usage.json");

  /** Book WAN bytes since the last sample to the current profile. Never throws: a missed sample is caught up next time. */
  async function sample() {
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
        await router.install(client, cfg, hostsFor(cfg), profile, check.ipv6, check.upstream);
        ctx = { client, cfg, ipv6: check.ipv6, usage: usage.load(usageFile()) };
        publish(profile);
        await sample();
        timer = setInterval(() => run(sample), SAMPLE_MS);
        unsubscribe = app.streambundle.getSelfStream("network.internet.state").onValue(onState);
      }).then(() => ctx && onState(app.getSelfPath("network.internet.state")?.value)); // outside run(): queueing from inside it would deadlock
    },

    stop() {
      unsubscribe?.();
      unsubscribe = null;
      clearInterval(timer);
      timer = null;
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
        const days = Object.fromEntries(Object.entries(ctx.usage.days).filter(([d]) => d >= from && d <= to));
        res.json({ profile: ctx.profile, pricePerGb: ctx.cfg.pricePerGb, currency: ctx.cfg.currency, days });
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

const { test } = require("node:test");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const assert = require("node:assert/strict");
const { fakeRouter, defconf } = require("./fake-routeros");
const createPlugin = require("..");

/** Just enough of the Signal K server API for the plugin. */
function fakeApp(initialState) {
  const listeners = [];
  const app = {
    status: null,
    error: null,
    deltas: [],
    setPluginStatus: (s) => (app.status = s),
    setPluginError: (e) => (app.error = e),
    debug: () => {},
    values: {},
    dataDir: mkdtempSync(join(tmpdir(), "skm-")),
    getDataDirPath: () => app.dataDir,
    handleMessage: (id, delta) => {
      for (const { path, value } of delta.updates[0].values) {
        app.values[path] = value;
        if (path === "network.mikrotik.profile") app.deltas.push(value);
      }
    },
    getSelfPath: (path) => (path === "network.internet.state" && initialState !== undefined ? { value: initialState } : undefined),
    streambundle: {
      getSelfStream: () => ({
        onValue: (fn) => {
          listeners.push(fn);
          return () => listeners.splice(listeners.indexOf(fn), 1);
        },
      }),
    },
    // Resolves once the plugin has finished reacting to the new state.
    emit: (state) => Promise.all(listeners.map((fn) => fn(state))),
    listeners,
  };
  return app;
}

const dropRule = (fake) =>
  fake.tables["ip/firewall/filter"].find((r) => r.comment === "signalk-mikrotik" && r.action === "drop");

async function start(t, app, seed = defconf()) {
  const fake = await fakeRouter(seed);
  t.after(() => fake.close());
  const plugin = createPlugin(app);
  await plugin.start({ url: fake.url, username: "u", password: "p" });
  return { fake, plugin };
}

test("follows signalk-internet: metered locks, online unlocks, offline/captive change nothing", async (t) => {
  const app = fakeApp();
  const { fake, plugin } = await start(t, app);
  assert.equal(app.error, null);
  assert.equal(dropRule(fake).disabled, "true");

  await app.emit("metered");
  assert.equal(dropRule(fake).disabled, "false");
  assert.equal(app.status, "Router profile: metered");

  for (const state of ["offline", "captive", null]) {
    await app.emit(state);
    assert.equal(dropRule(fake).disabled, "false", `${state} must not unlock`);
  }

  await app.emit("online");
  assert.equal(dropRule(fake).disabled, "true");
  assert.deepEqual(app.deltas, ["normal", "metered", "normal"]);

  plugin.stop();
  assert.equal(app.listeners.length, 0);
});

test("a repeated metered state does not flush connections again", async (t) => {
  const app = fakeApp();
  const { fake, plugin } = await start(t, app);
  await app.emit("metered");
  fake.tables["ip/firewall/connection"].push({ ".id": "*FF", "dst-address": "9.9.9.9:443" });
  await app.emit("metered");
  assert.equal(fake.tables["ip/firewall/connection"].length, 1);
  plugin.stop();
});

test("applies the state that is already published on start", async (t) => {
  const app = fakeApp("metered");
  const { fake, plugin } = await start(t, app);
  assert.equal(dropRule(fake).disabled, "false");
  plugin.stop();
});

test("restart without a known state keeps the router metered (fail safe)", async (t) => {
  const app = fakeApp();
  const { fake, plugin } = await start(t, app);
  await app.emit("metered");
  plugin.stop();

  const again = createPlugin(fakeApp());
  await again.start({ url: fake.url, username: "u", password: "p" });
  assert.equal(dropRule(fake).disabled, "false");
  again.stop();
});

test("preflight errors stop the install and show in the plugin status", async (t) => {
  const app = fakeApp();
  const { fake } = await start(t, app, defconf({ tables: { "interface/list": [] } }));
  assert.match(app.error, /Interface list "WAN" not found/);
  assert.equal(fake.tables["ip/firewall/filter"].filter((r) => r.comment === "signalk-mikrotik").length, 0);
  assert.equal(app.listeners.length, 0);
});

test("usage is booked to the profile that was active, and served on GET /usage", async (t) => {
  const app = fakeApp();
  const { fake, plugin } = await start(t, app);
  const ether1 = fake.tables.interface.find((i) => i.name === "ether1");
  const grow = (rx, tx) => Object.assign(ether1, { "rx-byte": String(Number(ether1["rx-byte"]) + rx), "tx-byte": String(Number(ether1["tx-byte"]) + tx) });

  grow(2000, 100);
  await app.emit("metered"); // books the 2100 to normal before switching
  grow(500, 50);
  await app.emit("online"); // books the 550 to metered
  assert.equal(app.values["network.mikrotik.usage.today.normal"], 2100);
  assert.equal(app.values["network.mikrotik.usage.today.metered"], 550);
  assert.equal(app.values["network.mikrotik.usage.wan.received"], 2500);
  assert.equal(app.values["network.mikrotik.usage.wan.sent"], 150);

  const routes = {};
  plugin.registerWithRouter({ get: (p, fn) => (routes[p] = fn), post: () => {} });
  let body;
  routes["/usage"]({ query: {} }, { json: (b) => (body = b) });
  assert.equal(body.profile, "normal");
  assert.deepEqual(Object.values(body.days)[0], { normal: { rx: 2000, tx: 100 }, metered: { rx: 500, tx: 50 } });
  const first = Object.keys(body.days)[0];
  routes["/usage"]({ query: { from: "2999-01-01" } }, { json: (b) => (body = b) });
  assert.deepEqual(body.days, {});
  assert.equal(body.first, first, "the first day is reported even when the range leaves it out");

  plugin.stop();
  // Bytes counted while the plugin was down go to the first sample after restart.
  grow(10, 0);
  const again = createPlugin(Object.assign(fakeApp(), { dataDir: app.dataDir }));
  await again.start({ url: fake.url, username: "u", password: "p" });
  again.stop();
  const saved = JSON.parse(require("node:fs").readFileSync(join(app.dataDir, "usage.json"), "utf8"));
  assert.deepEqual(Object.values(saved.days)[0].normal, { rx: 2010, tx: 100 });
});

/** Call a route the plugin registered, the way Express would. */
async function call(plugin, method, path, req = {}) {
  const routes = { get: {}, post: {} };
  plugin.registerWithRouter({ get: (p, fn) => (routes.get[p] = fn), post: (p, fn) => (routes.post[p] = fn) });
  return new Promise((resolve) => {
    const res = { statusCode: 200, headersSent: false };
    res.status = (c) => ((res.statusCode = c), res);
    res.json = (body) => { res.headersSent = true; resolve({ status: res.statusCode, body }); };
    routes[method][path]({ query: {}, ...req }, res);
  });
}

test("allowlist: seen names become services or domains, picks sync to the router", async (t) => {
  const app = fakeApp();
  const cache = [
    { name: "mmg.whatsapp.net", type: "A" }, { name: "registry-1.docker.io", type: "A" }, { name: "auth.docker.io", type: "A" },
    { name: "0.pool.ntp.org", type: "A" }, { name: "88.168.192.in-addr.arpa", type: "PTR" }, { name: "news.example.co.uk.", type: "A" },
    // A CNAME's target is not a lookup of its own.
    { name: "www.example.org", type: "CNAME", data: "edge.cdn-example.net" }, { name: "edge.cdn-example.net", type: "A" },
  ];
  const { fake, plugin } = await start(t, app, defconf({ tables: { "ip/dns/cache/all": cache } }));

  let { body } = await call(plugin, "get", "/allowlist");
  const whatsapp = body.services.find((s) => s.id === "whatsapp");
  assert.equal(whatsapp.allowed, false);
  assert.equal(whatsapp.seen.days, 1);
  assert.deepEqual(whatsapp.names, ["mmg.whatsapp.net"]);
  assert.ok(whatsapp.categories.includes("category-communication"));
  // v2fly knows Docker; the rest is grouped by domain. Fixed-list names (NTP) and local names are left out.
  assert.deepEqual(body.services.map((s) => s.id).sort(), ["docker", "whatsapp"]);
  assert.deepEqual(body.domains.map((d) => d.domain).sort(), ["example.co.uk", "example.org"]);

  const found = await call(plugin, "get", "/catalog", { query: { q: "netfl" } });
  assert.equal(found.body.services[0].id, "netflix");
  assert.equal(found.body.services[0].seen, null);

  const bad = await call(plugin, "post", "/allowlist", { body: { services: ["nope"], domains: ["*.x.com"] } });
  assert.equal(bad.status, 400);

  ({ body } = await call(plugin, "post", "/allowlist", { body: { services: ["telegram"], domains: ["example.co.uk"] } }));
  assert.equal(body.services.find((s) => s.id === "telegram").allowed, true);
  assert.ok(body.savedAt > 0, "the page can say when the router was last updated");
  const addresses = fake.tables["ip/firewall/address-list"].map((r) => r.address);
  const names = fake.tables["ip/dns/static"].map((r) => r.name);
  assert.ok(names.includes("telegram.org") && names.includes("example.co.uk"));
  // Services only get FWD entries, never address-list entries.
  assert.ok(!addresses.includes("telegram.org"));
  assert.equal(fake.flushed, undefined, "no cache flush in normal mode");

  // Unpicking removes only those entries; the rules stay as they are.
  const rules = JSON.stringify(fake.tables["ip/firewall/filter"]);
  await call(plugin, "post", "/allowlist", { body: { services: [], domains: ["example.co.uk"] } });
  assert.ok(!fake.tables["ip/dns/static"].some((r) => r.name === "telegram.org"));
  assert.ok(fake.tables["ip/dns/static"].some((r) => r.name === "example.co.uk"));
  assert.equal(JSON.stringify(fake.tables["ip/firewall/filter"]), rules);
  plugin.stop();
});

test("while metered, lookups the allowlist doesn't cover are marked blocked", async (t) => {
  const app = fakeApp();
  const cache = [{ name: "registry-1.docker.io", type: "A" }, { name: "captive.apple.com", type: "A" }];
  const { fake, plugin } = await start(t, app, defconf({ tables: { "ip/dns/cache/all": cache } }));
  let { body } = await call(plugin, "get", "/allowlist");
  assert.equal(body.services.find((s) => s.id === "docker").seen.blocked, null, "not blocked in normal mode");

  await app.emit("metered"); // samples before switching, so still normal
  await app.emit("online");
  await app.emit("metered");
  await app.emit("online"); // this sample happens while metered
  ({ body } = await call(plugin, "get", "/allowlist"));
  assert.ok(body.services.find((s) => s.id === "docker").seen.blocked > 0);

  // Allowing it afterwards; while metered the router's DNS cache is flushed so devices ask again.
  await app.emit("metered");
  ({ body } = await call(plugin, "post", "/allowlist", { body: { services: ["docker"], domains: [] } }));
  assert.equal(body.services.find((s) => s.id === "docker").allowed, true);
  assert.equal(fake.flushed, 1);
  plugin.stop();
});

test("Traffic Flow bytes are booked to the name a device looked up, CDN addresses included", async (t) => {
  const dgram = require("node:dgram");
  const { packet } = require("./flow-packets");
  const app = fakeApp();
  const cache = [
    { name: "mmg.whatsapp.net", type: "A", data: "157.240.1.1" },
    { name: "www.example.org", type: "CNAME", data: "edge.cdn-example.net" },
    { name: "edge.cdn-example.net", type: "A", data: "93.184.216.34" },
  ];
  const fake = await fakeRouter(defconf({ tables: { "ip/dns/cache/all": cache } }));
  t.after(() => fake.close());
  const plugin = createPlugin(app);
  const flowPort = 39_000 + Math.floor(Math.random() * 1000);
  await plugin.start({ url: fake.url, username: "u", password: "p", flowPort });

  const sock = dgram.createSocket("udp4");
  const send = (buf) => new Promise((r) => sock.send(buf, flowPort, "127.0.0.1", r));
  await send(packet(10, [
    { src: "192.168.88.10", dst: "157.240.1.1", bytes: 1000 },
    { src: "157.240.1.1", dst: "192.168.88.10", bytes: 2000 },
    { src: "93.184.216.34", dst: "192.168.88.10", bytes: 5000 },
    { src: "192.168.88.10", dst: "192.168.88.20", bytes: 9999 }, // on board: not counted
    { src: "8.8.4.4", dst: "192.168.88.10", bytes: 300 }, // no DNS answer yet: waits
  ]));
  sock.close();

  let body;
  for (let i = 0; i < 50; i++) {
    ({ body } = await call(plugin, "get", "/allowlist"));
    if (body.services.find((s) => s.id === "whatsapp")?.seen.bytes[0]) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(body.flows, true);
  assert.deepEqual(body.services.find((s) => s.id === "whatsapp").seen.bytes, [3000, 0]);
  assert.deepEqual(body.domains.find((d) => d.domain === "example.org").seen.bytes, [5000, 0]);
  assert.deepEqual(body.unmatched, [0, 0], "the unknown address is still waiting for its DNS answer");
  assert.equal(body.reset.at, 0);

  ({ body } = await call(plugin, "post", "/reset"));
  assert.ok(body.reset.at > 0);
  assert.deepEqual(body.services.find((s) => s.id === "whatsapp").seen.since, [0, 0]);
  assert.deepEqual(body.services.find((s) => s.id === "whatsapp").seen.bytes, [3000, 0], "the days are kept");
  plugin.stop();
});

test("allowing a service skips names its own domains already cover, and reports the sync", async (t) => {
  const app = fakeApp();
  const { fake, plugin } = await start(t, app);
  const before = fake.tables["ip/dns/static"].length;
  const { body } = await call(plugin, "post", "/allowlist", { body: { services: ["google"], domains: [] } });
  const names = new Set(fake.tables["ip/dns/static"].map((r) => r.name));
  assert.ok(names.has("google.com"));
  assert.ok(![...names].some((n) => n.endsWith(".google.com")), "subdomains of google.com need no entry of their own");
  assert.ok(!names.has("time.google.com"), "the base list's own entry is covered by google.com now");
  assert.equal(body.sync.added - body.sync.removed, names.size - before);
  plugin.stop();
});

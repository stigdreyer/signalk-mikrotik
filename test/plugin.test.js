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
  routes["/usage"]({ query: { from: "2999-01-01" } }, { json: (b) => (body = b) });
  assert.deepEqual(body.days, {});

  plugin.stop();
  // Bytes counted while the plugin was down go to the first sample after restart.
  grow(10, 0);
  const again = createPlugin(Object.assign(fakeApp(), { dataDir: app.dataDir }));
  await again.start({ url: fake.url, username: "u", password: "p" });
  again.stop();
  const saved = JSON.parse(require("node:fs").readFileSync(join(app.dataDir, "usage.json"), "utf8"));
  assert.deepEqual(Object.values(saved.days)[0].normal, { rx: 2010, tx: 100 });
});

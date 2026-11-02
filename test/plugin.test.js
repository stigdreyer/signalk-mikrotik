const { test } = require("node:test");
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
    handleMessage: (id, delta) => app.deltas.push(delta.updates[0].values[0].value),
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

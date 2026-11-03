const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fakeRouter, defconf } = require("./fake-routeros");
const { createClient } = require("../lib/routeros");
const router = require("../lib/router");

const CFG = { wanList: "WAN", redirectDns: true };
const HOSTS = ["captive.apple.com", "192.168.100.0/24"];
const UPSTREAM = "1.1.1.1";

async function setup(t, seed = defconf()) {
  const fake = await fakeRouter(seed);
  t.after(() => fake.close());
  const client = createClient({ url: fake.url, username: "u", password: "p" });
  return { fake, client };
}

const tagged = (rows) => rows.filter((r) => r.comment === router.TAG);
const untagged = (fake) =>
  JSON.stringify(Object.values(fake.tables).flat().filter((r) => r.comment !== router.TAG && r.list !== router.LIST));

test("install puts plugin rules above the user's first forward rule, disabled", async (t) => {
  const { fake, client } = await setup(t);
  await router.install(client, CFG, HOSTS, "normal", true, UPSTREAM);

  const forward = fake.tables["ip/firewall/filter"].filter((r) => r.chain === "forward");
  assert.deepEqual(
    forward.map((r) => r.action),
    ["accept", "drop", "fasttrack-connection", "accept"],
  );
  assert.equal(forward[0]["dst-address-list"], router.LIST);
  assert.equal(forward[1]["out-interface-list"], "WAN");
  assert.equal(forward[1]["connection-nat-state"], "!dstnat");
  const rules = ["ip/firewall/filter", "ip/firewall/nat", "ipv6/firewall/filter"].flatMap((p) => tagged(fake.tables[p]));
  assert.ok(rules.every((r) => r.disabled === "true"));

  const nat = fake.tables["ip/firewall/nat"];
  assert.deepEqual(tagged(nat).map((r) => `${r.chain}:${r.action}:${r.protocol}`), ["dstnat:redirect:udp", "dstnat:redirect:tcp"]);
  assert.equal(nat.length, 3);
  assert.deepEqual(tagged(fake.tables["ipv6/firewall/filter"]).map((r) => r.action), ["drop"]);
  assert.deepEqual(
    tagged(fake.tables["ip/firewall/address-list"]).map((r) => r.address),
    HOSTS,
  );
  // Only names get a FWD entry; it feeds the IPs the router hands out into the list.
  assert.deepEqual(tagged(fake.tables["ip/dns/static"]), [{
    ".id": tagged(fake.tables["ip/dns/static"])[0][".id"],
    type: "FWD", name: "captive.apple.com", "match-subdomain": "true", "forward-to": UPSTREAM,
    "address-list": router.LIST, comment: router.TAG, disabled: "true",
  }]);
});

test("without an upstream DNS server no FWD entries are created", async (t) => {
  const { fake, client } = await setup(t);
  await router.install(client, CFG, HOSTS, "normal", true, null);
  assert.equal(tagged(fake.tables["ip/dns/static"] ?? []).length, 0);
});

test("install twice leaves no duplicates and never touches user objects", async (t) => {
  const { fake, client } = await setup(t);
  const before = untagged(fake);
  await router.install(client, CFG, HOSTS, "normal", true, UPSTREAM);
  await router.install(client, CFG, HOSTS, "normal", true, UPSTREAM);

  assert.equal(tagged(fake.tables["ip/firewall/filter"]).length, 2);
  assert.equal(tagged(fake.tables["ip/firewall/nat"]).length, 2);
  assert.equal(tagged(fake.tables["ip/firewall/address-list"]).length, HOSTS.length);
  assert.equal(tagged(fake.tables["ip/dns/static"]).length, 1);
  assert.equal(untagged(fake), before);
});

test("without DNS redirect, DNS is accepted in forward instead", async (t) => {
  const { fake, client } = await setup(t);
  await router.install(client, { ...CFG, redirectDns: false }, HOSTS, "normal", false);
  const ours = tagged(fake.tables["ip/firewall/filter"]);
  assert.deepEqual(ours.map((r) => `${r.action}:${r.protocol || ""}`), ["accept:", "accept:udp", "accept:tcp", "drop:"]);
  assert.equal(tagged(fake.tables["ip/firewall/nat"]).length, 0);
  assert.equal(tagged(fake.tables["ipv6/firewall/filter"]).length, 0);
});

test("metered enables every rule and flushes connections; normal disables without flushing", async (t) => {
  const { fake, client } = await setup(t);
  await router.install(client, CFG, HOSTS, "normal", true, UPSTREAM);

  await router.setProfile(client, "metered", true);
  const rules = () => [
    ...tagged(fake.tables["ip/firewall/filter"]),
    ...tagged(fake.tables["ip/firewall/nat"]),
    ...tagged(fake.tables["ipv6/firewall/filter"]),
    ...tagged(fake.tables["ip/dns/static"]),
  ];
  assert.ok(rules().every((r) => r.disabled === "false"));
  assert.equal(fake.tables["ip/firewall/connection"].length, 0);
  assert.equal(await router.currentProfile(client), "metered");

  fake.tables["ip/firewall/connection"].push({ ".id": "*FF", "dst-address": "9.9.9.9:443" });
  await router.setProfile(client, "normal", true);
  assert.ok(rules().every((r) => r.disabled === "true"));
  assert.equal(fake.tables["ip/firewall/connection"].length, 1);
  assert.equal(await router.currentProfile(client), "normal");
});

test("reinstall keeps user rules placed above the plugin's rules above them", async (t) => {
  const { fake, client } = await setup(t);
  await router.install(client, CFG, HOSTS, "normal", true, UPSTREAM);
  // e.g. an exemption for a laptop, added with place-before=0
  fake.tables["ip/firewall/filter"].unshift({ ".id": "*EE", chain: "forward", action: "accept", "src-address": "192.168.88.252", disabled: "false" });

  await router.install(client, CFG, HOSTS, "metered", true, UPSTREAM);
  const forward = fake.tables["ip/firewall/filter"]
    .filter((r) => r.chain === "forward")
    .map((r) => (r[".id"] === "*EE" ? "exempt" : `${r.action}${r.comment === router.TAG ? "*" : ""}`));
  assert.deepEqual(forward, ["exempt", "accept*", "drop*", "fasttrack-connection", "accept"]);
});

test("reinstall keeps a metered router metered", async (t) => {
  const { fake, client } = await setup(t);
  await router.install(client, CFG, HOSTS, "normal", true, UPSTREAM);
  await router.setProfile(client, "metered", true);
  await router.install(client, CFG, HOSTS, await router.currentProfile(client), true);
  assert.equal(await router.currentProfile(client), "metered");
});

test("remove deletes everything tagged, keeps user and dynamic entries", async (t) => {
  const { fake, client } = await setup(t);
  const before = untagged(fake);
  await router.install(client, CFG, HOSTS, "metered", true, UPSTREAM);
  fake.tables["ip/firewall/address-list"].push({
    ".id": "*D1", list: router.LIST, address: "17.253.1.1", dynamic: "true", comment: router.TAG,
  });

  await router.remove(client, true);
  const left = tagged(Object.values(fake.tables).flat());
  assert.deepEqual(left.map((r) => r[".id"]), ["*D1"]);
  assert.equal(await router.currentProfile(client), null);
  assert.equal(untagged(fake), before);
});

test("preflight passes on a default config", async (t) => {
  const { fake, client } = await setup(t);
  const check = await router.preflight(client, CFG);
  assert.deepEqual(check.errors, []);
  assert.deepEqual(check.warnings, []);
  assert.equal(check.ipv6, true);
  assert.equal(check.upstream, "1.1.1.1");
});

test("preflight reports what blocks an install", async (t) => {
  const { fake, client } = await setup(
    t,
    defconf({
      settings: { "system/resource": { version: "6.49.10 (long-term)" }, "ip/dns": { "allow-remote-requests": "false" } },
      tables: { "interface/list/member": [] },
    }),
  );
  const { errors } = await router.preflight(client, CFG);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /6\.49\.10/);
  assert.match(errors[1], /no members/);
  assert.match(errors[2], /allow-remote-requests/);

  const missing = await router.preflight(client, { ...CFG, wanList: "UPLINK", redirectDns: false });
  assert.match(missing.errors.at(-1), /"UPLINK" not found/);
});

test("preflight warns about a missing upstream and a zero address-list-extra-time", async (t) => {
  const { client } = await setup(
    t,
    defconf({ settings: { "ip/dns": { "allow-remote-requests": "true", "dynamic-servers": "", "address-list-extra-time": "0s" } } }),
  );
  const check = await router.preflight(client, CFG);
  assert.equal(check.upstream, null);
  assert.equal(check.warnings.length, 2);
  assert.match(check.warnings[0], /no upstream/);
  assert.match(check.warnings[1], /address-list-extra-time/);
});

test("preflight warns about external DHCP DNS only without the redirect, and handles a router without IPv6", async (t) => {
  const { fake, client } = await setup(
    t,
    defconf({
      tables: { "ip/dhcp-server/network": [{ address: "192.168.88.0/24", "dns-server": "1.1.1.1,192.168.88.1" }] },
      missing: ["ipv6/"],
    }),
  );
  const check = await router.preflight(client, CFG);
  assert.equal(check.ipv6, false);
  assert.deepEqual(check.warnings, []);
  const noRedirect = await router.preflight(client, { ...CFG, redirectDns: false });
  assert.match(noRedirect.warnings[0], /1\.1\.1\.1/);
});

test("client surfaces auth failures with the RouterOS message", async () => {
  const server = require("node:http").createServer((req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: 401, message: "Unauthorized" }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const client = createClient({ url: `http://127.0.0.1:${server.address().port}`, username: "u", password: "bad" });
  await assert.rejects(client.get("system/resource"), /GET \/rest\/system\/resource: 401 Unauthorized/);
  await new Promise((r) => {
    server.close(r);
    server.closeAllConnections();
  });
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const seen = require("../lib/seen");
const catalog = require("../lib/catalog");

const DAY = 86_400_000;
const T = Date.parse("2026-11-03T12:00:00Z");

test("record keeps the last sighting and distinct UTC days; prune drops old days", () => {
  const s = {};
  seen.record(s, ["a.example.com"], T - 20 * DAY);
  seen.record(s, ["a.example.com", "b.example.com"], T - DAY);
  seen.record(s, ["a.example.com"], T);
  seen.record(s, ["a.example.com"], T + 1000);
  assert.deepEqual(s["a.example.com"].days, ["2026-10-14", "2026-11-02", "2026-11-03"]);
  seen.prune(s, T);
  assert.deepEqual(s["a.example.com"], { last: T + 1000, days: ["2026-11-02", "2026-11-03"] });

  seen.prune(s, T + 14 * DAY);
  assert.deepEqual(Object.keys(s), []);
});

test("blocked names get a timestamp, merge reports the latest", () => {
  const s = seen.record({}, ["x.docker.io", "y.docker.io"], T, (n) => n === "y.docker.io");
  assert.equal(s["x.docker.io"].blocked, undefined);
  assert.deepEqual(seen.merge(Object.values(s)), { last: T, days: 1, blocked: T, bytes: [0, 0] });
});

test("catalog finds the v2fly list of a name, also behind Akamai, and groups the rest by domain", () => {
  assert.equal(catalog.listOf("mmg.whatsapp.net"), "whatsapp");
  assert.equal(catalog.listOf("registry-1.docker.io"), "docker");
  assert.equal(catalog.listOf("gateway.icloud.com"), "icloud");
  assert.equal(catalog.listOf("captive.apple.com.edgesuite.net"), catalog.listOf("captive.apple.com"));
  assert.equal(catalog.listOf("edge21.streamonkey.net"), null);
  assert.ok(catalog.withIncludes("apple").has("icloud"), "apple includes icloud");
  assert.ok(catalog.hostsOf("whatsapp").domains.includes("whatsapp.net"));
  assert.equal(catalog.domainOf("registry-1.docker.io"), "docker.io");
  assert.equal(catalog.domainOf("www.bbc.co.uk"), "bbc.co.uk");
  assert.equal(catalog.domainOf("api.met.gov.fj"), "met.gov.fj");
});

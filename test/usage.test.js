const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const usage = require("../lib/usage");

const T = Date.parse("2026-11-03T12:00:00Z");
const read = (rx, tx) => [{ name: "ether1", rx, tx }];
const fresh = () => ({ days: {}, hours: {}, last: {} });

test("first reading is only a baseline, growth after it is booked", () => {
  const s = fresh();
  usage.record(s, read(5000, 1000), "normal", T);
  assert.deepEqual(s.days["2026-11-03"].normal, { rx: 0, tx: 0 });
  usage.record(s, read(7000, 1500), "normal", T + 60_000);
  assert.deepEqual(s.days["2026-11-03"].normal, { rx: 2000, tx: 500 });
});

test("a profile switch mid-day books to separate buckets", () => {
  const s = fresh();
  usage.record(s, read(0, 0), "normal", T);
  usage.record(s, read(100, 10), "normal", T + 1);
  usage.record(s, read(150, 20), "metered", T + 2);
  assert.deepEqual(s.days["2026-11-03"], { normal: { rx: 100, tx: 10 }, metered: { rx: 50, tx: 10 } });
});

test("a counter reset counts from zero", () => {
  const s = fresh();
  usage.record(s, read(10_000, 10_000), "normal", T);
  usage.record(s, read(300, 200), "normal", T + 1); // router rebooted
  assert.deepEqual(s.days["2026-11-03"].normal, { rx: 300, tx: 200 });
});

test("days are UTC: growth after midnight UTC goes to the new day", () => {
  const s = fresh();
  const midnight = Date.parse("2026-11-04T00:00:00Z");
  usage.record(s, read(0, 0), "metered", midnight - 30_000);
  usage.record(s, read(400, 40), "metered", midnight + 30_000);
  assert.deepEqual(s.days["2026-11-03"].metered, { rx: 0, tx: 0 });
  assert.deepEqual(s.days["2026-11-04"].metered, { rx: 400, tx: 40 });
  assert.deepEqual(usage.totals(s), { rx: 400, tx: 40 });
});

test("storage round trip, and a broken file starts empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "skm-usage-"));
  const file = join(dir, "sub", "usage.json");
  assert.deepEqual(usage.load(file), fresh());
  const s = usage.record(usage.record(fresh(), read(1, 1), "normal", T), read(5, 9), "normal", T);
  usage.save(file, s);
  assert.deepEqual(usage.load(file), s);
  writeFileSync(file, "{not json");
  assert.deepEqual(usage.load(file), fresh());
});

test("growth is also booked per UTC hour, so the webapp can build local days", () => {
  const s = fresh();
  usage.record(s, read(0, 0), "normal", T - 3_600_000);
  usage.record(s, read(100, 10), "normal", T - 60_000); // 11:59
  usage.record(s, read(150, 20), "metered", T + 60_000); // 12:01
  assert.deepEqual(s.hours["2026-11-03T11"].normal, { rx: 100, tx: 10 });
  assert.deepEqual(s.hours["2026-11-03T12"].metered, { rx: 50, tx: 10 });
  assert.deepEqual(s.days["2026-11-03"].normal, { rx: 100, tx: 10 }, "the UTC day still adds up");

  usage.record(s, read(150, 20), "normal", T + 401 * 86_400_000);
  assert.ok(!s.hours["2026-11-03T11"], "hours older than 400 days are dropped");
  assert.ok(s.days["2026-11-03"], "days are kept");
});

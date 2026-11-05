const { test } = require("node:test");
const assert = require("node:assert/strict");
const flows = require("../lib/flows");
const { packet } = require("./flow-packets");

const recs = [{ src: "192.168.88.10", dst: "157.240.1.1", bytes: 1234 }, { src: "157.240.1.1", dst: "192.168.88.10", bytes: 5_000_000_000 }];

for (const version of [9, 10]) {
  test(`parses ${version === 9 ? "NetFlow v9" : "IPFIX"} with a template from an earlier packet`, () => {
    const templates = new Map();
    assert.deepEqual(flows.parse(packet(version, recs, { template: false }), templates), [], "no template yet: dropped");
    assert.deepEqual(flows.parse(packet(version, []), templates), []);
    assert.deepEqual(flows.parse(packet(version, recs, { template: false }), templates), recs);
    assert.deepEqual(flows.parse(packet(version, recs), new Map()), recs, "template and data in one packet");
  });
}

test("ignores other export versions and truncated packets", () => {
  const v5 = Buffer.alloc(24);
  v5.writeUInt16BE(5, 0);
  assert.deepEqual(flows.parse(v5, new Map()), []);
  assert.deepEqual(flows.parse(packet(10, recs).subarray(0, 30), new Map()), []);
});

test("the remote side is the address that leaves the boat", () => {
  assert.equal(flows.remoteOf({ src: "192.168.88.10", dst: "157.240.1.1" }), "157.240.1.1");
  assert.equal(flows.remoteOf({ src: "157.240.1.1", dst: "100.64.0.5" }), "157.240.1.1", "Starlink CGNAT counts as local");
  assert.equal(flows.remoteOf({ src: "192.168.88.10", dst: "192.168.100.1" }), null, "dish and LAN stay on board");
  assert.equal(flows.canonical("2606:4700::6810:84E5"), "2606:4700:0:0:0:0:6810:84e5");
});

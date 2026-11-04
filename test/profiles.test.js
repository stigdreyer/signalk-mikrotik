const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { isIPv4 } = require("node:net");

// Profiles are community data: this is the gate a profile PR has to pass.
const DIRS = ["profiles"].map((d) => join(__dirname, "..", d));
const FQDN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const isCidr = (h) => {
  const [ip, bits, extra] = h.split("/");
  return extra === undefined && isIPv4(ip) && (bits === undefined || (/^\d+$/.test(bits) && +bits >= 8 && +bits <= 32));
};

for (const dir of DIRS) for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  test(`${file} in ${dir.split("/").at(-1)} is valid`, () => {
    const p = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const keys = ["name", "notes", "hosts", "description"];
    assert.deepEqual(Object.keys(p).filter((k) => !keys.includes(k)), [], "unknown keys");
    assert.equal(typeof p.name, "string");
    assert.equal(typeof p.description, "string");
    if (p.notes !== undefined) assert.equal(typeof p.notes, "string");
    assert.ok(Array.isArray(p.hosts) && p.hosts.length, "hosts must be a non-empty list");
    for (const h of p.hosts) {
      assert.ok(FQDN.test(h) || isCidr(h), `"${h}" is not a lowercase hostname or IPv4 address/range (no wildcards: subdomains match anyway)`);
    }
    assert.equal(new Set(p.hosts).size, p.hosts.length, "duplicate hosts");
  });
}

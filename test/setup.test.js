const { test } = require("node:test");
const assert = require("node:assert/strict");
const { explain, isSetUp, serverAddresses } = require("../lib/setup");

test("router errors read as something to do", () => {
  const e = (msg, status) => Object.assign(new Error(msg), { status });
  assert.match(explain(e("ip/resource: 401 Unauthorized", 401), "https://r"), /refused the user name or password/);
  assert.match(explain(e("ip/resource: 500 not allowed (9)"), "https://r"), /lacks permissions/);
  assert.match(explain(e("ip/resource: self-signed certificate"), "https://r"), /Accept self-signed/);
  assert.match(explain(e("ip/resource: connect ECONNREFUSED 10.0.0.1:443"), "https://10.0.0.1"), /Nothing answers at 10\.0\.0\.1/);
  assert.match(explain(e("ip/resource: timeout"), "https://10.0.0.1"), /Can't reach the router at 10\.0\.0\.1/);
  assert.equal(explain(e('Interface list "WAN" not found'), "https://r"), 'Interface list "WAN" not found');
});

test("set up means a router password; server addresses list LAN first", () => {
  assert.equal(isSetUp({}), false);
  assert.equal(isSetUp({ password: "x" }), true);
  const list = serverAddresses();
  assert.ok(list.every((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a.address)));
});

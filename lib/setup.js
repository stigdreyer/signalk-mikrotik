/**
 * Helpers for first-time setup: router errors in plain words, and the Signal K server's own
 * addresses (the router's Traffic Flow export and the plugin user's login are tied to one of them).
 */

const os = require("node:os");

const NOT_SET_UP = "Not set up yet: open the MikroTik Data Meter app and follow Setup.";

/** The plugin can't do anything before it has the router password. */
const isSetUp = (cfg) => Boolean(cfg && cfg.password);

/** A router error as a sentence a skipper can act on. Unknown errors keep their own text. */
function explain(err, url) {
  const msg = String(err?.message ?? err);
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  if (err?.status === 401) return "The router refused the user name or password. Check the router user (Setup, step 3).";
  if (/not allowed|\b403\b/i.test(msg)) {
    return "The router user lacks permissions: its group needs read, write, api and rest-api (the Setup script creates it).";
  }
  if (/self[- ]signed|certificate|UNABLE_TO_VERIFY|DEPTH_ZERO|CERT_/i.test(msg)) {
    return "The router's certificate isn't trusted: turn on \"Accept self-signed router certificate\".";
  }
  if (/ECONNREFUSED/.test(msg)) return `Nothing answers at ${host}: is the router's REST service (www-ssl) on? The Setup script turns it on.`;
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return `The router address ${host} doesn't resolve. Use its IP address, e.g. 192.168.88.1.`;
  if (/timeout|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(msg)) {
    return `Can't reach the router at ${host}. Check the address, and that this server is on the router's LAN.`;
  }
  if (/Invalid URL/i.test(msg)) return `"${url}" isn't a router address. Use the form https://192.168.88.1.`;
  return msg;
}

/** IPv4 addresses of this server, LAN-looking ones first (container bridges like 172.17.x come last). */
function serverAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) out.push({ name, address: a.address, cidr: a.cidr });
  }
  const bridge = (a) => /^(docker|br-|veth|cni|flannel|podman)/.test(a.name) || /^172\.(1[6-9]|2\d|3[01])\./.test(a.address);
  return out.sort((a, b) => bridge(a) - bridge(b));
}

module.exports = { NOT_SET_UP, isSetUp, explain, serverAddresses };

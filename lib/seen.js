/**
 * Names the router resolved recently, read from its DNS cache: when each was
 * last seen, on which UTC days, and when it was last blocked while metered.
 * State: { <name>: { last: ms, days: ["YYYY-MM-DD", …], blocked?: ms } }
 */

const { dayOf } = require("./usage");

const KEEP_DAYS = 14;
const LOCAL = /\.(arpa|local|lan|home|internal|localdomain)$/;

const clean = (n) => (n || "").toLowerCase().replace(/\.$/, "");

/**
 * Names devices looked up. The cache also holds the names CNAMEs point to
 * (CDN hosts like captive.g.aaplimg.com); nobody asked for those, so they're
 * left out, or an allowed service would show its CDN as blocked.
 */
async function readNames(client) {
  const rows = await client.get("ip/dns/cache/all", { ".proplist": "name,type,data" });
  const targets = new Set(rows.filter((r) => r.type === "CNAME").map((r) => clean(r.data)));
  const names = rows.map((r) => clean(r.name)).filter((n) => !targets.has(n));
  return [...new Set(names.filter((n) => n.includes(".") && !LOCAL.test(n)))];
}

/** `blocked(name)` is true for names looked up while metered that the allowlist doesn't cover. */
function record(state, names, now, blocked = () => false) {
  const day = dayOf(now);
  for (const name of names) {
    const entry = (state[name] ??= { last: 0, days: [] });
    entry.last = now;
    if (entry.days.at(-1) !== day) entry.days.push(day);
    if (blocked(name)) entry.blocked = now;
  }
  return state;
}

/** Forget days older than the retention window, and names with none left. */
function prune(state, now) {
  const oldest = dayOf(now - (KEEP_DAYS - 1) * 86_400_000);
  for (const [name, entry] of Object.entries(state)) {
    entry.days = entry.days.filter((d) => d >= oldest);
    if (!entry.days.length) delete state[name];
  }
  return state;
}

/** Merge the entries of many names: latest sighting, distinct days, latest block. */
function merge(entries) {
  const days = new Set(entries.flatMap((e) => e.days));
  const blocked = Math.max(0, ...entries.map((e) => e.blocked ?? 0));
  return { last: Math.max(0, ...entries.map((e) => e.last)), days: days.size, blocked: blocked || null };
}

module.exports = { KEEP_DAYS, readNames, record, prune, merge };

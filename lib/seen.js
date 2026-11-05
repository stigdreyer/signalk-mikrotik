/**
 * Names the router resolved recently, read from its DNS cache: when each was
 * last seen, on which UTC days, when it was last blocked while metered, and
 * how many bytes went to it per UTC day (normal, metered).
 * State: { <name>: { last: ms, days: ["YYYY-MM-DD", …], blocked?: ms, bytes?: { "YYYY-MM-DD": [normal, metered] } } }
 */

const { dayOf } = require("./usage");
const { canonical } = require("./flows");

const KEEP_DAYS = 14;
const LOCAL = /\.(arpa|local|lan|home|internal|localdomain)$/;

const clean = (n) => (n || "").toLowerCase().replace(/\.$/, "");

/**
 * Read the router's DNS cache.
 * - names: what devices looked up. The cache also holds the names CNAMEs point
 *   to (CDN hosts like captive.g.aaplimg.com); nobody asked for those, so
 *   they're left out, or an allowed service would show its CDN as blocked.
 * - addresses: Map(ip -> the name a device asked for), following CNAMEs back,
 *   so a CDN address counts for the service that uses it.
 */
async function readCache(client) {
  const rows = await client.get("ip/dns/cache/all", { ".proplist": "name,type,data" });
  const askedFor = new Map(rows.filter((r) => r.type === "CNAME").map((r) => [clean(r.data), clean(r.name)]));
  const origin = (name) => {
    for (let i = 0; i < 8 && askedFor.has(name); i++) name = askedFor.get(name);
    return name;
  };
  const names = rows.map((r) => clean(r.name)).filter((n) => !askedFor.has(n));
  const addresses = new Map(rows.filter((r) => r.type === "A" || r.type === "AAAA").map((r) => [canonical(r.data), origin(clean(r.name))]));
  return { names: [...new Set(names.filter((n) => n.includes(".") && !LOCAL.test(n)))], addresses };
}

/** Add `n` bytes for `name` on the UTC day of `now`, to the normal or metered column. */
function addBytes(state, name, n, profile, now) {
  const entry = (state[name] ??= { last: now, days: [dayOf(now)] });
  const day = ((entry.bytes ??= {})[dayOf(now)] ??= [0, 0]);
  day[profile === "metered" ? 1 : 0] += n;
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
    for (const d of Object.keys(entry.bytes ?? {})) if (d < oldest) delete entry.bytes[d];
    if (!entry.days.length) delete state[name];
  }
  return state;
}

/** Merge the entries of many names: latest sighting, distinct days, latest block, bytes [normal, metered]. */
function merge(entries) {
  const days = new Set(entries.flatMap((e) => e.days));
  const blocked = Math.max(0, ...entries.map((e) => e.blocked ?? 0));
  const bytes = [0, 0];
  for (const e of entries) for (const [n, m] of Object.values(e.bytes ?? {})) { bytes[0] += n; bytes[1] += m; }
  return { last: Math.max(0, ...entries.map((e) => e.last)), days: days.size, blocked: blocked || null, bytes };
}

module.exports = { KEEP_DAYS, readCache, addBytes, record, prune, merge };

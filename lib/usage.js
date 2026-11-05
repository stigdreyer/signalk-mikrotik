/**
 * WAN usage, split by router profile: per UTC day, like Starlink's, and per
 * UTC hour, so the webapp can show days in the viewer's own time zone.
 * State: { days: { "YYYY-MM-DD": { normal: {rx, tx}, metered: {rx, tx} } },
 *          hours: { "YYYY-MM-DDTHH": { normal: {rx, tx}, metered: {rx, tx} } },
 *          last: { <interface>: {rx, tx} } }
 */

const { readJson, writeJson } = require("./store");

const PROFILES = ["normal", "metered"];
const emptyDay = () => Object.fromEntries(PROFILES.map((p) => [p, { rx: 0, tx: 0 }]));
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const hourOf = (ms) => new Date(ms).toISOString().slice(0, 13);
const KEEP_HOURS_DAYS = 400; // a year of hourly detail; the daily buckets stay forever

function load(file) {
  const state = readJson(file, {});
  return { days: state.days ?? {}, hours: state.hours ?? {}, last: state.last ?? {} };
}

const save = writeJson;

/** Read rx/tx byte counters of every member of the WAN interface list. */
async function readCounters(client, wanList) {
  const members = new Set((await client.get("interface/list/member", { list: wanList })).map((m) => m.interface));
  return (await client.get("interface"))
    .filter((i) => members.has(i.name))
    .map((i) => ({ name: i.name, rx: Number(i["rx-byte"]), tx: Number(i["tx-byte"]) }));
}

/**
 * Book the counter growth since the last reading to `profile` on the UTC day
 * of `now`. A counter lower than last time was reset (router reboot), so it
 * counts from zero. The first reading of an interface only sets the baseline.
 */
function record(state, readings, profile, now) {
  const day = (state.days[dayOf(now)] ??= emptyDay());
  const hour = ((state.hours ??= {})[hourOf(now)] ??= emptyDay());
  for (const { name, rx, tx } of readings) {
    const prev = state.last[name];
    if (prev) {
      const dRx = rx >= prev.rx ? rx - prev.rx : rx;
      const dTx = tx >= prev.tx ? tx - prev.tx : tx;
      for (const bucket of [day, hour]) {
        bucket[profile].rx += dRx;
        bucket[profile].tx += dTx;
      }
    }
    state.last[name] = { rx, tx };
  }
  const oldest = hourOf(now - KEEP_HOURS_DAYS * 86_400_000);
  for (const h of Object.keys(state.hours)) if (h < oldest) delete state.hours[h];
  return state;
}

function totals(state) {
  let rx = 0;
  let tx = 0;
  for (const day of Object.values(state.days)) {
    for (const p of PROFILES) {
      rx += day[p].rx;
      tx += day[p].tx;
    }
  }
  return { rx, tx };
}

module.exports = { load, save, readCounters, record, totals, dayOf };

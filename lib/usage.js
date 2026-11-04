/**
 * Daily WAN usage, split by router profile. Days are UTC, like Starlink's.
 * State: { days: { "YYYY-MM-DD": { normal: {rx, tx}, metered: {rx, tx} } },
 *          last: { <interface>: {rx, tx} } }
 */

const { readJson, writeJson } = require("./store");

const PROFILES = ["normal", "metered"];
const emptyDay = () => Object.fromEntries(PROFILES.map((p) => [p, { rx: 0, tx: 0 }]));
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

function load(file) {
  const state = readJson(file, {});
  return { days: state.days ?? {}, last: state.last ?? {} };
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
  for (const { name, rx, tx } of readings) {
    const prev = state.last[name];
    if (prev) {
      day[profile].rx += rx >= prev.rx ? rx - prev.rx : rx;
      day[profile].tx += tx >= prev.tx ? tx - prev.tx : tx;
    }
    state.last[name] = { rx, tx };
  }
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

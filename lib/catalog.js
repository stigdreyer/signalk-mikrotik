/**
 * Services and categories from v2fly/domain-list-community (data/v2fly.json,
 * built by tools/build-v2fly.js), the fixed lists (profiles/), and matching of
 * DNS names against them.
 */

const v2fly = require("../data/v2fly.json");
const base = require("../profiles/base.json");
const starlink = require("../profiles/starlink.json");

const { lists, categories } = v2fly;

/** `host` allows `name` itself and every subdomain of it. */
const covers = (host, name) => name === host || name.endsWith(`.${host}`);

// name -> list that declares it. A domain in several lists goes to the smallest, most specific one.
const size = (id) => lists[id].domains.length + lists[id].full.length;
const suffixOwner = new Map();
const fullOwner = new Map();
const adSuffixes = new Set();
for (const id of Object.keys(lists).sort((a, b) => size(b) - size(a))) {
  for (const d of lists[id].domains) suffixOwner.set(d, id);
  for (const d of lists[id].full) fullOwner.set(d, id);
  for (const d of lists[id].ads) adSuffixes.add(d);
}
const categoryOfDomain = new Map();
for (const [cat, c] of Object.entries(categories)) for (const d of c.domains) if (!categoryOfDomain.has(d)) categoryOfDomain.set(d, cat);

const parents = {};
for (const [id, l] of Object.entries(lists)) for (const child of l.include ?? []) (parents[child] ??= []).push(id);
const categoriesOf = {};
for (const [cat, c] of Object.entries(categories)) for (const id of c.lists) (categoriesOf[id] ??= []).push(cat);

const suffixes = (name) => name.split(".").map((_, i, labels) => labels.slice(i).join(".")).slice(0, -1);

// Akamai CNAME targets embed the customer's name: captive.apple.com.edgesuite.net is Apple, not Akamai.
const AKAMAI = /\.(edgesuite|edgekey|akamaized|akamaiedge)\.net$/;

function lookupName(name) {
  if (fullOwner.has(name)) return fullOwner.get(name);
  for (const s of suffixes(name)) if (suffixOwner.has(s)) return suffixOwner.get(s);
  return null;
}

/** The v2fly list a looked-up name belongs to, or null. */
function listOf(name) {
  const embedded = name.replace(AKAMAI, "");
  return (embedded !== name && embedded.includes(".") && lookupName(embedded)) || lookupName(name);
}

/** v2fly marks the name as an ad/tracking domain. */
const isAd = (name) => suffixes(name).some((s) => adSuffixes.has(s));

/** Category named for a domain directly in a category list (e.g. NTP servers), for names in no service. */
const categoryOfName = (name) => suffixes(name).map((s) => categoryOfDomain.get(s)).find(Boolean) ?? null;

/** A list with everything it includes, transitively. */
function withIncludes(id, out = new Set()) {
  if (out.has(id) || !lists[id]) return out;
  out.add(id);
  for (const child of lists[id].include ?? []) withIncludes(child, out);
  return out;
}

/** What allowing a list puts on the router: subdomain-matching names and exact names. Ads stay out. */
function hostsOf(id) {
  const ids = [...withIncludes(id)];
  return { domains: ids.flatMap((i) => lists[i].domains), full: ids.flatMap((i) => lists[i].full) };
}

/**
 * The domain a name is grouped under when no list knows it: the last two
 * labels, or three under a country code's second level (example.co.uk).
 * shortcut: no public suffix list, so some groupings are off (e.g. github.io); add one if that bothers users.
 */
function domainOf(name) {
  const labels = name.split(".");
  const n = labels.length >= 3 && labels.at(-1).length === 2 && /^(co|com|net|org|gov|ac|edu)$/.test(labels.at(-2)) ? 3 : 2;
  return labels.slice(-n).join(".");
}

module.exports = {
  commit: v2fly.commit, lists, categories, categoriesOf, parents, base, starlink,
  covers, listOf, isAd, categoryOfName, withIncludes, hostsOf, domainOf,
};

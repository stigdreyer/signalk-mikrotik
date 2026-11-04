#!/usr/bin/env node
/**
 * Compile a v2fly/domain-list-community checkout into data/v2fly.json.
 *
 *   git clone https://github.com/v2fly/domain-list-community /tmp/v2fly
 *   git -C /tmp/v2fly checkout <commit>
 *   node tools/build-v2fly.js /tmp/v2fly
 *
 * Output: { commit, lists: { <id>: { domains, full, ads, include } }, categories: { <id>: { lists, domains } } }
 * - domains: suffix entries (the domain and its subdomains), full: exact names,
 *   ads: entries v2fly marks @ads (never allowed, used to flag ads),
 *   include: other service lists this one takes in as a whole.
 * - categories: every category-* list with the service lists it includes as a
 *   whole, transitively, and the domains it names itself. Includes filtered by attribute ("include:apple @ads")
 *   only take part of a list, so they don't make the list a member.
 * regexp: and keyword: entries are skipped: the router can't match them.
 */

const { readdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");

const src = process.argv[2];
if (!src) throw new Error("usage: node tools/build-v2fly.js <v2fly checkout>");
const dataDir = join(src, "data");
const commit = execFileSync("git", ["-C", src, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const raw = {};
for (const id of readdirSync(dataDir)) {
  const list = (raw[id] = { domains: [], full: [], ads: [], include: [] });
  for (const line of readFileSync(join(dataDir, id), "utf8").split("\n")) {
    const [entry, ...attrs] = line.split("#")[0].trim().split(/\s+/);
    if (!entry) continue;
    const colon = entry.indexOf(":");
    const [kind, value] = colon === -1 ? ["domain", entry] : [entry.slice(0, colon), entry.slice(colon + 1)];
    if (kind === "include") {
      if (!attrs.length) list.include.push(value);
    } else if (kind === "domain" || kind === "full") {
      const name = value.toLowerCase();
      if (attrs.includes("@ads")) list.ads.push(name);
      else list[kind === "full" ? "full" : "domains"].push(name);
    }
  }
}

const isService = (id) => !/^(category-|geolocation-|tld-)/.test(id) && id !== "private";
const closure = (id, out = new Set()) => {
  if (out.has(id) || !raw[id]) return out;
  out.add(id);
  for (const i of raw[id].include) closure(i, out);
  return out;
};

const lists = {};
for (const [id, l] of Object.entries(raw)) {
  if (!isService(id) || !(l.domains.length || l.full.length || l.ads.length)) continue;
  lists[id] = { domains: l.domains, full: l.full, ads: l.ads };
}
for (const [id, l] of Object.entries(lists)) {
  const include = raw[id].include.filter((i) => lists[i]);
  if (include.length) l.include = include;
}
const categories = {};
for (const id of Object.keys(raw).filter((i) => i.startsWith("category-"))) {
  const members = [...closure(id)].filter((m) => lists[m]).sort();
  const domains = [...closure(id)].filter((m) => !isService(m)).flatMap((m) => raw[m].domains);
  if (members.length || domains.length) categories[id] = { lists: members, domains: [...new Set(domains)] };
}

writeFileSync(join(__dirname, "..", "data", "v2fly.json"), JSON.stringify({ commit, lists, categories }));
console.log(`v2fly ${commit.slice(0, 7)}: ${Object.keys(lists).length} lists, ${Object.keys(categories).length} categories`);

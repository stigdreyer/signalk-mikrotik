# signalk-mikrotik

Signal K plugin and webapp **MikroTik Data Meter**: meters a boat's WAN data on a MikroTik router and, while
[signalk-internet](https://github.com/meri-imperiumi/signalk-internet) reports a metered connection, locks the router
down to an allowlist. Published to npm as `signalk-mikrotik`, which puts it in the Signal K Appstore. EUPL-1.2.

## Commands

```sh
npm test                                  # node:test, no dependencies; must pass before any commit
npm run build:v2fly -- /path/to/v2fly     # rebuild data/v2fly.json from a v2fly/domain-list-community checkout
npm pack                                  # the tarball users install; check `files` in package.json
```

## Layout

- `index.js`: the plugin. Config schema (every property has a default), start/stop, the retry when the router
  can't be reached, and the HTTP routes under `/plugins/signalk-mikrotik/` (`setup`, `setup/test`, `preflight`,
  `usage`, `catalog`, `allowlist`, `reset`, `remove`).
- `lib/routeros.js` (REST client), `lib/router.js` (preflight, install, profile switch, DNS/address-list sync),
  `lib/usage.js` (WAN byte counters per UTC day/hour), `lib/flows.js` (NetFlow v9 / IPFIX receiver),
  `lib/seen.js` (names from the router's DNS cache), `lib/catalog.js` (v2fly services), `lib/store.js`
  (JSON files written via a temp file), `lib/setup.js` (plain-language router errors, server addresses).
- `profiles/`: the always-allowed lists (base, Starlink). `data/v2fly.json`: compiled catalog, MIT (data/NOTICE).
- `public/`: the webapp, plain HTML/CSS/JS with no build step and nothing from a CDN. `mode.js` builds the shared
  header (brand, router badge, Auto/Night/Day, tabs), picks the start page and shows the not-set-up card.
  Pages: `index.html` (Data usage), `allowlist.html`, `setup.html`.
- `test/`: `fake-routeros.js` is an in-process RouterOS REST server; `flow-packets.js` builds IPFIX packets.
- `docs/`: router setup guide, real-router test checklist, Appstore screenshots. `brand/`: logo sources and exports.

## Rules that matter

- **The router is shared.** The plugin only creates, changes or removes RouterOS objects tagged with the comment
  `signalk-mikrotik` (address lists `skm-*`). Never touch anything else on the router. Router changes the user must
  make themselves go into the Setup script or `docs/router-setup.md`, never into code that runs unasked.
- **Never log or return the router password.** `GET /setup` returns `hasPassword`, not the password.
- **Works offline at sea:** no network calls except to the router; no CDN, fonts or external scripts in `public/`.
- **Night mode is a requirement:** red on black only (`:root[data-mode="night"]` tokens in `style.css`), states
  carried by shape (badges, dashed borders, hatching), never colour alone. Colours always come from the tokens.
- **Numbers must line up with the provider's:** GB = 10^9 bytes; Starlink's days are UTC.
- New logic gets a test against the fake router. The Signal K plugin registry runs `npm test` in a sandbox with no
  network and a read-only home: tests may only write to `os.tmpdir()` and talk to localhost.
- Design context for UI work: `PRODUCT.md` and `.impeccable/surfaces/`.
- Prose (docs, UI copy, commit messages): short plain sentences, the user's words, no marketing.

## Branches and releasing

`main` is protected: no direct or force pushes. Every change goes through a branch and a pull request, merged once
the Test checks (Node 20, 22, 24) and the SignalK Plugin CI (Linux, macOS, Windows) pass. Never commit to `main`
locally. The plugin registry scores the published package: it clones the source at the release commit (so
`repository` in package.json must be a full `github.com` URL) and deducts 10 points unless that commit has a passing
SignalK Plugin CI run.

```sh
git switch -c <topic> && git push -u origin <topic> && gh pr create --fill
```

To release:

1. In a pull request: move the `[Unreleased]` notes in `CHANGELOG.md` under the new version and date, update the
   compare links, and bump the version with `npm version <x.y.z> --no-git-tag-version` (package.json and
   package-lock.json). Merge it.
2. Tag the merged commit on `main` and push only the tag:
   `git switch main && git pull && git tag v<x.y.z> && git push origin v<x.y.z>`.
3. The `release` workflow checks the tag against package.json and the changelog, runs the tests, **stages** the
   version on npm with provenance (trusted publishing is stage-only) and creates the GitHub Release.
4. The maintainer approves the staged version on npmjs.com with 2FA (or `npm stage approve <stage-id>`); only then
   is it live. The Appstore picks it up from npm; the plugin registry rescores it within a day.

# Contributing

## Services

Services and categories come from
[v2fly/domain-list-community](https://github.com/v2fly/domain-list-community).
If a service is missing or incomplete, please fix it there: every router
project using that list benefits.

To update the compiled copy here, check out the v2fly commit you want and
rebuild:

```sh
git clone https://github.com/v2fly/domain-list-community /tmp/v2fly
npm run build:v2fly -- /tmp/v2fly
```

`profiles/base.json` and `profiles/starlink.json` are the fixed lists that are
always allowed.

## Finding an app's hosts

In normal mode, use the app on a device whose DNS goes through the router,
then look at what it resolved:

```routeros
/ip dns cache print where name~"example"
```

Then go metered, switch the service on in the Allowlist, and check that the
app works. If v2fly lacks one of its domains, please fix it there.

## Tests

```sh
npm test
```

`npm test` runs every test in `test/` on Node 20 or later, with no
dependencies: the router is `test/fake-routeros.js`. A PR has to pass them, and
new logic should come with a test.

## Trying a change on a boat

```sh
npm pack
```

Copy the tarball to the Signal K server, run
`npm install ./signalk-mikrotik-<version>.tgz` in its config directory
(usually `~/.signalk`), restart Signal K, and work through
[docs/testing.md](docs/testing.md).

## Pull requests

`main` only changes through pull requests, merged when the tests pass on Node 20, 22 and 24.

- Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for anything
  a user would notice.
- Bug reports: the router model, the RouterOS version and the plugin status line
  or Setup's connection test results.

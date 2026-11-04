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

Then go metered, tick your profile, and check that the app works.

## Tests

```sh
npm test
```

`test/profiles.test.js` checks the profile files. A PR has to pass it.

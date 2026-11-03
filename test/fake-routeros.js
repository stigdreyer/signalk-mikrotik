const http = require("node:http");

/**
 * In-memory stand-in for the RouterOS v7 REST API, covering only the verbs and
 * paths the plugin uses. Rows are stored with string values, like RouterOS.
 */
async function fakeRouter({ settings = {}, tables = {}, missing = [] } = {}) {
  let next = 1;
  const newId = () => `*${(next++).toString(16).toUpperCase()}`;
  const state = {
    settings: {
      "system/resource": { version: "7.16.1 (stable)" },
      "ip/dns": { "allow-remote-requests": "true", servers: "1.1.1.1,1.0.0.1", "address-list-extra-time": "1d" },
      "ipv6/settings": { "disable-ipv6": "false" },
      ...settings,
    },
    tables: {},
    requests: [],
  };
  for (const [path, rows] of Object.entries(tables)) {
    state.tables[path] = rows.map((r) => ({ ".id": newId(), disabled: "false", ...r }));
  }
  const table = (path) => (state.tables[path] ??= []);
  const normalise = (props) =>
    Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v === "yes" ? "true" : v === "no" ? "false" : String(v)]));

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (status, data) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(data === undefined ? "" : JSON.stringify(data));
      };
      const url = new URL(req.url, "http://router");
      let path = url.pathname.replace(/^\/rest\//, "");
      state.requests.push(`${req.method} ${path}`);
      if (missing.some((m) => path.startsWith(m))) return send(404, { detail: "no such command prefix" });
      const input = body ? JSON.parse(body) : {};

      if (req.method === "GET" && path in state.settings) return send(200, state.settings[path]);

      let id;
      const parts = path.split("/");
      if (parts.at(-1).startsWith("*")) id = parts.pop();
      let cmd;
      if (req.method === "POST") cmd = parts.pop();
      path = parts.join("/");
      const rows = table(path);

      if (req.method === "GET") {
        const filters = [...url.searchParams].filter(([k]) => k !== ".proplist");
        return send(200, rows.filter((r) => filters.every(([k, v]) => r[k] === v)));
      }
      if (req.method === "PUT") {
        const { "place-before": before, ...props } = input;
        const row = { ".id": newId(), disabled: "false", ...normalise(props) };
        const at = before ? rows.findIndex((r) => r[".id"] === before) : -1;
        if (at === -1) rows.push(row);
        else rows.splice(at, 0, row);
        return send(201, row);
      }
      const index = rows.findIndex((r) => r[".id"] === id);
      if (req.method === "PATCH") {
        if (index === -1) return send(404, { detail: "no such item" });
        Object.assign(rows[index], normalise(input));
        return send(200, rows[index]);
      }
      if (req.method === "DELETE") {
        if (index === -1) return send(404, { detail: "no such item" });
        if (rows[index].dynamic === "true") return send(400, { detail: "can not remove dynamic item" });
        rows.splice(index, 1);
        return send(204);
      }
      if (cmd === "remove") {
        const ids = input[".id"].split(",");
        state.tables[path] = rows.filter((r) => !ids.includes(r[".id"]));
        return send(200, []);
      }
      send(400, { detail: `unsupported ${req.method} ${req.url}` });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.url = `http://127.0.0.1:${server.address().port}`;
  state.close = () => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections(); // keep-alive sockets would hold close() open
  });
  return state;
}

/** A router with a typical default config: WAN list, fasttrack, DHCP pointing at itself. */
function defconf(overrides = {}) {
  return {
    ...overrides,
    tables: {
      "interface/list": [{ name: "WAN" }, { name: "LAN" }],
      "interface/list/member": [{ list: "WAN", interface: "ether1" }],
      "ip/address": [{ address: "192.168.88.1/24", interface: "bridge" }],
      "ip/dhcp-server/network": [{ address: "192.168.88.0/24", "dns-server": "192.168.88.1" }],
      "ip/firewall/filter": [
        { chain: "input", action: "accept", comment: "defconf: accept established" },
        { chain: "forward", action: "fasttrack-connection", comment: "defconf: fasttrack" },
        { chain: "forward", action: "accept", comment: "defconf: accept established" },
      ],
      "ip/firewall/nat": [{ chain: "srcnat", action: "masquerade", comment: "defconf: masquerade" }],
      "ipv6/firewall/filter": [{ chain: "forward", action: "accept", comment: "defconf: accept established" }],
      "ip/firewall/address-list": [{ list: "user-list", address: "10.0.0.1" }],
      "ip/firewall/connection": [{ "dst-address": "1.2.3.4:443" }, { "dst-address": "5.6.7.8:443" }],
      ...overrides.tables,
    },
  };
}

module.exports = { fakeRouter, defconf };

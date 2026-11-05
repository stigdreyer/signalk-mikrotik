const http = require("node:http");
const https = require("node:https");

/**
 * Minimal RouterOS v7 REST client. Built on node:https rather than fetch so a
 * router's self-signed certificate can be accepted per request.
 */
function createClient({ url, username, password, allowSelfSigned, timeoutMs = 10000 }) {
  const base = new URL("/rest/", url);
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const transport = base.protocol === "https:" ? https : http;
  // Reuse connections: a TLS handshake per call is slow on a small router, and a sync can make hundreds of calls.
  const agent = new transport.Agent({ keepAlive: true, maxSockets: 4, rejectUnauthorized: !allowSelfSigned });

  function request(method, path, body) {
    const target = new URL(path, base);
    const data = body === undefined ? undefined : JSON.stringify(body);
    const label = `RouterOS ${method} /rest/${path}`;
    return new Promise((resolve, reject) => {
      const req = transport.request(
        target,
        {
          method,
          headers: {
            authorization: auth,
            "content-type": "application/json",
            ...(data && { "content-length": Buffer.byteLength(data) }),
          },
          agent,
          rejectUnauthorized: !allowSelfSigned,
          timeout: timeoutMs,
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () => {
            let json = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              // non-JSON body, e.g. an HTML error page; keep the raw text for the message
            }
            if (res.statusCode >= 400) {
              const err = new Error(`${label}: ${res.statusCode} ${json?.detail || json?.message || text}`.trim());
              err.status = res.statusCode;
              return reject(err);
            }
            resolve(json);
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error(`${label}: timeout`)));
      req.on("error", (err) => reject(err.message.startsWith(label) ? err : new Error(`${label}: ${err.message}`)));
      if (data) req.write(data);
      req.end();
    });
  }

  return {
    get: (path, query) => request("GET", query ? `${path}?${new URLSearchParams(query)}` : path),
    add: (path, props) => request("PUT", path, props),
    set: (path, id, props) => request("PATCH", `${path}/${id}`, props),
    remove: (path, id) => request("DELETE", `${path}/${id}`),
    command: (path, cmd, props) => request("POST", `${path}/${cmd}`, props),
    close: () => agent.destroy(),
  };
}

module.exports = { createClient };

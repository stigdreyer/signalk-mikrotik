/**
 * Connection volumes from the router's Traffic Flow export (NetFlow v9 or
 * IPFIX over UDP). Only what the plugin needs: source and destination
 * address and the byte count of each flow record.
 */

const dgram = require("node:dgram");
const { isIP } = require("node:net");

// Information element ids, the same in NetFlow v9 and IPFIX.
const BYTES = 1;
const SRC4 = 8;
const DST4 = 12;
const SRC6 = 27;
const DST6 = 28;

const readUint = (buf, at, len) => {
  let n = 0;
  for (let i = 0; i < len; i++) n = n * 256 + buf[at + i];
  return n;
};
const ipv4 = (buf, at) => `${buf[at]}.${buf[at + 1]}.${buf[at + 2]}.${buf[at + 3]}`;
const ipv6 = (buf, at) => Array.from({ length: 8 }, (_, i) => buf.readUInt16BE(at + i * 2).toString(16)).join(":");

/** One spelling per address, so flow records and DNS answers match: IPv6 fully expanded, lower case. */
function canonical(ip) {
  if (isIP(ip) !== 6) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  return groups.map((g) => g.replace(/^0+(?=.)/, "")).join(":");
}

/**
 * Parse one export packet into flow records [{ src, dst, bytes }]. Templates
 * arrive in their own packets and are kept in `templates` between calls.
 * Data for a template not seen yet is dropped: the router resends templates
 * every few seconds.
 */
function parse(buf, templates) {
  const version = buf.readUInt16BE(0);
  if (version !== 9 && version !== 10) return [];
  const ipfix = version === 10;
  const domain = ipfix ? buf.readUInt32BE(12) : buf.readUInt32BE(16);
  const end = ipfix ? Math.min(buf.readUInt16BE(2), buf.length) : buf.length;
  const flows = [];
  for (let at = ipfix ? 16 : 20; at + 4 <= end; ) {
    const setId = buf.readUInt16BE(at);
    const setLen = buf.readUInt16BE(at + 2);
    if (setLen < 4 || at + setLen > end) break;
    const setEnd = at + setLen;
    if (setId === (ipfix ? 2 : 0)) {
      // Template set: template id, field count, then (id, length[, enterprise number]) per field.
      for (let p = at + 4; p + 4 <= setEnd; ) {
        const id = buf.readUInt16BE(p);
        const count = buf.readUInt16BE(p + 2);
        p += 4;
        const fields = [];
        for (let i = 0; i < count; i++) {
          const raw = buf.readUInt16BE(p);
          const enterprise = ipfix && raw & 0x8000;
          fields.push({ id: enterprise ? -1 : raw, len: buf.readUInt16BE(p + 2) });
          p += enterprise ? 8 : 4;
        }
        templates.set(`${domain}/${id}`, fields);
      }
    } else if (setId >= 256) {
      const fields = templates.get(`${domain}/${setId}`);
      if (fields) {
        for (let p = at + 4; p < setEnd; ) {
          const rec = {};
          const start = p;
          for (const { id, len } of fields) {
            let size = len;
            if (len === 65535) {
              // IPFIX variable length: one byte, or 255 then two bytes.
              size = buf[p];
              p += 1;
              if (size === 255) { size = buf.readUInt16BE(p); p += 2; }
            }
            if (p + size > setEnd) { p = setEnd; break; }
            if (id === BYTES) rec.bytes = readUint(buf, p, size);
            else if (id === SRC4 && size === 4) rec.src = ipv4(buf, p);
            else if (id === DST4 && size === 4) rec.dst = ipv4(buf, p);
            else if (id === SRC6 && size === 16) rec.src = ipv6(buf, p);
            else if (id === DST6 && size === 16) rec.dst = ipv6(buf, p);
            p += size;
          }
          if (p === start || p > setEnd) break; // zero-length template or padding
          if (rec.src && rec.dst && rec.bytes) flows.push(rec);
        }
      }
    }
    at = setEnd;
  }
  return flows;
}

/** Addresses that never leave the boat: private, CGNAT (Starlink's WAN side), link-local, loopback. */
function isLocal(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254);
  }
  return /^(fc|fd|fe8|fe9|fea|feb)/i.test(ip) || canonical(ip) === "0:0:0:0:0:0:0:1";
}

/** The internet side of a flow, or null for traffic that stays on board. */
function remoteOf({ src, dst }) {
  if (!isLocal(dst)) return dst;
  if (!isLocal(src)) return src;
  return null;
}

/** Listen for flow exports on `port`; calls onFlows(records) per packet. Returns a stop function. */
function listen(port, onFlows, onError) {
  const templates = new Map();
  const socket = dgram.createSocket({ type: "udp6", ipv6Only: false });
  socket.on("message", (msg) => {
    try {
      const flows = parse(msg, templates);
      if (flows.length) onFlows(flows);
    } catch (err) {
      onError(err);
    }
  });
  socket.on("error", onError);
  socket.bind(port, () => socket.unref()); // never the only thing keeping the process alive
  return () => socket.close();
}

module.exports = { parse, canonical, isLocal, remoteOf, listen };

/** Build NetFlow v9 / IPFIX export packets with one template: src, dst (IPv4), bytes (8). */
const FIELDS = [[8, 4], [12, 4], [1, 8]];

function packet(version, records, { template = true, templateId = 256 } = {}) {
  const sets = [];
  if (template) {
    const t = Buffer.alloc(4 + 4 + FIELDS.length * 4);
    t.writeUInt16BE(version === 10 ? 2 : 0, 0);
    t.writeUInt16BE(t.length, 2);
    t.writeUInt16BE(templateId, 4);
    t.writeUInt16BE(FIELDS.length, 6);
    FIELDS.forEach(([id, len], i) => { t.writeUInt16BE(id, 8 + i * 4); t.writeUInt16BE(len, 10 + i * 4); });
    sets.push(t);
  }
  if (records.length) {
    const d = Buffer.alloc(4 + records.length * 16);
    d.writeUInt16BE(templateId, 0);
    d.writeUInt16BE(d.length, 2);
    records.forEach(({ src, dst, bytes }, i) => {
      src.split(".").forEach((o, j) => (d[4 + i * 16 + j] = +o));
      dst.split(".").forEach((o, j) => (d[8 + i * 16 + j] = +o));
      d.writeBigUInt64BE(BigInt(bytes), 12 + i * 16);
    });
    sets.push(d);
  }
  const head = Buffer.alloc(version === 10 ? 16 : 20);
  head.writeUInt16BE(version, 0);
  const body = Buffer.concat(sets);
  if (version === 10) head.writeUInt16BE(head.length + body.length, 2);
  else head.writeUInt16BE(sets.length, 2);
  return Buffer.concat([head, body]);
}

module.exports = { packet };

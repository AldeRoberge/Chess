// Tiny WebSocket -> Art-Net bridge. Run: node bridge/dmx-bridge.mjs [artnet-ip] [ws-port]
// Browsers cannot send UDP, so the UI posts {universe, channels[]} here and we emit ArtDmx packets.
import dgram from "node:dgram";
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const target = process.argv[2] ?? "255.255.255.255";
const port = Number(process.argv[3] ?? 8787);
const udp = dgram.createSocket("udp4");
udp.bind(() => udp.setBroadcast(true));
let seq = 1;

function artDmx(universe, channels) {
  const len = Math.max(2, channels.length + (channels.length % 2));
  const buf = Buffer.alloc(18 + len);
  buf.write("Art-Net\0", 0, "latin1");
  buf.writeUInt16LE(0x5000, 8); // OpDmx
  buf.writeUInt16BE(14, 10); // protocol version
  buf[12] = seq = (seq % 255) + 1;
  buf.writeUInt16LE(universe, 14);
  buf.writeUInt16BE(len, 16);
  channels.forEach((v, i) => (buf[18 + i] = v & 255));
  return buf;
}

// minimal RFC6455 server (text frames only, no deps)
const server = createServer();
server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
    createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64") + "\r\n\r\n");
  socket.on("data", (d) => {
    const op = d[0] & 15; if (op !== 1) return;
    let len = d[1] & 127, off = 2;
    if (len === 126) { len = d.readUInt16BE(2); off = 4; } else if (len === 127) return;
    const mask = d.subarray(off, off + 4); off += 4;
    const payload = Buffer.from(d.subarray(off, off + len).map((b, i) => b ^ mask[i % 4]));
    try {
      const { universe = 0, channels = [] } = JSON.parse(payload.toString());
      udp.send(artDmx(universe, channels), 6454, target);
    } catch { /* ignore malformed */ }
  });
  socket.on("error", () => {});
});
server.listen(port, () => console.log(`dmx-bridge ws://127.0.0.1:${port} -> Art-Net ${target}:6454`));

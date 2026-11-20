import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

/**
 * Dev-server endpoint that keeps the labelled camera frames the running app sends it (see collect.ts):
 * `POST /__collect` -> ml/real/<time>-<camera>.gray (raw 8-bit pixels) and .json (position, corners, size).
 * Only this computer may post, only the fixed folder is written, and it stops at MAX files.
 * ml/real is git-ignored: these are pictures of the user's room.
 */
const MAX = 3000, DIR = "ml/real";

export function collectPlugin(dir = DIR): Plugin {
  return {
    name: "collect-training-frames",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__collect", (req: IncomingMessage, res: ServerResponse) => {
        const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "");
        if (req.method !== "POST" || !local) { res.statusCode = local ? 405 : 403; res.end(); return; }
        const chunks: Buffer[] = []; let size = 0;
        req.on("data", (c: Buffer) => { size += c.length; if (size > 1_500_000) req.destroy(); else chunks.push(c); });
        req.on("end", () => {
          try {
            const j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const cam = String(j.cam).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16) || "cam";
            const data = Buffer.from(String(j.data), "base64");
            if (!Number.isInteger(j.width) || !Number.isInteger(j.height) || data.length !== j.width * j.height || !/^[prnbqkPRNBQK1-8/]+$/.test(String(j.fen))) throw new Error("bad frame");
            mkdirSync(dir, { recursive: true });
            if (readdirSync(dir).length >= MAX * 2) { res.statusCode = 507; res.end(); return; }
            const name = `${dir}/${Date.now()}-${cam}`;
            writeFileSync(`${name}.gray`, data);
            writeFileSync(`${name}.json`, JSON.stringify({ cam, fen: j.fen, width: j.width, height: j.height, corners: j.corners }));
            res.statusCode = 204; res.end();
          } catch { res.statusCode = 400; res.end(); }
        });
      });
    },
  };
}

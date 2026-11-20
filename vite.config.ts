import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
const version: string = JSON.parse(readFileSync("package.json", "utf8")).version;
import { defineConfig } from "vitest/config";
import { remotePlugin } from "./src/remote/relay.ts";
import { collectPlugin } from "./src/vision/collectPlugin.ts";
// Full commit hash this build was made from ("" outside a git checkout). Shown on the setup page.
const commit = (() => { try { return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } })();
// Production lives at alderoberge.com/chess (see wrangler.jsonc); dev serves from /.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/chess/" : "/",
  // Listen on the network so a phone on the same Wi-Fi can open the remote page (the join code guards it; see src/remote/relay.ts).
  server: { host: true },
  plugins: [remotePlugin(), collectPlugin()],
  define: { __APP_VERSION__: JSON.stringify(version), __BUILD_TIME__: JSON.stringify(new Date().toISOString()), __BUILD_COMMIT__: JSON.stringify(commit) },
  build: { target: "es2022", chunkSizeWarningLimit: 900, outDir: "dist/chess", emptyOutDir: true },
  test: {
    // Coverage plus camera/image tests is memory-heavy; avoid flooding large-core hosts with workers.
    maxWorkers: 4,
    include: ["src/**/*.test.ts", "worker/**/*.test.ts"],
    environment: "jsdom",
    testTimeout: 240000,
    setupFiles: ["./src/test/setup.ts"],
    coverage: { provider: "v8", include: ["src/**/*.ts"], exclude: ["src/**/*.test.ts", "src/test/**", "src/vite-env.d.ts"], reporter: ["text-summary", "text"], thresholds: { lines: 85, functions: 75, branches: 69, statements: 79 } },
  },
}));

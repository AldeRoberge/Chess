import { defineConfig } from "vitest/config";
// Production lives at alderoberge.com/chess (see wrangler.jsonc); dev serves from /.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/chess/" : "/",
  build: { target: "es2022", chunkSizeWarningLimit: 900, outDir: "dist/chess", emptyOutDir: true },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "jsdom",
    testTimeout: 240000,
    setupFiles: ["./src/test/setup.ts"],
    coverage: { provider: "v8", include: ["src/**/*.ts"], exclude: ["src/**/*.test.ts", "src/test/**", "src/vite-env.d.ts"], reporter: ["text-summary", "text"], thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 } },
  },
}));

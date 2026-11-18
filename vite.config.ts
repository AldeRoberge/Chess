import { defineConfig } from "vitest/config";
export default defineConfig({
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "jsdom",
    testTimeout: 240000,
    setupFiles: ["./src/test/setup.ts"],
    coverage: { provider: "v8", include: ["src/**/*.ts"], exclude: ["src/**/*.test.ts", "src/test/**", "src/vite-env.d.ts"], reporter: ["text-summary", "text"], thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 } },
  },
});

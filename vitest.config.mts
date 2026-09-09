import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Node-only: this project's testable surface is the pipeline and the
    // validators, not React components.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

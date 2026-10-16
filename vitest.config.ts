import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts so tests don't load the live-preview plugin.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});

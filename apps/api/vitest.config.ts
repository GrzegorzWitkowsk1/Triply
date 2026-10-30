import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each integration file owns a MongoDB process; avoid CPU/RAM contention.
    maxWorkers: 4,
    globalSetup: ["./src/mongo.globalSetup.ts"],
  },
});

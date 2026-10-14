import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/health": process.env.TRIPLY_E2E_API_ORIGIN ?? "http://localhost:4000",
      "/api": process.env.TRIPLY_E2E_API_ORIGIN ?? "http://localhost:4000",
    },
  },
  test: {
    environment: "jsdom",
  },
});

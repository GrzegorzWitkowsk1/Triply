import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/health": "http://localhost:4000",
      "/api": "http://localhost:4000",
    },
  },
  test: {
    environment: "jsdom",
  },
});
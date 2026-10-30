import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(viteConfig, defineConfig({
  test: {
    // Keep MUI subpath imports on the same module graph as the bundles.
    server: { deps: { inline: [/^@mui\//, /^@emotion\//] } },
    deps: {
      optimizer: {
        client: {
          enabled: true,
          include: [
            "@mui/material", "@mui/material/styles", "@mui/material/locale",
            "@mui/icons-material", "@mui/icons-material/Flight", "@mui/icons-material/ChevronLeftOutlined",
          ],
        },
      },
    },
  },
}));

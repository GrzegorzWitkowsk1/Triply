import "dotenv/config";
import { startServer } from "./server.js";

void startServer().catch(() => {
  console.error("[api] failed to start");
  process.exitCode = 1;
});

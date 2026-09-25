import "dotenv/config";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectDb } from "./db.js";

async function start(): Promise<void> {
  try {
    await connectDb(env.MONGODB_URI);
    const app = createApp();

    app.listen(env.PORT, () => {
      console.log(`[api] listening on http://localhost:${env.PORT}`);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[api] failed to start: ${message}`);
    process.exitCode = 1;
  }
}

void start();

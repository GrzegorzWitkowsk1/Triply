import mongoose from "mongoose";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectDb } from "./db.js";

export async function startServer(options: { uri?: string; port?: number; host?: string } = {}) {
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let closing: Promise<void> | undefined;
  const shutdown = () => {
    void close().catch(() => { console.error("[api] shutdown failed"); process.exitCode = 1; });
  };
  function close(): Promise<void> {
    if (closing) return closing;
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    closing = (async () => {
      try { await app?.close(); }
      finally { await mongoose.disconnect(); }
    })();
    return closing;
  }
  try {
    await connectDb(options.uri ?? env.MONGODB_URI);
    await seedDestinations();
    app = await createApp();
    await app.listen({ port: options.port ?? env.PORT, host: options.host ?? "::" });
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    console.log(`[api] listening on ${app.listeningOrigin}`);
    return { app, close };
  } catch (error) {
    await close();
    throw error;
  }
}
import { seedDestinations } from "./seed/destinations.js";

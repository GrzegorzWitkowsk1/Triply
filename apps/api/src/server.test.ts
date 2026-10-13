import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { startServer } from "./server.js";

let mongod: MongoMemoryServer;
beforeAll(async () => { mongod = await MongoMemoryServer.create(); }, 120_000);
afterAll(async () => { await mongoose.disconnect(); await mongod?.stop(); });

describe("server lifecycle", () => {
  it("starts one listener and closes both HTTP and MongoDB idempotently", async () => {
    const before = { int: process.listenerCount("SIGINT"), term: process.listenerCount("SIGTERM") };
    const server = await startServer({ uri: mongod.getUri(), port: 0, host: "127.0.0.1" });
    try {
      expect(server.app.server.listening).toBe(true);
      expect(mongoose.connection.readyState).toBe(1);
      expect(process.listenerCount("SIGINT")).toBe(before.int + 1);
      expect(process.listenerCount("SIGTERM")).toBe(before.term + 1);
      const result = await fetch(server.app.listeningOrigin + "/health");
      expect(result.status).toBe(200);
      expect((await result.json()).db).toBe("connected");
    } finally { await Promise.all([server.close(), server.close()]); }
    expect(server.app.server.listening).toBe(false);
    expect(mongoose.connection.readyState).toBe(0);
    expect(process.listenerCount("SIGINT")).toBe(before.int);
    expect(process.listenerCount("SIGTERM")).toBe(before.term);
  });
  it("cleans up MongoDB and signal handlers when listen fails", async () => {
    const before = process.listenerCount("SIGTERM");
    await expect(startServer({ uri: mongod.getUri(), port: -1 })).rejects.toThrow();
    expect(mongoose.connection.readyState).toBe(0);
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });
});

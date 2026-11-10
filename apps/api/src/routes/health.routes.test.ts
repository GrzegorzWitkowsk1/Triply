import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { Signer } from "@fastify/cookie";
import { MongoMemoryReplSet, MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { env } from "../config/env.js";
import { READINESS_TIMEOUT_MS } from "../db.js";

let mongo: MongoMemoryReplSet;
let app: Awaited<ReturnType<typeof createApp>>;
const healthy = { status: "ok", db: "connected" };
const unavailable = { status: "unavailable", db: "disconnected" };
// A valid signature would normally force the session store to access MongoDB.
const cookie = `triply.sid=${encodeURIComponent(`s:${new Signer(env.SESSION_SECRET).sign("probe-session")}`)}`;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  app = await createApp();
}, 120_000);
afterEach(async () => {
  vi.restoreAllMocks();
  if (mongoose.connection.readyState !== 1) await mongoose.connect(mongo.getUri());
});
afterAll(async () => { await app?.close(); await mongoose.disconnect(); await mongo?.stop(); });

describe("dependency-aware health routes", () => {
  it("discovers the replica set and commits a real transaction without directConnection", async () => {
    const hello = await mongoose.connection.db!.command({ hello: 1 });
    expect(hello.setName).toBeTruthy();
    expect(hello.hosts).toContain(mongoose.connection.host + ":" + mongoose.connection.port);
    expect(mongoose.connection.getClient().options.directConnection).not.toBe(true);
    const collection = mongoose.connection.db!.collection("readiness_transaction_smoke");
    await collection.createIndex({ marker: 1 });
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await collection.insertOne({ marker: "committed" }, { session });
      });
      expect(await collection.countDocuments({ marker: "committed" })).toBe(1);
      expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
    } finally { await session.endSession(); }
  });

  it("checks a real primary, is deterministic, and bypasses session/conditional caching", async () => {
    const sessions = vi.spyOn(app.triplySessionStore, "get").mockRejectedValue(new Error("must not read session"));
    const result = await app.inject({ url: "/health", headers: { cookie, "if-none-match": "*" } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual(healthy);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers["set-cookie"]).toBeUndefined();
    expect(result.headers["x-content-type-options"]).toBe("nosniff");
    expect(sessions).not.toHaveBeenCalled();
    expect((await app.inject({ method: "HEAD", url: "/health" })).statusCode).toBe(200);
  });

  it("fails after a real disconnect, keeps liveness independent, and recovers without restarting the API", async () => {
    expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
    await mongoose.disconnect();
    const result = await app.inject({ url: "/health", headers: { cookie } });
    expect(result.statusCode).toBe(503);
    expect(result.json()).toEqual(unavailable);
    const live = await app.inject({ url: "/health/live", headers: { cookie } });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: "ok" });
    await mongoose.connect(mongo.getUri());
    expect((await app.inject({ url: "/health" })).json()).toEqual(healthy);
    expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
  });

  it.each([
    { ok: 1, isWritablePrimary: false, setName: "rs0", logicalSessionTimeoutMinutes: 30 },
    { ok: 1, isWritablePrimary: true, logicalSessionTimeoutMinutes: 30 },
    { ok: 1, isWritablePrimary: true, setName: "rs0" },
    { ok: 1, isWritablePrimary: true, setName: "rs0", logicalSessionTimeoutMinutes: 30, readOnly: true },
  ])("fails closed for unsuitable topology %j", async hello => {
    vi.spyOn(mongoose.connection.db!, "command").mockResolvedValue(hello);
    const result = await app.inject({ url: "/health" });
    expect(result.statusCode).toBe(503);
    expect(result.json()).toEqual(unavailable);
  });

  it("contains database errors and recovers on the very next probe", async () => {
    vi.spyOn(mongoose.connection.db!, "command").mockRejectedValueOnce(new Error("secret URI must not escape"));
    const result = await app.inject({ url: "/health" });
    expect(result.statusCode).toBe(503);
    expect(result.json()).toEqual(unavailable);
    expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
  });

  it("bounds a stuck command, coalesces probes, ignores late success, and then recovers", async () => {
    let release!: (value: Record<string, unknown>) => void;
    const command = vi.spyOn(mongoose.connection.db!, "command").mockImplementationOnce(() =>
      new Promise(resolve => { release = resolve; }));
    const started = performance.now();
    const results = await Promise.all(Array.from({ length: 8 }, () => app.inject({ url: "/health", headers: { cookie } })));
    expect(performance.now() - started).toBeLessThan(READINESS_TIMEOUT_MS + 750);
    for (const result of results) {
      expect(result.statusCode).toBe(503);
      expect(result.json()).toEqual(unavailable);
    }
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0][1]).toMatchObject({ readPreference: "primary", timeoutMS: 900 });
    expect(command.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect((await app.inject({ url: "/health/live", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/health" })).statusCode).toBe(503);
    expect(command).toHaveBeenCalledTimes(1);
    release({ ok: 1, isWritablePrimary: true, setName: "rs0", logicalSessionTimeoutMinutes: 30 });
    await new Promise(resolve => setImmediate(resolve));
    expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
  });

  it("rejects a real standalone even though it answers commands", async () => {
    const standalone = await MongoMemoryServer.create();
    try {
      await mongoose.disconnect();
      await mongoose.connect(standalone.getUri());
      expect((await mongoose.connection.db!.command({ ping: 1 })).ok).toBe(1);
      expect((await app.inject({ url: "/health" })).statusCode).toBe(503);
    } finally { await mongoose.disconnect(); await standalone.stop(); }
  });

  it("does not advertise readiness when shutdown begins during an active check", async () => {
    const isolated = await createApp();
    let release!: (value: Record<string, unknown>) => void;
    let entered!: () => void;
    const checking = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(mongoose.connection.db!, "command").mockImplementationOnce(() => {
      entered();
      return new Promise(resolve => { release = resolve; });
    });
    const response = isolated.inject({ url: "/health" });
    void response.then(() => {});
    await checking;
    const closed = isolated.close();
    await new Promise(resolve => setImmediate(resolve));
    release({ ok: 1, isWritablePrimary: true, setName: "rs0", logicalSessionTimeoutMinutes: 30 });
    expect((await response).statusCode).toBe(503);
    await closed;
  });
});

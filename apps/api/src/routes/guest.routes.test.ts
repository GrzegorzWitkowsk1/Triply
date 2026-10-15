import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { env } from "../config/env.js";
import { UserModel } from "../models/User.js";
import { sessionCookieOptions } from "../config/session.js";

let mongod: MongoMemoryServer;
let app: Awaited<ReturnType<typeof createApp>>;
const origin = env.WEB_ORIGIN;
const sessions = () => mongoose.connection.db!.collection<{ _id: string; session: string; expires: Date }>("sessions");
let address = 0;
async function guest(cookie?: string) {
  return app.inject({ method: "POST", url: "/api/auth/guest", remoteAddress: `192.0.2.${++address}`,
    headers: { origin, ...(cookie ? { cookie } : {}) } });
}
const cookieOf = (response: { headers: Record<string, unknown> }) => String(response.headers["set-cookie"]).split(";")[0];
const identity = (cookie?: string) => app.inject({ url: "/api/auth/session?identity=1", headers: cookie ? { cookie } : {} });
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = await createApp();
}, 120_000);
afterAll(async () => { await app?.close(); await mongoose.disconnect(); await mongod?.stop(); });

describe("guest sessions", () => {
  it("returns anonymous without creating records or cookies, including public sharing", async () => {
    expect((await identity()).json()).toEqual({ status: "anonymous" });
    expect((await identity()).headers["set-cookie"]).toBeUndefined();
    await app.inject({ url: "/api/public/trips/invalid" });
    expect(await sessions().countDocuments()).toBe(0);
    expect(await UserModel.countDocuments()).toBe(0);
  });
  it("creates a secure persistent guest identity without a user or raw secret in MongoDB", async () => {
    const response = await guest();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "guest", guest: { id: expect.any(String), expiresAt: expect.any(String) } });
    const cookie = String(response.headers["set-cookie"]);
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/"); expect(cookie).toContain("Expires=");
    expect(sessionCookieOptions.secure).toBe(env.NODE_ENV === "production");
    const record = await sessions().findOne({ _id: /^guest:/ });
    expect(record?._id).toMatch(/^guest:[a-f0-9]{64}$/);
    const secret = decodeURIComponent(cookieOf(response).split("=")[1]).slice(2).split(".")[0];
    expect(JSON.stringify(record)).not.toContain(secret);
    expect(response.body).not.toContain(secret);
    expect(await UserModel.countDocuments()).toBe(0);
    const indexes = await sessions().indexes();
    expect(indexes.some(index => index.expireAfterSeconds === 0 && index.key.expires === 1)).toBe(true);
  });
  it("reuses and restores the same identity across requests and app instances", async () => {
    const created = await guest(); const cookie = cookieOf(created);
    const reused = await guest(cookie);
    expect(reused.json().guest.id).toBe(created.json().guest.id);
    expect((await identity(cookie)).json().guest.id).toBe(created.json().guest.id);
    const second = await createApp();
    try { expect((await second.inject({ url: "/api/auth/session?identity=1", headers: { cookie } })).json().guest.id).toBe(created.json().guest.id); }
    finally { await second.close(); }
  });
  it("emits Secure cookies over trusted HTTPS and suppresses them over HTTP", async () => {
    const response = await guest();
    const cookie = cookieOf(response);
    const record = (await sessions().find({}).toArray()).find(record =>
      JSON.parse(record.session).guest?.id === response.json().guest.id)!;
    const data = JSON.parse(record.session);
    data.cookie.secure = true;
    await sessions().updateOne({ _id: record._id }, { $set: { session: JSON.stringify(data) } });
    const previous = env.TRUST_PROXY;
    try {
      env.TRUST_PROXY = true;
      const https = await app.inject({ url: "/api/auth/session?identity=1", headers: { cookie, "x-forwarded-proto": "https" } });
      expect(String(https.headers["set-cookie"])).toContain("Secure");
      expect((await identity(cookie)).headers["set-cookie"]).toBeUndefined();
    } finally { env.TRUST_PROXY = previous; }
  });
  it("rejects invalid and expired secrets and creates a fresh identity after expiry", async () => {
    const created = await guest(); const cookie = cookieOf(created);
    expect((await identity(cookie + "invalid")).json()).toEqual({ status: "anonymous", reason: "GUEST_SESSION_EXPIRED" });
    await sessions().updateMany({}, { $set: { expires: new Date(0) } });
    expect((await identity(cookie)).json()).toEqual({ status: "anonymous", reason: "GUEST_SESSION_EXPIRED" });
    expect((await guest(cookie)).json().guest.id).not.toBe(created.json().guest.id);
  });
  it("ends and revokes only the presented guest session", async () => {
    const one = cookieOf(await guest()); const two = cookieOf(await guest());
    const ended = await app.inject({ method: "POST", url: "/api/auth/guest/end", headers: { origin, cookie: one } });
    expect(ended.statusCode).toBe(204);
    expect(String(ended.headers["set-cookie"])).toContain("Expires=Thu, 01 Jan 1970");
    expect((await identity(one)).json()).toEqual({ status: "anonymous", reason: "GUEST_SESSION_EXPIRED" });
    expect((await identity(two)).json().status).toBe("guest");
  });
  it("keeps account and assistant endpoints user-only while allowing owned trip access", async () => {
    const cookie = cookieOf(await guest());
    for (const url of ["/api/profile", "/api/trips/507f1f77bcf86cd799439011/assistant/conversations"]) {
      expect((await app.inject({ url, headers: { cookie } })).statusCode).toBe(401);
    }
    expect((await app.inject({ url: "/api/trips", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/trips/507f1f77bcf86cd799439011", headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/trips/analyze", headers: { origin, cookie }, payload: {} })).statusCode).toBe(400);
  });
  it.each([undefined, "https://evil.example"])("rejects guest writes with origin %s", async value => {
    for (const url of ["/api/auth/guest", "/api/auth/guest/end"]) {
      expect((await app.inject({ method: "POST", url, headers: value ? { origin: value } : {} })).statusCode).toBe(403);
    }
  });
  it("rate limits creation server-side", async () => {
    const isolated = await createApp();
    try {
      for (let i = 0; i < 10; i++) expect((await isolated.inject({ method: "POST", url: "/api/auth/guest", headers: { origin } })).statusCode).toBe(200);
      expect((await isolated.inject({ method: "POST", url: "/api/auth/guest", headers: { origin } })).statusCode).toBe(429);
    } finally { await isolated.close(); }
  });
  it("rotates guest sessions on register and login, and guest/end preserves authenticated sessions", async () => {
    const guestCookie = cookieOf(await guest());
    const credentials = { email: "guest-upgrade@example.com", password: "Password123!Aa" };
    const registered = await app.inject({ method: "POST", url: "/api/auth/register", headers: { origin, cookie: guestCookie }, payload: credentials });
    expect(registered.statusCode).toBe(201);
    const userCookie = cookieOf(registered);
    expect(userCookie).not.toBe(guestCookie);
    expect((await identity(guestCookie)).json().status).toBe("anonymous");
    expect((await identity(userCookie)).json()).toEqual({ status: "authenticated", user: registered.json().user });
    expect((await guest(userCookie)).json().status).toBe("authenticated");
    const end = await app.inject({ method: "POST", url: "/api/auth/guest/end", headers: { origin, cookie: userCookie } });
    expect(end.statusCode).toBe(204);
    expect((await identity(userCookie)).json().status).toBe("authenticated");
    const secondGuest = cookieOf(await guest());
    const loggedIn = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin, cookie: secondGuest }, payload: credentials });
    expect(loggedIn.statusCode).toBe(200);
    expect((await identity(secondGuest)).json().status).toBe("anonymous");
    expect((await identity(cookieOf(loggedIn))).json().status).toBe("authenticated");
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createHmac, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import iconv from "iconv-lite";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { UserModel } from "./models/User.js";

let mongod: MongoMemoryServer;
let app: Awaited<ReturnType<typeof createApp>>;
const origin = env.WEB_ORIGIN;
const credentials = { email: "contract@example.com", password: "Password123!Aa" };
const sessions = () => mongoose.connection.getClient().db().collection<{ _id: string; session: string; expires: Date; lastModified?: Date }>("sessions");

  async function legacySession() {
    const user = await UserModel.create({ email: credentials.email, passwordHash: "unused" });
    const id = "persisted-session-for-migration";
    const expires = new Date(Date.now() + 7 * 86400000);
    await sessions().insertOne({ _id: id, session: JSON.stringify({ userId: user.id,
      cookie: { originalMaxAge: 7 * 86400000, expires, secure: false, httpOnly: true, path: "/", sameSite: "lax" } }), expires, lastModified: new Date() });
    const signature = createHmac("sha256", env.SESSION_SECRET).update(id).digest("base64").replace(/=+$/, "");
    return { user, id, cookie: `triply.sid=${encodeURIComponent(`s:${id}.${signature}`)}` };
  }

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = await createApp();
}, 120_000);
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  await sessions().deleteMany({});
});
afterAll(async () => { await app?.close(); await mongoose.disconnect(); await mongod?.stop(); });

describe("HTTP framework compatibility", () => {
  it("preserves authentication and security headers for malformed URL parameters", async () => {
    const url = "/api/trips/%E0%A4%A";
    const anonymous = await app.inject({ url });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ error: "Authentication required" });
    expect(anonymous.headers["x-content-type-options"]).toBe("nosniff");
    expect(anonymous.headers["access-control-allow-origin"]).toBe(origin);
    const { cookie } = await legacySession();
    const authenticated = await app.inject({ url, headers: { cookie } });
    expect(authenticated.statusCode).toBe(400);
    expect(authenticated.json()).toEqual({ error: "Invalid request body" });
    expect(authenticated.headers["set-cookie"]).toBeDefined();
    const unknownTrip = await app.inject({ url: url + "/unknown", headers: { cookie } });
    expect(unknownTrip.statusCode).toBe(400);
    const unknown = await app.inject({ url: "/unknown/%E0%A4%A" });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.body).toContain("Cannot GET /unknown/%E0%A4%A");
  });
  it("preserves strict JSON errors for whitespace and long primitive payloads", async () => {
    const cases = [
      ["   ", "Unexpected end of JSON input"],
      ["true" + "x".repeat(100), `Unexpected token 't', "truexxxxxx"... is not valid JSON`],
      ['"' + "x".repeat(100) + '"', `Unexpected token '\"', "\"xxxxxxxxx"... is not valid JSON`],
    ];
    for (const [payload, message] of cases) {
      const response = await app.inject({ method: "POST", url: "/api/trips/analyze",
        headers: { origin, "content-type": "application/json" }, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: message });
    }
  });
  it("preserves health and security headers without creating an anonymous session", async () => {
    const result = await request(app.server).get("/health");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: "ok", db: "connected", uptime: expect.any(Number), timestamp: expect.any(String), version: "0.1.0" });
    expect(result.headers["x-content-type-options"]).toBe("nosniff");
    expect(result.headers["x-powered-by"]).toBeUndefined();
    expect(result.headers["set-cookie"]).toBeUndefined();
    expect(await sessions().countDocuments()).toBe(0);
  });
  it("handles credentialed CORS preflight before authentication and parsing", async () => {
    const result = await request(app.server).options("/api/trips/analyze").set("Origin", origin)
      .set("Access-Control-Request-Method", "POST").set("Access-Control-Request-Headers", "Content-Type");
    expect(result.status).toBe(204);
    expect(result.text).toBe("");
    expect(result.headers["access-control-allow-origin"]).toBe(origin);
    expect(result.headers["access-control-allow-credentials"]).toBe("true");
    expect(result.headers["access-control-allow-methods"]).toBe("GET,HEAD,PUT,PATCH,POST,DELETE");
    expect(result.headers["access-control-allow-headers"]).toBe("Content-Type");
    expect(result.headers["set-cookie"]).toBeUndefined();
    expect(result.headers.vary).toContain("Origin");
  });
  it("retains the configured CORS origin even for other request origins", async () => {
    const result = await request(app.server).get("/health").set("Origin", "https://untrusted.example");
    expect(result.headers["access-control-allow-origin"]).toBe(origin);
  });
  it.each([undefined, "https://untrusted.example"])("rejects writes from origin %s before JSON parsing", async (value) => {
    const req = request(app.server).post("/api/auth/login").set("Content-Type", "application/json").send("{");
    if (value) req.set("Origin", value);
    const result = await req;
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: "Request origin is not allowed" });
  });
  it("returns the existing malformed JSON response before authentication", async () => {
    const result = await request(app.server).post("/api/trips/analyze").set("Origin", origin)
      .set("Content-Type", "application/json").send("{");
    expect(result.status).toBe(400);
    expect(result.body.error).toContain("JSON");
    expect(Object.keys(result.body)).toEqual(["error"]);
  });
  it("rejects primitive JSON bodies", async () => {
    const result = await request(app.server).post("/api/auth/login").set("Origin", origin)
      .set("Content-Type", "application/json").send("true");
    expect(result.status).toBe(400);
    expect(Object.keys(result.body)).toEqual(["error"]);
  });
  it("preserves the 100 KiB JSON body limit", async () => {
    const result = await request(app.server).post("/api/auth/login").set("Origin", origin).send({ value: "x".repeat(102401) });
    expect(result.status).toBe(413);
    expect(result.body).toEqual({ error: "request entity too large" });
  });
  it.each(["text/plain", "application/x-www-form-urlencoded", "application/vnd.triply+json"])("does not parse %s as JSON", async (type) => {
    const result = await request(app.server).post("/api/auth/login").set("Origin", origin)
      .set("Content-Type", type).send(JSON.stringify(credentials));
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "Enter a valid email and password." });
  });
  it("protects existing and unknown API endpoints", async () => {
    for (const path of ["/api/trips", "/api/location/search", "/api/unknown", "/api/auth/unknown"]) {
      const result = await request(app.server).get(path);
      expect(result.status).toBe(401);
      expect(result.body).toEqual({ error: "Authentication required" });
    }
  });
  it("preserves the public HTML 404 response", async () => {
    const result = await request(app.server).get("/missing?secret=value");
    expect(result.status).toBe(404);
    expect(result.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(result.headers["content-security-policy"]).toBe("default-src 'none'");
    expect(result.text).toBe('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot GET /missing</pre>\n</body>\n</html>\n');
  });
  it("preserves session cookies, cross-request persistence, rotation, and logout", async () => {
    const registered = await request(app.server).post("/api/auth/register").set("Origin", origin).send(credentials);
    expect(registered.status).toBe(201);
    expect(registered.body.user).toEqual({ id: expect.any(String), email: credentials.email });
    const cookie = String(registered.headers["set-cookie"][0]);
    expect(cookie).toMatch(/^triply\.sid=s%3A/);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Expires=");
    expect(cookie).not.toContain("Secure");
    const header = cookie.split(";")[0];
    const session = await request(app.server).get("/api/auth/session").set("Cookie", header);
    expect(session.status).toBe(200);
    expect(session.body).toEqual(registered.body);
    expect(session.headers["cache-control"]).toBe("no-store");
    expect(session.headers["set-cookie"]).toBeDefined();
    expect((await request(app.server).get("/api/trips").set("Cookie", header)).body).toEqual([]);
    const loggedIn = await request(app.server).post("/api/auth/login").set("Origin", origin).set("Cookie", header).send(credentials);
    expect(loggedIn.status).toBe(200);
    const newCookie = String(loggedIn.headers["set-cookie"][0]).split(";")[0];
    expect(newCookie).not.toBe(header);
    expect((await request(app.server).get("/api/auth/session").set("Cookie", header)).status).toBe(401);
    const logout = await request(app.server).post("/api/auth/logout").set("Origin", origin).set("Cookie", newCookie);
    expect(logout.status).toBe(204);
    expect(logout.text).toBe("");
    expect(logout.headers["set-cookie"][0]).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    expect((await request(app.server).get("/api/auth/session").set("Cookie", newCookie)).status).toBe(401);
  });
  it("accepts existing signed cookies and connect-mongo session records", async () => {
    const user = await UserModel.create({ email: credentials.email, passwordHash: "unused" });
    const id = "legacy-express-session-id-123456";
    const expires = new Date(Date.now() + 7 * 86400000);
    await sessions().insertOne({ _id: id, session: JSON.stringify({ cookie: { originalMaxAge: 7 * 86400000, expires, secure: false, httpOnly: true, path: "/", sameSite: "lax" }, userId: user.id }), expires, lastModified: new Date() });
    const signature = createHmac("sha256", env.SESSION_SECRET).update(id).digest("base64").replace(/=+$/, "");
    const cookie = `triply.sid=${encodeURIComponent(`s:${id}.${signature}`)}`;
    const result = await request(app.server).get("/api/auth/session").set("Cookie", cookie);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ user: { id: user.id, email: credentials.email } });
    expect(result.headers["set-cookie"][0].split(";")[0]).toBe(cookie);
    const record = await sessions().findOne({ _id: id });
    expect(typeof record?.session).toBe("string");
  });
  it("returns compatible async errors without exposing internal details", async () => {
    vi.spyOn(UserModel, "findOne").mockImplementationOnce(() => { throw new Error("private internal detail"); });
    const result = await request(app.server).post("/api/auth/login").set("Origin", origin).send(credentials);
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "Internal server error" });
  });
  it("preserves auth validation and invalid credential responses", async () => {
    const invalid = await request(app.server).post("/api/auth/register").set("Origin", origin).send({ email: "bad", password: "short" });
    expect(invalid.status).toBe(400);
    const login = await request(app.server).post("/api/auth/login").set("Origin", origin).send(credentials);
    expect(login.status).toBe(401);
    expect(login.body).toEqual({ error: "Invalid email or password." });
  });
});

describe("Fastify migration regressions", () => {
  it("retains raw, case-insensitive expense item matching and malformed item fallthrough", async () => {
    const { cookie } = await legacySession();
    const itemUrl = "/api/trips/example/EXPENSES/00000000-0000-0000-0000-000000000000";
    const item = await app.inject({ method: "PATCH", url: itemUrl, headers: { origin, cookie }, payload: {} });
    expect(item.statusCode).toBe(400);
    expect(item.headers["content-type"]).toContain("application/json");
    const malformed = await app.inject({ method: "PATCH", url: "/api/trips/example/expenses/%E0%A4%A", headers: { origin, cookie }, payload: {} });
    expect(malformed.statusCode).toBe(404);
    expect(malformed.body).toContain("Cannot PATCH /api/trips/example/expenses/%E0%A4%A");
  });
  it("preserves Unicode JSON decoding and charset validation before decompression", async () => {
    const { cookie } = await legacySession();
    for (const charset of ["utf-16", "utf-32", "utf-7"]) {
      const result = await app.inject({ method: "POST", url: "/api/trips/analyze",
        headers: { origin, cookie, "content-type": `application/json; charset=${charset}` },
        payload: iconv.encode('{}', charset) });
      expect(result.statusCode, charset).toBe(400);
      expect(result.json()).toEqual({ error: "Describe your trip or pick at least one interest to get started." });
    }
    const invalid = await app.inject({ method: "POST", url: "/api/trips/analyze",
      headers: { origin, "content-type": "application/json; charset=iso-8859-1", "content-encoding": "gzip" }, payload: "invalid gzip" });
    expect(invalid.statusCode).toBe(415);
    expect(invalid.json()).toEqual({ error: 'unsupported charset "ISO-8859-1"' });
  });
  it("creates a ready application without opening a port and supports inject", async () => {
    const isolated = await createApp();
    try {
      expect(isolated.server.listening).toBe(false);
      const result = await isolated.inject({ method: "GET", url: "/health" });
      expect(result.statusCode).toBe(200);
      expect(result.json().db).toBe("connected");
      expect(isolated.server.listening).toBe(false);
    } finally { await isolated.close(); }
  });
  it("retains existing sessions across application instances", async () => {
    const { cookie } = await legacySession();
    const isolated = await createApp();
    try {
      expect((await app.inject({ url: "/api/auth/session", headers: { cookie } })).statusCode).toBe(200);
      expect((await isolated.inject({ url: "/api/auth/session", headers: { cookie } })).statusCode).toBe(200);
    } finally { await isolated.close(); }
  });
  it("renews cookie expiry and only touches unchanged Mongo sessions after 24 hours", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { cookie, id } = await legacySession();
    const before = await sessions().findOne({ _id: id });
    vi.setSystemTime(Date.now() + 3600000);
    const early = await app.inject({ url: "/api/auth/session", headers: { cookie } });
    expect(early.statusCode).toBe(200);
    expect(early.headers["set-cookie"]).toContain(`Expires=${new Date(Date.now() + 7 * 86400000).toUTCString()}`);
    expect((await sessions().findOne({ _id: id }))?.lastModified).toEqual(before?.lastModified);
    vi.setSystemTime(Date.now() + 86400000);
    expect((await app.inject({ url: "/api/auth/session", headers: { cookie } })).statusCode).toBe(200);
    const after = await sessions().findOne({ _id: id });
    expect(after?.expires).toEqual(new Date(Date.now() + 7 * 86400000));
    // connect-mongo.touch updated expiry metadata, not the serialized session.
    expect(after?.session).toBe(before?.session);
  });
  it("uses Mongo expiry even when the serialized cookie expiry predates a lazy touch", async () => {
    const { cookie, id } = await legacySession();
    const record = await sessions().findOne({ _id: id });
    const data = JSON.parse(record!.session);
    data.cookie.expires = new Date(Date.now() - 86400000).toISOString();
    await sessions().updateOne({ _id: id }, { $set: { session: JSON.stringify(data) } });
    expect((await app.inject({ url: "/api/auth/session", headers: { cookie } })).statusCode).toBe(200);
  });
  it("rejects expired, tampered, and deleted-user sessions", async () => {
    const { user, cookie, id } = await legacySession();
    expect((await app.inject({ url: "/api/auth/session", headers: { cookie: cookie + "invalid" } })).statusCode).toBe(401);
    await sessions().updateOne({ _id: id }, { $set: { expires: new Date(0) } });
    expect((await app.inject({ url: "/api/auth/session", headers: { cookie } })).statusCode).toBe(401);
    await sessions().updateOne({ _id: id }, { $set: { expires: new Date(Date.now() + 86400000) } });
    await UserModel.deleteOne({ _id: user._id });
    expect((await app.inject({ url: "/api/auth/session", headers: { cookie } })).statusCode).toBe(401);
    expect(await sessions().findOne({ _id: id })).toBeNull();
  });
  it("does not load sessions before malformed JSON is rejected", async () => {
    const get = vi.spyOn(app.triplySessionStore, "get");
    const result = await app.inject({ method: "POST", url: "/api/trips/analyze",
      headers: { origin, cookie: "triply.sid=s%3Ainvalid.signature", "content-type": "application/json" }, payload: "{" });
    expect(result.statusCode).toBe(400);
    expect(get).not.toHaveBeenCalled();
  });
  it("preserves gzip JSON parsing and the decompressed size limit", async () => {
    const result = await app.inject({ method: "POST", url: "/api/auth/login", headers: {
      origin, "content-type": "application/json", "content-encoding": "gzip",
    }, payload: gzipSync(JSON.stringify(credentials)) });
    expect(result.statusCode).toBe(401);
    expect(result.json()).toEqual({ error: "Invalid email or password." });
    const oversized = await app.inject({ method: "POST", url: "/api/auth/login", headers: {
      origin, "content-type": "application/json", "content-encoding": "gzip",
    }, payload: gzipSync(JSON.stringify({ value: "x".repeat(102401) })) });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json()).toEqual({ error: "request entity too large" });
    const invalid = await app.inject({ method: "POST", url: "/api/auth/login", headers: {
      origin, "content-type": "application/json", "content-encoding": "gzip",
    }, payload: Buffer.from("invalid compressed data") });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: "incorrect header check" });
  });
  it("parses JSON on GET and rejects unsupported JSON charset and encoding", async () => {
    const get = await app.inject({ method: "GET", url: "/health", headers: { "content-type": "application/json" }, payload: "{" });
    expect(get.statusCode).toBe(400);
    const charset = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin, "content-type": "application/json; charset=iso-8859-1" }, payload: "{}" });
    expect(charset.statusCode).toBe(415);
    expect(charset.json()).toEqual({ error: 'unsupported charset "ISO-8859-1"' });
    const encoding = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin, "content-type": "application/json", "content-encoding": "unknown" }, payload: "{}" });
    expect(encoding.statusCode).toBe(415);
    expect(encoding.json()).toEqual({ error: 'unsupported content encoding "unknown"' });
  });
  it("keeps the shared authentication limit and draft-8 response headers", async () => {
    const isolated = await createApp();
    try {
      for (let i = 0; i < 10; i++) {
        const response = await isolated.inject({ method: "POST", url: i % 2 ? "/api/auth/register" : "/api/auth/login", headers: { origin }, payload: {} });
        expect(response.statusCode).toBe(400);
        expect(response.headers.ratelimit).toMatch(new RegExp(`^"10-in-15min"; r=${9 - i}; t=\\d+$`));
        expect(response.headers["ratelimit-policy"]).toMatch(/^"10-in-15min"; q=10; w=900; pk=:[A-Za-z0-9+/=]+:$/);
        expect(response.headers["x-ratelimit-limit"]).toBeUndefined();
      }
      const denied = await isolated.inject({ method: "POST", url: "/api/auth/login", headers: { origin }, payload: {} });
      expect(denied.statusCode).toBe(429);
      expect(denied.json()).toEqual({ error: "Too many authentication attempts. Try again later." });
      expect(Number(denied.headers["retry-after"])).toBeGreaterThan(0);
    } finally { await isolated.close(); }
  });
  it("shares planning limits across routes per user, without charging unauthenticated calls", async () => {
    const { cookie } = await legacySession();
    const isolated = await createApp();
    try {
      for (let i = 0; i < 22; i++) expect((await isolated.inject({ method: "POST", url: "/api/trips/analyze", headers: { origin }, payload: {} })).statusCode).toBe(401);
      for (let i = 0; i < 20; i++) {
        const response = await isolated.inject({ method: "POST", url: i % 2 ? "/api/trips/analyze" : "/api/trips/invalid/itinerary/candidates", headers: { origin, cookie }, payload: { search: 7 } });
        expect(response.statusCode).toBe(400);
      }
      const denied = await isolated.inject({ method: "POST", url: "/api/trips/invalid/assistant/messages", headers: { origin, cookie }, payload: {} });
      expect(denied.statusCode).toBe(429);
      expect(denied.json()).toEqual({ error: "Too many planning requests. Wait a few minutes and try again." });
    } finally { await isolated.close(); }
  });
  it("retains ordinary trailing slashes, case-insensitive routes, and implicit HEAD", async () => {
    const { cookie } = await legacySession();
    expect((await app.inject({ url: "/API/TRIPS/", headers: { cookie } })).json()).toEqual([]);
    const head = await app.inject({ method: "HEAD", url: "/health/" });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");
    const unknown = await app.inject({ url: "/api/auth/unknown", headers: { cookie } });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.body).toContain("Cannot GET /api/auth/unknown");
    expect((await app.inject({ url: "/api/trips/invalid/expenses/", headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "HEAD", url: "/api/trips/invalid/budget", headers: { cookie } })).statusCode).toBe(404);
  });
  it("preserves weak JSON ETags and conditional GET without dropping the rolling cookie", async () => {
    const { cookie } = await legacySession();
    const first = await app.inject({ url: "/api/trips", headers: { cookie } });
    const expectedTag = `W/"2-${createHash("sha1").update("[]").digest("base64").slice(0, 27)}"`;
    expect(first.headers.etag).toBe(expectedTag);
    const cached = await app.inject({ url: "/api/trips", headers: { cookie, "if-none-match": expectedTag } });
    expect(cached.statusCode).toBe(304);
    expect(cached.body).toBe("");
    expect(cached.headers["set-cookie"]).toBeDefined();
    expect(cached.headers["content-type"]).toBeUndefined();
    const fresh = await app.inject({ url: "/api/trips", headers: { cookie, "if-none-match": expectedTag, "cache-control": "no-cache" } });
    expect(fresh.statusCode).toBe(200);
  });
  it("retains IPv6 /56 grouping and ignores forwarded IPs without trusted proxy", async () => {
    const isolated = await createApp();
    try {
      for (let i = 0; i < 10; i++) {
        expect((await isolated.inject({ method: "POST", url: "/api/auth/login", remoteAddress: `2001:db8:1234:5600::${i + 1}`,
          headers: { origin, "x-forwarded-for": `198.51.100.${i + 1}` }, payload: {} })).statusCode).toBe(400);
      }
      expect((await isolated.inject({ method: "POST", url: "/api/auth/login", remoteAddress: "2001:db8:1234:56ff::1",
        headers: { origin }, payload: {} })).statusCode).toBe(429);
      expect((await isolated.inject({ method: "POST", url: "/api/auth/login", remoteAddress: "2001:db8:1234:5700::1",
        headers: { origin }, payload: {} })).statusCode).toBe(400);
    } finally { await isolated.close(); }
  });
  it("registers every audited endpoint and protects all nonpublic routes", async () => {
    const publicRoutes = [
      ["GET", "/health"], ["POST", "/api/auth/register"], ["POST", "/api/auth/login"],
      ["POST", "/api/auth/logout"], ["GET", "/api/auth/session"],
    ] as const;
    const protectedRoutes = [
      ["GET", "/api/location/search"], ["GET", "/api/trips"], ["POST", "/api/trips/analyze"],
      ["PATCH", "/api/trips/:id/requirements"], ["GET", "/api/trips/:id"], ["POST", "/api/trips/:id/weather/refresh"],
      ["GET", "/api/trips/:id/equipment"], ["POST", "/api/trips/:id/equipment"],
      ["PATCH", "/api/trips/:id/equipment/:itemId"], ["DELETE", "/api/trips/:id/equipment/:itemId"],
      ["POST", "/api/trips/:id/confirm"], ["POST", "/api/trips/:id/generate"],
      ["POST", "/api/trips/:id/days/:dayId/regenerate"], ["POST", "/api/trips/:id/days/:dayId/apply"],
      ["POST", "/api/trips/:id/itinerary/edit"], ["POST", "/api/trips/:id/itinerary/candidates"],
      ["GET", "/api/trips/:id/assistant/conversations"], ["GET", "/api/trips/:id/assistant/conversations/:conversationId"],
      ["POST", "/api/trips/:id/assistant/messages"], ["POST", "/api/trips/:id/assistant/actions/:previewId/apply"],
      ["DELETE", "/api/trips/:id/assistant/actions/:previewId"], ["GET", "/api/trips/:id/expenses"],
      ["POST", "/api/trips/:id/expenses"], ["PATCH", "/api/trips/:id/expenses/:expenseId"],
      ["DELETE", "/api/trips/:id/expenses/:expenseId"], ["GET", "/api/trips/:id/budget"], ["PATCH", "/api/trips/:id/budget"],
    ] as const;
    expect([...publicRoutes, ...protectedRoutes]).toHaveLength(32);
    for (const [method, url] of [...publicRoutes, ...protectedRoutes]) expect(app.hasRoute({ method, url }), `${method} ${url}`).toBe(true);
    for (const [method, url] of protectedRoutes) {
      const response = await app.inject({ method, url: url.replace(/:[a-zA-Z]+/g, "example"), headers: { origin } });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
      expect(response.json()).toEqual({ error: "Authentication required" });
    }
  });
  it("returns a safe error when session persistence fails, without retrying the response", async () => {
    const { cookie } = await legacySession();
    const touch = vi.spyOn(app.triplySessionStore, "touch").mockRejectedValue(new Error("mongodb://private-value"));
    const result = await app.inject({ url: "/api/auth/session", headers: { cookie } });
    expect(result.statusCode).toBe(500);
    expect(result.json()).toEqual({ error: "Internal server error" });
    expect(touch).toHaveBeenCalledTimes(1);
    expect(result.headers["set-cookie"]).toBeUndefined();
  });
});

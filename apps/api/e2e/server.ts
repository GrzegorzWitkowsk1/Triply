import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { analysis, attractions, makeDay, NOW, PASSWORD, type Scenario } from "./data.ts";
import { ProviderFixtures } from "./providers.ts";

if (process.env.NODE_ENV !== "test" || process.env.TRIPLY_E2E !== "1" || !process.env.TRIPLY_E2E_TOKEN) {
  throw new Error("The E2E executable requires NODE_ENV=test, TRIPLY_E2E=1 and a per-run control token");
}
const token = process.env.TRIPLY_E2E_TOKEN;
// Override inherited .env/credentials before dynamically importing any app code.
Object.assign(process.env, {
  SESSION_SECRET: "triply-e2e-only-session-secret-0000000000", WEB_ORIGIN: "http://127.0.0.1:5174",
  TRUST_PROXY: "false", AI_PROVIDER: "gemini", AI_MODEL: "e2e-fixture", GEMINI_API_KEY: "e2e-unused",
  OPENROUTER_API_KEY: "", GEOAPIFY_API_KEY: "e2e-unused", GEOAPIFY_ENABLED: "true",
  ROUTING_PROVIDER: "osrm", ROUTING_OSRM_URL: "https://routing.e2e.invalid", ROUTING_OSRM_PROFILE: "driving",
  ROUTING_ENABLED_MODES: "walking", ROUTING_MODE: "walking", ROUTING_RETURN_TO_START: "false",
});
const RealDate = Date;
let offset = 0;
const epoch = performance.now();
class TestDate extends RealDate {
  constructor(...args: [] | [string | number | Date] | [number, number, number?, number?, number?, number?, number?]) {
    const first = args[0];
    super(args.length === 0 ? TestDate.now() : args.length >= 2
      ? new RealDate(args[0] as number, args[1]!, args[2] ?? 1, args[3] ?? 0, args[4] ?? 0, args[5] ?? 0, args[6] ?? 0).getTime()
      : first instanceof RealDate ? first.getTime() : first as string | number);
  }
  static override now(): number { return RealDate.parse(NOW) + performance.now() - epoch + offset; }
}
// @date-fns/tz enumerates Date.prototype's own methods when it initializes.
// Keep the native surface on our subclass so its zone-aware accessors are built.
const dateMethods = Object.getOwnPropertyDescriptors(RealDate.prototype);
Reflect.deleteProperty(dateMethods, "constructor");
Object.defineProperties(TestDate.prototype, dateMethods);
// Mongoose recognizes the constructor by its standard name when building schemas.
Object.defineProperty(TestDate, "name", { value: "Date" });
globalThis.Date = TestDate as DateConstructor;
const providers = new ProviderFixtures();
providers.install();
const database = `triply_e2e_${randomUUID().replaceAll("-", "")}`;
// MongoDB's OS clock differs from our fixture clock; session expiry is still
// enforced by the real session store on every request.
const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1, ip: "127.0.0.1", dbName: database, storageEngine: "wiredTiger", args: ["--setParameter", "ttlMonitorEnabled=false"] } });
const uri = mongod.getUri(database);
const parsed = new URL(uri);
if (parsed.protocol !== "mongodb:" || parsed.hostname !== "127.0.0.1" || parsed.pathname !== `/${database}` || !database.startsWith("triply_e2e_")) {
  await mongod.stop(); throw new Error("Refusing unsafe E2E MongoDB URI");
}
process.env.MONGODB_URI = uri;
const { UserModel } = await import("../src/models/User.ts");
const { TripModel } = await import("../src/models/Trip.ts");
const { migrationWrites } = await import("../src/services/guestMigration.ts");
const transferWithoutFault = migrationWrites.transfer;
const { startServer } = await import("../src/server.ts");
let backend: Awaited<ReturnType<typeof startServer>> | undefined;
const preflights: { path: string; status: number; origin: unknown; credentials: unknown }[] = [];
function observePreflights(app: Awaited<ReturnType<typeof startServer>>["app"]): void {
  app.server.on("request", (request, response) => {
    if (request.method !== "OPTIONS") return;
    response.once("finish", () => preflights.push({ path: request.url ?? "", status: response.statusCode,
      origin: response.getHeader("access-control-allow-origin"), credentials: response.getHeader("access-control-allow-credentials") }));
  });
}

async function clean(): Promise<void> {
  if (mongoose.connection.name !== database || mongoose.connection.host !== "127.0.0.1") throw new Error("Refusing to clean an unowned database");
  for (const collection of await mongoose.connection.db!.listCollections({}, { nameOnly: true }).toArray()) {
    await mongoose.connection.db!.collection(collection.name).deleteMany({});
  }
}

const control = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(403); response.end('{}'); return; }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> : {};
    let result: unknown = {};
    if (request.method === "POST" && request.url === "/setup") {
      migrationWrites.transfer = transferWithoutFault;
      providers.reset();
      preflights.length = 0;
      // Expire process-local provider caches without changing application code.
      // Advance monotonically even if the preceding test advanced its clock.
      offset += 60_000;
      // Recreate Fastify for each test, including its real rate limiter state.
      await currentApp?.close(); await clean();
      const { createApp } = await import("../src/app.ts");
      const app = await createApp();
      observePreflights(app);
      await app.listen({ host: "127.0.0.1", port: 4001 });
      // startServer.close owns the original app; explicit teardown also closes this one.
      currentApp = app;
      const user = await UserModel.create({ email: `e2e-${randomUUID()}@example.test`, passwordHash: await argon2.hash(PASSWORD) });
      const scenario = body.scenario as Scenario;
      const base = analysis(scenario === "prague" ? "Prague" : scenario === "future" ? "Rome" : "Barcelona", scenario === "future" ? "2030-08-01" : "2030-06-02");
      let tripId: string | null = null;
      if (scenario !== "empty") {
        const pool = attractions(base.destination as "Barcelona" | "Prague" | "Rome");
        if (scenario === "conflict" || scenario === "editing") {
          pool[0]!.openingHours = { raw: "Mo-Su 13:30-19:00", source: "osm", checkedAt: "2030-06-01" };
          pool[1]!.openingHours = { raw: "Mo-Su 13:30-19:00", source: "osm", checkedAt: "2030-06-01" };
          pool[2]!.name = "Conflicted Restaurant";
          pool[2]!.openingHours = { raw: "Mo-Su 09:00-09:10", source: "osm", checkedAt: "2030-06-01" };
        }
        const days = [makeDay(pool, 1, base.startDate!, [0, 1, 2, 4]), makeDay(pool, 2, base.startDate!, [5, 6]), makeDay(pool, 3, base.startDate!, [7, 8])];
        if (scenario === "editing") {
          days[1]!.warnings = ["Schedule unresolved: Roman Walls needs review."];
          days[1]!.activities[0] = { ...days[1]!.activities[0]!, startTime: "", endTime: "", schedulingStatus: "unresolved" };
        }
        const trip = await TripModel.create({ user: user._id, analysis: scenario === "prague" ? { ...base, location: null } : base,
          status: scenario === "prague" ? "draft" : "ready", confirmedFields: [], missingFields: [],
          attractions: scenario === "prague" ? [] : pool, attractionsFetchedAt: new Date(),
          attractionsQuery: scenario === "prague" ? null : { lat: base.location!.lat, lng: base.location!.lng, interests: base.interests },
          itinerary: scenario === "prague" ? null : { timeZone: "Europe/Madrid", routingSource: "provider", days,
            unscheduled: scenario === "editing" ? [{ place: days[1]!.stops[0], dayIndex: 2, reason: "opening-hours-conflict", detail: "Roman Walls needs review." }] : [] },
          itineraryVersion: 3, generation: { generatedAt: scenario === "prague" ? null : new Date(), startedAt: null, error: null },
          weather: [], weatherAvailability: scenario === "weather" ? { status: "temporarily_unavailable", reason: "http_error", canRetry: true,
            checkedAt: null, retryAfter: null, timeZone: "Europe/Madrid", forecastStart: "2030-06-01", forecastEnd: "2030-06-16" } : null,
          expenses: [{ id: "fixture-lunch", title: "Lunch", category: "food_drinks", amountMinor: 1500, currency: "EUR", type: "actual", createdAt: NOW, updatedAt: NOW }],
        });
        tripId = trip.id;
      }
      providers.weatherFailures = scenario === "weather" ? 3 : 0;
      providers.geoapifyFallback = scenario === "prague";
      result = { email: user.email, password: PASSWORD, tripId, now: new Date().toISOString() };
    } else if (request.method === "POST" && request.url === "/hold") providers.hold(String(body.provider));
    else if (request.method === "POST" && request.url === "/release") providers.release(String(body.provider));
    else if (request.method === "POST" && request.url === "/advance") { offset += 11 * 60_000; result = { now: new Date().toISOString() }; }
    else if (request.method === "POST" && request.url === "/expire-guest") {
      if (typeof body.guestId !== "string" || !/^[a-f0-9]{32}$/.test(body.guestId)) throw new Error("Invalid fixture guest identity");
      const sessions = mongoose.connection.db!.collection<{ _id: string; session: string }>("sessions");
      for (const record of await sessions.find({}).toArray()) {
        if (JSON.parse(record.session).guest?.id === body.guestId) {
          await sessions.updateOne({ _id: record._id }, { $set: { expires: new Date(0) } });
        }
      }
    }
    else if (request.method === "POST" && request.url === "/fail-import-once") {
      migrationWrites.transfer = async (...args) => {
        migrationWrites.transfer = transferWithoutFault;
        await transferWithoutFault(...args);
        throw new Error("Fixture interruption after transaction writes");
      };
    }
    else if (request.method === "POST" && request.url === "/cleanup") { migrationWrites.transfer = transferWithoutFault; providers.reset(); await clean(); }
    else if (request.method === "POST" && request.url === "/shutdown") {
      await close(); response.end('{}'); return;
    }
    else if (request.method === "GET" && request.url?.startsWith("/trip/")) result = await TripModel.findById(request.url.slice(6)).lean();
    else if (request.method === "GET" && request.url === "/state") result = { calls: providers.calls, unexpected: providers.unexpected, preflights,
      sessions: await mongoose.connection.db!.collection("sessions").countDocuments() };
    else { response.writeHead(404); response.end('{}'); return; }
    response.end(JSON.stringify(result));
  } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: String(error) })); }
});
let currentApp: Awaited<ReturnType<typeof startServer>>["app"] | undefined;
let closing: Promise<void> | undefined;
function close(): Promise<void> {
  return closing ??= (async () => {
    providers.reset();
    control.close();
    await currentApp?.close();
    await backend?.close();
    await mongod.stop();
  })();
}
try {
  backend = await startServer({ uri, host: "127.0.0.1", port: 4001 });
  observePreflights(backend.app);
  currentApp = backend.app;
  await new Promise<void>((resolve, reject) => { control.once("error", reject); control.listen(4002, "127.0.0.1", resolve); });
  // Our handler closes MongoMemoryServer as well as Fastify/Mongoose.
  process.removeAllListeners("SIGTERM"); process.removeAllListeners("SIGINT");
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => { void close().then(() => process.exit(0)); });
} catch (error) { await close(); throw error; }

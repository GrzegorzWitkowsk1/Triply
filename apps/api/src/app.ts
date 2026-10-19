import Fastify from "fastify";
import { registerSavedAttractionRoutes } from "./routes/savedAttractions.js";
import { SavedAttractionModel } from "./models/SavedAttraction.js";
import { registerSavedRoutes } from "./routes/saved.js";
import { SavedDestinationModel } from "./models/SavedDestination.js";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { parse } from "node:querystring";
import { env } from "./config/env.js";
import { registerSessions } from "./config/session.js";
import { errorHandler } from "./middleware/error.js";
import { requireTripIdentity } from "./middleware/tripIdentity.js";
import { guestNetworkLimit } from "./middleware/guestNetworkLimit.js";
import { registerGuestUsageRoutes } from "./routes/guestUsage.js";
import { prepareGuestLimits } from "./services/guestLimits.js";
import { prepareGuestHandoffs } from "./models/GuestHandoff.js";
import { registerGuestActivity } from "./middleware/guestActivity.js";
import { registerGuestMigrationRoutes } from "./routes/guestMigration.js";
import { notFoundHandler } from "./middleware/notFound.js";
import { createLimiters } from "./middleware/rateLimit.js";
import { registerBodyParsing, JSON_BODY_LIMIT } from "./http/body.js";
import { registerResponseCompatibility } from "./http/response.js";
import { FixedWindowStore } from "./middleware/rateLimitStore.js";
import { rewriteUrl, validatePathParameters } from "./http/url.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerProfileRoutes } from "./routes/profile.js";
import { registerTripRoutes } from "./routes/trips.js";
import { registerLocationRoutes } from "./routes/location.js";
import { registerPublicTripRoutes, registerSharingRoutes } from "./routes/sharing.js";
import { registerPrivatePdfRoutes, registerPublicPdfRoutes } from "./routes/pdf.js";
import { registerPrivateCalendarRoutes, registerPublicCalendarRoutes } from "./routes/calendar.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export async function createApp() {
  const proxyHops = env.TRUST_PROXY;
  const app = Fastify({
    rewriteUrl,
    logger: false, trustProxy: typeof proxyHops === "number" ? (_address, hop) => hop < proxyHops : proxyHops, bodyLimit: JSON_BODY_LIMIT,
    routerOptions: { caseSensitive: false, ignoreTrailingSlash: true, maxParamLength: Number.MAX_SAFE_INTEGER,
      querystringParser: value => parse(value) },
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof Error && "code" in error && error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      reply.code(413).send({ error: "request entity too large" });
      return;
    }
    errorHandler(error, request, reply);
  });
  app.setNotFoundHandler(notFoundHandler);
  app.decorateRequest("user", null);
  await app.register(helmet);
  // Express varies on Origin even for fixed origins and early preflight replies.
  app.addHook("onRequest", async (_request, reply) => { reply.header("Vary", "Origin"); });
  await app.register(cors, {
    origin: env.WEB_ORIGIN, credentials: true, methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    strictPreflight: false,
  });
  app.addHook("onRequest", async (request, reply) => {
    if (!safeMethods.has(request.method) && request.headers.origin !== env.WEB_ORIGIN) {
      await reply.code(403).send({ error: "Request origin is not allowed" });
    }
  });
  registerBodyParsing(app);
  registerResponseCompatibility(app);
  await app.register(cookie);
  await registerSessions(app);
  await prepareGuestLimits();
  await prepareGuestHandoffs();
  await SavedDestinationModel.createIndexes();
  await SavedAttractionModel.createIndexes();
  registerGuestActivity(app);
  await app.register(rateLimit, { global: false, store: FixedWindowStore });
  const limits = createLimiters(app);
  registerHealthRoutes(app);
  registerPublicTripRoutes(app);
  registerPublicPdfRoutes(app);
  registerPublicCalendarRoutes(app);
  registerAuthRoutes(app, limits.auth);
  registerGuestMigrationRoutes(app);
  await registerProfileRoutes(app, limits.auth);
  await app.register(async protectedApi => {
    protectedApi.addHook("onRequest", async (_request, reply) => {
      // Private trip payloads must not survive logout in browser/proxy HTTP caches.
      reply.header("Cache-Control", "no-store");
    });
    protectedApi.addHook("preHandler", requireTripIdentity);
    protectedApi.addHook("preHandler", guestNetworkLimit(protectedApi));
    registerGuestUsageRoutes(protectedApi);
    registerSavedRoutes(protectedApi);
    registerSavedAttractionRoutes(protectedApi);
    protectedApi.addHook("preHandler", validatePathParameters);
    registerTripRoutes(protectedApi, limits.planning);
    registerSharingRoutes(protectedApi);
    registerPrivatePdfRoutes(protectedApi);
    registerPrivateCalendarRoutes(protectedApi);
    registerLocationRoutes(protectedApi);
  }, { prefix: "/api" });
  await app.ready();
  return app;
}

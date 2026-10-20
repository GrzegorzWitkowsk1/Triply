import type { FastifyInstance } from "fastify";
import { catalogDestinationSchema, collectionDestinationsSchema, findCuratedCollection, destinationIdSchema, destinationListSchema, destinationQuerySchema } from "@triply/shared";
import { DestinationModel } from "../models/Destination.js";
import { destinationFilters, discoveryFilter, discoverySort } from "../services/destinationDiscovery.js";
import { resolveCatalogDestination } from "../services/catalogDestination.js";

export function registerDestinationRoutes(app: FastifyInstance): void {
  const check = app.createRateLimit({ max: 120, timeWindow: 60_000, keyGenerator: req => req.ip });
  const publicLimit: import("fastify").preHandlerAsyncHookHandler = async (req, reply) => {
    const result = await check(req);
    if (result.isAllowed) return;
    if (result.isExceeded) await reply.header("Retry-After", result.ttlInSeconds).code(429).send({ error: "Too many destination requests. Please try again shortly." });
  };
  app.get<{ Params: { slug: string } }>("/api/destinations/collections/:slug", { preHandler: publicLimit }, async (req, reply) => {
    const collection = findCuratedCollection(req.params.slug);
    if (!collection) return reply.code(404).send({ error: "Collection not found." });
    const rows = await DestinationModel.find({ $and: [discoveryFilter(destinationQuerySchema.parse({})), { id: { $in: collection.destinationIds } }] }).limit(12).maxTimeMS(3000).lean().exec();
    const places = new Map(rows.flatMap(row => {
      const parsed = catalogDestinationSchema.safeParse(row);
      return parsed.success ? [[parsed.data.id, parsed.data] as const] : [];
    }));
    return collectionDestinationsSchema.parse({ slug: collection.slug,
      items: collection.destinationIds.flatMap(id => places.has(id) ? [places.get(id)!] : []) });
  });
  app.get<{ Params: { destinationId: string } }>("/api/destinations/:destinationId", { preHandler: publicLimit }, async (req, reply) => {
    const parsed = destinationIdSchema.safeParse(req.params.destinationId);
    if (!parsed.success) return reply.code(400).send({ error: "Provide a valid destination reference." });
    const destination = await resolveCatalogDestination(parsed.data);
    if (!destination) return reply.code(404).send({ code: "DESTINATION_NOT_FOUND", error: "Destination is no longer available. Choose another destination." });
    return destination;
  });
  app.get("/api/destinations/filters", { preHandler: publicLimit }, async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=300");
    return destinationFilters();
  });
  app.get("/api/destinations", { preHandler: publicLimit }, async (req, reply) => {
    const parsedQuery = destinationQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) return reply.code(400).send({ error: "Invalid destination query. Use q up to 120 characters, valid filters, positive page and pageSize (maximum 48)." });
    const query = parsedQuery.data;
    const { pageSize } = query;
    const filter = discoveryFilter(query);
    const total = await DestinationModel.countDocuments(filter).maxTimeMS(3000).exec();
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / pageSize)));
    const rows = await DestinationModel.find(filter).sort(discoverySort(query.sort)).skip((page - 1) * pageSize).limit(pageSize).maxTimeMS(3000).lean().exec();
    const items = rows.flatMap(row => {
      const parsed = catalogDestinationSchema.safeParse(row);
      if (parsed.success) return [parsed.data];
      // The application disables Fastify logging; emit only a validated public ID.
      const id = typeof row.id === "string" && /^city-\d{3}$/.test(row.id) ? row.id : "invalid ID";
      console.warn(`[destinations] Skipping ${id}; repair city or canonical ID in the catalog.`);
      return [];
    });
    return destinationListSchema.parse({ items, total, page, pageSize });
  });
}

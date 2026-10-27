import { localeRequestSchema } from "@triply/shared";
import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import { applyPackingSuggestionsSchema, bulkPackingSchema } from "@triply/shared";
import type { HttpRoute } from "../http/types.js";
import { currentTripOwner } from "../middleware/tripIdentity.js";
import { guestOperation } from "../services/guestLimits.js";
import { bulkPackingItems } from "../services/equipment.js";
import { applyPacking, generatePacking, packingContextStatus } from "../services/packing.js";

export function registerPackingActions(app: FastifyInstance, aiLimiter: preHandlerAsyncHookHandler): void {
  app.get<HttpRoute>("/trips/:id/equipment/context", async request => packingContextStatus(request.params.id, currentTripOwner(request)));
  app.patch<HttpRoute>("/trips/:id/equipment/bulk", async (request, reply) => {
    const input = bulkPackingSchema.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: "Select 1-100 unique valid packing item IDs and a packed state." });
    return bulkPackingItems(request.params.id, currentTripOwner(request), input.data);
  });
  app.post<HttpRoute>("/trips/:id/equipment/generate", { preHandler: aiLimiter }, async (request, reply) => {
    const parsed = localeRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Send only a supported locale (en or pl); packing context comes from the saved trip." });
    }
    const controller = new AbortController();
    const abort = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.once("close", abort);
    try {
      return await guestOperation(request, "packing", start => generatePacking(request.params.id, currentTripOwner(request), start, controller.signal, parsed.data.locale));
    } finally { reply.raw.removeListener("close", abort); }
  });
  app.post<HttpRoute>("/trips/:id/equipment/apply", async (request, reply) => {
    const input = applyPackingSuggestionsSchema.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: "Select at least one valid suggestion from the packing preview." });
    return applyPacking(request.params.id, currentTripOwner(request), input.data);
  });
}

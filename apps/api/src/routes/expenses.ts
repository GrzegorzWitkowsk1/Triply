import type { FastifyInstance, FastifyReply } from "fastify";
import { expenseCreateSchema, expenseUpdateSchema, budgetUpdateSchema, moneyMinorSchema } from "@triply/shared";
import { budgetData } from "../services/budgetSummary.js";
import { loadBudgetTrip, mutateExpense, updateBudgetAllocations } from "../services/expenses.js";
import { ItineraryEditError } from "../services/tripItineraryEditor.js";
import { currentTripOwner } from "../middleware/tripIdentity.js";
import { notFoundHandler } from "../middleware/notFound.js";
import type { HttpRoute, HttpRequest } from "../http/types.js";

export function registerExpenseRoutes(app: FastifyInstance): void {
  async function handle(req: HttpRequest, res: FastifyReply): Promise<unknown> {
    // The old method-dispatch middleware matched these suffixes exactly.
    const path = (req.raw.url ?? "").split("?")[0];
    const item = /\/expenses\/([a-f\d-]{36})$/i.exec(path);
    const expenses = path.endsWith("/expenses");
    const budget = path.endsWith("/budget");
    if (!expenses && !budget && !item) {
      await notFoundHandler(req, res);
      return;
    }
    try {
      const id = req.params.id;
      const userId = currentTripOwner(req);
      let trip;
      if (req.method === "GET" && (expenses || budget)) {
        trip = await loadBudgetTrip(id, userId);
      } else if (req.method === "POST" && expenses) {
        const input = expenseCreateSchema.safeParse(req.body);
        if (!input.success) throw new ItineraryEditError(input.error.issues[0]?.message ?? "Invalid expense");
        trip = await mutateExpense(id, userId, { type: "create", expense: input.data.expense, requestId: input.data.requestId }, input.data.expectedRevision);
        res.code(201);
      } else if (req.method === "PATCH" && budget) {
        const input = budgetUpdateSchema.safeParse(req.body);
        if (!input.success) throw new ItineraryEditError("Invalid budget allocations");
        trip = await updateBudgetAllocations(id, userId, input.data.allocations, input.data.expectedRevision);
      } else if (item && req.method === "PATCH") {
        const input = expenseUpdateSchema.safeParse(req.body);
        if (!input.success) throw new ItineraryEditError(input.error.issues[0]?.message ?? "Invalid expense");
        trip = await mutateExpense(id, userId, { type: "update", expenseId: item[1], expense: input.data.expense }, input.data.expectedRevision);
      } else if (item && req.method === "DELETE") {
        const body = req.body;
        const revision = moneyMinorSchema.safeParse(typeof body === "object" && body !== null && "expectedRevision" in body ? body.expectedRevision : undefined);
        if (!revision.success || Object.keys(body ?? {}).some(key => key !== "expectedRevision")) throw new ItineraryEditError("Provide a valid expense revision");
        trip = await mutateExpense(id, userId, { type: "delete", expenseId: item[1] }, revision.data);
      } else {
        await notFoundHandler(req, res);
        return;
      }
      return res.send(budgetData(trip.toObject()));
    } catch (error) {
      if (error instanceof ItineraryEditError) return res.code(error.status).send({ error: error.message });
      else throw error;
    }
  }
  app.get<HttpRoute>("/trips/:id/expenses", { exposeHeadRoute: false }, handle);
  app.get<HttpRoute>("/trips/:id/budget", { exposeHeadRoute: false }, handle);
  app.post<HttpRoute>("/trips/:id/expenses", handle);
  app.patch<HttpRoute>("/trips/:id/budget", handle);
  app.patch<HttpRoute>("/trips/:id/expenses/:expenseId", handle);
  app.delete<HttpRoute>("/trips/:id/expenses/:expenseId", handle);
}

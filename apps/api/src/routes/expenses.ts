import { Router } from "express";
import { expenseCreateSchema, expenseUpdateSchema, budgetUpdateSchema, moneyMinorSchema } from "@triply/shared";
import { budgetData } from "../services/budgetSummary.js";
import { loadBudgetTrip, mutateExpense, updateBudgetAllocations } from "../services/expenses.js";
import { ItineraryEditError } from "../services/tripItineraryEditor.js";
import type { PublicUser } from "../models/User.js";

export const expensesRouter = Router({ mergeParams: true });
expensesRouter.use(async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const userId = (res.locals.user as PublicUser).id;
    let trip;
    if (req.method === "GET" && (req.path === "/expenses" || req.path === "/budget")) trip = await loadBudgetTrip(id, userId);
    else if (req.method === "POST" && req.path === "/expenses") {
      const input = expenseCreateSchema.safeParse(req.body);
      if (!input.success) throw new ItineraryEditError(input.error.issues[0]?.message ?? "Invalid expense");
      trip = await mutateExpense(id, userId, { type: "create", expense: input.data.expense, requestId: input.data.requestId }, input.data.expectedRevision);
      res.status(201);
    } else if (req.method === "PATCH" && req.path === "/budget") {
      const input = budgetUpdateSchema.safeParse(req.body);
      if (!input.success) throw new ItineraryEditError("Invalid budget allocations");
      trip = await updateBudgetAllocations(id, userId, input.data.allocations, input.data.expectedRevision);
    } else {
      const match = /^\/expenses\/([a-f\d-]{36})$/i.exec(req.path);
      if (!match || !["PATCH", "DELETE"].includes(req.method)) { next(); return; }
      if (req.method === "PATCH") {
        const input = expenseUpdateSchema.safeParse(req.body);
        if (!input.success) throw new ItineraryEditError(input.error.issues[0]?.message ?? "Invalid expense");
        trip = await mutateExpense(id, userId, { type: "update", expenseId: match[1], expense: input.data.expense }, input.data.expectedRevision);
      } else {
        const revision = moneyMinorSchema.safeParse(req.body?.expectedRevision);
        if (!revision.success || Object.keys(req.body ?? {}).some(key => key !== "expectedRevision")) throw new ItineraryEditError("Provide a valid expense revision");
        trip = await mutateExpense(id, userId, { type: "delete", expenseId: match[1] }, revision.data);
      }
    }
    res.json(budgetData(trip.toObject()));
  } catch (error) {
    if (error instanceof ItineraryEditError) res.status(error.status).json({ error: error.message });
    else next(error);
  }
});

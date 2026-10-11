import { randomUUID } from "node:crypto";
import { decimalToMinor, expenseInputSchema, formatMoney, type ExpenseOperation } from "@triply/shared";
import type { TripDocument } from "../models/Trip.js";
import { validateExpenseAssociations } from "./expenses.js";
import { factualAnswer, resolveDay } from "./assistantContext.js";

export type BudgetIntent = { message: string; operation?: ExpenseOperation; cheaperDay?: number };
/** Literal monetary parsing: the model never supplies financial amounts or expense IDs. */
export function interpretBudgetRequest(trip: TripDocument, message: string, selected?: string): BudgetIntent | null {
  if (/\b(budget|spent|spending|planned.*spend|money.*left|how much.*left|expensive day|day.*expensive)\b/i.test(message) && !/^(add|record|delete|move|edit|change)\b/i.test(message)) return { message: factualAnswer(trip, "budget", undefined, undefined, message) };
  if (/cheaper|make it cheap/i.test(message)) {
    const ref = /day\s+(\d+)/i.exec(message)?.[1] ?? selected;
    const day = trip.itinerary?.days.find(d => String(d.dayIndex) === ref);
    return day ? { message: `Review a cheaper alternative for day ${day.dayIndex}. Unknown prices remain uncertain.`, cheaperDay: day.dayIndex } : { message: "Which day should I make cheaper? Please include the day number in your request." };
  }
  const add = /^(add|record)\s+(?:(€|\$|£|[A-Z]{3})\s*)?(\d+(?:\.\d+)?)\s*(EUR|USD|GBP|PLN|JPY|CHF|CZK|SEK|NOK|DKK)?\s+(?:for\s+)?(.+?)(?:\s+on\s+day\s+(\d+))?[.!]?$/i.exec(message.trim());
  if (add) {
    const currency = ({ "€": "EUR", "$": "USD", "£": "GBP" } as Record<string, string>)[add[2]] ?? add[2]?.toUpperCase() ?? add[4]?.toUpperCase() ?? trip.analysis.budget.currency;
    if (!currency || (add[2] && add[4] && currency !== add[4].toUpperCase())) return { message: "Please specify one currency, amount and title, for example: Record EUR 18 for drinks." };
    const title = add[5].trim();
    if (/\b(and|then)\b|\d+(?:\.\d+)?\s*(?:€|EUR|USD)/i.test(title)) return { message: "Please request one expense at a time, with a single amount and title." };
    const dayId = add[6] ?? null;
    const category = /lunch|dinner|breakfast|food|drink|coffee/i.test(title) ? "food_drinks" : /taxi|metro|bus|transport|train/i.test(title) ? "transport" : /hotel|accommodation/i.test(title) ? "accommodation" : /shopping|souvenir/i.test(title) ? "shopping" : /ticket|admission|museum/i.test(title) ? "attractions" : "other";
    try {
      const expense = expenseInputSchema.parse({ title, currency, amountMinor: decimalToMinor(add[3], currency), category, type: add[1].toLowerCase() === "record" ? "actual" : "planned", dayId });
      validateExpenseAssociations(trip, expense);
      return { message: `Confirm ${expense.type} expense: ${title}, ${formatMoney(expense.amountMinor, currency)}${dayId ? ` on day ${dayId}` : " (unassigned)"}.`, operation: { type: "create", expense, requestId: randomUUID() } };
    } catch { return { message: "Please provide a valid amount, currency and existing day. Add means planned; record means actual." }; }
  }
  const mutation = /^(delete|move|edit|change)\s+(?:my\s+|the\s+)?(.+?)\s+expense(?:\s+(?:to|on)\s+day\s+(\d+))?[.!]?$/i.exec(message.trim());
  if (mutation) {
    const matches = (trip.expenses ?? []).filter(e => e.title.toLowerCase() === mutation[2].toLowerCase());
    if (matches.length !== 1) return { message: "Please give the exact expense title. If several expenses share it, edit the desired record in Budget." };
    const expense = matches[0];
    if (mutation[1].toLowerCase() === "delete") return { message: `Confirm deletion of ${expense.title}, ${formatMoney(expense.amountMinor, expense.currency)} (${expense.type}).`, operation: { type: "delete", expenseId: expense.id } };
    if (mutation[1].toLowerCase() === "move" && mutation[3]) {
      const day = resolveDay(trip.itinerary!.days, mutation[3], null)[0];
      if (!day) return { message: "Which existing day should receive this expense?" };
      if (expense.replacesAdmission) return { message: "This expense replaces a specific day's admission. Edit its admission association in Budget before moving it." };
      const updated = expenseInputSchema.parse({ title: expense.title, category: expense.category, amountMinor: expense.amountMinor, currency: expense.currency, type: expense.type, dayId: String(day.dayIndex), date: expense.date, attractionId: expense.attractionId, replacesAdmission: expense.replacesAdmission, note: expense.note });
      return { message: `Confirm moving ${expense.title} to day ${day.dayIndex}. Its recorded date stays unchanged.`, operation: { type: "update", expenseId: expense.id, expense: updated } };
    }
    return { message: "Please use Budget to edit expense details, or request: Move the [exact title] expense to day 3." };
  }
  if (/^(add|record)\b.*(?:expense|lunch|drinks|shopping|taxi|€|\$|£|\bEUR\b|\bUSD\b)/i.test(message)) return { message: "Please specify one expense, for example: Add EUR 25 for lunch on day 2 (planned), or Record EUR 18 for drinks (actual)." };
  return null;
}

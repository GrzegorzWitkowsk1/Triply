import { z } from "zod";
import { EXPENSE_CATEGORIES, expenseInputSchema } from "./budget.js";
import { createTripEquipmentItemSchema } from "./trip.js";
import type { ItineraryDay, TripDetail } from "./trip.js";
import type { ItineraryEditOperation } from "./itineraryEditing.js";
import { itineraryEditOperationSchema } from "./itineraryEditing.js";
import type { ExpenseOperation } from "./budget.js";

const reference = z.string().trim().min(1).max(120);
const day = reference.optional();
export const assistantToolInputs = {
  reschedule_attraction: z.object({ attraction: reference, day, time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/) }).strict(),
  move_attraction: z.object({ attraction: reference.describe("Scheduled attraction name or ID; never an expense."), day: day.describe("Source day only, if needed to disambiguate. Omit when the attraction is unique."), targetDay: reference.describe("Destination trip day number, ordinal or date. This is not the source day.") }).strict(),
  remove_attraction: z.object({ attraction: reference, day }).strict(),
  add_existing_attraction: z.object({ attraction: reference, day: reference, position: z.number().int().min(0).max(500).optional() }).strict(),
  suggest_replacement: z.object({ attraction: reference.describe("Scheduled attraction to replace. Use outdoor attraction for an unnamed outdoor target."), day, replacement: reference.optional().describe("Known unscheduled candidate only; omit to resolve by reliable metadata."), environment: z.enum(["indoor", "outdoor"]).optional().describe("Required environment of the replacement, not of the original attraction.") }).strict(),
  add_expense: z.object({ title: expenseInputSchema.shape.title, amount: z.string().regex(/^\d+(?:\.\d+)?$/).max(25), currency: expenseInputSchema.shape.currency,
    category: z.enum(EXPENSE_CATEGORIES), type: z.enum(["planned", "actual"]), day, date: expenseInputSchema.shape.date.optional() }).strict(),
  update_expense: z.object({ expense: reference, title: expenseInputSchema.shape.title.optional(), amount: z.string().regex(/^\d+(?:\.\d+)?$/).max(25).optional(), currency: expenseInputSchema.shape.currency.optional(), category: z.enum(EXPENSE_CATEGORIES).optional(), type: z.enum(["planned", "actual"]).optional(), day, date: expenseInputSchema.shape.date.optional() }).strict(),
  add_packing_item: createTripEquipmentItemSchema.strict(),
  remove_packing_item: z.object({ item: reference }).strict(),
  update_packing_item_status: z.object({ item: reference, packed: z.boolean() }).strict(),
} as const;
export type AssistantToolName = keyof typeof assistantToolInputs;
/** Packing names remain in historical receipt types only; Trip Assistant cannot execute them. */
export const assistantEnabledToolNames: readonly AssistantToolName[] = ["reschedule_attraction", "move_attraction", "remove_attraction", "add_existing_attraction", "suggest_replacement", "add_expense", "update_expense"];
export type AssistantToolRequest = { [K in AssistantToolName]: { tool: K; arguments: z.infer<(typeof assistantToolInputs)[K]> } }[AssistantToolName];
export const assistantToolRequestSchema = z.discriminatedUnion("tool", [
  ...Object.entries(assistantToolInputs).map(([tool, argumentsSchema]) => z.object({ tool: z.literal(tool), arguments: argumentsSchema }).strict()),
] as unknown as [z.ZodObject, ...z.ZodObject[]]);
export const assistantToolRequestsSchema = z.array(assistantToolRequestSchema).min(1).max(5);
export type AssistantPackingOperation =
  | { type: "create"; itemId: string; input: z.infer<typeof createTripEquipmentItemSchema> }
  | { type: "delete"; itemId: string }
  | { type: "status"; itemId: string; packed: boolean };
export type AssistantValidatedAction =
  | { domain: "itinerary"; tool: AssistantToolName; operation: ItineraryEditOperation }
  | { domain: "expense"; tool: AssistantToolName; operation: ExpenseOperation }
  | { domain: "packing"; tool: AssistantToolName; operation: AssistantPackingOperation };
const toolOperations = { reschedule_attraction: "reschedule", move_attraction: "move", remove_attraction: "remove", add_existing_attraction: "add", suggest_replacement: "replace", add_expense: "create", update_expense: "update", add_packing_item: "create", remove_packing_item: "delete", update_packing_item_status: "status" } as const;
const itemId = z.string().regex(/^[a-f\d]{24}$/i);
/** Revalidate server-owned executable data before every preparation/confirmation. */
export const assistantValidatedActionsSchema = z.array(z.union([
  z.object({ domain: z.literal("itinerary"), tool: z.enum(["reschedule_attraction", "move_attraction", "remove_attraction", "add_existing_attraction", "suggest_replacement"]), operation: itineraryEditOperationSchema }).strict(),
  z.object({ domain: z.literal("expense"), tool: z.enum(["add_expense", "update_expense"]), operation: z.discriminatedUnion("type", [
    z.object({ type: z.literal("create"), requestId: z.uuid(), expense: expenseInputSchema }).strict(),
    z.object({ type: z.literal("update"), expenseId: z.string().min(1).max(120), expense: expenseInputSchema }).strict(),
  ]) }).strict(),
  z.object({ domain: z.literal("packing"), tool: z.enum(["add_packing_item", "remove_packing_item", "update_packing_item_status"]), operation: z.discriminatedUnion("type", [
    z.object({ type: z.literal("create"), itemId, input: createTripEquipmentItemSchema.strict() }).strict(),
    z.object({ type: z.literal("delete"), itemId }).strict(),
    z.object({ type: z.literal("status"), itemId, packed: z.boolean() }).strict(),
  ]) }).strict(),
]).refine(action => toolOperations[action.tool] === action.operation.type, "Tool and operation do not match")).min(1).max(5);
export type AssistantProposalStatus = "pending" | "completed" | "rejected" | "expired" | "stale" | "failed";
export interface AssistantActionChange { tool: AssistantToolName; entityId: string; label: string; before: string | null; after: string | null; dayIndex?: number }
export interface AssistantActionProposal {
  proposalId: string; tripId: string; status: AssistantProposalStatus;
  actions: AssistantValidatedAction[]; changes: AssistantActionChange[]; warnings: string[]; conflicts: string[];
  days: ItineraryDay[]; baseItineraryVersion: number; baseBudgetRevision: number;
  createdAt: string; expiresAt: string;
}
export interface AssistantActionResult { proposal: AssistantActionProposal; trip: TripDetail }
export const assistantConfirmationSchema = z.object({ locale: z.enum(["en", "pl"]).optional() }).strict();

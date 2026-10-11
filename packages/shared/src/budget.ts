import { z } from "zod";
import { isIsoDate } from "./dates.js";

export const EXPENSE_CATEGORIES = ["attractions", "food_drinks", "transport", "accommodation", "shopping", "other"] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  attractions: "Attractions", food_drinks: "Food & Drinks", transport: "Transport",
  accommodation: "Accommodation", shopping: "Shopping", other: "Other",
};
const currencies = new Set(Intl.supportedValuesOf("currency"));
export const expenseCurrencySchema = z.string().regex(/^[A-Z]{3}$/).refine(value => currencies.has(value), "Unsupported currency");
export const moneyMinorSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export function currencyPrecision(currency: string): number {
  expenseCurrencySchema.parse(currency);
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits!;
}
/** Parse a decimal string without floating point arithmetic; reject excess precision. */
export function decimalToMinor(value: string, currency: string): number {
  const digits = currencyPrecision(currency);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[2]?.length ?? 0) > digits) throw new Error("Enter a valid amount with the currency's precision");
  const amount = BigInt(match[1]) * 10n ** BigInt(digits) + BigInt((match[2] ?? "").padEnd(digits, "0") || "0");
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount is too large");
  return Number(amount);
}
export function formatMoney(amountMinor: number, currency: string): string {
  const digits = currencyPrecision(currency);
  const value = BigInt(amountMinor);
  const absolute = value < 0n ? -value : value;
  const factor = 10n ** BigInt(digits);
  const whole = absolute / factor;
  const fraction = (absolute % factor).toString().padStart(digits, "0");
  const signed = value < 0n ? whole === 0n ? -1n : -whole : whole;
  return new Intl.NumberFormat("en", { style: "currency", currency }).formatToParts(signed)
    .map(part => part.type === "fraction" ? fraction : part.type === "integer" && value < 0n && whole === 0n ? "0" : part.value).join("");
}
export function minorToDecimal(amountMinor: number, currency: string): string {
  const digits = currencyPrecision(currency);
  const value = BigInt(amountMinor);
  const factor = 10n ** BigInt(digits);
  return `${value / factor}${digits ? `.${(value % factor).toString().padStart(digits, "0")}` : ""}`;
}
export const expenseInputSchema = z.object({
  title: z.string().trim().min(1).max(120), category: z.enum(EXPENSE_CATEGORIES),
  amountMinor: moneyMinorSchema, currency: expenseCurrencySchema, type: z.enum(["planned", "actual"]),
  date: z.string().refine(isIsoDate, "Invalid date").nullable().default(null),
  dayId: z.string().regex(/^[1-9]\d{0,2}$/).nullable().default(null),
  attractionId: z.string().trim().min(1).max(120).nullable().default(null),
  replacesAdmission: z.boolean().default(false),
  note: z.string().trim().max(2000).nullable().default(null),
}).strict().refine(value => !value.replacesAdmission || (value.attractionId !== null && value.dayId !== null && value.category === "attractions"), "Admission replacement requires an attraction, day and Attractions category");
export type ExpenseInput = z.infer<typeof expenseInputSchema>;
export interface TripExpense extends ExpenseInput { id: string; createdAt: string; updatedAt: string }
export const expenseCreateSchema = z.object({ expense: expenseInputSchema, requestId: z.uuid(), expectedRevision: moneyMinorSchema }).strict();
export const expenseUpdateSchema = z.object({ expense: expenseInputSchema, expectedRevision: moneyMinorSchema }).strict();
export const budgetAllocationsSchema = z.partialRecord(z.enum(EXPENSE_CATEGORIES), moneyMinorSchema);
export type BudgetAllocations = z.infer<typeof budgetAllocationsSchema>;
export const budgetUpdateSchema = z.object({ allocations: budgetAllocationsSchema, expectedRevision: moneyMinorSchema }).strict();
export interface SpendingTotal { currency: string; plannedMinor: number; actualMinor: number; automaticMinor: number; manualPlannedMinor: number }
export interface BudgetSummary {
  currency: string | null; totalBudgetMinor: number | null; allocations: BudgetAllocations; allocationCurrency: string | null;
  totals: SpendingTotal[]; categories: { category: ExpenseCategory; totals: SpendingTotal[] }[];
  days: { dayId: string | null; totals: SpendingTotal[]; categories: { category: ExpenseCategory; totals: SpendingTotal[] }[] }[];
  plannedSpendingMinor: number | null; actualSpendingMinor: number | null;
  plannedRemainingMinor: number | null; actualRemainingMinor: number | null;
  unknownAdmissionPriceCount: number; hasIncompletePricing: boolean; comparisonAvailable: boolean;
  plannedOverBudget: boolean; actualOverBudget: boolean; warnings: string[];
}
export interface TripBudgetData { expenses: TripExpense[]; revision: number; summary: BudgetSummary }
export type ExpenseOperation = { type: "create"; expense: ExpenseInput; requestId: string } | { type: "update"; expenseId: string; expense: ExpenseInput } | { type: "delete"; expenseId: string };

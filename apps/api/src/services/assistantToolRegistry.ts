import { z } from "zod";
import { assistantEnabledToolNames, assistantToolInputs, decimalToMinor, expenseInputSchema, type AssistantToolName, type AssistantToolRequest, type AssistantValidatedAction, type SupportedLocale } from "@triply/shared";
import { randomUUID } from "node:crypto";
import type { TripDocument } from "../models/Trip.js";
import { resolveDay } from "./assistantContext.js";
import { ItineraryEditError, prepareItineraryEdit } from "./tripItineraryEditor.js";
import { prepareExpenseOperation } from "./expenses.js";

export class AssistantActionError extends ItineraryEditError {
  constructor(readonly code: string, message: string, status = 400) { super(message, status); }
}
export interface ToolContext { trip: TripDocument; selectedDayId?: string; lastDay?: number | null; lastAttraction?: string | null; evidence: string; locale: SupportedLocale }
const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ł/g, "l").trim();
function clarify(ctx: ToolContext, en: string, pl: string): never { throw new AssistantActionError("CLARIFICATION_REQUIRED", ctx.locale === "pl" ? pl : en); }
function choose<T extends { id: string; name: string }>(ctx: ToolContext, items: T[], ref: string): T {
  if (!items.length) clarify(ctx, "No authorized matching candidate is available. Name an existing trip item or use discovery to find known attractions first.", "Brak pasujących pozycji w tej podróży. Podaj istniejącą pozycję lub najpierw wyszukaj znane atrakcje.");
  const normalized = fold(ref).replace(/^(?:the|my|moj|moja)\s+/, "");
  const exact = items.filter(item => item.id === ref || fold(item.name) === normalized);
  const matches = exact.length ? exact : items.filter(item => fold(item.name).includes(normalized));
  if (matches.length !== 1) clarify(ctx, `Choose one exact name or ID: ${(matches.length ? matches : items).slice(0, 12).map(item => `${item.name} [${item.id}]`).join(", ")}.`, `Wybierz dokładną nazwę lub identyfikator: ${(matches.length ? matches : items).slice(0, 12).map(item => `${item.name} [${item.id}]`).join(", ")}.`);
  return matches[0];
}
function day(ctx: ToolContext, reference?: string) {
  let ref = reference ? fold(reference) : null;
  const map: Record<string, string> = { jutro: "tomorrow", dzisiaj: "today", dzis: "today", "ten dzien": "that day", "tego dnia": "that day", "wybrany dzien": "selected day" };
  if (ref) {
    ref = map[ref] ?? ref.replace(/(?:pierwszego|pierwszy)/, "first").replace(/(?:drugiego|drugi)/, "second").replace(/(?:trzeciego|trzeci)/, "third").replace(/(?:czwartego|czwarty)/, "fourth").replace(/(?:piaty|piatego)/, "fifth").replace(/(?:szosty|szostego)/, "sixth").replace(/(?:siodmy|siodmego)/, "seventh").replace(/dzien|dnia/, "day");
    const number = /^(?:day\s*)?(\d+)$/.exec(ref)?.[1]; if (number) ref = number;
  }
  const zone = ctx.trip.itinerary?.timeZone;
  if (ref === "today" || ref === "tomorrow") {
    try { if (!zone) throw new Error(); new Intl.DateTimeFormat("en", { timeZone: zone }); } catch { clarify(ctx, "Which trip date do you mean? The destination timezone is unknown.", "Którą datę podróży masz na myśli? Strefa czasowa celu jest nieznana."); }
  }
  const matches = resolveDay(ctx.trip.toObject().itinerary!.days.map(d => ({ ...d, timeZone: zone || d.timeZone })), ref, ctx.lastDay ?? null, ctx.selectedDayId);
  if (matches.length !== 1) clarify(ctx, "Which itinerary day do you mean? Use its day number or date.", "Który dzień planu masz na myśli? Podaj numer dnia lub datę.");
  return ctx.trip.itinerary!.days.find(d => d.dayIndex === matches[0].dayIndex)!;
}
function attraction(ctx: ToolContext, reference: string, dayReference?: string, unscheduled = false) {
  const selected = dayReference ? day(ctx, dayReference) : undefined;
  const scheduled = ctx.trip.itinerary!.days.flatMap(d => d.activities.filter(a => a.type === "attraction" && a.placeId).map(a => ({ id: a.placeId!, name: a.title, dayIndex: d.dayIndex })));
  let items = unscheduled ? ctx.trip.attractions.filter(p => p.placeId && !scheduled.some(a => a.id === p.placeId)).map(p => ({ id: p.placeId!, name: p.name, dayIndex: 0 })) : scheduled.filter(a => !selected || a.dayIndex === selected.dayIndex);
  const ref = fold(reference);
  if (!unscheduled && /^(?:it|that (?:place|museum|attraction)|the museum we discussed|to miejsce|to muzeum|ta atrakcja)$/.test(ref) && ctx.lastAttraction) return choose(ctx, items, ctx.lastAttraction);
  if (!unscheduled && /(?:first|last|second|pierwsz|ostatni|drug)/.test(ref) && /attraction|place|atrakcj|miejsce/.test(ref)) {
    const scope = selected ?? day(ctx); items = items.filter(a => a.dayIndex === scope.dayIndex);
    const index = /last|ostatni/.test(ref) ? items.length - 1 : /second|drug/.test(ref) ? 1 : 0;
    if (items[index]) return items[index];
  }
  if (/^(?:the )?(?:outdoor attraction|outdoor place|atrakcj[ae] (?:na zewnatrz|na swiezym powietrzu))$/.test(ref)) {
    items = items.filter(a => ctx.trip.attractions.find(p => p.placeId === a.id)?.environment === "outdoor");
    if (!items.length) clarify(ctx, "No scheduled attraction has reliable outdoor metadata. Which attraction should I replace? Provide its exact name; I will not infer its environment.", "Żadna zaplanowana atrakcja nie ma wiarygodnego oznaczenia jako plenerowa. Którą atrakcję zastąpić? Podaj dokładną nazwę; nie będę zgadywać jej otoczenia.");
  }
  else if (/^(?:the )?(?:museum|muzeum)$/.test(ref)) items = items.filter(a => /museum|muzeum/i.test(a.name) || ctx.trip.attractions.find(p => p.placeId === a.id)?.category === "museum");
  else return choose(ctx, items, reference);
  if (items.length !== 1) return choose(ctx, items, reference);
  return items[0];
}
function literalMoney(ctx: ToolContext, amount: string | undefined, currency: string | undefined, existingCurrency?: string) {
  if (amount && ![...ctx.evidence.matchAll(/\d+(?:[.,]\d+)?/g)].some(match => Number(match[0].replace(",", ".")) === Number(amount))) clarify(ctx, "Specify the exact expense amount.", "Podaj dokładną kwotę wydatku.");
  const aliases: Record<string, string> = { "€": "EUR", "$": "USD", "£": "GBP", euro: "EUR", euros: "EUR", zł: "PLN", zloty: "PLN", zlotych: "PLN", zlote: "PLN" };
  const known = new Set(Intl.supportedValuesOf("currency"));
  const ambiguousWords = new Set(["ALL", "TRY", "MAD", "TOP", "GEL", "BAM", "CUP", "BOB", "PEN"]);
  const mentions = [...ctx.evidence.matchAll(/\b[A-Za-z]{3}\b|€|\$|£|\beuros?\b|\bzlot(?:y|ych|e)\b|zł/gi)].map(match => ({ index: match.index, text: match[0], currency: aliases[match[0].toLowerCase()] ?? match[0].toUpperCase() })).filter(m => known.has(m.currency) && (!ambiguousWords.has(m.currency) || m.text === m.currency));
  const currencies = mentions.map(m => m.currency);
  if (!currency && currencies.length && existingCurrency && currencies.some(c => c !== existingCurrency)) clarify(ctx, "Specify the expense currency to change it explicitly.", "Podaj walutę wydatku, aby jawnie ją zmienić.");
  if (currency && (!currencies.length || !currencies.includes(currency))) clarify(ctx, "Specify the currency explicitly; I will not invent an exchange rate.", "Podaj walutę wprost; nie będę wymyślać kursu wymiany.");
  if (amount && currency && new Set(currencies).size > 1) {
    const paired = mentions.some(m => m.currency === currency && [...ctx.evidence.matchAll(/\d+(?:[.,]\d+)?/g)].some(n => Number(n[0].replace(",", ".")) === Number(amount) && (n.index + n[0].length <= m.index && ctx.evidence.slice(n.index + n[0].length, m.index).trim() === "" || m.index + m.text.length <= n.index && ctx.evidence.slice(m.index + m.text.length, n.index).trim() === "")));
    if (!paired) clarify(ctx, "Specify each amount next to its currency to avoid mixing currencies.", "Podaj każdą kwotę obok jej waluty, aby uniknąć pomieszania walut.");
  }
}
function minorAmount(ctx: ToolContext, amount: string, currency: string) {
  try { return decimalToMinor(amount, currency); } catch { return clarify(ctx, "Specify a supported amount and currency precision.", "Podaj poprawną kwotę z dokładnością odpowiednią dla waluty."); }
}
function resolveRequest(request: AssistantToolRequest, ctx: ToolContext): AssistantValidatedAction {
  switch (request.tool) {
    case "reschedule_attraction": { const a = attraction(ctx, request.arguments.attraction, request.arguments.day); return { domain: "itinerary", tool: request.tool, operation: { type: "reschedule", dayIndex: a.dayIndex, attractionId: a.id, time: request.arguments.time } }; }
    case "move_attraction": { const a = attraction(ctx, request.arguments.attraction, request.arguments.day); return { domain: "itinerary", tool: request.tool, operation: { type: "move", sourceDayIndex: a.dayIndex, targetDayIndex: day(ctx, request.arguments.targetDay).dayIndex, attractionId: a.id } }; }
    case "remove_attraction": { const a = attraction(ctx, request.arguments.attraction, request.arguments.day); return { domain: "itinerary", tool: request.tool, operation: { type: "remove", dayIndex: a.dayIndex, attractionId: a.id } }; }
    case "add_existing_attraction": { const a = attraction(ctx, request.arguments.attraction, undefined, true); return { domain: "itinerary", tool: request.tool, operation: { type: "add", dayIndex: day(ctx, request.arguments.day).dayIndex, attractionId: a.id, ...(request.arguments.position !== undefined ? { position: request.arguments.position } : {}) } }; }
    case "suggest_replacement": {
      const a = attraction(ctx, request.arguments.attraction, request.arguments.day);
      const scheduled = ctx.trip.itinerary!.days.flatMap(d => d.activities.map(v => v.placeId));
      const candidates = ctx.trip.attractions.filter(p => p.placeId && !scheduled.includes(p.placeId) && (!request.arguments.environment || p.environment === request.arguments.environment));
      if (!candidates.length && request.arguments.environment) clarify(ctx, `No known unscheduled ${request.arguments.environment} alternatives have reliable metadata. Choose a known alternative or use Explore to find one first. Opening hours and availability will still need validation.`, "Brak znanych, niezaplanowanych zamienników z wiarygodnym oznaczeniem otoczenia. Wybierz znany zamiennik lub najpierw znajdź go w Odkrywaj. Godziny otwarcia i dostępność nadal wymagają sprawdzenia.");
      const replacement = request.arguments.replacement ? choose(ctx, candidates.map(p => ({ id: p.placeId!, name: p.name })), request.arguments.replacement) : candidates.length === 1 ? { id: candidates[0].placeId!, name: candidates[0].name } : choose(ctx, candidates.map(p => ({ id: p.placeId!, name: p.name })), "");
      return { domain: "itinerary", tool: request.tool, operation: { type: "replace", dayIndex: a.dayIndex, oldAttractionId: a.id, newAttractionId: replacement.id } };
    }
    case "add_expense": {
      const value = request.arguments; literalMoney(ctx, value.amount, value.currency);
      const expense = expenseInputSchema.parse({ title: value.title, amountMinor: minorAmount(ctx, value.amount, value.currency), currency: value.currency, category: value.category, type: value.type, dayId: value.day ? String(day(ctx, value.day).dayIndex) : null, date: value.date ?? null });
      return { domain: "expense", tool: request.tool, operation: { type: "create", requestId: randomUUID(), expense } };
    }
    case "update_expense": {
      const value = request.arguments; const previous = choose(ctx, ctx.trip.toObject().expenses.map(e => ({ id: e.id, name: e.title, expense: e })), value.expense).expense;
      literalMoney(ctx, value.amount, value.currency, previous.currency);
      const currency = value.currency ?? previous.currency;
      if (currency !== previous.currency && value.amount === undefined) clarify(ctx, "Specify a new amount when changing currency; no conversion is available.", "Przy zmianie waluty podaj nową kwotę; przeliczanie walut jest niedostępne.");
      const { id: _id, createdAt: _created, updatedAt: _updated, ...existing } = previous;
      const expense = expenseInputSchema.parse({ ...existing, title: value.title ?? previous.title, currency, amountMinor: value.amount !== undefined ? minorAmount(ctx, value.amount, currency) : previous.amountMinor, category: value.category ?? previous.category, type: value.type ?? previous.type, dayId: value.day ? String(day(ctx, value.day).dayIndex) : previous.dayId, date: value.date !== undefined ? value.date : previous.date });
      return { domain: "expense", tool: request.tool, operation: { type: "update", expenseId: previous.id, expense } };
    }
    case "add_packing_item": case "remove_packing_item": case "update_packing_item_status": throw new AssistantActionError("TOOL_DISABLED", "Use Packing Assistant for packing lists.");
  }
}
const descriptions: Record<AssistantToolName, string> = {
  reschedule_attraction: "Propose a scheduled attraction's exact local HH:mm start; never execute.", move_attraction: "Propose moving one attraction to another trip day.", remove_attraction: "Propose removing exactly one scheduled attraction.", add_existing_attraction: "Propose adding one authorized known unscheduled attraction.", suggest_replacement: "Propose a replacement from known unscheduled attractions; clarify multiple matches.", add_expense: "Propose one expense with literal user amount/currency, category and planned/actual type.", update_expense: "Propose changes to exactly one existing expense; unspecified values stay unchanged.", add_packing_item: "Propose adding one packing item, default count 1, using the user's literal item name.", remove_packing_item: "Propose removing exactly one packing item.", update_packing_item_status: "Propose marking exactly one packing item packed or unpacked.",
};
/** Adapters mutate only a private draft. The single persistence adapter is the
 * owner/version guarded atomic commit in assistantActions, after confirmation. */
async function prepareDraft(trip: TripDocument, action: AssistantValidatedAction, timestamp: string) {
  if (action.domain === "itinerary") {
    const result = await prepareItineraryEdit(trip, { operation: action.operation, expectedVersion: trip.itineraryVersion });
    trip.itinerary = result.itinerary;
    return { affectedDayIndices: result.affectedDayIndices, warnings: result.warnings };
  }
  if (action.domain === "expense") trip.expenses = prepareExpenseOperation(trip, action.operation, trip.budgetRevision ?? 0, timestamp).expenses;
  else throw new AssistantActionError("TOOL_DISABLED", "Packing actions are disabled.");
  return { affectedDayIndices: [], warnings: [] };
}
export const assistantToolRegistry = Object.fromEntries(Object.entries(assistantToolInputs).map(([name, schema]) => [name, {
  name: name as AssistantToolName, description: descriptions[name as AssistantToolName], inputSchema: schema, permission: "authenticated_trip_owner" as const,
  resolve: (args: unknown, ctx: ToolContext) => {
    if (!assistantEnabledToolNames.includes(name as AssistantToolName)) throw new AssistantActionError("TOOL_DISABLED", "Use Packing Assistant for packing lists.");
    return resolveRequest({ tool: name, arguments: schema.parse(args) } as AssistantToolRequest, ctx);
  },
  prepareDraft: (trip: TripDocument, action: AssistantValidatedAction, timestamp: string) => {
    if (action.tool !== name || !assistantEnabledToolNames.includes(action.tool)) throw new AssistantActionError("VALIDATION_FAILED", "Tool is disabled or adapter does not match.");
    return prepareDraft(trip, action, timestamp);
  },
}])) as unknown as Record<AssistantToolName, { name: AssistantToolName; description: string; inputSchema: z.ZodType; permission: "authenticated_trip_owner"; resolve: (args: unknown, ctx: ToolContext) => AssistantValidatedAction; prepareDraft: typeof prepareDraft }>;
export function assistantToolDefinitions() { return Object.values(assistantToolRegistry).filter(tool => assistantEnabledToolNames.includes(tool.name)).map(tool => { const { $schema: _schema, ...parameters } = z.toJSONSchema(tool.inputSchema); return { name: tool.name, description: tool.description, parameters }; }); }

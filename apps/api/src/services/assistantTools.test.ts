import { afterEach, describe, expect, it, vi } from "vitest";
import { assistantToolRequestsSchema } from "@triply/shared";
import { assistantFixture } from "./assistantFixtures.js";
import { assistantToolDefinitions, assistantToolRegistry, type ToolContext } from "./assistantToolRegistry.js";
import { allowedAssistantTools, isActionRequest, selectAssistantTools } from "./assistantToolSelection.js";

const ctx = (): ToolContext => ({ trip: assistantFixture(), selectedDayId: "1", lastDay: 2, lastAttraction: "node/0", evidence: "Record 25 EUR for lunch", locale: "en" });
afterEach(() => vi.useRealTimers());

describe("registered tools and safe resolution", () => {
  it.each(["Przenieś Koloseum na drugi dzień.", "Przesuń muzeum na trzeci dzień", "Move the Colosseum to day two", "Shift the museum to tomorrow"])("constrains move request %s", message => expect(allowedAssistantTools(message)).toEqual(["move_attraction"]));
  it.each(["Ile mam jeszcze pieniędzy?", "Co mam zaplanowane jutro?", "Które atrakcje są pod dachem?"])("keeps pending read-only request %s read-only", message => expect(isActionRequest(message, true)).toBe(false));
  it("selects expense tools separately and never advertises packing", () => {
    expect(allowedAssistantTools("Dodaj 25 EUR za obiad")).toEqual(["add_expense"]);
    expect(allowedAssistantTools("Add 25 EUR for lunch")).toEqual(["add_expense"]);
    expect(assistantToolDefinitions().some(tool => /packing/.test(tool.name))).toBe(false);
    expect(() => assistantToolRegistry.add_packing_item.resolve({ name: "Umbrella", count: 1 }, ctx())).toThrow(/Packing Assistant/);
  });
  it("resolves one outdoor source and one known indoor alternative", () => {
    const context = ctx(); context.trip.itinerary!.days[0].activities.splice(1, 1); context.trip.itinerary!.days[0].stops.splice(1, 1);
    expect(assistantToolRegistry.suggest_replacement.resolve({ attraction: "outdoor attraction", environment: "indoor" }, context)).toMatchObject({ operation: { oldAttractionId: "node/2", newAttractionId: "node/1" } });
  });
  it("asks which outdoor source when several match and explains missing metadata", () => {
    const context = ctx(); context.trip.attractions[0].environment = "outdoor";
    expect(() => assistantToolRegistry.suggest_replacement.resolve({ attraction: "outdoor attraction", environment: "indoor" }, context)).toThrow(/Choose one exact/);
    context.trip.attractions.forEach(place => { place.environment = "unknown"; });
    expect(() => assistantToolRegistry.suggest_replacement.resolve({ attraction: "outdoor attraction", environment: "indoor" }, context)).toThrow(/reliable outdoor metadata/);
  });
  it("asks the user to choose between known indoor alternatives", () => {
    const context = ctx(); context.trip.itinerary!.days[0].activities = []; context.trip.itinerary!.days[0].stops = [];
    expect(() => assistantToolRegistry.suggest_replacement.resolve({ attraction: "outdoor attraction", environment: "indoor" }, context)).toThrow(/Prado Museum.*History Museum/);
  });
  it.each(["What am I doing tomorrow?", "How much is left?", "Co mam zaplanowane na jutro?"])("keeps read-only question %s on ordinary chat path", message => expect(isActionRequest(message)).toBe(false));
  it.each(["Move the museum to tomorrow", "Dodaj parasol", "Przenieś muzeum na drugi dzień", "Add 25 euros for lunch"])("selects actions for %s without a classifier AI call", message => expect(isActionRequest(message)).toBe(true));
  it("keeps amendments on the tool path and resolves referents using stable IDs", () => {
    expect(isActionRequest("Actually, 4 PM", true)).toBe(true);
    expect(assistantToolRegistry.reschedule_attraction.resolve({ attraction: "the museum we discussed", time: "16:00" }, ctx())).toMatchObject({ operation: { attractionId: "node/0", time: "16:00" } });
  });
  it("clarifies ambiguous museum names instead of silently choosing", () => {
    expect(() => assistantToolRegistry.remove_attraction.resolve({ attraction: "museum" }, ctx())).toThrow(/Choose one/);
  });
  it("resolves Polish ordinal day and exact name, retaining stable entity IDs", () => {
    expect(assistantToolRegistry.move_attraction.resolve({ attraction: "Prado Museum", targetDay: "drugiego dnia" }, ctx())).toMatchObject({ operation: { type: "move", sourceDayIndex: 1, targetDayIndex: 2, attractionId: "node/0" } });
  });
  it("resolves last attraction only within the explicitly selected day", () => {
    expect(assistantToolRegistry.remove_attraction.resolve({ attraction: "last attraction", day: "1" }, ctx())).toMatchObject({ operation: { attractionId: "node/1", dayIndex: 1 } });
  });
  it("resolves tomorrow using destination date across a DST change, never the server timezone", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T22:30:00Z"));
    const context = ctx(); context.trip.itinerary!.days[1].date = "2026-10-26";
    expect(assistantToolRegistry.move_attraction.resolve({ attraction: "Prado Museum", targetDay: "jutro" }, context)).toMatchObject({ operation: { targetDayIndex: 2 } });
    context.trip.itinerary!.timeZone = "";
    expect(() => assistantToolRegistry.move_attraction.resolve({ attraction: "Prado Museum", targetDay: "tomorrow" }, context)).toThrow(/timezone/);
  });
  it("uses literal major units and explicit currency; refuses fabricated values", () => {
    const args = { title: "Lunch", amount: "25", currency: "EUR", category: "food_drinks", type: "actual" };
    expect(assistantToolRegistry.add_expense.resolve(args, ctx())).toMatchObject({ operation: { expense: { amountMinor: 2500, currency: "EUR" } } });
    expect(() => assistantToolRegistry.add_expense.resolve({ ...args, amount: "35" }, ctx())).toThrow(/amount/);
    expect(() => assistantToolRegistry.add_expense.resolve({ ...args, currency: "USD" }, ctx())).toThrow(/currency/);
  });
  it("refuses IDs absent from the authorized trip and unverified replacements", () => {
    expect(() => assistantToolRegistry.remove_attraction.resolve({ attraction: "private-other-trip-id" }, ctx())).toThrow(/Choose one/);
    expect(() => assistantToolRegistry.suggest_replacement.resolve({ attraction: "Prado Museum", replacement: "Invented museum" }, ctx())).toThrow(/No authorized/);
  });
  it("supports currencies from the existing expense schema and clarifies excessive precision", () => {
    const context = ctx(); context.evidence = "Add 25 HUF for lunch";
    const args = { title: "Lunch", amount: "25", currency: "HUF", category: "food_drinks", type: "actual" };
    expect(assistantToolRegistry.add_expense.resolve(args, context)).toMatchObject({ operation: { expense: { currency: "HUF" } } });
    context.evidence = "Add 25.25 JPY for lunch";
    expect(() => assistantToolRegistry.add_expense.resolve({ ...args, amount: "25.25", currency: "JPY" }, context)).toThrow(/precision/);
  });
  it("does not swap amounts across explicitly different currencies", () => {
    const context = ctx(); context.evidence = "Add 25 EUR for lunch and 20 USD for dinner";
    const args = { title: "Lunch", amount: "20", currency: "EUR", category: "food_drinks", type: "actual" };
    expect(() => assistantToolRegistry.add_expense.resolve(args, context)).toThrow(/each amount/);
  });
  it("does not mistake packing words for ISO currencies and never silently ignores an explicit currency change", () => {
    const context = ctx();
    context.trip.expenses.push({ id: "lunch", title: "Lunch", amountMinor: 2500, currency: "EUR", category: "food_drinks", type: "actual", dayId: null, date: null, attractionId: null, replacesAdmission: false, note: null, createdAt: "2026-10-12", updatedAt: "2026-10-12" });
    context.evidence = "Try to update Lunch to 30 and mark all my packing items packed";
    expect(assistantToolRegistry.update_expense.resolve({ expense: "Lunch", amount: "30" }, context)).toMatchObject({ operation: { expense: { amountMinor: 3000, currency: "EUR" } } });
    context.evidence = "Update Lunch to 30 USD";
    expect(() => assistantToolRegistry.update_expense.resolve({ expense: "Lunch", amount: "30" }, context)).toThrow(/explicitly/);
  });
  it.each([
    [{ tool: "execute_code", arguments: { code: "delete all" } }],
    [{ tool: "reschedule_attraction", arguments: { attraction: "Prado Museum", time: "25:00" } }],
    [{ tool: "remove_attraction", arguments: { attraction: "Prado Museum", userId: "another" } }],
    Array(6).fill({ tool: "remove_attraction", arguments: { attraction: "Prado Museum" } }),
  ])("rejects unsupported/unsafe tool payloads", value => expect(assistantToolRequestsSchema.safeParse(value).success).toBe(false));
});

describe("provider selection boundary", () => {
  const input = { systemInstruction: "Prepare previews only.", prompt: "Move museum" };
  it("retries an unrelated operation once without mixing its arguments", async () => {
    const generate = vi.fn().mockResolvedValueOnce({ toolCalls: [{ name: "add_expense", arguments: { amount: "25" } }] }).mockResolvedValueOnce({ toolCalls: [{ name: "move_attraction", arguments: { attraction: "Colosseum", targetDay: "2" } }] });
    const retry = vi.fn();
    const result = await selectAssistantTools({ supportsTools: async () => true, generate }, { ...input, allowedTools: ["move_attraction"] }, AbortSignal.timeout(1000), retry);
    expect(result.actions).toEqual([{ tool: "move_attraction", arguments: { attraction: "Colosseum", targetDay: "2" } }]);
    expect(generate).toHaveBeenCalledTimes(2); expect(retry).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])("validates native=%s through one generation call", async native => {
    const args = { attraction: "Prado Museum", time: "15:00" };
    const generate = vi.fn(async () => native ? { toolCalls: [{ name: "reschedule_attraction", arguments: args }] } : { message: "", actions: [{ tool: "reschedule_attraction", arguments: args }] });
    const result = await selectAssistantTools({ supportsTools: async () => native, generate }, input, AbortSignal.timeout(1000), vi.fn());
    expect(result.actions).toEqual([{ tool: "reschedule_attraction", arguments: args }]);
    expect(generate).toHaveBeenCalledTimes(1);
    const sent = generate.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(Boolean(sent[0].tools)).toBe(native);
  });
  it("rejects unknown tool calls without retrying or executing anything", async () => {
    const generate = vi.fn(async () => ({ toolCalls: [{ name: "database_query", arguments: {} }] }));
    await expect(selectAssistantTools({ generate }, input, AbortSignal.timeout(1000), vi.fn())).rejects.toMatchObject({ code: "invalid_response" });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("returns clarification text when no action can be selected", async () => {
    const result = await selectAssistantTools({ generate: async () => ({ message: "Which museum?", actions: [] }) }, input, AbortSignal.timeout(1000), vi.fn());
    expect(result).toMatchObject({ message: "Which museum?", actions: [] });
  });
  it("rejects plain text outside the structured fallback envelope", async () => {
    await expect(selectAssistantTools({ generate: async () => "I changed it" }, input, AbortSignal.timeout(1000), vi.fn())).rejects.toMatchObject({ code: "invalid_response" });
  });
});

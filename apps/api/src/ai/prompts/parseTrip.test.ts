import { BUDGET_TYPE_VALUES, PACE_VALUES } from "@triply/shared";
import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  buildSystemInstruction,
  buildTripAnalysisRequest,
  TRIP_ANALYSIS_SCHEMA,
} from "./parseTrip.js";

describe("TRIP_ANALYSIS_SCHEMA", () => {
  it("requires every top-level field", () => {
    expect(TRIP_ANALYSIS_SCHEMA.required).toEqual([
      "destination",
      "country",
      "startDate",
      "endDate",
      "durationDays",
      "travelers",
      "budget",
      "interests",
      "pace",
      "maxWalkingDistanceKm",
      "notes",
    ]);
  });

  it("describes the budget object", () => {
    const budget = TRIP_ANALYSIS_SCHEMA.properties?.budget;
    expect(budget?.required).toEqual(["amount", "currency", "type"]);
    expect(Object.keys(budget?.properties ?? {})).toEqual(["amount", "currency", "type"]);
    expect(budget?.properties?.type?.enum).toEqual([...BUDGET_TYPE_VALUES, "per_day"]);
  });

  it("limits pace to the shared values", () => {
    expect(TRIP_ANALYSIS_SCHEMA.properties?.pace?.enum).toEqual([...PACE_VALUES]);
  });
});

describe("buildSystemInstruction", () => {
  it("states the core parsing rules", () => {
    const instruction = buildSystemInstruction();

    expect(instruction).toContain("structured trip requirements");
    expect(instruction).toContain("Use null for anything unknown");
    expect(instruction).toContain("ISO 4217");
    expect(instruction).toContain("per_day");
    expect(instruction).toContain("Return only the JSON object");
  });
});

describe("buildPrompt", () => {
  it("includes today's date, badge interests and the request", () => {
    const prompt = buildPrompt("4 days in Barcelona", ["food"]);

    expect(prompt).toMatch(/Today's date is \d{4}-\d{2}-\d{2}\./);
    expect(prompt).toContain("Interests selected from badges: Food.");
    expect(prompt).toContain("Traveller request: 4 days in Barcelona");
  });

  it("says so when no badges were selected", () => {
    const prompt = buildPrompt("anything", []);

    expect(prompt).toContain("No interests were selected from badges.");
  });
});

describe("buildTripAnalysisRequest", () => {
  it("wires the system instruction, prompt and schema together", () => {
    const request = buildTripAnalysisRequest({ prompt: "trip", badges: [] });

    expect(request.systemInstruction).toContain(buildSystemInstruction());
    expect(request.systemInstruction).toContain("natural English");
    expect(request.schema).toBe(TRIP_ANALYSIS_SCHEMA);
    expect(request.prompt).toContain("Traveller request: trip");
  });
});

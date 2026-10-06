import { describe, expect, it, vi } from "vitest";
import { AiError } from "./errors.js";
import { TRIP_ANALYSIS_SCHEMA } from "./prompts/parseTrip.js";
import { createAiService } from "./aiService.js";
import type { AIProvider, AIRequest } from "./types.js";

function capturingProvider(result: unknown): { provider: AIProvider; requests: AIRequest[] } {
  const requests: AIRequest[] = [];

  return {
    requests,
    provider: {
      async generate(request: AIRequest): Promise<unknown> {
        requests.push(request);
        return result;
      },
    },
  };
}

describe("aiService.parseTrip", () => {
  it("builds a provider-independent request and normalizes the model output", async () => {
    const { provider, requests } = capturingProvider({
      destination: "Barcelona",
      country: "Spain",
      startDate: "2026-06-01",
      endDate: null,
      durationDays: 4,
      travelers: 2,
      budget: { amount: "100", currency: "euro", type: "per_day" },
      interests: ["Food", "architecture", "food"],
      pace: "relaxed",
      maxWalkingDistanceKm: "8.4",
      notes: "  Prefer tapas.  ",
    });
    const service = createAiService(provider);

    const analysis = await service.parseTrip({
      prompt: "4 days in Barcelona with my friend",
      badges: ["beach"],
    });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.schema).toBe(TRIP_ANALYSIS_SCHEMA);
    expect(request.systemInstruction).toContain("structured trip requirements");
    expect(request.prompt).toMatch(/Today's date is \d{4}-\d{2}-\d{2}\./);
    expect(request.prompt).toContain("Interests selected from badges: Beach.");
    expect(request.prompt).toContain("Traveller request: 4 days in Barcelona with my friend");

    expect(analysis).toMatchObject({
      destination: "Barcelona",
      country: "Spain",
      startDate: "2026-06-01",
      endDate: "2026-06-04",
      durationDays: 4,
      travelers: 2,
      budget: { amount: 400, currency: "EUR", type: "total" },
      interests: ["food", "architecture", "beach"],
      pace: "relaxed",
      maxWalkingDistanceKm: 8.4,
      notes: "Prefer tapas.",
    });
  });

  it("clamps out-of-range numbers and drops unknown values", async () => {
    const { provider } = capturingProvider({
      destination: "   ",
      durationDays: 99999,
      travelers: -10,
      budget: { amount: -50, currency: "?", type: "sometimes" },
      interests: [42, "Culture"],
      pace: "teleporting",
      maxWalkingDistanceKm: 5000,
    });
    const service = createAiService(provider);

    const analysis = await service.parseTrip({ prompt: "anything", badges: [] });

    expect(analysis).toMatchObject({
      destination: null,
      durationDays: 365,
      travelers: 1,
      budget: { amount: null, currency: null, type: null },
      interests: ["culture"],
      pace: null,
      maxWalkingDistanceKm: 100,
    });
  });

  it("still returns badge interests when the model output is useless", async () => {
    const { provider } = capturingProvider(null);
    const service = createAiService(provider);

    const analysis = await service.parseTrip({ prompt: "", badges: ["food", "nature"] });

    expect(analysis.destination).toBeNull();
    expect(analysis.durationDays).toBeNull();
    expect(analysis.interests).toEqual(["food", "nature"]);
  });

  it("throws an AiError when the output fails final validation", async () => {
    const { provider } = capturingProvider({ notes: "x".repeat(2001) });
    const service = createAiService(provider);

    const error = await service
      .parseTrip({ prompt: "anything", badges: [] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).status).toBe(502);
    expect((error as AiError).code).toBe("invalid_response");
    expect((error as AiError).message).toBe("The AI service returned an unreadable response.");
  });

  it("propagates provider errors unchanged", async () => {
    const sentinel = new AiError("The AI service is busy right now. Please try again in a moment.", 503);
    const provider: AIProvider = {
      async generate(): Promise<unknown> {
        throw sentinel;
      },
    };
    const service = createAiService(provider);

    await expect(service.parseTrip({ prompt: "anything", badges: [] })).rejects.toBe(sentinel);
  });

  it("never lets provider failures leak provider details", async () => {
    const provider: AIProvider = {
      async generate(): Promise<unknown> {
        throw new AiError("The AI service could not complete the request.", 502, {
          provider: "openrouter",
          code: "unavailable",
        });
      },
    };
    const service = createAiService(provider);

    const error = await service
      .parseTrip({ prompt: "anything", badges: [] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).expose).toBe(true);
    expect((error as AiError).message).not.toMatch(/openrouter|api[_-]?key/i);
  });

  it("calls the provider exactly once per parse", async () => {
    const generate = vi.fn(async (): Promise<unknown> => null);
    const service = createAiService({ generate });

    await service.parseTrip({ prompt: "one", badges: [] });
    await service.parseTrip({ prompt: "two", badges: [] });

    expect(generate).toHaveBeenCalledTimes(2);
  });
});

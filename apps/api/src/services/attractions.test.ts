import { afterEach, describe, expect, it, vi } from "vitest";
import type { TripAttraction } from "@triply/shared";
import {
  buildOverpassQuery,
  fetchAttractions,
  selectFilters,
} from "./attractions.js";

function withoutScores(result: TripAttraction[] | null): TripAttraction[] | null {
  if (result === null) {
    return null;
  }

  return result.map(
    ({ score: _score, placeId: _placeId, environment: _environment, openingHours: _openingHours, admission: _admission, ...rest }) => rest,
  );
}

function hasValidScores(result: TripAttraction[] | null): boolean {
  return (
    result !== null &&
    result.every(
      (attraction) =>
        typeof attraction.score === "number" &&
        Number.isInteger(attraction.score) &&
        attraction.score >= 0 &&
        attraction.score <= 100,
    )
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(response: Response) {
  const mock = vi.fn(async (_url: unknown, _init?: unknown): Promise<Response> => response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function stubFetchSequence(responses: Response[]) {
  let call = 0;
  const mock = vi.fn(async (_url: unknown, _init?: unknown): Promise<Response> => {
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return response;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function stubFetchError(error: unknown) {
  const mock = vi.fn(async (_url: unknown, _init?: unknown): Promise<Response> => {
    throw error;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function fastOptions(
  overrides: Partial<Parameters<typeof fetchAttractions>[3]> = {},
): Parameters<typeof fetchAttractions>[3] {
  return {
    endpoints: ["https://overpass.test/api/interpreter"],
    backoffMs: [0, 0],
    totalBudgetMs: 5_000,
    timeoutMs: 5_000,
    ...overrides,
  };
}

function postedQuery(mock: ReturnType<typeof vi.fn>): string {
  const [, init] = mock.mock.calls[0] as [string, RequestInit];
  const body = new URLSearchParams(init.body as string);

  return body.get("data") ?? "";
}

function element(
  type: "node" | "way" | "relation",
  lat: number,
  lng: number,
  tags: Record<string, unknown>,
) {
  if (type === "node") {
    return { type, lat, lon: lng, tags };
  }

  return { type, center: { lat, lon: lng }, tags };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildOverpassQuery", () => {
  it("builds a 5km query with one clause per key and element type", () => {
    const query = buildOverpassQuery(48.85, 2.35, ["food", "beach"]);

    expect(query).toContain("[out:json][timeout:15];");
    expect(query).toContain("(around:5000,48.85,2.35)");
    expect(query).toContain(
      'node["amenity"~"^(restaurant|cafe|fast_food|food_court|ice_cream)$"](around:5000,48.85,2.35);',
    );
    expect(query).toContain(
      'way["natural"~"^(beach)$"](around:5000,48.85,2.35);',
    );
    expect(query).toContain(
      'relation["leisure"~"^(beach_resort)$"](around:5000,48.85,2.35);',
    );
    expect(query.trim().endsWith("out center tags;")).toBe(true);
  });

  it("merges filters that share an OSM key into a single union pattern", () => {
    const query = buildOverpassQuery(48.85, 2.35, ["culture", "nightlife"]);

    const amenityClauses = query
      .split("\n")
      .filter((line) => line.includes('["amenity"~'));

    expect(amenityClauses).toHaveLength(3);
    expect(query).toContain("bar|pub|nightclub|biergarten|casino");
    expect(query).toContain("theatre|arts_centre|library");
    expect(query.split('["amenity"~').length - 1).toBe(3);
  });

  it("falls back to tourism=attraction when no interest maps", () => {
    const query = buildOverpassQuery(48.85, 2.35, ["gardening", "  "]);

    expect(query).toContain('node["tourism"~"^(attraction)$"](around:5000,48.85,2.35);');
    expect(query).not.toContain("restaurant");
  });
});

describe("selectFilters", () => {
  it("returns the fallback filters by reference when nothing maps", () => {
    expect(selectFilters(["unknown-interest"])).toEqual([
      { key: "tourism", values: ["attraction"] },
    ]);
  });

  it("normalizes interest casing and whitespace", () => {
    const filters = selectFilters([" Food ", "FOOD"]);

    expect(filters).toEqual([
      { key: "amenity", values: ["restaurant", "cafe", "fast_food", "food_court", "ice_cream"] },
    ]);
  });

  it("merges value lists for keys shared across interests", () => {
    const filters = selectFilters(["food", "culture", "nightlife"]);
    const amenity = filters.find((filter) => filter.key === "amenity");

    expect(amenity?.values).toEqual(
      expect.arrayContaining(["restaurant", "cafe", "theatre", "bar", "pub"]),
    );
    expect(filters.filter((filter) => filter.key === "amenity")).toHaveLength(1);
  });
});

describe("fetchAttractions", () => {
  it("falls back when HTTP 200 contains an Overpass execution error", async () => {
    const fetchMock = stubFetchSequence([
      jsonResponse({ elements: [], remark: "runtime error: Query timed out" }),
      jsonResponse({ elements: [element("node", 48.85, 2.35, { name: "Museum", tourism: "museum" })] }),
    ]);
    const result = await fetchAttractions(48.85, 2.35, ["culture"], fastOptions({
      endpoints: ["https://primary.test/api/interpreter", "https://mirror.test/api/interpreter"],
    }));
    expect(result?.[0]?.name).toBe("Museum");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not treat a JSON error without elements as an empty result", async () => {
    const fetchMock = stubFetchSequence([
      jsonResponse({ error: "unavailable" }),
      jsonResponse({ elements: [] }),
    ]);
    expect(await fetchAttractions(48.85, 2.35, [], fastOptions())).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reserves time for all three providers when earlier providers time out", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        now += 20_000;
        throw new DOMException("Timed out", "TimeoutError");
      }
      return jsonResponse({ elements: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchAttractions(48.85, 2.35, [], fastOptions({
      endpoints: ["https://one.test", "https://two.test", "https://three.test"],
      totalBudgetMs: 60_000, timeoutMs: 25_000,
    }));
    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(timeoutSpy.mock.calls.map(([timeout]) => timeout)).toEqual([20_000, 20_000, 20_000]);
  });

  it("shares concurrent default requests and briefly caches a successful response", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      elements: [element("node", 51.01, 20.01, { name: "Shared museum", tourism: "museum" })],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const first = fetchAttractions(51.01, 20.01, ["culture"]);
    const second = fetchAttractions(51.01, 20.01, ["culture"]);
    expect(first).toBe(second);
    await first;
    await fetchAttractions(51.01, 20.01, ["culture"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits before retrying a failed default request, then allows recovery", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetchMock = vi.fn(async () => jsonResponse({ error: "bad query" }, 400));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAttractions(51.02, 20.02, [])).toBeNull();
    expect(await fetchAttractions(51.02, 20.02, [])).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 15_001;
    fetchMock.mockImplementation(async () => jsonResponse({ elements: [] }));
    expect(await fetchAttractions(51.02, 20.02, [])).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("posts the query with a Triply user agent and returns categorized elements", async () => {
    const fetchMock = stubFetch(
      jsonResponse({
        elements: [
          element("node", 48.86, 2.34, { name: "Le Louvre", tourism: "museum" }),
          element("way", 48.852, 2.349, { name: "Café de Flore", amenity: "cafe" }),
          element("relation", 48.84, 2.36, { name: "Notre-Dame", building: "cathedral" }),
        ],
      }),
    );

    const result = await fetchAttractions(
      48.85,
      2.35,
      ["culture", "food", "architecture"],
      fastOptions(),
    );

    expect(withoutScores(result)).toEqual([
      { name: "Café de Flore", category: "food", lat: 48.852, lng: 2.349 },
      { name: "Le Louvre", category: "culture", lat: 48.86, lng: 2.34 },
      { name: "Notre-Dame", category: "architecture", lat: 48.84, lng: 2.36 },
    ]);
    expect(hasValidScores(result)).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://overpass.test/api/interpreter");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(
      "Triply/0.1 (trip planning)",
    );
    expect(postedQuery(fetchMock)).toContain("(around:5000,48.85,2.35)");
  });

  it("passes through the OSM id as placeId and the classified environment", async () => {
    stubFetch(
      jsonResponse({
        elements: [
          {
            type: "node",
            id: 12345,
            lat: 48.85,
            lon: 2.35,
            tags: { name: "Café", amenity: "cafe" },
          },
        ],
      }),
    );

    const result = await fetchAttractions(48.85, 2.35, ["food"], fastOptions());

    expect(result?.[0]?.placeId).toBe("node/12345");
    expect(result?.[0]?.environment).toBe("indoor");
  });

  it("retries retryable failures and succeeds on a later attempt", async () => {
    const fetchMock = stubFetchSequence([
      jsonResponse({ error: "busy" }, 504),
      jsonResponse({ error: "busy" }, 504),
      jsonResponse({ elements: [element("node", 48.85, 2.35, { name: "Spot", amenity: "cafe" })] }),
    ]);

    const result = await fetchAttractions(48.85, 2.35, ["food"], fastOptions());

    expect(withoutScores(result)).toEqual([
      { name: "Spot", category: "food", lat: 48.85, lng: 2.35 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable 4xx responses", async () => {
    const fetchMock = stubFetch(jsonResponse({ error: "bad query" }, 400));

    const result = await fetchAttractions(48.85, 2.35, ["food"], fastOptions());

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tries the next endpoint before retrying the primary", async () => {
    const fetchMock = stubFetchSequence([
      jsonResponse({ error: "busy" }, 503),
      jsonResponse({ elements: [element("node", 48.85, 2.35, { name: "Mirror Spot", tourism: "museum" })] }),
    ]);

    const result = await fetchAttractions(48.85, 2.35, ["culture"], {
      endpoints: [
        "https://primary.test/api/interpreter",
        "https://mirror.test/api/interpreter",
      ],
      backoffMs: [0, 0],
      totalBudgetMs: 5_000,
      timeoutMs: 5_000,
    });

    expect(withoutScores(result)).toEqual([
      { name: "Mirror Spot", category: "culture", lat: 48.85, lng: 2.35 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).toEqual([
      "https://primary.test/api/interpreter",
      "https://mirror.test/api/interpreter",
    ]);
  });

  it("gives up when the total time budget is exhausted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = stubFetch(jsonResponse({ error: "busy" }, 503));

    const result = await fetchAttractions(48.85, 2.35, ["food"], {
      endpoints: ["https://primary.test/api/interpreter"],
      backoffMs: [0, 0],
      totalBudgetMs: -1,
      timeoutMs: 5_000,
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries thrown network errors", async () => {
    let call = 0;
    const mock = vi.fn(async (_url: unknown, _init?: unknown): Promise<Response> => {
      call += 1;

      if (call === 1) {
        throw new TypeError("fetch failed");
      }

      return jsonResponse({ elements: [element("node", 48.85, 2.35, { name: "Recovered", amenity: "cafe" })] });
    });
    vi.stubGlobal("fetch", mock);

    const result = await fetchAttractions(48.85, 2.35, ["food"], fastOptions());

    expect(withoutScores(result)).toEqual([
      { name: "Recovered", category: "food", lat: 48.85, lng: 2.35 },
    ]);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("uses the attraction fallback category when interests do not map", async () => {
    stubFetch(
      jsonResponse({
        elements: [element("node", 48.85, 2.35, { name: "Nice Viewpoint", tourism: "attraction" })],
      }),
    );

    const result = await fetchAttractions(48.85, 2.35, ["gardening"], fastOptions());

    expect(withoutScores(result)).toEqual([
      { name: "Nice Viewpoint", category: "attraction", lat: 48.85, lng: 2.35 },
    ]);
  });

  it("skips elements without a name", async () => {
    stubFetch(
      jsonResponse({
        elements: [
          element("node", 48.85, 2.35, { amenity: "cafe" }),
          element("node", 48.85, 2.35, { name: "   ", amenity: "cafe" }),
        ],
      }),
    );

    const result = await fetchAttractions(48.85, 2.35, ["food"], fastOptions());

    expect(result).toEqual([]);
  });

  it("skips centerless ways and malformed coordinates", async () => {
    stubFetch(
      jsonResponse({
        elements: [
          { type: "way", tags: { name: "Broken way" } },
          element("node", Number.NaN, 2.35, { name: "NaN node" }),
          element("node", 48.85, 2.35, { name: "Good node", amenity: "cafe" }),
        ],
      }),
    );

    const result = await fetchAttractions(48.85, 2.35, ["food"], fastOptions());

    expect(withoutScores(result)).toEqual([
      { name: "Good node", category: "food", lat: 48.85, lng: 2.35 },
    ]);
  });

  it("sorts by distance and caps at 60 results", async () => {
    const elements = [];

    for (let index = 0; index < 70; index += 1) {
      const offset = 70 - index;
      elements.push(
        element("node", 48.85 + offset * 0.001, 2.35, {
          name: `Place ${index}`,
          amenity: "cafe",
        }),
      );
    }

    stubFetch(jsonResponse({ elements }));

    const result = await fetchAttractions(48.85, 2.35, ["food"], fastOptions());

    expect(result).toHaveLength(60);
    expect(result?.[0]?.name).toBe("Place 69");
    expect(result?.[59]?.name).toBe("Place 10");
  });

  it("rejects invalid coordinates without calling the network", async () => {
    const fetchMock = stubFetch(jsonResponse({ elements: [] }));

    expect(await fetchAttractions(Number.NaN, 2.35, ["food"], fastOptions())).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when the payload is not valid JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    stubFetch(
      new Response("not json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    expect(await fetchAttractions(48.85, 2.35, ["food"], fastOptions())).toBeNull();
  });

  it("returns a provider failure when elements is missing", async () => {
    stubFetch(jsonResponse({}));

    expect(await fetchAttractions(48.85, 2.35, ["food"], fastOptions())).toBeNull();
  });
});

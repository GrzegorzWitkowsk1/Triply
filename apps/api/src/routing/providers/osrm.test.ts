import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Coordinates } from "@triply/shared";
import { RoutingError } from "../errors.js";
import { createOsrmProvider, type OsrmConfig } from "./osrm.js";

const points: Coordinates[] = [
  { lat: 41.39, lng: 2.17 },
  { lat: 41.4, lng: 2.18 },
];

function makeProvider(overrides: Partial<OsrmConfig> = {}) {
  return createOsrmProvider({
    baseUrl: "https://osrm.test/",
    supportedModes: ["walking", "driving"],
    timeoutMs: 1_000,
    backoffMs: [],
    totalBudgetMs: 5_000,
    ...overrides,
  });
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

function stubFetchSequence(responses: (Response | (() => never))[]) {
  let index = 0;
  const mock = vi.fn(async (_url: unknown, _init?: unknown): Promise<Response> => {
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;

    if (typeof next === "function") {
      return next();
    }

    return next;
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

async function expectRoutingError(
  promise: Promise<unknown>,
  expected: { status: number; code?: string },
): Promise<RoutingError> {
  const error = await promise.catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(RoutingError);
  expect((error as RoutingError).status).toBe(expected.status);
  if (expected.code) {
    expect((error as RoutingError).code).toBe(expected.code);
  }

  return error as RoutingError;
}

const matrixBody = {
  code: "Ok",
  durations: [
    [0, 100],
    [110, 0],
  ],
  distances: [
    [0, 200],
    [210, 0],
  ],
};

const routeBody = {
  code: "Ok",
  routes: [
    {
      distance: 500,
      duration: 60,
      geometry: {
        type: "LineString",
        coordinates: [
          [2.17, 41.39],
          [2.18, 41.4],
        ],
      },
      legs: [
        { distance: 250, duration: 30 },
        { distance: 250, duration: 30 },
      ],
    },
  ],
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createOsrmProvider", () => {
  it("requests a duration/distance table with lng,lat coordinates", async () => {
    const fetchMock = stubFetch(jsonResponse(matrixBody));

    const matrix = await makeProvider().getTravelMatrix(points, "walking");

    expect(matrix.durationsSeconds).toEqual([
      [0, 100],
      [110, 0],
    ]);
    expect(matrix.distancesMeters).toEqual([
      [0, 200],
      [210, 0],
    ]);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/table/v1/walking/2.17,41.39;2.18,41.4");
    expect(new URL(url).searchParams.get("annotations")).toBe("duration,distance");
  });

  it("treats null table cells as unreachable", async () => {
    stubFetch(
      jsonResponse({
        code: "Ok",
        durations: [
          [0, null],
          [null, 0],
        ],
        distances: [
          [0, null],
          [null, 0],
        ],
      }),
    );

    const matrix = await makeProvider().getTravelMatrix(points, "walking");

    expect(matrix.durationsSeconds[0][1]).toBeNull();
    expect(matrix.distancesMeters[1][0]).toBeNull();
  });

  it("rejects malformed table responses", async () => {
    stubFetch(jsonResponse({ code: "Ok", durations: "nope" }));

    await expectRoutingError(makeProvider().getTravelMatrix(points, "walking"), {
      status: 502,
      code: "invalid_response",
    });
  });

  it("parses route legs and keeps GeoJSON [lng,lat] ordering", async () => {
    const fetchMock = stubFetch(jsonResponse(routeBody));

    const route = await makeProvider().getRoute(points, "walking");

    expect(route.distanceMeters).toBe(500);
    expect(route.durationSeconds).toBe(60);
    expect(route.legs).toEqual([
      { fromIndex: 0, toIndex: 1, distanceMeters: 250, durationSeconds: 30 },
      { fromIndex: 1, toIndex: 2, distanceMeters: 250, durationSeconds: 30 },
    ]);
    expect(route.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [2.17, 41.39],
        [2.18, 41.4],
      ],
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/route/v1/walking/2.17,41.39;2.18,41.4");
    expect(new URL(url).searchParams.get("overview")).toBe("full");
    expect(new URL(url).searchParams.get("geometries")).toBe("geojson");
  });

  it("returns null geometry when the route geometry is malformed", async () => {
    stubFetch(
      jsonResponse({
        code: "Ok",
        routes: [{ distance: 10, duration: 5, geometry: { type: "Point", coordinates: [1, 2] } }],
      }),
    );

    const route = await makeProvider().getRoute(points, "walking");

    expect(route.geometry).toBeNull();
    expect(route.distanceMeters).toBe(10);
  });

  it("does not call the provider for an unsupported mode", async () => {
    const fetchMock = stubFetch(jsonResponse(matrixBody));
    const provider = makeProvider({ supportedModes: ["driving"] });

    await expectRoutingError(provider.getTravelMatrix(points, "walking"), {
      status: 400,
      code: "unsupported_mode",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries transient failures and succeeds", async () => {
    const fetchMock = stubFetchSequence([
      jsonResponse({ code: "TooManyRequests" }, 429),
      jsonResponse(matrixBody),
    ]);

    const matrix = await makeProvider({ backoffMs: [0] }).getTravelMatrix(points, "walking");

    expect(matrix.durationsSeconds[0][1]).toBe(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent client errors", async () => {
    const fetchMock = stubFetch(jsonResponse({ code: "InvalidQuery" }, 400));

    await expectRoutingError(makeProvider({ backoffMs: [10] }).getTravelMatrix(points, "walking"), {
      status: 502,
      code: "unavailable",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps timeouts to a timeout error", async () => {
    stubFetchError(Object.assign(new Error("slow"), { name: "TimeoutError" }));

    await expectRoutingError(makeProvider().getTravelMatrix(points, "walking"), {
      status: 504,
      code: "timeout",
    });
  });

  it("maps network failures to an unreachable error", async () => {
    stubFetchError(new Error("connection refused"));

    await expectRoutingError(makeProvider().getRoute(points, "walking"), {
      status: 502,
      code: "unreachable",
    });
  });
});

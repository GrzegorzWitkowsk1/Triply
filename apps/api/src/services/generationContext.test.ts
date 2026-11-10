import { afterEach, expect, it, vi } from "vitest";
import { fetchAttractions } from "./attractions.js";
import { fetchGeoapifyPlaces } from "./geoapify.js";
import { resolveDestination } from "./location.js";
import { generationContext, OperationStoppedError, operationDelay } from "./generationContext.js";

vi.mock("./geoapify.js", () => ({ fetchGeoapifyPlaces: vi.fn(async () => []) }));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const context = (controller: AbortController) => ({ signal: controller.signal, deadline: new Date(Date.now() + 240_000) });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("aborts Overpass transport without retrying or starting a billed fallback", async () => {
  const entered = deferred(); const controller = new AbortController();
  const fetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }); entered.resolve();
  }));
  vi.stubGlobal("fetch", fetch);
  const pending = generationContext.run(context(controller), () => fetchAttractions(48.85, 2.35, ["culture"]));
  const rejected = expect(pending).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
  await entered.promise; controller.abort(new OperationStoppedError("REQUEST_CANCELLED", 499));
  await rejected;
  expect(fetch).toHaveBeenCalledTimes(1); expect(fetchGeoapifyPlaces).not.toHaveBeenCalled();
});

it("retains optional provider failure fallback inside an active overall budget", async () => {
  const controller = new AbortController();
  const fetch = vi.fn(async () => { throw new DOMException("controlled timeout", "TimeoutError"); });
  vi.stubGlobal("fetch", fetch);
  const result = await generationContext.run(context(controller), () => fetchAttractions(48.85, 2.35, ["culture"], {
    endpoints: ["https://overpass.test/a", "https://overpass.test/b"], backoffMs: [],
  }));
  expect(result).toEqual([]); expect(fetch).toHaveBeenCalledTimes(2); expect(fetchGeoapifyPlaces).toHaveBeenCalledTimes(1);
});

it("cancels one geocoding subscriber without cancelling another identical query", async () => {
  const gate = deferred(); const entered = deferred();
  let transportSignal: AbortSignal | null | undefined;
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    transportSignal = init?.signal; entered.resolve(); await gate.promise;
    return Response.json({ results: [{ name: "Paris", latitude: 48.85, longitude: 2.35, country: "France" }] });
  });
  vi.stubGlobal("fetch", fetch);
  const a = new AbortController(); const b = new AbortController();
  const first = generationContext.run(context(a), () => resolveDestination("Paris"));
  const second = generationContext.run(context(b), () => resolveDestination("Paris"));
  const rejected = expect(first).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
  await entered.promise; a.abort(new OperationStoppedError("REQUEST_CANCELLED", 499)); await rejected;
  expect(transportSignal?.aborted).toBe(false);
  gate.resolve(); expect(await second).toMatchObject({ city: "Paris" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("interrupts provider pacing waits when the overall deadline fires", async () => {
  const controller = new AbortController();
  const pending = generationContext.run(context(controller), () => operationDelay(60_000));
  const rejected = expect(pending).rejects.toThrow();
  controller.abort(new OperationStoppedError("GENERATION_DEADLINE_EXCEEDED", 504));
  await rejected;
});

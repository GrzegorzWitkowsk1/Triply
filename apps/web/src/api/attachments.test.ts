import { afterEach, expect, it, vi } from "vitest";
import { analyzeTrip } from "./trips";
afterEach(() => vi.unstubAllGlobals());
it("sends multipart with credentials and automatic boundary when attachments exist", async () => {
  const fetchMock = vi.fn(async (_path: string, _init?: RequestInit) => Response.json({ draftId: "draft" })); vi.stubGlobal("fetch", fetchMock);
  const controller = new AbortController(), file = new File(["Rome"], "places.txt", { type: "text/plain" });
  await analyzeTrip({ prompt: "Rome", badges: [] }, [file], controller.signal);
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  expect(init.body).toBeInstanceOf(FormData); expect((init.body as FormData).get("metadata")).toBe(JSON.stringify({ prompt: "Rome", badges: [] }));
  expect((init.body as FormData).getAll("files")).toHaveLength(1); expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  expect(init.credentials).toBe("include"); expect(init.signal).toBe(controller.signal);
});
it("keeps prompt-only analysis as JSON", async () => {
  const fetchMock = vi.fn(async (_path: string, _init?: RequestInit) => Response.json({ draftId: "draft" })); vi.stubGlobal("fetch", fetchMock);
  await analyzeTrip({ prompt: "Rome", badges: [] }); const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  expect(new Headers(init.headers).get("Content-Type")).toBe("application/json"); expect(init.body).toBe(JSON.stringify({ prompt: "Rome", badges: [] }));
});

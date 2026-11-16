import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it.each([undefined, "", "https://backend.example", "https://backend.example/"])(
  "uses the configured backend or relative fallback (%s) without changing request options",
  async (baseUrl) => {
    vi.stubEnv("VITE_API_URL", baseUrl);
    vi.resetModules();
    const { request } = await import("./client");
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    const body = JSON.stringify({ name: "Trip" });

    await request("/api/trips?locale=pl&snapshot=true", {
      method: "POST", body, signal, cache: "no-store", headers: { "X-Test": "value" },
    });

    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl?.replace(/\/+$/, "") ?? ""}/api/trips?locale=pl&snapshot=true`,
      expect.objectContaining({ method: "POST", body, signal, cache: "no-store", credentials: "include" }),
    );
    const headers = fetch.mock.calls[0]![1].headers as Headers;
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Test")).toBe("value");

    await request("/api/public/trips/token", { credentials: "omit", referrerPolicy: "no-referrer" });
    expect(fetch).toHaveBeenLastCalledWith(
      `${baseUrl?.replace(/\/+$/, "") ?? ""}/api/public/trips/token`,
      expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer" }),
    );
  },
);

it.each(["pdf", "calendar"] as const)("uses the configured backend for owner and public %s downloads", async (format) => {
  vi.stubEnv("VITE_API_URL", "https://backend.example/");
  vi.resetModules();
  const { downloadTripPdf } = await import("./pdf");
  const { downloadTripCalendar } = await import("./calendar");
  const { default: i18n } = await import("../i18n");
  await i18n.changeLanguage("en");
  const download = format === "pdf" ? downloadTripPdf : downloadTripCalendar;
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: "Unavailable" }), { status: 404 }));
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;

  for (const isPublic of [false, true]) {
    await expect(download(isPublic ? { shareToken: "a/b" } : { tripId: "a/b" }, signal)).rejects.toThrow("Unavailable");
    expect(fetch).toHaveBeenLastCalledWith(
      `https://backend.example/api/${isPublic ? "public/trips" : "trips"}/a%2Fb/export/${format}?locale=en`,
      {
        credentials: isPublic ? "omit" : "include", cache: "no-store", referrerPolicy: "no-referrer",
        headers: { Accept: format === "pdf" ? "application/pdf" : "text/calendar" }, signal,
      },
    );
  }
});

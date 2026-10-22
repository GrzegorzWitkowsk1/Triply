import { addDays } from "@triply/shared";
import { analysis, attractions, cities, type City } from "./data.ts";

export class ProviderFixtures {
  calls: string[] = [];
  unexpected: string[] = [];
  weatherFailures = 0;
  packingFailures = 0;
  packingSmart = false;
  geoapifyFallback = false;
  private gates = new Map<string, { promise: Promise<void>; release: () => void }>();

  hold(provider: string): void {
    if (this.gates.has(provider)) throw new Error(`Already holding ${provider}`);
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    this.gates.set(provider, { promise, release });
  }
  release(provider: string): void { this.gates.get(provider)?.release(); this.gates.delete(provider); }
  reset(): void {
    for (const key of this.gates.keys()) this.release(key);
    this.calls = []; this.unexpected = []; this.weatherFailures = 0; this.packingFailures = 0; this.packingSmart = false; this.geoapifyFallback = false;
  }
  private city(lat: number): City {
    const match = (Object.keys(cities) as City[]).find(key => Math.abs(cities[key].lat - lat) < .05);
    if (!match) throw new Error(`No destination fixture for latitude ${lat}`);
    return match;
  }
  private async boundary(provider: string): Promise<void> {
    this.calls.push(provider);
    await this.gates.get(provider)?.promise;
  }
  // Installed only by the test executable, before importing the application.
  // No original fetch fallback: even an unexpected loopback/internal fetch fails.
  install(): void {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const json = (body: unknown) => Response.json(body);
      try {
        if (url.hostname === "generativelanguage.googleapis.com" && url.pathname.endsWith(":generateContent")) {
          const request = JSON.parse(String(init?.body)) as { contents?: { parts?: { text?: string }[] }[]; generationConfig?: { responseSchema?: { properties?: { items?: unknown } } } };
          if (request.generationConfig?.responseSchema?.properties?.items) {
            await this.boundary("packing");
            if (this.packingFailures > 0) { this.packingFailures--; return Promise.reject(new DOMException("Fixture timeout", "TimeoutError")); }
            const context = JSON.parse(request.contents?.[0]?.parts?.[0]?.text ?? "{}") as { activities?: { name: string }[]; trip?: { durationDays?: number } };
            const items = [
              { name: "Walking shoes", category: "clothing", count: 1, reason: context.activities?.length ? `Comfort for your planned visit to ${context.activities[0]!.name}.` : "Comfort for everyday travel." },
              { name: "Phone charger", category: "electronics", count: 1, reason: "Keep your phone charged during travel." },
              { name: "Everyday socks", category: "clothing", count: context.trip?.durationDays ?? 1, reason: "A fresh pair per trip day, per traveler." },
              { name: "Passport", category: "documents", count: 1, reason: "Travel identification." },
            ];
            if (this.packingSmart) items.push({ name: "Rain jacket", category: "clothing", count: 1, reason: "A general weather-protective layer for travel; check local conditions." });
            return json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items, warnings: [] }) }] } }] });
          }
          await this.boundary("ai");
          // Deliberately incomplete provider output exercises the real requirements UI.
          const draft = { ...analysis(), destination: null, country: null, location: null, startDate: null,
            endDate: null, durationDays: null, travelers: null, budget: { amount: null, currency: null, type: null }, interests: [] };
          return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(draft) }] } }] });
        }
        if (url.hostname === "geocoding-api.open-meteo.com" && url.pathname === "/v1/search") {
          await this.boundary("geocoding");
          const name = url.searchParams.get("name") as City;
          if (!(name in cities)) throw new Error(`No geocoding fixture for ${name}`);
          const c = cities[name];
          return json({ results: [{ id: 1, name, country: c.country, country_code: c.code, latitude: c.lat, longitude: c.lng, timezone: c.zone }] });
        }
        if (url.hostname === "api.open-meteo.com" && url.pathname === "/v1/forecast") {
          this.city(Number(url.searchParams.get("latitude")));
          await this.boundary("weather");
          if (this.weatherFailures > 0) {
            this.weatherFailures--;
            return new Response("Transient fixture outage", { status: 503 });
          }
          const start = url.searchParams.get("start_date")!;
          const end = url.searchParams.get("end_date")!;
          const count = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
          if (count < 1 || count > 16) throw new Error("Forecast requested outside supported fixture range");
          return json({ daily: { time: Array.from({ length: count }, (_, i) => addDays(start, i)), weather_code: Array(count).fill(1), temperature_2m_max: Array(count).fill(24) } });
        }
        if (["overpass-api.de", "overpass.private.coffee", "maps.mail.ru"].includes(url.hostname) && url.pathname.endsWith("/interpreter")) {
          await this.boundary("overpass");
          const query = new URLSearchParams(String(init?.body)).get("data") ?? "";
          const latitude = /around:\d+,([\d.-]+),/.exec(query)?.[1];
          const city = this.city(Number(latitude));
          if (this.geoapifyFallback) return new Response("Fixture forces fallback", { status: 503, headers: { "Retry-After": "120" } });
          return json({ elements: attractions(city).map((p, i) => ({ type: "node", id: 1000 + i, lat: p.lat, lon: p.lng,
            tags: { name: p.name, ...(p.category === "food" ? { amenity: "restaurant" } : { historic: "monument" }),
              opening_hours: p.openingHours?.raw, fee: "no", description: `Fixture attraction in ${city}` } })) });
        }
        if (url.hostname === "api.geoapify.com" && url.pathname === "/v2/places") {
          await this.boundary("geoapify");
          const lat = Number(url.searchParams.get("filter")?.split(",")[1]);
          return json({ type: "FeatureCollection", features: attractions(this.city(lat)).map(p => ({ type: "Feature",
            geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: { place_id: p.placeId, name: p.name,
              categories: [p.category === "food" ? "catering.restaurant" : "tourism.sights"],
              datasource: { raw: { historic: "monument", opening_hours: p.openingHours?.raw, fee: "no" } } } })) });
        }
        if (url.hostname === "routing.e2e.invalid" && /\/(table|route)\/v1\/driving\//.test(url.pathname)) {
          await this.boundary("routing");
          const points = url.pathname.split("/").at(-1)!.split(";").map(p => p.split(",").map(Number));
          const distance = (a: number[], b: number[]) => Math.round(Math.hypot((a[0]! - b[0]!) * 84_000, (a[1]! - b[1]!) * 111_000) * 1.15);
          const distances = points.map(a => points.map(b => distance(a, b)));
          const durations = distances.map(row => row.map(d => Math.round(d / 1.2)));
          if (url.pathname.startsWith("/table/")) return json({ code: "Ok", distances, durations });
          const legs = points.slice(1).map((_, i) => ({ distance: distances[i]![i + 1], duration: durations[i]![i + 1] }));
          return json({ code: "Ok", routes: [{ distance: legs.reduce((n, l) => n + l.distance!, 0), duration: legs.reduce((n, l) => n + l.duration!, 0), geometry: { type: "LineString", coordinates: points }, legs }] });
        }
        throw new Error(`Unexpected external request: ${url.origin}${url.pathname}`);
      } catch (error) {
        this.unexpected.push(error instanceof Error ? error.message : String(error));
        throw error;
      }
    }) as typeof fetch;
  }
}

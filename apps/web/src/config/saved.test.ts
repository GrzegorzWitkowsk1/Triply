import { expect, it } from "vitest";
import type { SavedAttraction, SavedDestination } from "@triply/shared";
import { findDestinationByCity } from "@triply/shared";
import { filterSaved, savedCollection, savedMapUrl } from "./saved";

it("sorts Polish names using the selected locale without changing identities", () => {
  const destinations: SavedDestination[] = ["Łódź", "Lublin", "Lwów"].map((city, index) => ({ destinationId: String(index), createdAt: "2026-01-01", destination: { ...findDestinationByCity("Paris", "France")!, city } }));
  const rows = savedCollection(destinations, []);
  expect(filterSaved(rows, "all", "", "name-asc", "pl").map(item => item.key)).toEqual(["destination:1", "destination:2", "destination:0"]);
  expect(rows.map(item => item.key)).toEqual(["destination:0", "destination:1", "destination:2"]);
});

it("keeps ordering deterministic for equal timestamps or names regardless of input order", () => {
  const destinations: SavedDestination[] = ["a", "b"].map(destinationId => ({ destinationId, createdAt: "2026-01-01", destination: findDestinationByCity("Paris", "France") }));
  const first = savedCollection(destinations, []); const second = savedCollection([...destinations].reverse(), []);
  for (const sort of ["recent", "oldest", "name-asc", "name-desc"] as const) expect(filterSaved(first, "all", "", sort).map(row => row.key)).toEqual(filterSaved(second, "all", "", sort).map(row => row.key));
});
it("searches available region metadata and normalizes Unicode whitespace and accents", () => {
  const row = { destinationId: "region-fixture", createdAt: "", destination: { ...findDestinationByCity("Paris", "France")!, region: "Île-de-France" } };
  expect(filterSaved(savedCollection([row], []), "destinations", "  ILE-de-france   PARIS ", "recent")).toHaveLength(1);
});
it("does not produce an invalid link for missing or unsafe snapshot coordinates", () => {
  for (const coordinates of [undefined, { lat: 999, lng: 0 }, { lat: 1, lng: NaN }]) {
    const row = { attractionKey: "osm:node:1", snapshot: { coordinates } } as unknown as SavedAttraction;
    expect(savedMapUrl(savedCollection([], [row])[0]!)).toBeNull();
  }
});

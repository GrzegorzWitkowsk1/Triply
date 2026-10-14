import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import TripMap from "./TripMap";

const mocks = vi.hoisted(() => ({
  clearLayers: vi.fn(), fitBounds: vi.fn(), polyline: vi.fn(), marker: vi.fn(), divIcon: vi.fn(),
  tileLayer: vi.fn(),
}));
vi.mock("leaflet", () => ({ default: {
  map: () => ({ fitBounds: mocks.fitBounds, remove: vi.fn(), flyTo: vi.fn(), getZoom: () => 15 }),
  tileLayer: mocks.tileLayer,
  layerGroup: () => ({ addTo: () => ({ clearLayers: mocks.clearLayers }) }),
  latLngBounds: (coordinates: number[][]) => coordinates,
  polyline: mocks.polyline,
  divIcon: mocks.divIcon,
  marker: mocks.marker,
} }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.tileLayer.mockReturnValue({ addTo: vi.fn() });
  mocks.polyline.mockReturnValue({ addTo: vi.fn() });
  mocks.marker.mockReturnValue({ addTo: () => ({ on: vi.fn(), getElement: () => null }) });
});
afterEach(cleanup);
const center: [number, number] = [48.85, 2.35];
const stops: [number, number][] = [[48.85, 2.35], [48.86, 2.36]];

describe("TripMap itinerary updates", () => {
  it("identifies the site to OSM without sending the shared URL or token", () => {
    render(<TripMap center={center} stops={stops} active={-1} onSelect={() => {}} />);
    expect(mocks.tileLayer).toHaveBeenCalledWith("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      expect.objectContaining({ referrerPolicy: "origin" }));
  });
  it("shows numbered markers without drawing fabricated geometry", () => {
    render(<TripMap center={center} stops={stops} geometry={null} active={-1} onSelect={() => {}} />);
    expect(mocks.marker).toHaveBeenCalledTimes(2);
    expect(mocks.divIcon.mock.calls.map(([options]) => options.html)).toEqual([
      '<div class="trip-marker-inner">1</div>', '<div class="trip-marker-inner">2</div>',
    ]);
    expect(mocks.polyline).not.toHaveBeenCalled();
    expect(mocks.fitBounds).toHaveBeenCalledWith(stops, expect.any(Object));
  });
  it("clears previous routes and markers after an edit removes geometry", () => {
    const view = render(<TripMap center={center} stops={stops} geometry={stops} active={0} onSelect={() => {}} />);
    expect(mocks.polyline).toHaveBeenCalledTimes(1);
    view.rerender(<TripMap center={center} stops={[stops[1]]} geometry={null} active={-1} onSelect={() => {}} />);
    expect(mocks.clearLayers).toHaveBeenCalledTimes(2);
    expect(mocks.marker).toHaveBeenCalledTimes(3);
    expect(mocks.polyline).toHaveBeenCalledTimes(1);
  });
  it("clears the map for an empty day", () => {
    const view = render(<TripMap center={center} stops={stops} geometry={stops} active={0} onSelect={() => {}} />);
    view.rerender(<TripMap center={center} stops={[]} geometry={null} active={-1} onSelect={() => {}} />);
    expect(mocks.clearLayers).toHaveBeenCalledTimes(2);
    expect(mocks.marker).toHaveBeenCalledTimes(2);
    expect(mocks.polyline).toHaveBeenCalledTimes(1);
  });
});

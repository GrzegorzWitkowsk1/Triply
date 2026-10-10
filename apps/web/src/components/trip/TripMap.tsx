import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface TripMapProps {
  center: [number, number];
  stops: [number, number][];
  geometry?: [number, number][] | null;
  active: number;
  onSelect: (index: number) => void;
}

export default function TripMap({
  center,
  stops,
  geometry = null,
  active,
  onSelect,
}: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center,
      zoom: 15,
      scrollWheelZoom: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      markersRef.current = [];
    };
  }, [center]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersRef.current = [];

    const path = geometry && geometry.length > 1 ? geometry : stops;

    if (path.length > 0) {
      L.polyline(path, {
        color: "#f2664b",
        weight: 4,
        dashArray: geometry && geometry.length > 1 ? undefined : "8 6",
      }).addTo(layer);
      map.fitBounds(L.latLngBounds(path), { padding: [28, 28] });
    }

    stops.forEach((pos, i) => {
      const icon = L.divIcon({
        className: "trip-marker",
        html: `<div class="trip-marker-inner">${i + 1}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const marker = L.marker(pos, { icon }).addTo(layer);
      marker.on("click", () => onSelectRef.current(i));
      markersRef.current.push(marker);
    });
  }, [stops, geometry]);

  useEffect(() => {
    markersRef.current.forEach((marker, i) => {
      const inner = marker.getElement()?.querySelector(".trip-marker-inner");
      inner?.classList.toggle("is-active", i === active);
    });

    const map = mapRef.current;
    const target = stops[active];

    if (map && target) {
      map.flyTo(target, Math.max(map.getZoom(), 16), {
        animate: true,
        duration: 0.6,
      });
    }
  }, [active, stops]);

  return <div className="trip-map" ref={containerRef} />;
}

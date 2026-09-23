import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface TripMapProps {
  center: [number, number];
  stops: [number, number][];
  active: number;
  onSelect: (index: number) => void;
}

export default function TripMap({ center, stops, active, onSelect }: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
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
    };
  }, [center]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    if (stops.length > 0) {
      L.polyline(stops, { color: "#f2664b", weight: 4, dashArray: "8 6" }).addTo(layer);
      map.fitBounds(L.latLngBounds(stops), { padding: [28, 28] });
    }

    stops.forEach((pos, i) => {
      const icon = L.divIcon({
        className: "trip-marker",
        html: `<div class="trip-marker-inner${i === active ? " is-active" : ""}">${i + 1}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const marker = L.marker(pos, { icon }).addTo(layer);
      marker.on("click", () => onSelectRef.current(i));
    });
  }, [stops, active]);

  return <div className="trip-map" ref={containerRef} />;
}
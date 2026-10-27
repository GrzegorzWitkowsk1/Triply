import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
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
  useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const attributionRef = useRef(i18n.t("attribution", { ns: "trips/map" }));
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center,
      zoom: 15,
      scrollWheelZoom: false,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      // OSM requires a Referer; send only the origin, never a shared-link token.
      referrerPolicy: "origin",
      attribution: i18n.t("attribution", { ns: "trips/map" }),
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      markersRef.current = [];
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const attribution = i18n.t("attribution", { ns: "trips/map" });
    if (attribution !== attributionRef.current && mapRef.current?.attributionControl) {
      mapRef.current.attributionControl.removeAttribution(attributionRef.current);
      mapRef.current.attributionControl.addAttribution(attribution);
      attributionRef.current = attribution;
    }
    for (const [selector, key] of [[".leaflet-control-zoom-in", "zoomIn"], [".leaflet-control-zoom-out", "zoomOut"]]) {
      const button = container?.querySelector(selector);
      button?.setAttribute("title", i18n.t(key, { ns: "trips/map" }));
      button?.setAttribute("aria-label", i18n.t(key, { ns: "trips/map" }));
    }
    markersRef.current.forEach((marker, index) => {
      const label = i18n.t("marker", { ns: "trips/map", count: index + 1 });
      marker.getElement()?.setAttribute("aria-label", label);
      marker.getElement()?.setAttribute("title", label);
    });
  }, [i18n.resolvedLanguage, stops]);

  useEffect(() => { mapRef.current?.setView?.(center, mapRef.current.getZoom()); }, [center[0], center[1]]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersRef.current = [];

    const path = geometry && geometry.length > 1 ? geometry : [];

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
      const label = i18n.t("marker", { ns: "trips/map", count: i + 1 });
      const marker = L.marker(pos, { icon, title: label, alt: label }).addTo(layer);
      marker.on("click", () => onSelectRef.current(i));
      markersRef.current.push(marker);
    });
    if (path.length === 0 && stops.length > 0) {
      map.fitBounds(L.latLngBounds(stops), { padding: [28, 28], maxZoom: 16 });
    }
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

  return <div className="trip-map" role="region" aria-label={i18n.t("mapLabel", { ns: "trips/map" })} ref={containerRef} />;
}

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import L from "leaflet";
import type { VisitStatus } from "@triply/shared";
import { validCoordinates } from "../../config/journey";
import "leaflet/dist/leaflet.css";

interface TripMapProps {
  center: [number, number];
  stops: [number, number][];
  geometry?: [number, number][] | null;
  active: number;
  stopIds?: string[];
  providerIds?: string[];
  stopNames?: string[];
  stopIndexes?: number[];
  statuses?: VisitStatus[];
  nextStop?: number;
  visible?: boolean;
  onSelect: (index: number) => void;
}

export default function TripMap({
  center,
  stops,
  geometry = null,
  active,
  stopIds = [],
  providerIds = [],
  stopNames = [],
  stopIndexes = [],
  statuses,
  nextStop,
  visible = true,
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
  const stopsKey = JSON.stringify(stops);
  const geometryKey = JSON.stringify(geometry);
  const identityKey = JSON.stringify(stopIds);
  const providerKey = JSON.stringify(providerIds);
  const namesKey = JSON.stringify(stopNames);
  const indexesKey = JSON.stringify(stopIndexes);
  const statusKey = JSON.stringify(statuses);
  const activeMapIndex = stopIndexes.length ? stopIndexes.indexOf(active) : active;
  const logicalIndex = (index: number) => stopIndexes[index] ?? index;
  const markerLabel = (index: number) => `${i18n.t("marker", { ns: "trips/map", count: logicalIndex(index) + 1 })}${stopNames[index] ? `: ${stopNames[index]}` : ""}${statuses?.[index] ? ` · ${i18n.t(statuses[index], { ns: "itinerary/visits" })}${logicalIndex(index) === nextStop ? ` · ${i18n.t("nextPlanned", { ns: "itinerary/journey" })}` : ""}` : ""}`;
  const previousSelection = useRef<{ key: string; active: number } | null>(null);
  const fitOnReveal = useRef(false);

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
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (container.clientWidth > 0 && container.clientHeight > 0) mapRef.current?.invalidateSize?.({ pan: false, animate: false });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !visible) return;
    map.invalidateSize?.({ pan: false, animate: false });
    if (fitOnReveal.current) {
      const path = geometry && geometry.length > 1 && geometry.every(point => validCoordinates(...point)) ? geometry : stops.filter(point => validCoordinates(...point));
      if (path.length) map.fitBounds(L.latLngBounds(path), { padding: [28, 28], maxZoom: 16, animate: false });
      fitOnReveal.current = false;
    } else if (stops[activeMapIndex] && !map.getBounds?.().contains(stops[activeMapIndex])) map.panTo?.(stops[activeMapIndex], { animate: false });
  }, [visible]);

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
  }, [i18n.resolvedLanguage, stopsKey, namesKey]);

  useEffect(() => { mapRef.current?.setView?.(center, mapRef.current.getZoom(), { animate: false }); }, [center[0], center[1]]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersRef.current = [];
    if (!visible) fitOnReveal.current = true;

    const path = geometry && geometry.length > 1 && geometry.every(point => validCoordinates(...point)) ? geometry : [];

    if (path.length > 0) {
      L.polyline(path, {
        color: "#f2664b",
        weight: 4,
        dashArray: geometry && geometry.length > 1 ? undefined : "8 6",
      }).addTo(layer);
      if (visible) map.fitBounds(L.latLngBounds(path), { padding: [28, 28], animate: false });
    }

    stops.forEach((pos, i) => {
      if (!validCoordinates(...pos)) return;
      const icon = L.divIcon({
        className: "trip-marker",
        html: `<div class="trip-marker-inner">${logicalIndex(i) + 1}</div>`,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });
      const label = markerLabel(i);
      const marker = L.marker(pos, { icon, title: label, alt: label }).addTo(layer);
      marker.on("click", () => onSelectRef.current(logicalIndex(i)));
      const element = marker.getElement();
      if (stopIds[i]) element?.setAttribute("data-item-id", stopIds[i]);
      if (providerIds[i] ?? stopIds[i]) element?.setAttribute("data-place-id", providerIds[i] ?? stopIds[i]);
      element?.setAttribute("role", "button");
      element?.addEventListener("keydown", event => {
        if (event.key === " ") { event.preventDefault(); onSelectRef.current(logicalIndex(i)); }
      });
      markersRef.current[i] = marker;
    });
    const validStops = stops.filter(point => validCoordinates(...point));
    if (visible && path.length === 0 && validStops.length > 0) {
      map.fitBounds(L.latLngBounds(validStops), { padding: [28, 28], maxZoom: 16, animate: false });
    }
  }, [stopsKey, geometryKey, identityKey, providerKey, indexesKey]);

  useEffect(() => {
    markersRef.current.forEach((marker, index) => {
      const element = marker.getElement();
      const label = markerLabel(index);
      element?.setAttribute("aria-label", label); element?.setAttribute("title", label);
      const inner = element?.querySelector(".trip-marker-inner");
      for (const status of ["planned", "visited", "skipped"] as const) inner?.classList.toggle(`is-${status}`, statuses?.[index] === status);
      inner?.classList.toggle("is-next", Boolean(statuses) && logicalIndex(index) === nextStop);
    });
  }, [statusKey, nextStop, i18n.resolvedLanguage, namesKey, stopsKey, identityKey, providerKey, indexesKey, geometryKey]);

  useEffect(() => {
    markersRef.current.forEach((marker, i) => {
      const inner = marker.getElement()?.querySelector(".trip-marker-inner");
      inner?.classList.toggle("is-active", i === activeMapIndex);
      marker.getElement()?.setAttribute("aria-pressed", String(i === activeMapIndex));
      marker.setZIndexOffset?.(i === activeMapIndex ? 1000 : 0);
    });

    const map = mapRef.current;
    const target = stops[activeMapIndex];

    const previous = previousSelection.current;
    previousSelection.current = { key: stopsKey, active };
    if (visible && map && target && previous?.key === stopsKey && previous.active !== active && !map.getBounds?.().contains(target)) {
      map.panTo?.(target, { animate: false });
    }
  }, [active, stopsKey, geometryKey, identityKey, providerKey, indexesKey]);

  return <div className="trip-map" role="region" aria-label={i18n.t("mapLabel", { ns: "trips/map" })} ref={containerRef} />;
}

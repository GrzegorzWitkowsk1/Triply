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
  stopIds?: string[];
  stopNames?: string[];
  visible?: boolean;
  onSelect: (index: number) => void;
}

export default function TripMap({
  center,
  stops,
  geometry = null,
  active,
  stopIds = [],
  stopNames = [],
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
  const namesKey = JSON.stringify(stopNames);
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
      const path = geometry && geometry.length > 1 ? geometry : stops;
      if (path.length) map.fitBounds(L.latLngBounds(path), { padding: [28, 28], maxZoom: 16 });
      fitOnReveal.current = false;
    } else if (stops[active] && !map.getBounds?.().contains(stops[active])) map.panTo?.(stops[active], { animate: false });
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
    markersRef.current.forEach((marker, index) => {
      const label = `${i18n.t("marker", { ns: "trips/map", count: index + 1 })}${stopNames[index] ? `: ${stopNames[index]}` : ""}`;
      marker.getElement()?.setAttribute("aria-label", label);
      marker.getElement()?.setAttribute("title", label);
    });
  }, [i18n.resolvedLanguage, stopsKey, namesKey]);

  useEffect(() => { mapRef.current?.setView?.(center, mapRef.current.getZoom()); }, [center[0], center[1]]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersRef.current = [];
    if (!visible) fitOnReveal.current = true;

    const path = geometry && geometry.length > 1 ? geometry : [];

    if (path.length > 0) {
      L.polyline(path, {
        color: "#f2664b",
        weight: 4,
        dashArray: geometry && geometry.length > 1 ? undefined : "8 6",
      }).addTo(layer);
      if (visible) map.fitBounds(L.latLngBounds(path), { padding: [28, 28] });
    }

    stops.forEach((pos, i) => {
      const icon = L.divIcon({
        className: "trip-marker",
        html: `<div class="trip-marker-inner">${i + 1}</div>`,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });
      const label = `${i18n.t("marker", { ns: "trips/map", count: i + 1 })}${stopNames[i] ? `: ${stopNames[i]}` : ""}`;
      const marker = L.marker(pos, { icon, title: label, alt: label }).addTo(layer);
      marker.on("click", () => onSelectRef.current(i));
      const element = marker.getElement();
      if (stopIds[i]) element?.setAttribute("data-place-id", stopIds[i]);
      element?.setAttribute("role", "button");
      element?.addEventListener("keydown", event => {
        if (event.key === " ") { event.preventDefault(); onSelectRef.current(i); }
      });
      markersRef.current.push(marker);
    });
    if (visible && path.length === 0 && stops.length > 0) {
      map.fitBounds(L.latLngBounds(stops), { padding: [28, 28], maxZoom: 16 });
    }
  }, [stopsKey, geometryKey, identityKey]);

  useEffect(() => {
    markersRef.current.forEach((marker, i) => {
      const inner = marker.getElement()?.querySelector(".trip-marker-inner");
      inner?.classList.toggle("is-active", i === active);
      marker.getElement()?.setAttribute("aria-pressed", String(i === active));
      marker.setZIndexOffset?.(i === active ? 1000 : 0);
    });

    const map = mapRef.current;
    const target = stops[active];

    const previous = previousSelection.current;
    previousSelection.current = { key: stopsKey, active };
    if (visible && map && target && previous?.key === stopsKey && previous.active !== active && !map.getBounds?.().contains(target)) {
      map.panTo?.(target, { animate: false });
    }
  }, [active, stopsKey, geometryKey, identityKey]);

  return <div className="trip-map" role="region" aria-label={i18n.t("mapLabel", { ns: "trips/map" })} ref={containerRef} />;
}

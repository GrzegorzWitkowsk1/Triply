import { MapOutlined, ViewListOutlined } from "@mui/icons-material";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";

export type TripMobileView = "plan" | "map";
export default function TripMobileViewSwitch({ value, onChange }: { value: TripMobileView; onChange: (view: TripMobileView) => void }) {
  useTranslation();
  return <div className="trip-mobile-view-switch" role="group" aria-label={i18n.t("mobileView", { ns: "trips/details" })}>
    {(["plan", "map"] as const).map(view => <button key={view} type="button" aria-pressed={value === view}
      aria-controls={view === "plan" ? "trip-day-panel" : "trip-map-panel"} onClick={() => onChange(view)}>
      {view === "plan" ? <ViewListOutlined /> : <MapOutlined />}{i18n.t(view === "plan" ? "planView" : "mapView", { ns: "trips/details" })}
    </button>)}
  </div>;
}

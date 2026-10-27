import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { breakLabel } from "../../i18n/labels";
import type { TimelineBreak } from "../../config/itineraryAdapters";

interface TripBreakCardProps {
  entry: TimelineBreak;
}

export default function TripBreakCard({ entry }: TripBreakCardProps) {
  useTranslation();
  return (
    <div className="break-card">
      <span className="break-title">
        {i18n.t("breakSummary", { ns: "itinerary/editor", name: breakLabel(entry.name), count: entry.minutes })}</span>
      <span className="break-sub">{i18n.t("timeToRecharge", { ns: "itinerary/editor" })}</span>
    </div>
  );
}

import { Alert } from "@mui/material";
import type { ItineraryDay, ItineraryIssue } from "@triply/shared";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { issueMessage } from "../../i18n/labels";

export default function TripDayDiagnostics({ day, issues, hasWarnings }: { day?: ItineraryDay; issues: ItineraryIssue[]; hasWarnings: boolean }) {
  useTranslation();
  if (!hasWarnings && !issues.length) return null;
  const sorted = [...issues].sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error"));
  const unique = sorted.filter((issue, index) => sorted.findIndex(other => other.code === issue.code && other.activityId === issue.activityId) === index);
  return <section className="trip-day-diagnostics" aria-label={i18n.t("dayChecks", { ns: "trips/details" })}>
    <h3>{i18n.t("dayChecks", { ns: "trips/details" })}</h3>
    {unique.length ? unique.map(issue => {
      const attraction = day?.stops.find(stop => stop.placeId === issue.activityId);
      return <Alert key={`${issue.code}:${issue.activityId ?? "day"}`} severity={issue.severity}>
        {attraction && <strong>{attraction.name}: </strong>}{issueMessage(issue)}
      </Alert>;
    }) : <Alert severity="warning">{i18n.t("dimension_schedule", { ns: "itinerary/quality" })}</Alert>}
  </section>;
}

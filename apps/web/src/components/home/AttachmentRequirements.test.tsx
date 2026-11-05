import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { creationContextSchema, type TripAnalysis } from "@triply/shared";
import i18n from "../../i18n";
import AttachmentRequirements from "./AttachmentRequirements";
import RequestedAttractionOutcomes from "../trip/RequestedAttractionOutcomes";

const analysis: TripAnalysis = { destination: "Rome", country: "Italy", startDate: null, endDate: null, durationDays: 3, travelers: 2,
  budget: { amount: 500, currency: "EUR", type: "total" }, interests: ["food"], pace: "balanced", maxWalkingDistanceKm: 5, notes: null };
const context = creationContextSchema.parse({ requestedAttractions: ["Colosseum", "Pantheon"], excludedAttractions: [], adopted: {
  destination: null, country: null, startDate: null, endDate: null, durationDays: null, travelers: null, budget: { amount: null, currency: null, type: null },
  interests: ["food"], pace: null, maxWalkingDistanceKm: null, requestedAttractions: ["Colosseum"], excludedAttractions: [],
} });
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
it("reviews only adopted document facts without attributing direct prompt places to attachments", async () => {
  await act(() => i18n.changeLanguage("en")); render(<AttachmentRequirements context={context} analysis={analysis} />);
  expect(screen.getByText("Colosseum")).toBeInTheDocument(); expect(screen.queryByText("Pantheon")).not.toBeInTheDocument(); expect(screen.getByText(/where feasible/)).toBeInTheDocument();
});
it("does not display superseded supplemental interests after explicit user corrections", () => {
  render(<AttachmentRequirements context={context} analysis={{ ...analysis, interests: ["nature"] }} />);
  expect(screen.queryByText("Food")).not.toBeInTheDocument();
});
it("reports every stable outcome and provider unavailability in Polish", async () => {
  await act(() => i18n.changeLanguage("pl")); render(<RequestedAttractionOutcomes outcomes={[
    { name: "Colosseum", placeId: "node/1", status: "included", reason: null },
    { name: "Pantheon", placeId: "node/2", status: "not_scheduled", reason: "capacity" },
    { name: "Unknown", placeId: null, status: "unresolved", reason: "provider_unavailable" },
    { name: "Closed", placeId: "node/3", status: "excluded", reason: "constraints" },
  ]} />);
  expect(screen.getByText(/Uwzględniono/)).toBeInTheDocument(); expect(screen.getByText(/Nie zmieściło/)).toBeInTheDocument();
  expect(screen.getByText(/Nie znaleziono/)).toBeInTheDocument(); expect(screen.getByText(/Wykluczono/)).toBeInTheDocument(); expect(screen.getByText(/niedostępna/)).toBeInTheDocument();
});

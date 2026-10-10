import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TripAnalysis } from "@triply/shared";
import TripPlanSummaryCard from "./TripPlanSummaryCard";

const analysis: TripAnalysis = {
  destination: "Paris",
  country: "France",
  startDate: "2026-06-01",
  endDate: "2026-06-03",
  durationDays: 3,
  travelers: 2,
  budget: { amount: 500, currency: "EUR", type: "total" },
  interests: ["food"],
  pace: "balanced",
  maxWalkingDistanceKm: 5,
  notes: null,
  location: { lat: 48.85, lng: 2.35 },
};

function renderCard(overrides: Partial<Parameters<typeof TripPlanSummaryCard>[0]> = {}) {
  return render(
    <TripPlanSummaryCard
      analysis={analysis}
      missingFields={[]}
      requirementsComplete
      onEdit={() => {}}
      onGenerate={() => {}}
      isGenerating={false}
      generateError={null}
      {...overrides}
    />,
  );
}

afterEach(cleanup);

describe("TripPlanSummaryCard", () => {
  it("calls onGenerate from the primary action", () => {
    const onGenerate = vi.fn();
    renderCard({ onGenerate });

    fireEvent.click(screen.getByRole("button", { name: "Generate my trip" }));

    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("disables generation until the requirements are complete", () => {
    renderCard({ requirementsComplete: false, missingFields: ["budget"] });

    const button = screen.getByRole("button", {
      name: "Generate my trip",
    }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
  });

  it("shows a generating state and an error message", () => {
    renderCard({ isGenerating: true, generateError: "Generation failed" });

    expect(screen.getByText("Creating your trip…")).toBeTruthy();
    expect(screen.getByText("Generation failed")).toBeTruthy();
  });
});

import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AccountBalanceWalletOutlined,
  AutoFixHighOutlined,
  BackpackOutlined,
  ChevronLeftOutlined,
  ChevronRightOutlined,
  DirectionsWalkOutlined,
  EditOutlined,
  PlaceOutlined,
  ShareOutlined,
} from "@mui/icons-material";
import {
  PACE_VALUES,
  ASKABLE_FIELDS,
  type Pace,
  type RegenerateDayPreview,
  type RegenerateDayRequest,
  type UpdateTripRequirements,
} from "@triply/shared";
import { ApiError } from "../api/client";
import TripRequirementsDialog from "../components/home/TripRequirementsDialog";
import TripLoading from "../components/trip/TripLoading";
import TripStatusCard from "../components/trip/TripStatusCard";
import RegenerateDayDialog from "../components/trip/RegenerateDayDialog";
import TripAssistant from "../components/trip/TripAssistant";
import TripBudgetCard from "../components/trip/TripBudgetCard";
import TripMap from "../components/trip/TripMap";
import TripPreferencesCard from "../components/trip/TripPreferencesCard";
import TripTimeline from "../components/trip/TripTimeline";
import {
  buildDayTimeline,
  dayGeometry,
  dayStops,
  totalItineraryActivities,
  totalWalkingKm,
} from "../config/itineraryAdapters";
import { toTripWeather } from "../config/weather";
import { useGenerateTrip } from "../hooks/useTripGeneration";
import { useUpdateTripRequirements } from "../hooks/useTripAnalysis";
import { useApplyRegeneration, useRegenerateDay } from "../hooks/useTripRegeneration";
import { TRIPS_KEY, useTrip } from "../hooks/useTrips";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const STALE_GENERATION_MS = 2 * 60 * 1000;

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  PLN: "zł",
  CHF: "CHF ",
};

function formatRange(startDate: string | null, endDate: string | null): string {
  if (!startDate) {
    return "Dates to be decided";
  }

  const start = new Date(`${startDate}T00:00:00.000Z`);

  if (Number.isNaN(start.getTime())) {
    return "Dates to be decided";
  }

  const startLabel = `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}`;

  if (!endDate) {
    return startLabel;
  }

  const end = new Date(`${endDate}T00:00:00.000Z`);

  if (Number.isNaN(end.getTime()) || endDate === startDate) {
    return startLabel;
  }

  const endLabel =
    start.getUTCMonth() === end.getUTCMonth()
      ? String(end.getUTCDate())
      : `${MONTHS[end.getUTCMonth()]} ${end.getUTCDate()}`;

  return `${startLabel}-${endLabel}`;
}

function formatBudget(amount: number | null, currency: string | null): string | null {
  if (amount === null) {
    return null;
  }

  const symbol = currency ? CURRENCY_SYMBOLS[currency] ?? `${currency} ` : "";

  return `${symbol}${Math.round(amount)}`;
}

function paceIndex(pace: Pace | null): number {
  const index = PACE_VALUES.indexOf(pace ?? "balanced");

  return index >= 0 ? index : 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

export default function TripPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const trip = useTrip(id);
  const generate = useGenerateTrip();
  const regenerate = useRegenerateDay();
  const applyRegeneration = useApplyRegeneration();
  const saveRequirements = useUpdateTripRequirements();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const [activeDay, setActiveDay] = useState(0);
  const [activeStop, setActiveStop] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [pace, setPace] = useState(1);
  const [walking, setWalking] = useState(1);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [regenerationPreview, setRegenerationPreview] =
    useState<RegenerateDayPreview | null>(null);
  const autoStartRef = useRef<string | null>(null);

  const analysis = trip.data?.analysis ?? null;
  const itinerary = trip.data?.itinerary ?? null;
  const status = trip.data?.status ?? "draft";

  const isGenerating = status === "generating" || generate.isPending;
  const isFailed = !isGenerating && (status === "failed" || generate.isError);

  useEffect(() => {
    setTags(analysis?.interests ?? []);
    setPace(paceIndex(analysis?.pace ?? null));
  }, [analysis?.interests, analysis?.pace]);

  const dayCount = itinerary?.days.length ?? analysis?.durationDays ?? 0;

  useEffect(() => {
    setActiveDay((current) => Math.min(current, Math.max(dayCount - 1, 0)));
  }, [dayCount, id]);

  useEffect(() => {
    setActiveStop(0);
  }, [id]);

  const autoStart =
    (location.state as { autoStart?: boolean } | null)?.autoStart ?? false;

  useEffect(() => {
    if (!id || !trip.data || !autoStart || autoStartRef.current === id || status !== "draft" || generate.isPending) {
      return;
    }

    autoStartRef.current = id;
    navigate(location.pathname, { replace: true });
    generate.mutate(id);
  }, [autoStart, id, trip.data, status, location.pathname, navigate, generate.mutate, generate.isPending]);

  if (trip.isPending) {
    return (
      <div className="trip-page">
        <div className="trip-inner">
          <TripLoading />
        </div>
      </div>
    );
  }

  if (trip.isError || !trip.data || !analysis) {
    const notFound = trip.error instanceof ApiError && trip.error.status === 404;
    return (
      <div className="trip-page"><div className="trip-inner">
        <TripStatusCard
          isError
          title={notFound ? "This trip couldn't be found" : "We couldn't load your trip"}
          message={notFound ? "The trip may have been removed or the link is incorrect." : errorMessage(trip.error)}
          actionLabel={notFound ? "View my trips" : "Try again"}
          onAction={() => { if (notFound) navigate("/trips"); else void trip.refetch(); }}
          disabled={trip.isFetching}
          onBack={() => navigate("/trips")}
        />
      </div></div>
    );
  }

  const city = analysis.destination ?? "Untitled trip";
  const country = analysis.country ?? "";
  const days = itinerary?.days.length ?? analysis.durationDays ?? 0;
  const dateLabel = formatRange(analysis.startDate, analysis.endDate);
  const day = itinerary?.days[activeDay];
  const dayWeather = trip.data.weather[activeDay];
  const weather = dayWeather ? toTripWeather(dayWeather) : null;
  const WeatherIcon = weather?.icon ?? null;

  const center = analysis.location
    ? ([analysis.location.lat, analysis.location.lng] as [number, number])
    : null;
  const entries = day ? buildDayTimeline(day) : [];
  const stops = dayStops(day);
  const geometry = dayGeometry(day);

  const totalActivities = itinerary ? totalItineraryActivities(itinerary) : 0;
  const walkingKm = itinerary ? totalWalkingKm(itinerary) : null;
  const budgetLabel = formatBudget(analysis.budget.amount, analysis.budget.currency);
  const budgetAmount = analysis.budget.amount;
  const budgetSymbol = analysis.budget.currency
    ? CURRENCY_SYMBOLS[analysis.budget.currency] ?? `${analysis.budget.currency} `
    : "€";

  const generationStartedAt = trip.data.generation.startedAt;
  const isGenerationStale =
    status === "generating" &&
    generationStartedAt !== null &&
    Date.now() - Date.parse(generationStartedAt) > STALE_GENERATION_MS;

  const toggleTag = (tagId: string) => {
    setTags((current) =>
      current.includes(tagId)
        ? current.filter((tag) => tag !== tagId)
        : [...current, tagId]
    );
  };

  const handleGenerate = () => {
    if (!id || generate.isPending) {
      return;
    }

    generate.reset();
    generate.mutate(id);
  };

  const handleSaveRequirements = (payload: UpdateTripRequirements) => {
    if (!id || saveRequirements.isPending) return;
    saveRequirements.mutate({ draftId: id, ...payload }, {
      onSuccess: () => {
        setEditOpen(false);
        generate.reset();
        void queryClient.invalidateQueries({ queryKey: TRIPS_KEY });
      },
    });
  };

  const dayIndex = day?.dayIndex ?? activeDay + 1;

  const openRegenerate = () => {
    regenerate.reset();
    applyRegeneration.reset();
    setRegenerationPreview(null);
    setRegenerateOpen(true);
  };

  const handleRegenerationRequest = (
    request: RegenerateDayRequest,
  ) => {
    if (!id) {
      return;
    }

    setRegenerationPreview(null);
    regenerate.mutate(
      { tripId: id, dayIndex, request },
      { onSuccess: setRegenerationPreview },
    );
  };

  const handleApplyRegeneration = () => {
    if (!id || !regenerationPreview) {
      return;
    }

    applyRegeneration.mutate(
      {
        tripId: id,
        dayIndex: regenerationPreview.dayIndex,
        previewId: regenerationPreview.previewId,
      },
      {
        onSuccess: () => {
          setRegenerateOpen(false);
          setRegenerationPreview(null);
        },
      },
    );
  };

  const regenerationError =
    regenerate.error || applyRegeneration.error
      ? errorMessage(regenerate.error ?? applyRegeneration.error)
      : null;

  return (
    <div className="trip-page">
      <div className="trip-inner">
        <section className="trip-hero">
          <div className="trip-hero-locale">
            <p className="trip-eyebrow">Your itinerary</p>
            <h1>
              {city}
              {country ? `, ${country}` : ""}
            </h1>
            <p className="trip-hero-sub">
              {dateLabel}
              {days > 0 ? ` · ${days} days` : ""}
            </p>
            <div className="trip-hero-badges">
              {status === "ready" && WeatherIcon && weather && (
                <span className="trip-badge">
                  <WeatherIcon /> {weather.temp}° {weather.label}
                </span>
              )}
              {budgetLabel && (
                <span className="trip-badge is-budget is-ok">
                  <AccountBalanceWalletOutlined /> {budgetLabel} budget
                </span>
              )}
              {status === "ready" && totalActivities > 0 && (
                <span className="trip-badge">
                  <PlaceOutlined /> {totalActivities} activities
                </span>
              )}
              {status === "ready" && walkingKm !== null && (
                <span className="trip-badge">
                  <DirectionsWalkOutlined /> {walkingKm} km walking
                </span>
              )}
            </div>
          </div>
          <div className="trip-hero-actions">
            <button
              type="button"
              className="trip-action"
              onClick={() => navigate(`/trips/${id}/equipment`)}
            >
              <BackpackOutlined />
            </button>
            <button
              type="button"
              className="trip-action"
              onClick={() => navigate("/", { state: { focusPrompt: true } })}
            >
              <EditOutlined /> Edit
            </button>
            <button type="button" className="trip-action">
              <ShareOutlined /> Share
            </button>
            {status === "ready" && (
              <button
                type="button"
                className="trip-action is-primary"
                onClick={openRegenerate}
              >
                <AutoFixHighOutlined /> Regenerate Day
              </button>
            )}
          </div>
        </section>

        {status === "ready" && itinerary ? (
          <div className="trip-content">
            <div className="trip-left">
              <div className="trip-day-header">
                <span className="trip-day-label">
                  Day {activeDay + 1} of {dayCount}
                </span>
                <div className="trip-day-nav">
                  <button
                    type="button"
                    aria-label="Previous day"
                    disabled={activeDay === 0}
                    onClick={() => {
                      setActiveDay((dayIndex) => Math.max(0, dayIndex - 1));
                      setActiveStop(0);
                    }}
                  >
                    <ChevronLeftOutlined />
                  </button>
                  <button
                    type="button"
                    aria-label="Next day"
                    disabled={activeDay >= dayCount - 1}
                    onClick={() => {
                      setActiveDay((dayIndex) =>
                        Math.min(dayCount - 1, dayIndex + 1)
                      );
                      setActiveStop(0);
                    }}
                  >
                    <ChevronRightOutlined />
                  </button>
                </div>
              </div>
              <div className="trip-activity-list">
                <TripTimeline
                  entries={entries}
                  activeStop={activeStop}
                  onSelectStop={setActiveStop}
                />
                {entries.length === 0 && (
                  <p className="trip-eyebrow">
                    No activities were scheduled for this day.
                  </p>
                )}
                {day && day.warnings.length > 0 && (
                  <ul className="trip-eyebrow">
                    {day.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="trip-right">
              {center && (
                <div className="trip-map-wrap">
                  <TripMap
                    center={center}
                    stops={stops}
                    geometry={geometry}
                    active={activeStop}
                    onSelect={setActiveStop}
                  />
                  <p className="trip-map-caption">
                    {itinerary.routingSource === "provider"
                      ? `Walking route through the day's stops in ${city}.`
                      : `Approximate walking route through the day's stops in ${city}.`}
                  </p>
                </div>
              )}
              {budgetAmount !== null && (
                <TripBudgetCard
                  whole={budgetAmount}
                  currencySymbol={budgetSymbol}
                  spent={null}
                  breakdown={null}
                />
              )}
              <TripPreferencesCard
                tags={tags}
                onToggleTag={toggleTag}
                pace={pace}
                onPaceChange={setPace}
                walking={walking}
                onWalkingChange={setWalking}
              />
            </div>
          </div>
        ) : (
          isGenerating ? (
            <TripLoading city={city} isStale={isGenerationStale} onRetry={!generate.isPending ? handleGenerate : undefined} />
          ) : (
            <TripStatusCard
              isError={isFailed}
              hasSavedDetails
              title={isFailed ? "Your itinerary hit a small detour" : "Your trip is ready to generate"}
              message={isFailed
                ? generate.error ? errorMessage(generate.error) : trip.data.generation.error ?? "We couldn't finish your itinerary. Please try again."
                : `${dateLabel}${days > 0 ? ` · ${days} days` : ""} in ${city}. Let's turn your ideas into a day-by-day plan.`}
              actionLabel={isFailed ? "Try again" : "Generate my trip"}
              onAction={handleGenerate}
              disabled={saveRequirements.isPending}
              onBack={() => navigate("/trips")}
              onEdit={() => { saveRequirements.reset(); setEditOpen(true); }}
            />
          )
        )}
      </div>
      <TripRequirementsDialog
        mode="edit"
        key={`${id}:${editOpen}`}
        open={editOpen}
        analysis={analysis}
        missingFields={[...ASKABLE_FIELDS]}
        isSaving={saveRequirements.isPending}
        error={saveRequirements.error ? errorMessage(saveRequirements.error) : null}
        onSave={handleSaveRequirements}
        onClose={() => { if (!saveRequirements.isPending) setEditOpen(false); }}
      />
      <RegenerateDayDialog
        open={regenerateOpen}
        dayNumber={dayIndex}
        preview={regenerationPreview}
        isGenerating={regenerate.isPending}
        isApplying={applyRegeneration.isPending}
        error={regenerationError}
        onGenerate={handleRegenerationRequest}
        onApply={handleApplyRegeneration}
        onEditOptions={() => setRegenerationPreview(null)}
        onClose={() => {
          setRegenerateOpen(false);
          setRegenerationPreview(null);
        }}
      />
      <TripAssistant key={id} city={city} />
    </div>
  );
}

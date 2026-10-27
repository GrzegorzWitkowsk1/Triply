import { resolveMessage, errorKey as localizedErrorKey } from "../i18n/errors";
import { formatDateRange, formatDistance, formatCurrency, formatNumber } from "../i18n/format";
import { issueMessage } from "../i18n/labels";
import { errorMessage as localizedError } from "../i18n/errors";
import { Trans, useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useGuestUsage } from "../hooks/useGuestUsage";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, CircularProgress } from "@mui/material";
import type { ItineraryEditOperation } from "@triply/shared";
import AttractionPicker from "../components/trip/AttractionPicker";
import MoveAttractionDialog from "../components/trip/MoveAttractionDialog";
import { useItineraryEditing } from "../hooks/useItineraryEditing";
import {
  AccountBalanceWalletOutlined,
  AutoFixHighOutlined,
  BackpackOutlined,
  ChevronLeftOutlined,
  ChevronRightOutlined,
  DirectionsWalkOutlined,
  EditOutlined,
  PlaceOutlined,
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
import TripWeatherRetry from "../components/trip/TripWeatherRetry";
import TripPreferencesCard from "../components/trip/TripPreferencesCard";
import TripTimeline from "../components/trip/TripTimeline";
import TripExportActions from "../components/trip/TripExportActions";
import {
  buildDayTimeline,
  dayGeometry,
  dayStops,
  formatDuration,
  totalItineraryActivities,
  totalWalkingKm,
} from "../config/itineraryAdapters";
import { toTripWeather } from "../config/weather";
import { useGenerateTrip } from "../hooks/useTripGeneration";
import { useUpdateTripRequirements } from "../hooks/useTripAnalysis";
import { useApplyRegeneration, useRegenerateDay } from "../hooks/useTripRegeneration";
import { TRIPS_KEY, useTrip } from "../hooks/useTrips";

const STALE_GENERATION_MS = 2 * 60 * 1000;
const WALKING_LIMITS = [3, 5, 10] as const;
function walkingIndex(km: number | null | undefined): number {
  return km == null ? 1 : km <= 3 ? 0 : km <= 5 ? 1 : 2;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  PLN: "zł",
  CHF: "CHF ",
};

function formatRange(startDate: string | null, endDate: string | null): string {
  if (!startDate) return i18n.t("datesToBeDecided", { ns: "trips" });
  try { return formatDateRange(startDate, endDate ?? startDate); }
  catch { return i18n.t("datesToBeDecided", { ns: "trips" }); }
}

function formatBudget(amount: number | null, currency: string | null): string | null {
  if (amount === null) {
    return null;
  }

  return currency ? formatCurrency(Math.round(amount), currency, { maximumFractionDigits: 0, minimumFractionDigits: 0 }) : formatNumber(Math.round(amount));
}

function paceIndex(pace: Pace | null): number {
  const index = PACE_VALUES.indexOf(pace ?? "balanced");

  return index >= 0 ? index : 1;
}

function errorMessage(error: unknown): string {
  return localizedError(error);
}

export default function TripPage() {
  const { t } = useTranslation("itinerary", { i18n });
  const guestUsage = useGuestUsage();
  const generationBlocked = guestUsage.isGuest && (!guestUsage.data || guestUsage.data.aiGenerationsRemaining === 0);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const trip = useTrip(id);
  const generate = useGenerateTrip();
  const regenerate = useRegenerateDay();
  const applyRegeneration = useApplyRegeneration();
  const saveRequirements = useUpdateTripRequirements();
  const queryClient = useQueryClient();
  const itineraryEdit = useItineraryEditing();
  const [picker, setPicker] = useState<{ replaceId?: string } | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [editNotice, setEditNotice] = useState<(() => string) | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const [activeDay, setActiveDay] = useState(0);
  const [activeStop, setActiveStop] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [pace, setPace] = useState(1);
  const [walking, setWalking] = useState(1);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
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
    setWalking(walkingIndex(analysis?.maxWalkingDistanceKm));
  }, [id, analysis?.interests, analysis?.pace, analysis?.maxWalkingDistanceKm]);

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
    if (!id || !trip.data || !autoStart || autoStartRef.current === id || status !== "draft" || generate.isPending || generationBlocked) {
      return;
    }

    autoStartRef.current = id;
    navigate(location.pathname, { replace: true });
    generate.mutate(id);
  }, [autoStart, id, trip.data, status, location.pathname, navigate, generate.mutate, generate.isPending, generationBlocked]);

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
          title={notFound ? i18n.t("thisTripCouldnTBeFound", { ns: "trips/details" }) : i18n.t("weCouldnTLoadYourTrip", { ns: "trips/details" })}
          message={notFound ? i18n.t("theTripMayHaveBeenRemovedOrThe", { ns: "trips/details" }) : errorMessage(trip.error)}
          actionLabel={notFound ? i18n.t("viewMyTrips", { ns: "trips/details" }) : i18n.t("tryAgain", { ns: "common" })}
          onAction={() => { if (notFound) navigate("/trips"); else void trip.refetch(); }}
          disabled={trip.isFetching}
          onBack={() => navigate("/trips")}
        />
      </div></div>
    );
  }

  const city = analysis.destination ?? i18n.t("untitledTrip", { ns: "trips" });
  const country = analysis.country ?? "";
  const days = itinerary?.days.length ?? analysis.durationDays ?? 0;
  const dateLabel = formatRange(analysis.startDate, analysis.endDate);
  const day = itinerary?.days[activeDay];
  const dayWeather = trip.data.weather.find(forecast => forecast.date === day?.date);
  const weather = dayWeather ? toTripWeather(dayWeather) : null;
  const WeatherIcon = weather?.icon ?? null;
  const dayWarnings = (day?.warnings ?? []).filter(warning => !trip.data.weatherAvailability ||
    !/^Weather forecast unavailable for \d{4}-\d{2}-\d{2}\.$/.test(warning));
  const qualityIssues = (trip.data.quality?.issues ?? []).filter(issue =>
    (!issue.dayId || issue.dayId === String(day?.dayIndex)) &&
    (!trip.data.weatherAvailability || !issue.code.startsWith("WEATHER_")));

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
    : "";

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
  const preferencesDirty = pace !== paceIndex(analysis.pace) || walking !== walkingIndex(analysis.maxWalkingDistanceKm)
    || tags.length !== analysis.interests.length || tags.some(tag => !analysis.interests.includes(tag));
  const preferencesDisabled = saveRequirements.isPending || isGenerating || itineraryEdit.isPending || regenerateOpen || applyRegeneration.isPending;
  const cancelPreferences = () => {
    setTags([...analysis.interests]);
    setPace(paceIndex(analysis.pace));
    setWalking(walkingIndex(analysis.maxWalkingDistanceKm));
    setPreferencesError(null);
  };
  const regeneratePreferences = () => {
    if (generationBlocked) { setPreferencesError("trips/details:yourItineraryGenerationAllowanceIsUsedYourCurrent"); return; }
    if (!id || !preferencesDirty || preferencesDisabled) return;
    setPreferencesError(null);
    saveRequirements.mutate({ draftId: id, regenerate: true, confirmedFields: [], answers: {
      interests: tags, pace: PACE_VALUES[pace],
      ...(walking !== walkingIndex(analysis.maxWalkingDistanceKm) ? { maxWalkingDistanceKm: WALKING_LIMITS[walking] } : {}),
    } }, {
      onSuccess: () => {
        setRegenerationPreview(null); setActiveDay(0); setActiveStop(0);
        generate.reset();
        generate.mutate(id);
      },
      onError: error => setPreferencesError(localizedErrorKey(error)),
    });
  };

  const handleGenerate = () => {
    if (!id || generate.isPending || generationBlocked) {
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
  const scheduledStops = day?.stops.filter((stop) => day.activities.some((activity) => activity.type === "attraction" && activity.placeId === stop.placeId)) ?? [];
  const editError = itineraryEdit.error ? (() => {
    const error = itineraryEdit.error;
    const details = error instanceof ApiError ? error.details : null;
    const warnings = details && typeof details === "object" && "warnings" in details && Array.isArray(details.warnings)
      ? details.warnings.filter((warning): warning is string => typeof warning === "string").join(" ") : "";
    return localizedError(error);
  })() : null;
  const submitEdit = (operation: ItineraryEditOperation) => {
    if (!id || itineraryEdit.isPending || regenerate.isPending || applyRegeneration.isPending) return;
    const selectedId = scheduledStops[activeStop]?.placeId;
    setEditNotice(null);
    itineraryEdit.mutate({ tripId: id, operation, expectedVersion: trip.data.itineraryVersion ?? 0 }, {
      onSuccess: (result) => {
        setPicker(null); setMovingId(null); setRegenerationPreview(null);
        const updatedDay = result.trip.itinerary?.days.find((entry) => entry.dayIndex === dayIndex);
        const updatedStops = updatedDay?.stops.filter((stop) => updatedDay.activities.some((activity) => activity.type === "attraction" && activity.placeId === stop.placeId)) ?? [];
        setActiveStop(selectedId ? updatedStops.findIndex((stop) => stop.placeId === selectedId) : -1);
        const routingUnavailable = operation.type === "reroute" && (!updatedDay?.geometry || updatedDay.geometry.coordinates.length < 2);
        setEditNotice(() => () => routingUnavailable
          ? i18n.t("routeMissingWithWarnings", { ns: "trips/details", warnings: "" }).trim()
          : result.warnings.length ? i18n.t("savedWithWarnings", { ns: "trips/details", warnings: i18n.t("dimension_schedule", { ns: "itinerary/quality" }) }) : i18n.t("itinerarySaved", { ns: "trips/details" }));
      },
    });
  };

  const openRegenerate = () => {
    if (itineraryEdit.isPending) return;
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
            <p className="trip-eyebrow">{i18n.t("yourItinerary", { ns: "trips/details" })}</p>
            <h1>
              {city}
              {country ? `, ${country}` : ""}
            </h1>
            <p className="trip-hero-sub">
              {dateLabel}
              {days > 0 ? ` · ${i18n.t("days", { ns: "common", count: days })}` : ""}
            </p>
            <div className="trip-hero-badges">
              {status === "ready" && id && <TripWeatherRetry tripId={id} availability={trip.data.weatherAvailability} date={day?.date}
                forecast={WeatherIcon && weather ? <><WeatherIcon /> {weather.temp}° {weather.label}</> : undefined} />}
              {budgetLabel && (
                <span className="trip-badge is-budget is-ok">
                  <AccountBalanceWalletOutlined /> {budgetLabel} {i18n.t("budgetLabel", { ns: "trips/details" })}
                </span>
              )}
              {status === "ready" && totalActivities > 0 && (
                <span className="trip-badge">
                  <PlaceOutlined /> {i18n.t("activityCount", { ns: "trips", count: totalActivities })}
                </span>
              )}
              {status === "ready" && walkingKm !== null && (
                <span className="trip-badge">
                  <DirectionsWalkOutlined /> {i18n.t("walkingKm", { ns: "trips/details", distance: walkingKm })}
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
              <BackpackOutlined /> {i18n.t("whatShouldITake", { ns: "trips/details" })}</button>
            {/* <button
              type="button"
              className="trip-action"
              onClick={() => navigate("/", { state: { focusPrompt: true } })}
            >
              <EditOutlined /> Edit
            </button> */}
            {status === "ready" && (
              <button
                type="button"
                className="trip-action is-primary"
                disabled={itineraryEdit.isPending}
                onClick={openRegenerate}
              >
                <AutoFixHighOutlined /> {i18n.t("regenerateDay", { ns: "trips/details" })}</button>
            )}
            {id && <TripExportActions key={`export-${id}`} ready={status === "ready"} target={{ tripId: id }} />}
          </div>
        </section>

        {status === "ready" && itinerary ? (
          <div className="trip-content">
            <div className="trip-left">
              <div className="trip-day-header">
                <span className="trip-day-label">
                  {i18n.t("dayPosition", { ns: "common", day: activeDay + 1, total: dayCount })}
                </span>
                <div className="trip-day-nav">
                  <button
                    type="button"
                    aria-label={i18n.t("previousDay", { ns: "common" })}
                    disabled={activeDay === 0 || itineraryEdit.isPending}
                    onClick={() => {
                      setActiveDay((dayIndex) => Math.max(0, dayIndex - 1));
                      setActiveStop(0);
                    }}
                  >
                    <ChevronLeftOutlined />
                  </button>
                  <button
                    type="button"
                    aria-label={i18n.t("nextDay", { ns: "common" })}
                    disabled={activeDay >= dayCount - 1 || itineraryEdit.isPending}
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
                {day && <p className="trip-eyebrow">
                  {i18n.t("daySummary", { ns: "trips/details", count: scheduledStops.length, visiting: formatDuration(day.totalVisitMinutes), travel: formatDuration(day.totalTravelMinutes) })}
                  {day.totalDistanceMeters !== null ? ` · ${formatDistance(day.totalDistanceMeters)}` : ` · ${i18n.t("distanceUnavailable", { ns: "trips/details" })}`}
                  {day.partiallyEstimated ? ` · ${i18n.t("estimatedTravel", { ns: "trips/details" })}` : ""}
                </p>}
                <button type="button" className="trip-action" disabled={itineraryEdit.isPending || regenerateOpen} onClick={() => { itineraryEdit.reset(); setPicker({}); }}>{t("addAttraction")}</button>
                {itineraryEdit.isPending && <p role="status">{t("saving")}</p>}
                {editError && <Alert severity="error">{editError}</Alert>}
                {editNotice && <Alert severity={itineraryEdit.data?.warnings.length || itineraryEdit.variables?.operation.type === "reroute" ? "warning" : "success"}>{editNotice()}</Alert>}
                <TripTimeline
                  tripId={id}
                  entries={entries}
                  activeStop={activeStop}
                  onSelectStop={setActiveStop}
                  saving={itineraryEdit.isPending || regenerateOpen}
                  onReorder={(attractionIds) => submitEdit({ type: "reorder", dayIndex, attractionIds })}
                  onAction={(action, attractionId) => {
                    itineraryEdit.reset(); setEditNotice(null);
                    if (action === "remove") submitEdit({ type: "remove", dayIndex, attractionId });
                    if (action === "replace") setPicker({ replaceId: attractionId });
                    if (action === "move") setMovingId(attractionId);
                  }}
                />
                {entries.length === 0 && (
                  <p className="trip-eyebrow">
                    {i18n.t("noActivitiesWereScheduledForThisDay", { ns: "trips/details" })}</p>
                )}
                {dayWarnings.length > 0 && (
                  <ul className="trip-eyebrow trip-day-warnings">
                    {dayWarnings.map((warning) => (
                      <li key={warning}>{i18n.t("dimension_schedule", { ns: "itinerary/quality" })}</li>
                    ))}
                  </ul>
                )}
                {trip.data.quality && qualityIssues.length > 0 && (
                  <Alert severity={trip.data.quality.valid ? "warning" : "error"}>
                    {[...new Set(qualityIssues.sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error")).map(issue => issueMessage(issue)))].slice(0, 4).join(" ")}
                  </Alert>
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
                    {geometry ? <Trans ns="trips/details" i18nKey="mapCaption" values={{ city }} components={{ provider: <a href="https://project-osrm.org/" target="_blank" rel="noreferrer" />, data: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" />, fix: <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer" /> }} /> : i18n.t("stopsInRouteGeometryIsUnavailable", { ns: "trips/details", value0: city })}
                    {!geometry && scheduledStops.length > 0 && <Button
                      size="small"
                      className="trip-routing-retry"
                      disabled={itineraryEdit.isPending || regenerateOpen || regenerate.isPending || applyRegeneration.isPending}
                      startIcon={itineraryEdit.isPending && itineraryEdit.variables?.operation.type === "reroute" ? <CircularProgress size={12} color="inherit" /> : undefined}
                      onClick={() => submitEdit({ type: "reroute", dayIndex })}
                    >
                      {itineraryEdit.isPending && itineraryEdit.variables?.operation.type === "reroute" ? i18n.t("retrying", { ns: "trips/details" }) : i18n.t("retry", { ns: "common" })}
                    </Button>}
                  </p>
                </div>
              )}
              {(
                <TripBudgetCard
                  tripId={trip.data.id}
                  budgetData={trip.data.budgetData}
                  days={trip.data.itinerary?.days ?? []}
                  activeDayIndex={dayIndex}
                  attractions={trip.data.itinerary?.days.flatMap(d => d.stops) ?? []}
                  whole={budgetAmount ?? 0}
                  currencySymbol={budgetSymbol}
                />
              )}
              <TripPreferencesCard
                dirty={preferencesDirty}
                disabled={preferencesDisabled}
                error={resolveMessage(preferencesError)}
                onCancel={cancelPreferences}
                onRegenerate={regeneratePreferences}
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
              title={isFailed ? i18n.t("yourItineraryHitASmallDetour", { ns: "trips/details" }) : i18n.t("yourTripIsReadyToGenerate", { ns: "trips/details" })}
              message={isFailed
                ? generate.error ? errorMessage(generate.error) : i18n.t("weCouldnTFinishYourItineraryPleaseTry", { ns: "trips/details" })
                : i18n.t("draftSummary", { ns: "trips/details", dates: `${dateLabel}${days > 0 ? ` · ${i18n.t("days", { ns: "common", count: days })}` : ""}`, city })}
              actionLabel={isFailed ? i18n.t("tryAgain", { ns: "common" }) : i18n.t("generateMyTrip", { ns: "trips/details" })}
              onAction={handleGenerate}
              disabled={saveRequirements.isPending || generationBlocked}
              onBack={() => navigate("/trips")}
              onEdit={() => { saveRequirements.reset(); setEditOpen(true); }}
            />
          )
        )}
      </div>
      <TripRequirementsDialog
        maxTripDays={guestUsage.isGuest ? guestUsage.data?.maxTripDays : undefined}
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
      {id && <AttractionPicker tripId={id} open={picker !== null} replace={Boolean(picker?.replaceId)} stopCount={scheduledStops.length}
        saving={itineraryEdit.isPending} error={editError} onClose={() => setPicker(null)}
        onConfirm={(attractionId, position) => submitEdit(picker?.replaceId
          ? { type: "replace", dayIndex, oldAttractionId: picker.replaceId, newAttractionId: attractionId }
          : { type: "add", dayIndex, attractionId, position })} />}
      <MoveAttractionDialog open={movingId !== null} sourceDayIndex={dayIndex} days={itinerary?.days ?? []}
        saving={itineraryEdit.isPending} error={editError} onClose={() => setMovingId(null)}
        onConfirm={(targetDayIndex, position) => movingId && submitEdit({ type: "move", sourceDayIndex: dayIndex, targetDayIndex, attractionId: movingId, position })} />
      <RegenerateDayDialog
        aiRemaining={guestUsage.isGuest ? guestUsage.data?.dayRegenerationsRemaining : undefined}
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
      {id && !guestUsage.isGuest && <TripAssistant key={id} city={city} tripId={id} selectedDayId={String(dayIndex)} />}
    </div>
  );
}

import { localizedCollection } from "../config/explore";
import { formatDate } from "../i18n/format";
import { errorMessage as localizedError, errorKey, resolveMessage } from "../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useGuestUsage } from "../hooks/useGuestUsage";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowForwardOutlined,
  AttachFileOutlined,
  CloseOutlined,
  MicOutlined,
} from "@mui/icons-material";
import { Alert, Button, TextField } from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";
import { ASKABLE_FIELDS, collectionForDestination, type DestinationList, type TripAnalysisResult, type UpdateTripRequirements } from "@triply/shared";
import { useDestinationPrefill } from "../hooks/useDestinationPrefill";
import { HOME_BADGES } from "../config/home";
import { buildHomeTripCards } from "../config/tripCards";
import TripCard from "../components/trips/TripCard";
import PlanProgressCard from "../components/home/PlanProgressCard";
import TripPlanSummaryCard from "../components/home/TripPlanSummaryCard";
import TripRequirementsDialog from "../components/home/TripRequirementsDialog";
import { useTrips } from "../hooks/useTrips";
import {
  useAnalyzeTrip,
  useUpdateTripRequirements,
} from "../hooks/useTripAnalysis";
import { useConfirmTrip } from "../hooks/useTripGeneration";
import { useTripPlanning } from "../hooks/useTripPlanning";
import { useAuth } from "../auth/AuthProvider";
import { DEFAULT_PROFILE_PREFERENCES, PACE_VALUES, PROFILE_WALKING_LIMITS } from "@triply/shared";

interface VoiceHint {
  text: string;
  kind: "info" | "error";
}

function errorMessage(error: unknown): string {
  return localizedError(error);
}

const VOICE_ERRORS: Record<string, string> = {
  get "not-allowed"() { return i18n.t("microphonePermissionDeniedAllowTheMicInYour", { ns: "tripCreator/home" }); },
  get "no-speech"() { return i18n.t("noSpeechDetected", { ns: "tripCreator/home" }); },
  get "audio-capture"() { return i18n.t("noMicrophoneFound", { ns: "tripCreator/home" }); },
  get network() { return i18n.t("speechServiceUnreachable", { ns: "tripCreator/home" }); },
};

function getRecognition(): SpeechRecognition | null {
  const Ctor = SpeechRecognition ?? webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export default function HomePage() {
  useTranslation();
  const { user } = useAuth();
  const guestUsage = useGuestUsage();
  const storageBlocked = guestUsage.isGuest && (!guestUsage.data || guestUsage.data.tripCount >= guestUsage.data.tripLimit);
  const location = useLocation();
  const prefill = useDestinationPrefill(location.search, location.state);
  const collectionValues = new URLSearchParams(location.search).getAll("collection");
  const collectionReference = collectionForDestination(collectionValues, prefill.reference.id);
  const collection = collectionReference ? localizedCollection(collectionReference.slug) : undefined;
  const referenceKey = prefill.reference.id ? `${prefill.reference.id}:${collection?.slug ?? ""}` : undefined;
  const [appliedCollection, setAppliedCollection] = useState<string>();
  const [hasCollectionPreferences, setHasCollectionPreferences] = useState(false);
  const handledReference = useRef<string | undefined>(undefined);
  const promptEdited = useRef(false);
  const [prefillConflict, setPrefillConflict] = useState<DestinationList["items"][number] | null>(null);
  const [prompt, setPrompt] = useState("");
  const [selectedDestinationId, setSelectedDestinationId] = useState<string | undefined>();
  const [selectedBadges, setSelectedBadges] = useState<string[]>(user?.preferences?.interests ?? []);
  const badgesEdited = useRef(false);
  const preferencesEdited = useRef(false);
  const [preferences, setPreferences] = useState(user?.preferences ?? DEFAULT_PROFILE_PREFERENCES);
  useEffect(() => {
    if (!badgesEdited.current && !appliedCollection) setSelectedBadges(user?.preferences?.interests ?? []);
    if (!preferencesEdited.current && !appliedCollection) setPreferences(user?.preferences ?? DEFAULT_PROFILE_PREFERENCES);
  }, [user?.preferences]);
  const [files, setFiles] = useState<File[]>([]);
  const [listening, setListening] = useState(false);
  const [voiceHint, setVoiceHint] = useState<VoiceHint | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const interimRef = useRef("");
  const navigate = useNavigate()
  const hadErrorRef = useRef(false);
  const planning = useTripPlanning();
  const analyze = useAnalyzeTrip();
  const saveRequirements = useUpdateTripRequirements();
  const createTrip = useConfirmTrip();
  const tripsQuery = useTrips();
  const myTrips = useMemo(
    () => buildHomeTripCards(tripsQuery.data ?? []),
    [tripsQuery.data, i18n.resolvedLanguage],
  );
  const [draft, setDraft] = useState<TripAnalysisResult | null>(null);
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"complete" | "edit">("complete");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const awaitingPrefill = Boolean(prefill.reference.id && prefill.query.isPending && handledReference.current !== referenceKey);
  const invalidPrefill = Boolean(prefill.reference.error || prefill.query.isError) && !promptEdited.current;
  const canPlan = !storageBlocked && !awaitingPrefill && !invalidPrefill && !prefillConflict && (prompt.trim().length > 0 || selectedBadges.length > 0);
  const isPlanning = planning.hasStarted;
  const showProgress = planning.hasStarted && !planning.isDone;

  const planSummary = prompt.trim()
    ? prompt.trim()
    : selectedBadges
        .map(
          (id) => HOME_BADGES.find((badge) => badge.id === id)?.label ?? "",
        )
        .filter(Boolean)
        .join(", ");

  useEffect(() => {
    const shouldFocus = (location.state as { focusPrompt?: boolean } | null)
      ?.focusPrompt;
    if (shouldFocus) {
      window.scrollTo({ top: 0, behavior: "auto" });
      promptInputRef.current?.focus();
    }
  }, [location.state]);

  const applyDestination = (destination: DestinationList["items"][number]) => {
    const suggestionReference = collectionForDestination(collectionValues, destination.id);
    const suggestions = suggestionReference ? localizedCollection(suggestionReference.slug) : undefined;
    if (!draft && suggestions) {
      setHasCollectionPreferences(true);
      if (!badgesEdited.current) setSelectedBadges([...suggestions.suggestedInterests]);
      if (!preferencesEdited.current) setPreferences(previous => ({ ...previous, pace: suggestions.suggestedPace }));
    }
    setAppliedCollection(suggestions?.slug);
    setSelectedDestinationId(destination.id);
    setPrompt(`Plan a trip to ${destination.city}, ${destination.country}`);
    setPrefillConflict(null); setDraft(null); planning.reset(); setDialogOpen(false);
    handledReference.current = referenceKey; promptEdited.current = false;
    promptInputRef.current?.focus();
  };
  useEffect(() => {
    const destination = prefill.query.data;
    if (!destination || handledReference.current === referenceKey) return;
    handledReference.current = referenceKey;
    if (promptEdited.current || draft || prompt.trim()) setPrefillConflict(destination);
    else applyDestination(destination);
  }, [prefill.query.data, referenceKey]);
  useEffect(() => {
    if (prefill.reference.error || prefill.query.isError) { setSelectedDestinationId(undefined); setAppliedCollection(undefined); }
  }, [prefill.reference.error, prefill.query.isError]);

  const changeDestination = () => {
    handledReference.current = referenceKey;
    promptEdited.current = true; setSelectedDestinationId(undefined); setPrefillConflict(null);
    setPrompt("");
    setAppliedCollection(undefined);
    const params = new URLSearchParams(location.search); params.delete("destinationId"); params.delete("collection");
    navigate({ pathname: "/home", search: params.toString() }, { replace: true, state: null });
    promptInputRef.current?.focus();
  };

  const getOrCreateRecognition = (): SpeechRecognition | null => {
    if (recognitionRef.current) return recognitionRef.current;

    const recognition = getRecognition();
    if (!recognition) {
      setVoiceHint({
        get text() { return i18n.t("voiceTypingIsnTSupportedInThisBrowser", { ns: "tripCreator/home" }); },
        kind: "error",
      });
      return null;
    }

    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }

      setPrompt((prev) => {
        let base = prev;
        if (interimRef.current) {
          base = base.replace(interimRef.current, "");
        }
        const final = finalText.trim();
        const interim = interimText.trim();
        let next = base;
        if (final) {
          next = next ? `${next} ${final}` : final;
        }
        if (interim) {
          next = next ? `${next} ${interim}` : interim;
        }
        return next;
      });

      interimRef.current = interimText.trim();
      if (finalText) {
        setVoiceHint({ text: "tripCreator/home:listening", kind: "info" });
      }
    };

    recognition.onerror = (event) => {
      hadErrorRef.current = true;
      interimRef.current = "";
      setListening(false);
      setVoiceHint({
        get text() { return VOICE_ERRORS[event.error] ?? i18n.t("voiceInputFailed", { ns: "tripCreator/home" }); },
        kind: "error",
      });
    };

    recognition.onend = () => {
      if (!hadErrorRef.current) {
        setVoiceHint(null);
      }
      hadErrorRef.current = false;
      interimRef.current = "";
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    return recognition;
  };

  const startListening = () => {
    promptEdited.current = true;
    if (prefill.query.isPending) handledReference.current = referenceKey;
    const recognition = getOrCreateRecognition();
    if (!recognition) return;

    setVoiceHint({ text: "tripCreator/home:listening", kind: "info" });
    setListening(true);

    try {
      recognition.start();
    } catch {
      setListening(false);
      setVoiceHint({ get text() { return i18n.t("voiceInputFailedToStart", { ns: "tripCreator/home" }); }, kind: "error" });
      recognitionRef.current = null;
    }
  };

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    startListening();
  };

  const onFilesPicked = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  };

  const toggleBadge = (id: string) => {
    badgesEdited.current = true;
    setSelectedBadges((prev) =>
      prev.includes(id) ? prev.filter((badgeId) => badgeId !== id) : [...prev, id],
    );
  };

  const cancelPlan = () => {
    planning.reset();
    setDraft(null);
    setDialogOpen(false);
    setSaveError(null);
    setCreateError(null);
  };

  const startPlan = () => {
    if (!canPlan || analyze.isPending) return;
    setSaveError(null);
    setCreateError(null);
    setDraft(null);
    setVoiceHint(null);
    planning.start();

    analyze.mutate(
      { prompt: prompt.trim(), destinationId: selectedDestinationId, badges: hasCollectionPreferences ? selectedBadges.filter(id => HOME_BADGES.some(badge => badge.id === id)) : selectedBadges, ...(hasCollectionPreferences ? { interests: selectedBadges } : {}), pace: preferences.pace, maxWalkingDistanceKm: preferences.maxWalkingDistanceKm },
      {
        onSuccess: (result) => {
          setDraft(result);
          planning.finish();

          if (result.missingFields.length > 0) {
            setDialogMode(selectedDestinationId ? "edit" : "complete");
            setDialogOpen(true);
          }
        },
        onError: (error) => {
          planning.reset();
          setVoiceHint({ text: errorKey(error), kind: "error" });
        },
      },
    );
  };

  const generateTrip = () => {
    if (guestUsage.isGuest && guestUsage.data?.aiGenerationsRemaining === 0) { setCreateError("tripCreator/home:yourItineraryGenerationAllowanceIsUsedForThe"); return; }
    if (!draft || createTrip.isPending) return;

    setCreateError(null);

    createTrip.mutate(draft.draftId, {
      onSuccess: (trip) => {
        navigate(`/trips/${trip.id}`, { state: { autoStart: true } });
      },
      onError: (error) => setCreateError(errorKey(error)),
    });
  };

  const saveAnswers = (payload: UpdateTripRequirements) => {
    if (!draft) return;

    setSaveError(null);
    setCreateError(null);

    saveRequirements.mutate(
      {
        draftId: draft.draftId,
        answers: payload.answers,
        confirmedFields: payload.confirmedFields,
      },
      {
        onSuccess: (result) => {
          if (hasCollectionPreferences) {
            setSelectedBadges(result.analysis.interests); badgesEdited.current = true;
            if (result.analysis.pace) setPreferences(previous => ({ ...previous, pace: result.analysis.pace! }));
            preferencesEdited.current = true;
          }
          if (draft.analysis.destination !== result.analysis.destination || draft.analysis.country !== result.analysis.country) {
            setAppliedCollection(undefined);
            const params = new URLSearchParams(location.search); params.delete("collection"); params.delete("destinationId");
            navigate({ pathname: "/home", search: params.toString() }, { replace: true, state: null });
            setSelectedDestinationId(result.analysis.destinationId ?? undefined);
            setPrompt(`Plan a trip to ${result.analysis.destination}, ${result.analysis.country}`);
          }
          setDraft(result);
          setDialogOpen(false);
        },
        onError: (error) => setSaveError(errorKey(error)),
      },
    );
  };

  return (
    <div className="home-page">
      <div className="home-inner">
        <p className="home-eyebrow">{i18n.t("yourNextFavoriteTripStartsHere", { ns: "tripCreator/home" })}</p>
        <h1 className="home-title">{i18n.t("planATripYouLlActuallyEnjoy", { ns: "tripCreator/home" })}</h1>
        <p className="home-subtitle">
          {i18n.t("tellTriplyWhereYouReGoingWhatYou", { ns: "tripCreator/home" })}</p>

        <div className="prompt-card">
          {awaitingPrefill && <p role="status">{i18n.t("loadingSelectedDestination", { ns: "tripCreator/home" })}</p>}
          {prefill.reference.error && <Alert severity="warning">{prefill.reference.error}</Alert>}
          {prefill.query.isError && <Alert severity="warning" action={<Button onClick={() => void prefill.query.refetch()}>{i18n.t("retryDestination", { ns: "tripCreator/home" })}</Button>}>{i18n.t("couldNotLoadTheSelectedDestinationItMay", { ns: "tripCreator/home" })}</Alert>}
          {prefillConflict && <Alert severity="info">{i18n.t("draftConflict", { ns: "tripCreator/home", destination: `${prefillConflict.city}, ${prefillConflict.country}` })}
            <Button onClick={() => applyDestination(prefillConflict)}>{i18n.t("useSelectedDestination", { ns: "tripCreator/home" })}</Button><Button onClick={() => setPrefillConflict(null)}>{i18n.t("continueExistingDraft", { ns: "tripCreator/home" })}</Button>
          </Alert>}
          {selectedDestinationId && <Alert severity="info" action={<Button onClick={changeDestination} disabled={isPlanning}>{i18n.t("changeDestination", { ns: "tripCreator/home" })}</Button>}>
            {i18n.t("selectedDestination", { ns: "tripCreator/home", destination: prefill.query.data?.id === selectedDestinationId ? `${prefill.query.data.city}, ${prefill.query.data.country}` : selectedDestinationId })}
          </Alert>}
          {appliedCollection && selectedDestinationId && <p className="collection-prefill-note">{i18n.t("collectionSuggestions", { ns: "tripCreator/home", collection: localizedCollection(appliedCollection)?.title ?? appliedCollection })}</p>}
          {isPlanning ? (
            <div className="prompt-summary">
              <span className="prompt-summary-text">{planSummary}</span>
              <button
                type="button"
                className="prompt-summary-cancel"
                onClick={cancelPlan}
              >
                {i18n.t("cancel", { ns: "common" })}</button>
            </div>
          ) : (
            <>
              {files.length > 0 && (
                <div className="attach-chips">
                  {files.map((file) => (
                    <span key={`${file.name}-${file.lastModified}`} className="attach-chip">
                      <AttachFileOutlined fontSize="small" />
                      {file.name}
                      <button
                        type="button"
                        aria-label={i18n.t("remove", { ns: "tripCreator/home", value0: file.name })}
                        onClick={() =>
                          setFiles((prev) => prev.filter((f) => f !== file))
                        }
                      >
                        <CloseOutlined />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <TextField
                fullWidth
                variant="standard"
                multiline
                rows={3}
                placeholder={i18n.t("promptExample", { ns: "tripCreator/home", date: formatDate(new Date(Date.now() + 86400000), { dateStyle: "short" }) })}
                value={prompt}
                onChange={(e) => {
                  promptEdited.current = true;
                  if (prefill.query.isPending) handledReference.current = referenceKey;
                  setPrompt(e.target.value);
                }}
                slotProps={{
                  input: { disableUnderline: true },
                  htmlInput: { ref: promptInputRef, get "aria-label"() { return i18n.t("describeYourTrip", { ns: "tripCreator/home" }); } },
                }}
              />
              <div className="prompt-divider" />
              <div className="prompt-tools">
                <div className="prompt-tools-left">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      onFilesPicked(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    className="prompt-icon"
                    aria-label={i18n.t("attachments", { ns: "tripCreator/home" })}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <AttachFileOutlined />
                  </button>
                  <button
                    type="button"
                    className={`prompt-icon${listening ? " is-active" : ""}`}
                    aria-label={listening ? i18n.t("stopVoiceWriting", { ns: "tripCreator/home" }) : i18n.t("voiceWriting", { ns: "tripCreator/home" })}
                    onClick={toggleVoice}
                  >
                    <MicOutlined />
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn-primary prompt-submit"
                  disabled={!canPlan}
                  onClick={startPlan}
                >
                  {i18n.t("planMyTrip", { ns: "tripCreator/home" })}<ArrowForwardOutlined fontSize="small" />
                </button>
              </div>
              {voiceHint && (
                <p className={`prompt-hint is-${voiceHint.kind}`} role={voiceHint.kind === "error" ? "alert" : "status"}>{resolveMessage(voiceHint.text)}</p>
              )}
            </>
          )}
        </div>

        {showProgress && (
          <PlanProgressCard statuses={planning.statuses} isDone={planning.isDone} />
        )}

        {draft && (
          <TripPlanSummaryCard
            analysis={draft.analysis}
            missingFields={draft.missingFields}
            requirementsComplete={draft.requirementsComplete}
            onEdit={() => { setDialogMode("edit"); setDialogOpen(true); }}
            onGenerate={generateTrip}
            isGenerating={createTrip.isPending}
            generateError={createError}
          />
        )}

        <div className="home-badges">
          {HOME_BADGES.map((badge) => {
            const Icon = badge.icon;
            const selected = selectedBadges.includes(badge.id);
            return (
              <button
                key={badge.id}
                type="button"
                disabled={isPlanning}
                className={`home-badge${selected ? " is-active" : ""}`}
                aria-pressed={selected}
                style={{ "--badge-color": badge.color } as CSSProperties}
                onClick={() => toggleBadge(badge.id)}
              >
                <Icon sx={{ color: selected ? "#ffffff" : badge.color }} fontSize="small" />
                {badge.label}
              </button>
            );
          })}
        </div>
        <section className="home-section">
          <p className="home-eyebrow">{i18n.t("pickUpWhereYouLeftOff", { ns: "tripCreator/home" })}</p>
          <div className="trips-head">
            <h2 className="trips-title">{i18n.t("myTrips", { ns: "tripCreator/home" })}</h2>
            <button onClick={() => navigate('/trips')} type="button" className="view-all">
              {i18n.t("viewAll", { ns: "tripCreator/home" })}<ArrowForwardOutlined fontSize="small" />
            </button>
          </div>

          <div className="trips-grid">
            {tripsQuery.isPending && (
              <p className="my-trips-subtitle">{i18n.t("loadingTrips", { ns: "tripCreator/home" })}</p>
            )}

            {tripsQuery.isError && (
              <p className="my-trips-subtitle">
                {errorMessage(tripsQuery.error)}
              </p>
            )}

            {!tripsQuery.isPending &&
              !tripsQuery.isError &&
              myTrips.length === 0 && (
                <p className="my-trips-subtitle">
                  {i18n.t("noTripsHereYetPlanYourFirstOne", { ns: "tripCreator/home" })}</p>
              )}

            {myTrips.map((trip, i) => (
              <TripCard key={trip.id} trip={trip} isFirst={i === 0} />
            ))}
          </div>
        </section>
      </div>

      {draft && (
        <TripRequirementsDialog
          maxTripDays={guestUsage.isGuest ? guestUsage.data?.maxTripDays : undefined}
          key={`${draft.draftId}:${dialogMode}:${draft.missingFields.join(",")}`}
          mode={dialogMode}
          open={isDialogOpen}
          analysis={draft.analysis}
          missingFields={dialogMode === "edit" ? [...ASKABLE_FIELDS] : draft.missingFields}
          isSaving={saveRequirements.isPending}
          error={saveError}
          onSave={saveAnswers}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}

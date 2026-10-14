import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowForwardOutlined,
  AttachFileOutlined,
  CloseOutlined,
  MicOutlined,
} from "@mui/icons-material";
import { TextField } from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";
import type { TripAnalysisResult, UpdateTripRequirements } from "@triply/shared";
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
import PreferenceFields from "../components/trip/PreferenceFields";

interface VoiceHint {
  text: string;
  kind: "info" | "error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

const VOICE_ERRORS: Record<string, string> = {
  "not-allowed":
    "Microphone permission denied — allow the mic in your browser's address bar, then try again.",
  "no-speech": "No speech detected.",
  "audio-capture": "No microphone found.",
  network: "Speech service unreachable.",
};

function getRecognition(): SpeechRecognition | null {
  const Ctor = SpeechRecognition ?? webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export default function HomePage() {
  const { user } = useAuth();
  const location = useLocation();
  const [prompt, setPrompt] = useState("");
  const [selectedBadges, setSelectedBadges] = useState<string[]>(user?.preferences?.interests ?? []);
  const badgesEdited = useRef(false);
  const preferencesEdited = useRef(false);
  const [preferences, setPreferences] = useState(user?.preferences ?? DEFAULT_PROFILE_PREFERENCES);
  useEffect(() => {
    if (!badgesEdited.current) setSelectedBadges(user?.preferences?.interests ?? []);
    if (!preferencesEdited.current) setPreferences(user?.preferences ?? DEFAULT_PROFILE_PREFERENCES);
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
    [tripsQuery.data],
  );
  const [draft, setDraft] = useState<TripAnalysisResult | null>(null);
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const canPlan = prompt.trim().length > 0 || selectedBadges.length > 0;
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

  const getOrCreateRecognition = (): SpeechRecognition | null => {
    if (recognitionRef.current) return recognitionRef.current;

    const recognition = getRecognition();
    if (!recognition) {
      setVoiceHint({
        text: "Voice typing isn't supported in this browser",
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
        setVoiceHint({ text: "Listening…", kind: "info" });
      }
    };

    recognition.onerror = (event) => {
      hadErrorRef.current = true;
      interimRef.current = "";
      setListening(false);
      setVoiceHint({
        text: VOICE_ERRORS[event.error] ?? "Voice input failed.",
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
    const recognition = getOrCreateRecognition();
    if (!recognition) return;

    setVoiceHint({ text: "Listening…", kind: "info" });
    setListening(true);

    try {
      recognition.start();
    } catch {
      setListening(false);
      setVoiceHint({ text: "Voice input failed to start.", kind: "error" });
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
    setSaveError(null);
    setCreateError(null);
    setDraft(null);
    setVoiceHint(null);
    planning.start();

    analyze.mutate(
      { prompt: prompt.trim(), badges: selectedBadges, pace: preferences.pace, maxWalkingDistanceKm: preferences.maxWalkingDistanceKm },
      {
        onSuccess: (result) => {
          setDraft(result);
          planning.finish();

          if (result.missingFields.length > 0) {
            setDialogOpen(true);
          }
        },
        onError: (error) => {
          planning.reset();
          setVoiceHint({ text: errorMessage(error), kind: "error" });
        },
      },
    );
  };

  const generateTrip = () => {
    if (!draft || createTrip.isPending) return;

    setCreateError(null);

    createTrip.mutate(draft.draftId, {
      onSuccess: (trip) => {
        navigate(`/trips/${trip.id}`, { state: { autoStart: true } });
      },
      onError: (error) => setCreateError(errorMessage(error)),
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
          setDraft(result);
          setDialogOpen(false);
        },
        onError: (error) => setSaveError(errorMessage(error)),
      },
    );
  };

  return (
    <div className="home-page">
      <div className="home-inner">
        <p className="home-eyebrow">Your next favorite trip starts here</p>
        <h1 className="home-title">Plan a trip you’ll actually enjoy.</h1>
        <p className="home-subtitle">
          Tell Triply where you’re going, what you love, and how you like to
          travel. We’ll take care of the rest.
        </p>

        <div className="prompt-card">
          {isPlanning ? (
            <div className="prompt-summary">
              <span className="prompt-summary-text">{planSummary}</span>
              <button
                type="button"
                className="prompt-summary-cancel"
                onClick={cancelPlan}
              >
                Cancel
              </button>
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
                        aria-label={`Remove ${file.name}`}
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
                placeholder={`4 days in Barcelona, starting at ${(new Date(new Date().getTime() + 24 * 60 * 60 * 1000)).toLocaleDateString()}, €500 budget, I love food and architecture, relaxed place...`}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                slotProps={{
                  input: { disableUnderline: true },
                  htmlInput: { ref: promptInputRef },
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
                    aria-label="Attachments"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <AttachFileOutlined />
                  </button>
                  <button
                    type="button"
                    className={`prompt-icon${listening ? " is-active" : ""}`}
                    aria-label={listening ? "Stop voice writing" : "Voice writing"}
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
                  Plan my trip
                  <ArrowForwardOutlined fontSize="small" />
                </button>
              </div>
              {voiceHint && (
                <p className={`prompt-hint is-${voiceHint.kind}`}>{voiceHint.text}</p>
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
            onEdit={() => setDialogOpen(true)}
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

        <div className="settings-card">
          <PreferenceFields showInterests={false} disabled={isPlanning} tags={[]} onToggleTag={() => {}}
            pace={PACE_VALUES.indexOf(preferences.pace)} onPaceChange={index => { preferencesEdited.current = true; setPreferences(current => ({ ...current, pace: PACE_VALUES[index] })); }}
            walking={PROFILE_WALKING_LIMITS.indexOf(preferences.maxWalkingDistanceKm)} onWalkingChange={index => { preferencesEdited.current = true; setPreferences(current => ({ ...current, maxWalkingDistanceKm: PROFILE_WALKING_LIMITS[index] })); }} />
        </div>
        <section className="home-section">
          <p className="home-eyebrow">Pick up where you left off</p>
          <div className="trips-head">
            <h2 className="trips-title">My trips</h2>
            <button onClick={() => navigate('/trips')} type="button" className="view-all">
              View all
              <ArrowForwardOutlined fontSize="small" />
            </button>
          </div>

          <div className="trips-grid">
            {tripsQuery.isPending && (
              <p className="my-trips-subtitle">Loading trips…</p>
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
                  No trips here yet. Plan your first one.
                </p>
              )}

            {myTrips.map((trip, i) => (
              <TripCard key={trip.id} trip={trip} isFirst={i === 0} />
            ))}
          </div>
        </section>
      </div>

      {draft && (
        <TripRequirementsDialog
          key={draft.missingFields.join(",")}
          open={isDialogOpen}
          analysis={draft.analysis}
          missingFields={draft.missingFields}
          isSaving={saveRequirements.isPending}
          error={saveError}
          onSave={saveAnswers}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}

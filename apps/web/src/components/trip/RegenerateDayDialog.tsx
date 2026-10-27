import { formatDistance } from "../../i18n/format";
import { resolveMessage } from "../../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { AutoFixHighOutlined, CloseOutlined } from "@mui/icons-material";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
} from "@mui/material";
import { useEffect, useState } from "react";
import {
  hasRegenerationPreferences,
  REGENERATION_OPTIONS,
  type RegenerateDayPreview,
  type RegenerateDayRequest,
  type RegenerationPreferences,
} from "@triply/shared";
import { formatDuration } from "../../config/itineraryAdapters";

const EMPTY_PREFERENCES: RegenerationPreferences = {
  lessWalking: false,
  moreFood: false,
  relaxedPace: false,
  preferIndoor: false,
  surpriseMe: false,
};

function formatKm(meters: number | null): string {
  if (meters === null || !Number.isFinite(meters)) {
    return "—";
  }

  return formatDistance(meters).replace(/([.,])0(?= km$)/, "");
}

function togglePreference(
  current: RegenerationPreferences,
  key: keyof RegenerationPreferences,
): RegenerationPreferences {
  return { ...current, [key]: !current[key] };
}

interface MetricRowProps {
  label: string;
  before: string;
  after: string;
}

function MetricRow({ label, before, after }: MetricRowProps) {
  useTranslation();
  return (
    <div className="regenerate-metric">
      <span className="regenerate-metric-label">{label}</span>
      <span className="regenerate-metric-before">{before}</span>
      <span className="regenerate-metric-arrow">→</span>
      <span className="regenerate-metric-after">{after}</span>
    </div>
  );
}

interface RegenerateDayDialogProps {
  aiRemaining?: number;
  zIndex?: number;
  open: boolean;
  dayNumber: number;
  preview: RegenerateDayPreview | null;
  isGenerating: boolean;
  isApplying: boolean;
  error: string | null;
  onGenerate: (request: RegenerateDayRequest) => void;
  onApply: () => void;
  onEditOptions: () => void;
  onClose: () => void;
}

export default function RegenerateDayDialog({
  aiRemaining,
  zIndex,
  open,
  dayNumber,
  preview,
  isGenerating,
  isApplying,
  error,
  onGenerate,
  onApply,
  onEditOptions,
  onClose,
}: RegenerateDayDialogProps) {
  useTranslation();
  const [preferences, setPreferences] =
    useState<RegenerationPreferences>(EMPTY_PREFERENCES);
  const [customInstructions, setCustomInstructions] = useState("");

  useEffect(() => {
    if (open) {
      setPreferences(EMPTY_PREFERENCES);
      setCustomInstructions("");
    }
  }, [open]);

  const instructions = customInstructions.trim();
  const maybeSubmit =
    hasRegenerationPreferences(preferences) || instructions.length > 0;
  const busy = isGenerating || isApplying;
  const aiBlocked = instructions.length > 0 && aiRemaining === 0;

  const handleGenerate = () => {
    if (!maybeSubmit || busy || aiBlocked) {
      return;
    }

    onGenerate({
      preferences,
      customInstructions: instructions.length > 0 ? instructions : undefined,
    });
  };

  const comparison = preview?.comparison ?? null;

  return (
    <Dialog
      sx={zIndex === undefined ? undefined : { zIndex }}
      open={open}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      className="regenerate-dialog"
    >
      <DialogTitle className="regenerate-title">
        {i18n.t("reworkDayTitle", { ns: "itinerary/generation", day: dayNumber })}
        <IconButton
          aria-label={i18n.t("close", { ns: "common" })}
          onClick={onClose}
          disabled={busy}
          className="regenerate-close"
        >
          <CloseOutlined />
        </IconButton>
      </DialogTitle>

      <DialogContent className="regenerate-content">
        {aiRemaining !== undefined && <p>{i18n.t("aiAllowance", { ns: "itinerary/generation", count: aiRemaining })}</p>}
        {aiBlocked && <p role="alert">{i18n.t("yourAiDayRegenerationAllowanceIsUsedFor", { ns: "itinerary/generation" })}</p>}
        <p className="regenerate-lead">
          {i18n.t("pickHowYouDLikeThisDayTo", { ns: "itinerary/generation" })}</p>

        <div className="regenerate-options">
          {REGENERATION_OPTIONS.map((option) => {
            const active = preferences[option.id];

            return (
              <button
                key={option.id}
                type="button"
                className={`regenerate-option${active ? " is-active" : ""}`}
                aria-pressed={active}
                disabled={busy}
                onClick={() =>
                  setPreferences((current) =>
                    togglePreference(current, option.id),
                  )
                }
              >
                <span className="regenerate-option-title">
                  <AutoFixHighOutlined /> {i18n.t(`${option.id}Label`, { ns: "itinerary/generation" })}
                </span>
                <span className="regenerate-option-description">
                  {i18n.t(`${option.id}Description`, { ns: "itinerary/generation" })}
                </span>
              </button>
            );
          })}
        </div>

        <TextField
          label={i18n.t("anyOtherChangesOptional", { ns: "itinerary/generation" })}
          placeholder={i18n.t("eGFocusOnMuseumsNearTheOld", { ns: "itinerary/generation" })}
          multiline
          minRows={2}
          fullWidth
          disabled={busy}
          value={customInstructions}
          onChange={(event) => setCustomInstructions(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />

        {isGenerating && (
          <p className="regenerate-status">
            <AutoFixHighOutlined /> {i18n.t("exploringOptionsForThisDay", { ns: "itinerary/generation" })}</p>
        )}

        {comparison && (
          <div className="regenerate-compare">
            <p className="regenerate-compare-title">{i18n.t("hereSTheNewDay", { ns: "itinerary/generation" })}</p>

            <div className="regenerate-compare-rows">
              <div className="regenerate-compare-head">
                <span />
                <span>{i18n.t("before", { ns: "itinerary/generation" })}</span>
                <span />
                <span>{i18n.t("after", { ns: "itinerary/generation" })}</span>
              </div>
              <MetricRow
                label={i18n.t("attractions", { ns: "itinerary/generation" })}
                before={String(comparison.original.attractionCount)}
                after={String(comparison.proposed.attractionCount)}
              />
              <MetricRow
                label={i18n.t("walking", { ns: "itinerary/generation" })}
                before={formatKm(comparison.original.walkingMeters)}
                after={formatKm(comparison.proposed.walkingMeters)}
              />
              <MetricRow
                label={i18n.t("travel", { ns: "itinerary/generation" })}
                before={formatDuration(comparison.original.travelMinutes)}
                after={formatDuration(comparison.proposed.travelMinutes)}
              />
              <MetricRow
                label={i18n.t("visiting", { ns: "itinerary/generation" })}
                before={formatDuration(comparison.original.visitMinutes)}
                after={formatDuration(comparison.proposed.visitMinutes)}
              />
            </div>

            {comparison.removed.length > 0 && (
              <div className="regenerate-diff">
                <span className="regenerate-diff-title">{i18n.t("removed", { ns: "itinerary/generation" })}</span>
                {comparison.removed.map((stop) => (
                  <span key={stop.placeId ?? stop.name} className="regenerate-diff-item is-removed">
                    {stop.name}
                  </span>
                ))}
              </div>
            )}

            {comparison.added.length > 0 && (
              <div className="regenerate-diff">
                <span className="regenerate-diff-title">{i18n.t("added", { ns: "itinerary/generation" })}</span>
                {comparison.added.map((stop) => (
                  <span key={stop.placeId ?? stop.name} className="regenerate-diff-item is-added">
                    {stop.name}
                  </span>
                ))}
              </div>
            )}

            {preview && preview.warnings.length > 0 && (
              <ul className="regenerate-warnings">
                <li>{i18n.t("reviewAlternativeWarning", { ns: "itinerary/generation" })}</li>
              </ul>
            )}
          </div>
        )}

        {error && <p className="regenerate-error">{resolveMessage(error)}</p>}
      </DialogContent>

      <DialogActions className="regenerate-actions">
        {comparison ? (
          <>
            <Button type="button" onClick={onClose} disabled={busy}>
              {i18n.t("cancel", { ns: "common" })}</Button>
            <Button type="button" onClick={onEditOptions} disabled={busy}>
              {i18n.t("tryDifferentOptions", { ns: "itinerary/generation" })}</Button>
            <Button
              type="button"
              variant="contained"
              disabled={busy || !preview}
              onClick={onApply}
            >
              {isApplying ? i18n.t("applying", { ns: "itinerary/generation" }) : i18n.t("applyChanges", { ns: "common" })}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" onClick={onClose} disabled={busy}>
              {i18n.t("cancel", { ns: "common" })}</Button>
            <Button
              type="button"
              variant="contained"
              startIcon={<AutoFixHighOutlined />}
              disabled={!maybeSubmit || busy || aiBlocked}
              onClick={handleGenerate}
            >
              {isGenerating ? i18n.t("preparing", { ns: "itinerary/generation" }) : i18n.t("generateAlternative", { ns: "itinerary/generation" })}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

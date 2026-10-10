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

  return `${(meters / 1000).toFixed(1).replace(/\.0$/, "")} km`;
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

  const handleGenerate = () => {
    if (!maybeSubmit || busy) {
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
      open={open}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      className="regenerate-dialog"
    >
      <DialogTitle className="regenerate-title">
        Rework Day {dayNumber}
        <IconButton
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
          className="regenerate-close"
        >
          <CloseOutlined />
        </IconButton>
      </DialogTitle>

      <DialogContent className="regenerate-content">
        <p className="regenerate-lead">
          Pick how you'd like this day to change. Only this day is rewritten —
          the rest of your trip stays as it is.
        </p>

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
                  <AutoFixHighOutlined /> {option.label}
                </span>
                <span className="regenerate-option-description">
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>

        <TextField
          label="Any other changes (optional)"
          placeholder="e.g. Focus on museums near the old town and skip the crowded spots."
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
            <AutoFixHighOutlined /> Exploring options for this day…
          </p>
        )}

        {comparison && (
          <div className="regenerate-compare">
            <p className="regenerate-compare-title">Here's the new day</p>

            <div className="regenerate-compare-rows">
              <div className="regenerate-compare-head">
                <span />
                <span>Before</span>
                <span />
                <span>After</span>
              </div>
              <MetricRow
                label="Attractions"
                before={String(comparison.original.attractionCount)}
                after={String(comparison.proposed.attractionCount)}
              />
              <MetricRow
                label="Walking"
                before={formatKm(comparison.original.walkingMeters)}
                after={formatKm(comparison.proposed.walkingMeters)}
              />
              <MetricRow
                label="Travel"
                before={formatDuration(comparison.original.travelMinutes)}
                after={formatDuration(comparison.proposed.travelMinutes)}
              />
              <MetricRow
                label="Visiting"
                before={formatDuration(comparison.original.visitMinutes)}
                after={formatDuration(comparison.proposed.visitMinutes)}
              />
            </div>

            {comparison.removed.length > 0 && (
              <div className="regenerate-diff">
                <span className="regenerate-diff-title">Removed</span>
                {comparison.removed.map((stop) => (
                  <span key={stop.placeId ?? stop.name} className="regenerate-diff-item is-removed">
                    {stop.name}
                  </span>
                ))}
              </div>
            )}

            {comparison.added.length > 0 && (
              <div className="regenerate-diff">
                <span className="regenerate-diff-title">Added</span>
                {comparison.added.map((stop) => (
                  <span key={stop.placeId ?? stop.name} className="regenerate-diff-item is-added">
                    {stop.name}
                  </span>
                ))}
              </div>
            )}

            {preview && preview.warnings.length > 0 && (
              <ul className="regenerate-warnings">
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <p className="regenerate-error">{error}</p>}
      </DialogContent>

      <DialogActions className="regenerate-actions">
        {comparison ? (
          <>
            <Button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={onEditOptions} disabled={busy}>
              Try different options
            </Button>
            <Button
              type="button"
              variant="contained"
              disabled={busy || !preview}
              onClick={onApply}
            >
              {isApplying ? "Applying…" : "Apply changes"}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="contained"
              startIcon={<AutoFixHighOutlined />}
              disabled={!maybeSubmit || busy}
              onClick={handleGenerate}
            >
              {isGenerating ? "Preparing…" : "Generate alternative"}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
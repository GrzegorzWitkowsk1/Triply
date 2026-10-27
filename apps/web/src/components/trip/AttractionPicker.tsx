import { errorKey as localizedErrorKey, resolveMessage } from "../../i18n/errors";
import { categoryLabel } from "../../i18n/labels";
import { errorMessage as localizedError } from "../../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField } from "@mui/material";
import { getItineraryCandidates } from "../../api/trips";

interface Props {
  zIndex?: number;
  tripId: string;
  open: boolean;
  replace: boolean;
  stopCount: number;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (placeId: string, position: number) => void;
}

export default function AttractionPicker({ zIndex, tripId, open, replace, stopCount, saving, error, onClose, onConfirm }: Props) {
  useTranslation();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [position, setPosition] = useState(stopCount);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const candidates = useQuery({
    queryKey: ["itinerary-candidates", tripId],
    queryFn: () => getItineraryCandidates(tripId), enabled: open,
  });
  useEffect(() => {
    if (open) { setSearch(""); setSelected(null); setPosition(stopCount); setDiscoveryError(null); }
  }, [open, stopCount]);
  const results = candidates.data?.candidates.filter((place) =>
    `${place.name} ${categoryLabel(place.category)}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? [];
  const discover = async () => {
    setDiscovering(true); setDiscoveryError(null);
    try {
      const result = await getItineraryCandidates(tripId, "", true);
      setDiscoveryError(result.warnings.length ? "itinerary/quality:dimension_dataCompleteness" : null);
      await candidates.refetch();
    } catch (cause) { setDiscoveryError(localizedErrorKey(cause)); }
    finally { setDiscovering(false); }
  };
  const selectedCandidate = candidates.data?.candidates.find((place) => place.placeId === selected);
  return <Dialog sx={zIndex === undefined ? undefined : { zIndex }} open={open} onClose={saving || discovering ? undefined : onClose} fullWidth maxWidth="sm">
    <DialogTitle>{replace ? i18n.t("replaceAttraction", { ns: "itinerary/editor" }) : i18n.t("addAttraction", { ns: "itinerary" })}</DialogTitle>
    <DialogContent>
      <TextField label={i18n.t("searchAttractions", { ns: "itinerary/editor" })} value={search} onChange={(event) => setSearch(event.target.value)} fullWidth margin="dense" />
      {!replace && <TextField label={i18n.t("insertAtPosition", { ns: "itinerary/editor" })} select value={position} onChange={(event) => setPosition(Number(event.target.value))} fullWidth margin="dense">
        {Array.from({ length: stopCount + 1 }, (_, index) => <MenuItem key={index} value={index}>{index === stopCount ? i18n.t("atTheEnd", { ns: "itinerary/editor" }) : i18n.t("beforeStop", { ns: "itinerary/editor", value0: index + 1 })}</MenuItem>)}
      </TextField>}
      {(error || discoveryError || candidates.error) && <Alert severity="error">{resolveMessage(error ?? discoveryError) ?? (candidates.error ? localizedError(candidates.error) : null)}</Alert>}
      {(candidates.isPending || discovering) && <div role="status"><CircularProgress size={24} /> {i18n.t("loadingAttractions", { ns: "itinerary/editor" })}</div>}
      {!candidates.isPending && results.length === 0 && <p>{i18n.t("noMatchingAttractionsTrySearchingForMoreNearby", { ns: "itinerary/editor" })}</p>}
      <div className="itinerary-picker-results">
        {results.map((place) => <button type="button" key={place.placeId}
          className={`activity-card${selected === place.placeId ? " is-selected" : ""}`}
          aria-pressed={selected === place.placeId} disabled={saving || place.scheduledDayIndex !== null}
          onClick={() => setSelected(place.placeId)}>
          <span className="activity-name">{place.name}</span>
          <span className="activity-category">{place.category}{place.environment && place.environment !== "unknown" ? ` · ${categoryLabel(place.environment)}` : ""}</span>
          <span className="activity-time">{place.visitDurationMinutes ? i18n.t("minVisit", { ns: "itinerary/editor", value0: place.visitDurationMinutes }) : i18n.t("visitDurationEstimated", { ns: "itinerary/editor" })}{place.score != null ? i18n.t("score", { ns: "itinerary/editor", value0: Math.round(place.score) }) : ""}</span>
          {place.scheduledDayIndex !== null && <span>{i18n.t("alreadyScheduled", { ns: "itinerary/editor", day: place.scheduledDayIndex })}</span>}
        </button>)}
      </div>
      <Button disabled={saving || discovering} onClick={() => void discover()}>{i18n.t("searchMoreNearbyAttractions", { ns: "itinerary/editor" })}</Button>
      {candidates.isError && <Button onClick={() => void candidates.refetch()}>{i18n.t("retry", { ns: "common" })}</Button>}
    </DialogContent>
    <DialogActions>
      <Button disabled={saving || discovering} onClick={onClose}>{i18n.t("cancel", { ns: "common" })}</Button>
      <Button disabled={saving || discovering || !selectedCandidate || selectedCandidate.scheduledDayIndex !== null} onClick={() => selected && onConfirm(selected, position)}>
        {saving ? i18n.t("saving", { ns: "itinerary/editor" }) : replace ? i18n.t("replaceAttraction2", { ns: "itinerary/editor" }) : i18n.t("addAttraction", { ns: "itinerary/editor" })}
      </Button>
    </DialogActions>
  </Dialog>;
}

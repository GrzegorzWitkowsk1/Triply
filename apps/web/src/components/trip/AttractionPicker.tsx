import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField } from "@mui/material";
import { getItineraryCandidates } from "../../api/trips";

interface Props {
  tripId: string;
  open: boolean;
  replace: boolean;
  stopCount: number;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (placeId: string, position: number) => void;
}

export default function AttractionPicker({ tripId, open, replace, stopCount, saving, error, onClose, onConfirm }: Props) {
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
    `${place.name} ${place.category}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? [];
  const discover = async () => {
    setDiscovering(true); setDiscoveryError(null);
    try {
      const result = await getItineraryCandidates(tripId, "", true);
      setDiscoveryError(result.warnings.join(" ") || null);
      await candidates.refetch();
    } catch (cause) { setDiscoveryError(cause instanceof Error ? cause.message : "Could not search for places."); }
    finally { setDiscovering(false); }
  };
  const selectedCandidate = candidates.data?.candidates.find((place) => place.placeId === selected);
  return <Dialog open={open} onClose={saving || discovering ? undefined : onClose} fullWidth maxWidth="sm">
    <DialogTitle>{replace ? "Replace Attraction" : "Add Attraction"}</DialogTitle>
    <DialogContent>
      <TextField label="Search attractions" value={search} onChange={(event) => setSearch(event.target.value)} fullWidth margin="dense" />
      {!replace && <TextField label="Insert at position" select value={position} onChange={(event) => setPosition(Number(event.target.value))} fullWidth margin="dense">
        {Array.from({ length: stopCount + 1 }, (_, index) => <MenuItem key={index} value={index}>{index === stopCount ? "At the end" : `Before stop ${index + 1}`}</MenuItem>)}
      </TextField>}
      {(error || discoveryError || candidates.error) && <Alert severity="error">{error ?? discoveryError ?? candidates.error?.message}</Alert>}
      {(candidates.isPending || discovering) && <div role="status"><CircularProgress size={24} /> Loading attractions</div>}
      {!candidates.isPending && results.length === 0 && <p>No matching attractions. Try searching for more nearby places.</p>}
      <div className="itinerary-picker-results">
        {results.map((place) => <button type="button" key={place.placeId}
          className={`activity-card${selected === place.placeId ? " is-selected" : ""}`}
          aria-pressed={selected === place.placeId} disabled={saving || place.scheduledDayIndex !== null}
          onClick={() => setSelected(place.placeId)}>
          <span className="activity-name">{place.name}</span>
          <span className="activity-category">{place.category}{place.environment && place.environment !== "unknown" ? ` · ${place.environment}` : ""}</span>
          <span className="activity-time">{place.visitDurationMinutes ? `${place.visitDurationMinutes} min visit` : "Visit duration estimated"}{place.score != null ? ` · Score ${Math.round(place.score)}` : ""}</span>
          {place.scheduledDayIndex !== null && <span>Already scheduled on day {place.scheduledDayIndex}</span>}
        </button>)}
      </div>
      <Button disabled={saving || discovering} onClick={() => void discover()}>Search more nearby attractions</Button>
      {candidates.isError && <Button onClick={() => void candidates.refetch()}>Retry</Button>}
    </DialogContent>
    <DialogActions>
      <Button disabled={saving || discovering} onClick={onClose}>Cancel</Button>
      <Button disabled={saving || discovering || !selectedCandidate || selectedCandidate.scheduledDayIndex !== null} onClick={() => selected && onConfirm(selected, position)}>
        {saving ? "Saving…" : replace ? "Replace attraction" : "Add attraction"}
      </Button>
    </DialogActions>
  </Dialog>;
}

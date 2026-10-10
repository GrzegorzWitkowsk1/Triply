import { useEffect, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField } from "@mui/material";
import type { ItineraryDay } from "@triply/shared";

interface Props {
  open: boolean;
  sourceDayIndex: number;
  days: ItineraryDay[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (targetDayIndex: number, position: number) => void;
}
export default function MoveAttractionDialog({ open, sourceDayIndex, days, saving, error, onClose, onConfirm }: Props) {
  const destinations = days.filter((day) => day.dayIndex !== sourceDayIndex);
  const [target, setTarget] = useState(destinations[0]?.dayIndex ?? 0);
  const [position, setPosition] = useState(0);
  useEffect(() => { if (open) { setTarget(days.find((day) => day.dayIndex !== sourceDayIndex)?.dayIndex ?? 0); setPosition(0); } }, [open, sourceDayIndex, days]);
  const count = days.find((day) => day.dayIndex === target)?.activities.filter((activity) => activity.type === "attraction").length ?? 0;
  return <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="xs">
    <DialogTitle>Move Attraction</DialogTitle>
    <DialogContent>
      {destinations.length === 0 && <p>This trip has only one day. There is no other day to move to.</p>}
      {error && <Alert severity="error">{error}</Alert>}
      <TextField select label="Destination day" value={target} fullWidth margin="dense" onChange={(event) => { setTarget(Number(event.target.value)); setPosition(0); }}>
        {destinations.map((day) => <MenuItem key={day.dayIndex} value={day.dayIndex}>Day {day.dayIndex}{day.date ? ` · ${day.date}` : ""}</MenuItem>)}
      </TextField>
      <TextField select label="Insert at position" value={position} fullWidth margin="dense" onChange={(event) => setPosition(Number(event.target.value))}>
        {Array.from({ length: count + 1 }, (_, index) => <MenuItem key={index} value={index}>{index === count ? "At the end" : `Before stop ${index + 1}`}</MenuItem>)}
      </TextField>
    </DialogContent>
    <DialogActions><Button disabled={saving} onClick={onClose}>Cancel</Button><Button disabled={saving || !target} onClick={() => onConfirm(target, position)}>{saving ? "Saving…" : "Move attraction"}</Button></DialogActions>
  </Dialog>;
}

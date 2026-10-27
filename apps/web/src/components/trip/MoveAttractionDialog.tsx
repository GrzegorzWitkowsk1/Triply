import { resolveMessage } from "../../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
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
  useTranslation();
  const destinations = days.filter((day) => day.dayIndex !== sourceDayIndex);
  const [target, setTarget] = useState(destinations[0]?.dayIndex ?? 0);
  const [position, setPosition] = useState(0);
  useEffect(() => { if (open) { setTarget(days.find((day) => day.dayIndex !== sourceDayIndex)?.dayIndex ?? 0); setPosition(0); } }, [open, sourceDayIndex, days]);
  const count = days.find((day) => day.dayIndex === target)?.activities.filter((activity) => activity.type === "attraction").length ?? 0;
  return <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="xs">
    <DialogTitle>{i18n.t("moveAttraction", { ns: "itinerary/editor" })}</DialogTitle>
    <DialogContent>
      {destinations.length === 0 && <p>{i18n.t("thisTripHasOnlyOneDayThereIs", { ns: "itinerary/editor" })}</p>}
      {error && <Alert severity="error">{resolveMessage(error)}</Alert>}
      <TextField select label={i18n.t("destinationDay", { ns: "itinerary/editor" })} value={target} fullWidth margin="dense" onChange={(event) => { setTarget(Number(event.target.value)); setPosition(0); }}>
        {destinations.map((day) => <MenuItem key={day.dayIndex} value={day.dayIndex}>{i18n.t("dayLabel", { ns: "common", day: day.dayIndex })}{day.date ? ` · ${day.date}` : ""}</MenuItem>)}
      </TextField>
      <TextField select label={i18n.t("insertAtPosition", { ns: "itinerary/editor" })} value={position} fullWidth margin="dense" onChange={(event) => setPosition(Number(event.target.value))}>
        {Array.from({ length: count + 1 }, (_, index) => <MenuItem key={index} value={index}>{index === count ? i18n.t("atTheEnd", { ns: "itinerary/editor" }) : i18n.t("beforeStop", { ns: "itinerary/editor", value0: index + 1 })}</MenuItem>)}
      </TextField>
    </DialogContent>
    <DialogActions><Button disabled={saving} onClick={onClose}>{i18n.t("cancel", { ns: "common" })}</Button><Button disabled={saving || !target} onClick={() => onConfirm(target, position)}>{saving ? i18n.t("saving", { ns: "itinerary/editor" }) : i18n.t("moveAttraction2", { ns: "itinerary/editor" })}</Button></DialogActions>
  </Dialog>;
}

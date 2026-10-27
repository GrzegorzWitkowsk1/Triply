import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { Favorite } from "@mui/icons-material";
import { Alert, CircularProgress, IconButton } from "@mui/material";
import { useDestinationPending, useUnsaveDestination } from "../../hooks/useSavedDestinations";
import { useAttractionPending, useUnsaveAttraction } from "../../hooks/useSavedAttractions";
import { savedName, type SavedItem } from "../../config/saved";

export default function SavedRemoveButton({ item }: { item: SavedItem }) {
  useTranslation();
  const destination = useUnsaveDestination();
  const attraction = useUnsaveAttraction();
  const destinationPending = useDestinationPending(item.type === "destinations" ? item.row.destinationId : "");
  const attractionPending = useAttractionPending(item.type === "attractions" ? item.row.attractionKey : "");
  const mutation = item.type === "destinations" ? destination : attraction;
  const pending = item.type === "destinations" ? destinationPending : attractionPending;
  const label = i18n.t(item.type === "attractions" ? "unsaveAttraction" : "unsaveDestination", { ns: "saved", name: savedName(item) });
  return <div className="saved-remove">
    <IconButton aria-label={label} title={label} aria-pressed="true" aria-busy={pending} disabled={pending}
      onClick={() => { if (!pending) { if (item.type === "destinations") destination.mutate(item.row.destinationId); else attraction.mutate({ attractionKey: item.row.attractionKey }); } }}
      sx={{ color: "primary.main", minWidth: 44, minHeight: 44, "&.Mui-focusVisible": { outline: "3px solid currentColor" } }}>
      {pending ? <CircularProgress size={20} color="inherit" aria-label={i18n.t("removingSavedPlace", { ns: "saved" })} /> : <Favorite />}
    </IconButton>
    {mutation.isError && <Alert severity="error">{i18n.t("couldNotRemoveThisPlaceTryTheHeart", { ns: "saved" })}</Alert>}
  </div>;
}

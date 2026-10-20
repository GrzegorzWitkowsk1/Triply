import { Favorite, FavoriteBorderOutlined } from "@mui/icons-material";
import { IconButton } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useSavedIdentity } from "../hooks/useSavedDestinations";
import { useSavedDestinationIds, useSaveDestination, useUnsaveDestination, useDestinationPending } from "../hooks/useSavedDestinations";

export default function DestinationSaveButton({ destinationId, name }: { destinationId: string; name: string }) {
  const navigate = useNavigate();
  const identity = useSavedIdentity();
  const ids = useSavedDestinationIds();
  const save = useSaveDestination();
  const unsave = useUnsaveDestination();
  const pending = useDestinationPending(destinationId);
  const saved = ids.data?.destinationIds.includes(destinationId) ?? false;
  const error = save.error ?? unsave.error;
  return <>
    <IconButton aria-label={`${saved ? "Unsave" : "Save"} ${name}`} aria-pressed={saved}
      disabled={identity.loading || identity.enabled && (pending || !ids.data || ids.isError)} className="destination-save"
      onClick={event => { event.preventDefault(); event.stopPropagation(); if (!identity.enabled) { navigate("/login"); return; } save.reset(); unsave.reset(); (saved ? unsave : save).mutate(destinationId); }}
      sx={{ bgcolor: "background.paper", color: "primary.main", "&.Mui-focusVisible": { outline: "3px solid currentColor" } }}>
      {saved ? <Favorite /> : <FavoriteBorderOutlined />}
    </IconButton>
    {error && <span className="destination-save-error" role="alert">Could not update Saved for {name}. Please try again.</span>}
  </>;
}

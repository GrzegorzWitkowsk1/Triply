import { Favorite, FavoriteBorderOutlined } from "@mui/icons-material";
import { IconButton } from "@mui/material";
import { useSavedDestinationIds, useSaveDestination, useUnsaveDestination, useDestinationPending } from "../hooks/useSavedDestinations";

export default function DestinationSaveButton({ destinationId, name }: { destinationId: string; name: string }) {
  const ids = useSavedDestinationIds();
  const save = useSaveDestination();
  const unsave = useUnsaveDestination();
  const pending = useDestinationPending(destinationId);
  const saved = ids.data?.destinationIds.includes(destinationId) ?? false;
  const error = save.error ?? unsave.error;
  return <>
    <IconButton aria-label={`${saved ? "Unsave" : "Save"} ${name}`} aria-pressed={saved}
      disabled={pending || !ids.data || ids.isError} className="destination-save"
      onClick={event => { event.preventDefault(); event.stopPropagation(); (saved ? unsave : save).mutate(destinationId); }}
      sx={{ bgcolor: "background.paper", color: "primary.main", "&.Mui-focusVisible": { outline: "3px solid currentColor" } }}>
      {saved ? <Favorite /> : <FavoriteBorderOutlined />}
    </IconButton>
    {error && <span role="alert">{error.message}</span>}
  </>;
}

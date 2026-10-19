import { Favorite, FavoriteBorderOutlined } from "@mui/icons-material";
import { IconButton } from "@mui/material";
import { useSavedAttractionKeys, useSaveAttraction, useUnsaveAttraction, useAttractionPending } from "../hooks/useSavedAttractions";

export default function AttractionSaveButton({ attractionKey, name, tripId }: { attractionKey: string; name: string; tripId?: string }) {
  const keys = useSavedAttractionKeys();
  const save = useSaveAttraction();
  const unsave = useUnsaveAttraction();
  const pending = useAttractionPending(attractionKey);
  const saved = keys.data?.attractionKeys.includes(attractionKey) ?? false;
  const error = save.error ?? unsave.error;
  return <span className="attraction-save-control" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <IconButton aria-label={`${saved ? "Unsave" : "Save"} attraction ${name}`} aria-pressed={saved}
      disabled={pending || !keys.data || keys.isError || (!saved && !tripId)} size="small"
      onClick={event => { event.preventDefault(); event.stopPropagation(); (saved ? unsave : save).mutate({ attractionKey, ...(tripId ? { tripId } : {}) }); }}
      sx={{ color: "primary.main", "&.Mui-focusVisible": { outline: "3px solid currentColor" } }}>
      {saved ? <Favorite /> : <FavoriteBorderOutlined />}
    </IconButton>
    {error && <span role="alert">{error.message}</span>}
    {keys.isError && <span role="alert">Saved status unavailable. <button onClick={() => void keys.refetch()}>Retry</button></span>}
  </span>;
}

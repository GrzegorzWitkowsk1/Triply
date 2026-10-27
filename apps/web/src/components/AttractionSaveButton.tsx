import { errorMessage as localizedError } from "../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { Favorite, FavoriteBorderOutlined } from "@mui/icons-material";
import { IconButton } from "@mui/material";
import { useSavedAttractionKeys, useSaveAttraction, useUnsaveAttraction, useAttractionPending } from "../hooks/useSavedAttractions";

export default function AttractionSaveButton({ attractionKey, name, tripId }: { attractionKey: string; name: string; tripId?: string }) {
  useTranslation();
  const keys = useSavedAttractionKeys();
  const save = useSaveAttraction();
  const unsave = useUnsaveAttraction();
  const pending = useAttractionPending(attractionKey);
  const saved = keys.data?.attractionKeys.includes(attractionKey) ?? false;
  const error = save.error ?? unsave.error;
  return <span className="attraction-save-control" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <IconButton aria-label={i18n.t(saved ? "unsaveAttraction" : "saveAttraction", { ns: "saved", name })} aria-pressed={saved}
      disabled={pending || !keys.data || keys.isError || (!saved && !tripId)} size="small"
      onClick={event => { event.preventDefault(); event.stopPropagation(); (saved ? unsave : save).mutate({ attractionKey, ...(tripId ? { tripId } : {}) }); }}
      sx={{ color: "primary.main", "&.Mui-focusVisible": { outline: "3px solid currentColor" } }}>
      {saved ? <Favorite /> : <FavoriteBorderOutlined />}
    </IconButton>
    {error && <span role="alert">{localizedError(error)}</span>}
    {keys.isError && <span role="alert">{i18n.t("savedStatusUnavailable", { ns: "saved" })} <button onClick={() => void keys.refetch()}>{i18n.t("retry", { ns: "common" })}</button></span>}
  </span>;
}

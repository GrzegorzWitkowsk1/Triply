import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { AttractionsOutlined, LandscapeOutlined, PlaceOutlined } from "@mui/icons-material";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { useState, type ReactNode } from "react";
import DestinationPlanButton from "../DestinationPlanButton";
import { savedLocale, savedMapUrl, savedName, type SavedItem } from "../../config/saved";
import PhotoAttribution from "../trips/PhotoAttribution";
import SavedRemoveButton from "./SavedRemoveButton";
import DestinationImage from "../DestinationImage";

function safeImage(value: string | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? value : null; } catch { return null; }
}
function SavedImage({ item }: { item: SavedItem }) {
  useTranslation();
  const [failed, setFailed] = useState(false);
  const source = item.type === "destinations" ? item.row.destination?.imageUrl : item.row.snapshot?.image;
  const image = safeImage(source);
  const Icon = item.type === "destinations" ? LandscapeOutlined : AttractionsOutlined;
  if (item.type === "destinations" && item.row.destination) return <div className="saved-card-media"><DestinationImage photo={item.row.destination} /></div>;
  return <div className="saved-card-media">
    {image && !failed ? <img src={image} alt={savedName(item)} loading="lazy" onError={() => setFailed(true)} /> : <Icon className="saved-image-fallback" aria-hidden="true" />}
    {image && !failed && item.type === "destinations" && item.row.destination && <PhotoAttribution photo={item.row.destination} />}
  </div>;
}
export function SavedPlanButton({ item, collectionSlug }: { item: SavedItem; collectionSlug?: string }) {
  useTranslation();
  return item.type === "destinations" && item.row.destination ? <DestinationPlanButton destinationId={item.row.destination.id} collectionSlug={collectionSlug} /> : null;
}
export default function SavedPlaceCard({ item, onOpen }: { item: SavedItem; onOpen: () => void }) {
  useTranslation();
  const unavailable = item.type === "destinations" && !item.row.destination;
  return <article className="saved-card" aria-label={`${item.type === "destinations" ? i18n.t("destination", { ns: "saved" }) : i18n.t("attraction", { ns: "saved" })}: ${savedName(item)}`}>
    <SavedImage item={item} />
    <div className="saved-card-body">
      <div className="saved-card-heading"><div><span className="saved-kind">{item.type === "destinations" ? i18n.t("destination", { ns: "saved" }) : i18n.t("attraction", { ns: "saved" })}</span><h3 className="saved-name">{savedName(item)}</h3></div><SavedRemoveButton item={item} /></div>
      {savedLocale(item) && <p className="saved-locale"><PlaceOutlined fontSize="small" aria-hidden="true" />{savedLocale(item)}</p>}
      {item.type === "attractions" && item.row.snapshot?.category && <p className="saved-category">{item.row.snapshot.category}</p>}
      {unavailable && <p className="saved-desc">{i18n.t("destinationNoLongerAvailableYouCanStillRemove", { ns: "saved" })}</p>}
      <div className="saved-card-actions">
        <Button variant="outlined" onClick={onOpen} disabled={unavailable}>{item.type === "destinations" ? i18n.t("openDestination", { ns: "saved" }) : i18n.t("viewDetails", { ns: "saved" })}</Button>
        <SavedPlanButton item={item} />
      </div>
    </div>
  </article>;
}
export function SavedPlaceDetails({ item, onClose, destinationAction, collectionSlug }: { item: SavedItem | undefined; onClose: () => void; destinationAction?: ReactNode; collectionSlug?: string }) {
  useTranslation();
  const map = item ? savedMapUrl(item) : null;
  const snapshot = item?.type === "attractions" ? item.row.snapshot : null;
  return <Dialog open={Boolean(item)} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="saved-detail-title">
    <DialogTitle id="saved-detail-title">{item ? savedName(item) : i18n.t("savedPlace", { ns: "saved" })}</DialogTitle>
    <DialogContent>
      {item && <>
        <p className="saved-detail-locale">{savedLocale(item)}</p>
        {snapshot?.category && <p>{snapshot.category}</p>}
        {snapshot?.address && <p>{snapshot.address}</p>}
        {snapshot?.description && <p className="saved-detail-description">{snapshot.description}</p>}
        {item.type === "attractions" && !snapshot?.description && <p>{i18n.t("noAdditionalDescriptionIsAvailableForThisSaved", { ns: "saved" })}</p>}
        {map && <a href={map} target="_blank" rel="noreferrer">{i18n.t("viewOnOpenstreetmap", { ns: "saved" })}</a>}
      </>}
    </DialogContent>
    <DialogActions className="saved-detail-actions">{item && <>{destinationAction ?? <SavedRemoveButton item={item} />}<SavedPlanButton item={item} collectionSlug={collectionSlug} /></>}<Button onClick={onClose}>{i18n.t("close", { ns: "common" })}</Button></DialogActions>
  </Dialog>;
}

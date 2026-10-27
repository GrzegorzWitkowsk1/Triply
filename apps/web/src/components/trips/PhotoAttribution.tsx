import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import type { CityPhoto } from "../../config/cityPhotos";
import { catalogDestinationSchema } from "@triply/shared";

interface PhotoAttributionProps {
  photo: CityPhoto;
}

export default function PhotoAttribution({ photo }: PhotoAttributionProps) {
  useTranslation();
  const sourceUrl = catalogDestinationSchema.shape.sourceUrl.parse(photo.sourceUrl);
  const licenseUrl = catalogDestinationSchema.shape.licenseUrl.parse(photo.licenseUrl);
  if (!photo.photographer && !photo.source && !photo.license) {
    return null;
  }

  return (
    <p className="photo-attribution">
      {photo.photographer && <span className="photo-attribution-label">{i18n.t("photoCredit", { ns: "trips", name: photo.photographer })}</span>}
      <span aria-hidden="true"> · </span>
      {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">{photo.source || i18n.t("photoSource", { ns: "trips" })}</a> : <span>{photo.source}</span>}
      <span aria-hidden="true"> · </span>
      {licenseUrl ? <a href={licenseUrl} target="_blank" rel="noreferrer">{photo.license}</a> : <span>{photo.license}</span>}
    </p>
  );
}

import type { CityPhoto } from "../../config/cityPhotos";
import { catalogDestinationSchema } from "@triply/shared";

interface PhotoAttributionProps {
  photo: CityPhoto;
}

export default function PhotoAttribution({ photo }: PhotoAttributionProps) {
  const sourceUrl = catalogDestinationSchema.shape.sourceUrl.parse(photo.sourceUrl);
  const licenseUrl = catalogDestinationSchema.shape.licenseUrl.parse(photo.licenseUrl);
  if (!photo.photographer && !photo.source && !photo.license) {
    return null;
  }

  return (
    <p className="photo-attribution">
      {photo.photographer && <span className="photo-attribution-label">Photo: {photo.photographer}</span>}
      <span aria-hidden="true"> · </span>
      {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">{photo.source || "Source"}</a> : <span>{photo.source}</span>}
      <span aria-hidden="true"> · </span>
      {licenseUrl ? <a href={licenseUrl} target="_blank" rel="noreferrer">{photo.license}</a> : <span>{photo.license}</span>}
    </p>
  );
}

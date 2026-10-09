import type { CityPhoto } from "../../config/cityPhotos";

interface PhotoAttributionProps {
  photo: CityPhoto;
}

export default function PhotoAttribution({ photo }: PhotoAttributionProps) {
  if (!photo.attributionRequired) {
    return null;
  }

  return (
    <p className="photo-attribution">
      <span className="photo-attribution-label">Photo: {photo.photographer}</span>
      <span aria-hidden="true"> · </span>
      <a href={photo.sourceUrl} target="_blank" rel="noreferrer">
        {photo.source}
      </a>
      <span aria-hidden="true"> · </span>
      <a href={photo.licenseUrl} target="_blank" rel="noreferrer">
        {photo.license}
      </a>
    </p>
  );
}

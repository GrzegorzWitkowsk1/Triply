import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useEffect, useRef, useState } from "react";
import { catalogDestinationSchema, type Destination } from "@triply/shared";
import MediaFallback from "./trips/MediaFallback";
import PhotoAttribution from "./trips/PhotoAttribution";

/** Only existing audited photos with sufficient credit metadata may render. */
export function destinationImageUrl(photo: Destination): string {
  if (photo.licenseAuditStatus !== "provisionally_usable" || !photo.license || !photo.sourceUrl || !photo.licenseUrl || photo.attributionRequired && !photo.photographer) return "";
  if (!catalogDestinationSchema.shape.sourceUrl.parse(photo.sourceUrl) || !catalogDestinationSchema.shape.licenseUrl.parse(photo.licenseUrl)) return "";
  return catalogDestinationSchema.shape.imageUrl.parse(photo.imageUrl);
}
export default function DestinationImage({ photo }: { photo: Destination }) {
  useTranslation();
  const source = destinationImageUrl(photo);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const visibleImage = Boolean(source && failedSource !== source);
  useEffect(() => {
    if (!visibleImage || loadedSource === source) return;
    const start = () => { timer.current = setTimeout(() => setFailedSource(source), 15_000); };
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === "undefined") start();
    else {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); start(); }
      }, { rootMargin: "200px" });
      if (host.current) observer.observe(host.current);
    }
    return () => { clearTimeout(timer.current); observer?.disconnect(); };
  }, [source, visibleImage, loadedSource]);
  return <div className="destination-image" ref={host}>
    {visibleImage ? <>
      <div className="destination-image-placeholder" aria-hidden="true"><MediaFallback alt="" /></div>
      <img key={source} src={source} alt={photo.city} loading="lazy" decoding="async"
        onLoad={() => { clearTimeout(timer.current); setLoadedSource(source); }}
        onError={() => { clearTimeout(timer.current); setFailedSource(source); }} />
      <PhotoAttribution photo={photo} />
    </> : <MediaFallback alt={i18n.t("imageUnavailable", { ns: "trips", name: photo.city })} />}
  </div>;
}

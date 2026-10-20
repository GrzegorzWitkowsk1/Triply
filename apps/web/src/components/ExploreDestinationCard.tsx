import { PlaceOutlined } from "@mui/icons-material";
import type { Destination } from "@triply/shared";
import DestinationSaveButton from "./DestinationSaveButton";
import DestinationPlanButton from "./DestinationPlanButton";
import DestinationImage from "./DestinationImage";

export default function ExploreDestinationCard({ destination, onOpen, collectionSlug }: { destination: Destination; onOpen: () => void; collectionSlug?: string }) {
  return <article className="trend-card" aria-label={`Destination: ${destination.city}`} data-destination-id={destination.id}>
    <div className="trend-card-media">
      <DestinationImage photo={destination} />
      <DestinationSaveButton destinationId={destination.id} name={destination.city} />
    </div>
    <div className="trend-card-body">
      <span className="trend-city">{destination.city}</span>
      <span className="trend-locale"><PlaceOutlined fontSize="small" />{destination.country || "Country unavailable"}</span>
      <button type="button" className="btn btn-secondary" onClick={onOpen}>Open destination</button>
      <DestinationPlanButton destinationId={destination.id} collectionSlug={collectionSlug} />
    </div>
  </article>;
}

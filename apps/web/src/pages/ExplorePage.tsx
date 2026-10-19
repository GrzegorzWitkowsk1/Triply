import {
  ArrowForwardOutlined,
  AutoAwesomeOutlined,
  PlaceOutlined,
  TrendingUpOutlined,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { COLLECTIONS, TRENDING_TRIPS } from "../config/explore";
import { findDestinationByCity } from "@triply/shared";
import DestinationSaveButton from "../components/DestinationSaveButton";

export default function ExplorePage() {
  const navigate = useNavigate();

  return (
    <div className="explore-page">
      <div className="explore-inner">
        <AutoAwesomeOutlined className="explore-spark" />

        <p className="explore-eyebrow">Inspiration</p>
        <h1 className="explore-title">Where to next?</h1>
        <p className="explore-subtitle">
          Browse ideas travelers love right now, then let Triply shape one into
          your perfect itinerary.
        </p>

        <div className="explore-section-title">
          <TrendingUpOutlined />
          <h2>Trending this season</h2>
        </div>

        <div className="trend-grid">
          {TRENDING_TRIPS.map((trip) => (
            <article key={trip.id} className="trend-card">
              <div className="trend-card-media">
                <img src={trip.image} alt={trip.city} />
                {findDestinationByCity(trip.city, trip.country) && <DestinationSaveButton destinationId={findDestinationByCity(trip.city, trip.country)!.id} name={trip.city} />}
                <span className="trend-badge">
                  {trip.days} {trip.days === 1 ? "day" : "days"}
                </span>
              </div>

              <div className="trend-card-body">
                <span className="trend-city">{trip.city}</span>
                <span className="trend-locale">
                  <PlaceOutlined fontSize="small" />
                  {trip.country} · {trip.activities} activities
                </span>
              </div>
            </article>
          ))}
        </div>

        <h2 className="explore-collections-title">Curated collections</h2>

        <div className="collections-grid">
          {COLLECTIONS.map((collection) => {
            const Icon = collection.icon;
            return (
              <article key={collection.id} className="collection-card">
                <span
                  className="collection-icon"
                  style={{
                    color: collection.color,
                    backgroundColor: `${collection.color}1a`,
                  }}
                >
                  <Icon />
                </span>
                <h3 className="collection-title">{collection.title}</h3>
                <p className="collection-desc">{collection.description}</p>
                <div className="collection-tags">
                  {collection.tags.map((tag) => (
                    <span key={tag} className="collection-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>

        <section className="explore-cta">
          <div className="explore-cta-copy">
            <h2>Have somewhere in mind already?</h2>
            <p>Describe it in one sentence and Triply builds the whole trip.</p>
          </div>
          <button
            type="button"
            className="btn btn-primary explore-cta-btn"
            onClick={() => navigate("/home", { state: { focusPrompt: true } })}
          >
            Plan my trip
            <ArrowForwardOutlined fontSize="small" />
          </button>
        </section>
      </div>
    </div>
  );
}

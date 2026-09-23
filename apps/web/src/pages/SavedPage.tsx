import {
  ArrowForwardOutlined,
  BookmarkOutlined,
  CalendarMonthOutlined,
  Favorite,
  FavoriteBorderOutlined,
  PlaceOutlined,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { SAVED_PLACES, TRIP_IDEAS } from "../config/saved";

export default function SavedPage() {
  const navigate = useNavigate();

  return (
    <div className="saved-page">
      <div className="saved-inner">
        <FavoriteBorderOutlined className="saved-spark" />

        <p className="saved-eyebrow">Your collection</p>
        <h1 className="saved-title">Saved for later</h1>
        <p className="saved-subtitle">
          Places and ideas you've bookmarked — Triply can weave any of them
          into your itinerary.
        </p>

        <h2 className="saved-section-title">Saved places</h2>

        <div className="saved-grid">
          {SAVED_PLACES.map((place) => {
            const Icon = place.icon;
            return (
              <article key={place.id} className="saved-card">
                <div className="saved-card-media">
                  <img src={place.image} alt={place.name} />
                  <div className="saved-card-badges">
                    <span className="saved-badge">{place.badge}</span>
                    <span className="saved-heart">
                      <Favorite />
                    </span>
                  </div>
                </div>

                <div className="saved-card-body">
                  <span className="saved-name-row">
                    <Icon className="saved-type-icon" />
                    <span className="saved-name">{place.name}</span>
                  </span>
                  <span className="saved-locale">
                    <PlaceOutlined fontSize="small" />
                    {place.city}
                  </span>
                  <p className="saved-desc">"{place.description}"</p>
                </div>
              </article>
            );
          })}
        </div>

        <h2 className="saved-subsection-title">Trip ideas</h2>

        <div className="ideas-grid">
          {TRIP_IDEAS.map((idea) => {
            const Icon = idea.icon;
            return (
              <article key={idea.id} className="idea-card">
                <span className="idea-icon">
                  <Icon />
                </span>
                <div className="idea-copy">
                  <h3 className="idea-title">{idea.title}</h3>
                  <p className="idea-desc">
                    <BookmarkOutlined fontSize="small" />
                    {idea.description}
                  </p>
                </div>
              </article>
            );
          })}
        </div>

        <section className="explore-cta saved-cta">
          <div className="explore-cta-copy">
            <h2>Turn a saved idea into a plan</h2>
            <p className="cta-idea-line">
              <CalendarMonthOutlined />
              Mention any saved place when you plan your next trip.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary explore-cta-btn"
            onClick={() => navigate("/home", { state: { focusPrompt: true } })}
          >
            Plan a trip
            <ArrowForwardOutlined fontSize="small" />
          </button>
        </section>
      </div>
    </div>
  );
}
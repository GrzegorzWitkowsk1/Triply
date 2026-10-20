import {
  ArrowForwardOutlined,
  AutoAwesomeOutlined,
} from "@mui/icons-material";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { COLLECTIONS } from "../config/explore";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Chip, IconButton, InputAdornment, MenuItem, Pagination, Skeleton, TextField } from "@mui/material";
import { CloseOutlined, SearchOutlined } from "@mui/icons-material";
import { DESTINATION_SORTS, findDestination } from "@triply/shared";
import { useDestinationFilters, useExploreDestinations } from "../hooks/useExploreDestinations";
import { useExploreState } from "../hooks/useExploreState";
import ExploreDestinationCard from "../components/ExploreDestinationCard";
import DestinationSaveButton from "../components/DestinationSaveButton";
import { SavedPlaceDetails } from "../components/saved/SavedPlaceCard";
import { useSavedDestinationIds } from "../hooks/useSavedDestinations";

export default function ExplorePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { query, draft, search, update, clear, canonicalizePage } = useExploreState();
  const searchRef = useRef<HTMLInputElement>(null);
  const { page } = query;
  const destinations = useExploreDestinations(query);
  const filters = useDestinationFilters();
  const savedStatus = useSavedDestinationIds();
  const regions = filters.data?.regions.filter(region => region.countryId === query.country) ?? [];
  const active = Boolean(query.q || query.country || query.region || query.interests.length);
  const changing = destinations.isFetching || draft.trim().replace(/\s+/gu, " ") !== query.q;
  useEffect(() => {
    if (destinations.data && destinations.data.page !== page) canonicalizePage(destinations.data.page);
  }, [destinations.data, page, draft]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const selected = destinations.data?.items.find(item => item.id === detailId);

  return (
    <div className="explore-page">
      <div className="explore-inner">
        <AutoAwesomeOutlined className="explore-spark" />

        <p className="explore-eyebrow">Inspiration</p>
        <h1 className="explore-title">Where to next?</h1>
        <p className="explore-subtitle">
          Browse destinations, then let Triply shape one into
          your perfect itinerary.
        </p>

        <div className="explore-toolbar" role="group" aria-label="Destination discovery">
          <TextField label="Search destinations" inputRef={searchRef} value={draft} onChange={event => search(event.target.value)} fullWidth
            slotProps={{ htmlInput: { role: "searchbox", maxLength: 120 }, input: {
              startAdornment: <InputAdornment position="start"><SearchOutlined /></InputAdornment>,
              endAdornment: draft ? <InputAdornment position="end"><IconButton aria-label="Clear search" onClick={() => { search(""); searchRef.current?.focus(); }}><CloseOutlined /></IconButton></InputAdornment> : null,
            } }} />
          <TextField select label="Country" value={query.country} fullWidth disabled={filters.isPending}
            onChange={event => update({ country: event.target.value })}>
            <MenuItem value="">All countries</MenuItem>
            {query.country && !filters.data?.countries.some(country => country.id === query.country) && <MenuItem value={query.country}>Unavailable country</MenuItem>}
            {filters.data?.countries.map(country => <MenuItem key={country.id} value={country.id}>{country.name}</MenuItem>)}
          </TextField>
          <TextField select label="Sort destinations" value={query.sort} fullWidth onChange={event => update({ sort: event.target.value as typeof query.sort })}>
            {DESTINATION_SORTS.map(sort => <MenuItem key={sort} value={sort}>{sort === "name-asc" ? "Name A–Z" : sort === "name-desc" ? "Name Z–A" : "Country A–Z"}</MenuItem>)}
          </TextField>
          {regions.length > 0 && <TextField select label="Region" value={query.region} fullWidth onChange={event => update({ region: event.target.value })}>
            <MenuItem value="">All regions</MenuItem>
            {query.region && !regions.some(region => region.id === query.region) && <MenuItem value={query.region}>Unavailable region</MenuItem>}
            {regions.map(region => <MenuItem key={region.id} value={region.id}>{region.name}</MenuItem>)}
          </TextField>}
        </div>
        {filters.isError && <Alert severity="warning" action={<Button onClick={() => void filters.refetch()}>Retry filters</Button>}>Could not load filter options. Search and sorting are still available.</Alert>}
        {!!filters.data?.interests.length && <div className="explore-filter-chips" role="group" aria-label="Destination interests">
          {filters.data.interests.map(interest => <Chip key={interest.id} label={interest.label} component="button" clickable aria-pressed={query.interests.includes(interest.id)}
            color={query.interests.includes(interest.id) ? "primary" : "default"} onClick={() => update({ interests: (query.interests.includes(interest.id) ? query.interests.filter(id => id !== interest.id) : [...query.interests, interest.id]).sort() })} />)}
        </div>}
        <div className="explore-filter-chips" aria-label="Active destination filters">
          {query.q && <Chip label={`Search: ${query.q}`} onDelete={() => search("")} />}
          {query.country && <Chip label={`Country: ${filters.data?.countries.find(country => country.id === query.country)?.name ?? query.country}`} onDelete={() => update({ country: "" })} />}
          {query.region && <Chip label={`Region: ${regions.find(region => region.id === query.region)?.name ?? query.region}`} onDelete={() => update({ region: "" })} />}
          {query.interests.map(id => <Chip key={id} label={filters.data?.interests.find(interest => interest.id === id)?.label ?? id} onDelete={() => update({ interests: query.interests.filter(value => value !== id) })} />)}
          {(active || query.sort !== "name-asc") && <Button onClick={() => { clear(); searchRef.current?.focus(); }}>Clear filters</Button>}
        </div>
        <p className="explore-results-count" role="status" aria-live="polite">{changing ? "Loading destinations…" : destinations.data ? `${destinations.data.total} destinations found` : destinations.isError ? "Destinations could not be loaded" : "Loading destinations…"}</p>

        {destinations.isError && <Alert severity="error" action={<Button onClick={() => void destinations.refetch()}>Retry</Button>}>Could not load destinations. Please try again.</Alert>}
        {savedStatus.isError && <Alert severity="warning" action={<Button onClick={() => void savedStatus.refetch()}>Retry Saved status</Button>}>Could not load Saved status. Your collection has not changed.</Alert>}
        {savedStatus.fetchStatus === "paused" && <Alert severity="info">Saved status is waiting for a connection. Reconnect to update your collection.</Alert>}
        <div className="trend-grid" aria-busy={changing}>
          {destinations.isPending && Array.from({ length: 4 }, (_, index) => <Skeleton key={index} data-testid="explore-skeleton" variant="rounded" height={240} />)}
          {destinations.data?.items.map(destination => <ExploreDestinationCard key={destination.id} destination={destination} onOpen={() => setDetailId(destination.id)} />)}
        </div>
        {destinations.isSuccess && !destinations.data.items.length && <p>{active && filters.data?.total !== 0 ? "No destinations found. Try another search or remove some filters." : "No destinations available yet."}</p>}
        {destinations.data && destinations.data.total > 24 && <Pagination className="explore-pagination" aria-label="Destination pages" page={destinations.data.page} count={Math.ceil(destinations.data.total / 24)} onChange={(_event, next) => { setDetailId(null); update({ page: next }); }} />}
        <SavedPlaceDetails item={selected ? { type: "destinations", key: selected.id, row: { destinationId: selected.id, destination: selected, createdAt: "" } } : undefined} destinationAction={selected ? <DestinationSaveButton destinationId={selected.id} name={selected.city} /> : undefined} onClose={() => setDetailId(null)} />

        <h2 className="explore-collections-title">Curated collections</h2>

        <div className="collections-grid">
          {COLLECTIONS.map((collection) => {
            const Icon = collection.icon;
            return (
              <article key={collection.slug} className="collection-card">
                <Link to={`/explore/collections/${collection.slug}`} state={{ exploreReturnTo: `${location.pathname}${location.search}` }} className="collection-main" aria-label={collection.title}>
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
                </Link>
                <div className="collection-tags">
                  {collection.destinationIds.map(id => { const destination = findDestination(id); return destination ? (
                    <Link key={id} className="collection-tag" to={`/explore/collections/${collection.slug}?destinationId=${id}`} state={{ exploreReturnTo: `${location.pathname}${location.search}` }} aria-label={`Explore ${destination.city} in ${collection.title}`}>
                      {destination.city}
                    </Link>
                  ) : null; })}
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

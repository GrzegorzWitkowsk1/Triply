import { interestLabel } from "../i18n/labels";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
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
  const { t } = useTranslation("explore", { i18n });
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
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const selected = destinations.data?.items.find(item => item.id === detailId);

  return (
    <div className="explore-page" data-filters-expanded={filtersExpanded}>
      <div className="explore-inner">
        <AutoAwesomeOutlined className="explore-spark" />

        <p className="explore-eyebrow">{i18n.t("inspiration", { ns: "explore" })}</p>
        <h1 className="explore-title">{t("title")}</h1>
        <p className="explore-subtitle">
          {i18n.t("browseDestinationsThenLetTriplyShapeOneInto", { ns: "explore" })}</p>

        <button type="button" className="explore-mobile-filter-toggle trip-action" aria-expanded={filtersExpanded} aria-controls="explore-discovery-controls explore-interest-controls" onClick={() => setFiltersExpanded(value => !value)}>{i18n.t("filtersAndSorting", { ns: "explore" })}</button>
        <div className="explore-toolbar" id="explore-discovery-controls" role="group" aria-label={i18n.t("destinationDiscovery", { ns: "explore" })}>
          <TextField label={i18n.t("searchDestinations", { ns: "explore" })} inputRef={searchRef} value={draft} onChange={event => search(event.target.value)} fullWidth
            slotProps={{ htmlInput: { role: "searchbox", maxLength: 120 }, input: {
              startAdornment: <InputAdornment position="start"><SearchOutlined /></InputAdornment>,
              endAdornment: draft ? <InputAdornment position="end"><IconButton aria-label={i18n.t("clearSearch", { ns: "explore" })} onClick={() => { search(""); searchRef.current?.focus(); }}><CloseOutlined /></IconButton></InputAdornment> : null,
            } }} />
          <TextField select label={i18n.t("country", { ns: "explore" })} value={query.country} fullWidth disabled={filters.isPending}
            onChange={event => update({ country: event.target.value })}>
            <MenuItem value="">{i18n.t("allCountries", { ns: "explore" })}</MenuItem>
            {query.country && !filters.data?.countries.some(country => country.id === query.country) && <MenuItem value={query.country}>{i18n.t("unavailableCountry", { ns: "explore" })}</MenuItem>}
            {filters.data?.countries.map(country => <MenuItem key={country.id} value={country.id}>{country.name}</MenuItem>)}
          </TextField>
          <TextField select label={i18n.t("sortDestinations", { ns: "explore" })} value={query.sort} fullWidth onChange={event => update({ sort: event.target.value as typeof query.sort })}>
            {DESTINATION_SORTS.map(sort => <MenuItem key={sort} value={sort}>{sort === "name-asc" ? i18n.t("nameAZ", { ns: "explore" }) : sort === "name-desc" ? i18n.t("nameZA", { ns: "explore" }) : i18n.t("countryAZ", { ns: "explore" })}</MenuItem>)}
          </TextField>
          {regions.length > 0 && <TextField select label={i18n.t("region", { ns: "explore" })} value={query.region} fullWidth onChange={event => update({ region: event.target.value })}>
            <MenuItem value="">{i18n.t("allRegions", { ns: "explore" })}</MenuItem>
            {query.region && !regions.some(region => region.id === query.region) && <MenuItem value={query.region}>{i18n.t("unavailableRegion", { ns: "explore" })}</MenuItem>}
            {regions.map(region => <MenuItem key={region.id} value={region.id}>{region.name}</MenuItem>)}
          </TextField>}
        </div>
        {filters.isError && <Alert severity="warning" action={<Button onClick={() => void filters.refetch()}>{i18n.t("retryFilters", { ns: "explore" })}</Button>}>{i18n.t("couldNotLoadFilterOptionsSearchAndSorting", { ns: "explore" })}</Alert>}
        {!!filters.data?.interests.length && <div className="explore-filter-chips" id="explore-interest-controls" role="group" aria-label={i18n.t("destinationInterests", { ns: "explore" })}>
          {filters.data.interests.map(interest => <Chip key={interest.id} label={interestLabel(interest.id)} component="button" clickable aria-pressed={query.interests.includes(interest.id)}
            color={query.interests.includes(interest.id) ? "primary" : "default"} onClick={() => update({ interests: (query.interests.includes(interest.id) ? query.interests.filter(id => id !== interest.id) : [...query.interests, interest.id]).sort() })} />)}
        </div>}
        <div className="explore-filter-chips" role="group" aria-label={i18n.t("activeDestinationFilters", { ns: "explore" })}>
          {query.q && <Chip label={i18n.t("search", { ns: "explore", value0: query.q })} onDelete={() => search("")} />}
          {query.country && <Chip label={i18n.t("country2", { ns: "explore", value0: filters.data?.countries.find(country => country.id === query.country)?.name ?? query.country })} onDelete={() => update({ country: "" })} />}
          {query.region && <Chip label={i18n.t("region2", { ns: "explore", value0: regions.find(region => region.id === query.region)?.name ?? query.region })} onDelete={() => update({ region: "" })} />}
          {query.interests.map(id => <Chip key={id} label={interestLabel(id)} onDelete={() => update({ interests: query.interests.filter(value => value !== id) })} />)}
          {(active || query.sort !== "name-asc") && <Button onClick={() => { clear(); searchRef.current?.focus(); }}>{i18n.t("clearFilters", { ns: "explore" })}</Button>}
        </div>
        <p className="explore-results-count" role="status" aria-live="polite">{changing ? i18n.t("loadingDestinations", { ns: "explore" }) : destinations.data ? i18n.t("destinationCount", { ns: "explore", count: destinations.data.total }) : destinations.isError ? i18n.t("destinationsCouldNotBeLoaded", { ns: "explore" }) : i18n.t("loadingDestinations", { ns: "explore" })}</p>

        {destinations.isError && <Alert severity="error" action={<Button onClick={() => void destinations.refetch()}>{i18n.t("retry", { ns: "common" })}</Button>}>{i18n.t("couldNotLoadDestinationsPleaseTryAgain", { ns: "explore" })}</Alert>}
        {savedStatus.isError && <Alert severity="warning" action={<Button onClick={() => void savedStatus.refetch()}>{i18n.t("retrySavedStatus", { ns: "explore" })}</Button>}>{i18n.t("couldNotLoadSavedStatusYourCollectionHas", { ns: "explore" })}</Alert>}
        {savedStatus.fetchStatus === "paused" && <Alert severity="info">{i18n.t("savedStatusIsWaitingForAConnectionReconnect", { ns: "explore" })}</Alert>}
        <div className="trend-grid" aria-busy={changing}>
          {destinations.isPending && Array.from({ length: 4 }, (_, index) => <Skeleton key={index} data-testid="explore-skeleton" variant="rounded" height={240} />)}
          {destinations.data?.items.map(destination => <ExploreDestinationCard key={destination.id} destination={destination} onOpen={() => setDetailId(destination.id)} />)}
        </div>
        {destinations.isSuccess && !destinations.data.items.length && <p>{active && filters.data?.total !== 0 ? i18n.t("noDestinationsFoundTryAnotherSearchOrRemove", { ns: "explore" }) : i18n.t("noDestinationsAvailableYet", { ns: "explore" })}</p>}
        {destinations.data && destinations.data.total > 24 && <Pagination className="explore-pagination" aria-label={i18n.t("destinationPages", { ns: "explore" })} page={destinations.data.page} count={Math.ceil(destinations.data.total / 24)} onChange={(_event, next) => { setDetailId(null); update({ page: next }); }} />}
        <SavedPlaceDetails item={selected ? { type: "destinations", key: selected.id, row: { destinationId: selected.id, destination: selected, createdAt: "" } } : undefined} destinationAction={selected ? <DestinationSaveButton destinationId={selected.id} name={selected.city} /> : undefined} onClose={() => setDetailId(null)} />

        <h2 className="explore-collections-title">{t("collectionsTitle")}</h2>

        <div className="collections-grid">
          {COLLECTIONS.map((collection) => {
            const Icon = collection.icon;
            return (
              <article key={collection.slug} className="collection-card">
                <Link to={`/explore/collections/${collection.slug}`} state={{ exploreReturnTo: `${location.pathname}${location.search}` }} className="collection-main">
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
                    <Link key={id} className="collection-tag" to={`/explore/collections/${collection.slug}?destinationId=${id}`} state={{ exploreReturnTo: `${location.pathname}${location.search}` }} aria-label={i18n.t("exploreIn", { ns: "explore", value0: destination.city, value1: collection.title })}>
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
            <h2>{i18n.t("haveSomewhereInMindAlready", { ns: "explore" })}</h2>
            <p>{i18n.t("describeItInOneSentenceAndTriplyBuilds", { ns: "explore" })}</p>
          </div>
          <button
            type="button"
            className="btn btn-primary explore-cta-btn"
            onClick={() => navigate("/home", { state: { focusPrompt: true } })}
          >
            {i18n.t("planMyTrip", { ns: "explore" })}<ArrowForwardOutlined fontSize="small" />
          </button>
        </section>
      </div>
    </div>
  );
}

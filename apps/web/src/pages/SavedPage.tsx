import { useTranslation } from "react-i18next";
import i18n, { getSelectedLanguage } from "../i18n";
import { useMemo, useRef, useState } from "react";
import { FavoriteBorderOutlined, SearchOutlined, CloseOutlined } from "@mui/icons-material";
import { Alert, Button, IconButton, InputAdornment, MenuItem, Skeleton, TextField } from "@mui/material";
import { Link, useSearchParams } from "react-router-dom";
import { useSavedDestinations } from "../hooks/useSavedDestinations";
import { useSavedAttractions } from "../hooks/useSavedAttractions";
import { filterSaved, savedCollection, SAVED_SORTS, SAVED_TYPES, type SavedSort, type SavedType } from "../config/saved";
import SavedPlaceCard, { SavedPlaceDetails } from "../components/saved/SavedPlaceCard";

const LABELS = { get all() { return i18n.t("all", { ns: "saved" }); }, get destinations() { return i18n.t("destinations", { ns: "saved" }); }, get attractions() { return i18n.t("attractions", { ns: "saved" }); } };
const SORT_LABELS = { get recent() { return i18n.t("recentlySaved", { ns: "saved" }); }, get oldest() { return i18n.t("oldestSaved", { ns: "saved" }); }, get "name-asc"() { return i18n.t("nameAZ", { ns: "saved" }); }, get "name-desc"() { return i18n.t("nameZA", { ns: "saved" }); } };
export default function SavedPage() {
  const { t } = useTranslation("saved", { i18n });
  const destinations = useSavedDestinations();
  const attractions = useSavedAttractions();
  const [params, setParams] = useSearchParams();
  const type = SAVED_TYPES.includes(params.get("type") as SavedType) ? params.get("type") as SavedType : "all";
  const sort = SAVED_SORTS.includes(params.get("sort") as SavedSort) ? params.get("sort") as SavedSort : "recent";
  const search = params.get("q") ?? "";
  const searchRef = useRef<HTMLInputElement>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const update = (key: string, value: string, replace = false) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (!value || key === "type" && value === "all" || key === "sort" && value === "recent") next.delete(key); else next.set(key, value);
    return next;
  }, { replace });
  const items = useMemo(() => savedCollection(destinations.data?.destinations ?? [], attractions.data?.attractions ?? []), [destinations.data, attractions.data]);
  const locale = getSelectedLanguage();
  const results = useMemo(() => filterSaved(items, type, search, sort, locale), [items, type, search, sort, locale]);
  const counts = { all: items.length, destinations: items.filter(item => item.type === "destinations").length, attractions: items.filter(item => item.type === "attractions").length };
  const sources = [{ type: "destinations" as const, query: destinations }, { type: "attractions" as const, query: attractions }];
  const visibleSources = sources.filter(source => type === "all" || source.type === type);
  const pending = visibleSources.some(source => source.query.isPending);
  const failed = visibleSources.some(source => source.query.isError);
  const complete = sources.every(source => source.query.isSuccess);
  const allKnown = sources.every(source => source.query.data !== undefined);
  const showEmpty = !pending && !failed && results.length === 0;
  const noMatches = search.trim().length > 0 && (type === "all" ? counts.all : counts[type]) > 0;
  const entirelyEmpty = complete && counts.all === 0;
  const emptyTitle = noMatches ? i18n.t("noPlacesMatchYourSearch", { ns: "saved" }) : entirelyEmpty && type === "all" ? i18n.t("noSavedPlacesYet", { ns: "saved" }) : type === "attractions" ? i18n.t("noSavedAttractionsYet", { ns: "saved" }) : type === "destinations" ? i18n.t("noSavedDestinationsYet", { ns: "saved" }) : i18n.t("noSavedPlacesYet", { ns: "saved" });
  return <div className="saved-page"><div className="saved-inner">
    <header><FavoriteBorderOutlined className="saved-spark" aria-hidden="true" />
      <p className="saved-eyebrow">{t("eyebrow")}</p><h1 className="saved-title">{t("title")}</h1>
      <p className="saved-subtitle">{i18n.t("keepYourFavoriteDestinationsAndAttractionsInOne", { ns: "saved" })}</p>
      <p className="saved-count" aria-live="polite">{allKnown ? i18n.t("savedCount", { ns: "saved", count: counts.all }) : sources.some(source => source.query.isError) ? i18n.t("someSavedPlacesCouldNotBeLoaded", { ns: "saved" }) : i18n.t("loadingYourCollection", { ns: "saved" })}</p>
    </header>
    <div className="trip-filters saved-filters" role="group" aria-label={i18n.t("savedPlaceCategories", { ns: "saved" })}>
      {SAVED_TYPES.map(value => {
        const known = value === "all" ? sources.every(source => source.query.data !== undefined) : sources.find(source => source.type === value)!.query.data !== undefined;
        return <button key={value} type="button" className={`trip-filter${type === value ? " is-active" : ""}`} aria-pressed={type === value} onClick={() => update("type", value)}>{LABELS[value]} ({known ? counts[value] : "…"})</button>;
      })}
    </div>
    <div className="saved-toolbar">
      <TextField label={i18n.t("searchSavedPlaces", { ns: "saved" })} inputRef={searchRef} value={search} onChange={event => update("q", event.target.value, true)} fullWidth
        slotProps={{ htmlInput: { role: "searchbox", enterKeyHint: "search" }, input: { startAdornment: <InputAdornment position="start"><SearchOutlined /></InputAdornment>, endAdornment: search ? <InputAdornment position="end"><IconButton aria-label={i18n.t("clearSearch", { ns: "saved" })} title={i18n.t("clearSearch", { ns: "saved" })} onClick={() => { update("q", "", true); searchRef.current?.focus(); }}><CloseOutlined /></IconButton></InputAdornment> : null } }} />
      <TextField select label={i18n.t("sortSavedPlaces", { ns: "saved" })} value={sort} onChange={event => update("sort", event.target.value)} fullWidth>
        {SAVED_SORTS.map(value => <MenuItem key={value} value={value}>{SORT_LABELS[value]}</MenuItem>)}
      </TextField>
    </div>
    {visibleSources.map(({ type: sourceType, query }) => query.isError ? <Alert className="saved-query-error" severity="error" key={sourceType}
      action={<Button color="inherit" onClick={() => void query.refetch()}>{i18n.t(sourceType === "destinations" ? "retryDestinations" : "retryAttractions", { ns: "saved" })}</Button>}>
      {query.error && "status" in query.error && query.error.status === 401 ? i18n.t("yourSessionHasExpiredSignInOrEnter", { ns: "saved" }) : i18n.t(sourceType === "attractions" ? "loadAttractionsFailed" : "loadDestinationsFailed", { ns: "saved" })}
      {query.data && i18n.t("yourPreviouslyLoadedPlacesAreStillShown", { ns: "saved" })}
    </Alert> : null)}
    <section aria-labelledby="saved-results-title" aria-busy={pending}>
      <h2 id="saved-results-title" className="saved-results-title">{i18n.t("resultsTitle", { ns: "saved", type: LABELS[type] })}</h2>
      <p className="saved-results-count" role="status">{pending ? i18n.t("loadingSavedPlaces", { ns: "saved" }) : i18n.t(failed ? "shownCountPartial" : "shownCount", { ns: "saved", count: results.length })}</p>
      <div className="saved-grid">
        {results.map(item => <SavedPlaceCard key={item.key} item={item} onOpen={() => setDetailKey(item.key)} />)}
        {pending && Array.from({ length: results.length ? 2 : 4 }, (_, index) => <div className="saved-card saved-skeleton" data-testid="saved-skeleton" key={`skeleton-${index}`} aria-hidden="true">
          <Skeleton variant="rectangular" height={170} animation={false} /><div className="saved-card-body"><Skeleton width="80%" height={30} animation={false} /><Skeleton width="60%" animation={false} /><Skeleton height={44} animation={false} /></div>
        </div>)}
      </div>
      {showEmpty && <div className="saved-empty"><FavoriteBorderOutlined aria-hidden="true" /><h3>{emptyTitle}</h3>
        <p>{noMatches ? i18n.t("tryAnotherNameCountryOrCategory", { ns: "saved" }) : type === "attractions" ? i18n.t("saveAttractionsFromYourTripItinerariesToKeep", { ns: "saved" }) : i18n.t("exploreDestinationsAndSaveThePlacesYouD", { ns: "saved" })}</p>
        {!noMatches && <Button component={Link} to={type === "attractions" ? "/trips" : "/explore"} variant="contained">{type === "attractions" ? i18n.t("viewMyTrips", { ns: "saved" }) : i18n.t("exploreDestinations", { ns: "saved" })}</Button>}
      </div>}
    </section>
    <SavedPlaceDetails item={items.find(item => item.key === detailKey)} onClose={() => setDetailKey(null)} />
  </div></div>;
}

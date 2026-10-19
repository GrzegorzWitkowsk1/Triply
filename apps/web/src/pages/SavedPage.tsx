import { useMemo, useRef, useState } from "react";
import { FavoriteBorderOutlined, SearchOutlined, CloseOutlined } from "@mui/icons-material";
import { Alert, Button, IconButton, InputAdornment, MenuItem, Skeleton, TextField } from "@mui/material";
import { Link, useSearchParams } from "react-router-dom";
import { useSavedDestinations } from "../hooks/useSavedDestinations";
import { useSavedAttractions } from "../hooks/useSavedAttractions";
import { filterSaved, savedCollection, SAVED_SORTS, SAVED_TYPES, type SavedSort, type SavedType } from "../config/saved";
import SavedPlaceCard, { SavedPlaceDetails } from "../components/saved/SavedPlaceCard";

const LABELS = { all: "All", destinations: "Destinations", attractions: "Attractions" };
const SORT_LABELS = { recent: "Recently saved", oldest: "Oldest saved", "name-asc": "Name A–Z", "name-desc": "Name Z–A" };
export default function SavedPage() {
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
  const results = useMemo(() => filterSaved(items, type, search, sort), [items, type, search, sort]);
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
  const emptyTitle = noMatches ? "No places match your search" : entirelyEmpty && type === "all" ? "No saved places yet" : type === "attractions" ? "No saved attractions yet" : type === "destinations" ? "No saved destinations yet" : "No saved places yet";
  return <div className="saved-page"><div className="saved-inner">
    <header><FavoriteBorderOutlined className="saved-spark" aria-hidden="true" />
      <p className="saved-eyebrow">Your collection</p><h1 className="saved-title">Saved places</h1>
      <p className="saved-subtitle">Keep your favorite destinations and attractions in one place.</p>
      <p className="saved-count" aria-live="polite">{allKnown ? `${counts.all} saved ${counts.all === 1 ? "place" : "places"}` : sources.some(source => source.query.isError) ? "Some saved places could not be loaded" : "Loading your collection…"}</p>
    </header>
    <div className="trip-filters saved-filters" role="group" aria-label="Saved place categories">
      {SAVED_TYPES.map(value => {
        const known = value === "all" ? sources.every(source => source.query.data !== undefined) : sources.find(source => source.type === value)!.query.data !== undefined;
        return <button key={value} type="button" className={`trip-filter${type === value ? " is-active" : ""}`} aria-pressed={type === value} onClick={() => update("type", value)}>{LABELS[value]} ({known ? counts[value] : "…"})</button>;
      })}
    </div>
    <div className="saved-toolbar">
      <TextField label="Search saved places" inputRef={searchRef} value={search} onChange={event => update("q", event.target.value, true)} fullWidth
        slotProps={{ htmlInput: { role: "searchbox", enterKeyHint: "search" }, input: { startAdornment: <InputAdornment position="start"><SearchOutlined /></InputAdornment>, endAdornment: search ? <InputAdornment position="end"><IconButton aria-label="Clear search" title="Clear search" onClick={() => { update("q", "", true); searchRef.current?.focus(); }}><CloseOutlined /></IconButton></InputAdornment> : null } }} />
      <TextField select label="Sort saved places" value={sort} onChange={event => update("sort", event.target.value)} fullWidth>
        {SAVED_SORTS.map(value => <MenuItem key={value} value={value}>{SORT_LABELS[value]}</MenuItem>)}
      </TextField>
    </div>
    {visibleSources.map(({ type: sourceType, query }) => query.isError ? <Alert className="saved-query-error" severity="error" key={sourceType}
      action={<Button color="inherit" onClick={() => void query.refetch()}>Retry {sourceType}</Button>}>
      {query.error && "status" in query.error && query.error.status === 401 ? "Your session has expired. Sign in or enter Guest Mode again." : `Could not load saved ${sourceType}. Check your connection and try again.`}
      {query.data && " Your previously loaded places are still shown."}
    </Alert> : null)}
    <section aria-labelledby="saved-results-title" aria-busy={pending}>
      <h2 id="saved-results-title" className="saved-results-title">{LABELS[type]} saved places</h2>
      <p className="saved-results-count" role="status">{pending ? "Loading saved places…" : `${results.length} ${results.length === 1 ? "place" : "places"} shown${failed ? " · Some places could not be loaded" : ""}`}</p>
      <div className="saved-grid">
        {results.map(item => <SavedPlaceCard key={item.key} item={item} onOpen={() => setDetailKey(item.key)} />)}
        {pending && Array.from({ length: results.length ? 2 : 4 }, (_, index) => <div className="saved-card saved-skeleton" data-testid="saved-skeleton" key={`skeleton-${index}`} aria-hidden="true">
          <Skeleton variant="rectangular" height={170} animation={false} /><div className="saved-card-body"><Skeleton width="80%" height={30} animation={false} /><Skeleton width="60%" animation={false} /><Skeleton height={44} animation={false} /></div>
        </div>)}
      </div>
      {showEmpty && <div className="saved-empty"><FavoriteBorderOutlined aria-hidden="true" /><h3>{emptyTitle}</h3>
        <p>{noMatches ? "Try another name, country or category." : type === "attractions" ? "Save attractions from your trip itineraries to keep them here, even after a trip ends." : "Explore destinations and save the places you'd love to visit."}</p>
        {!noMatches && <Button component={Link} to={type === "attractions" ? "/trips" : "/explore"} variant="contained">{type === "attractions" ? "View my trips" : "Explore destinations"}</Button>}
      </div>}
    </section>
    <SavedPlaceDetails item={items.find(item => item.key === detailKey)} onClose={() => setDetailKey(null)} />
  </div></div>;
}

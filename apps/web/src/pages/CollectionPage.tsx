import { useEffect, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Alert, Button, Chip, Skeleton } from "@mui/material";
import { ArrowBackOutlined } from "@mui/icons-material";
import {
  findCuratedCollection,
  INTEREST_OPTIONS,
  PACE_OPTIONS,
} from "@triply/shared";
import { COLLECTION_ICONS } from "../config/explore";
import { useCollectionDestinations } from "../hooks/useCollectionDestinations";
import { useSavedDestinationIds } from "../hooks/useSavedDestinations";
import ExploreDestinationCard from "../components/ExploreDestinationCard";
import DestinationSaveButton from "../components/DestinationSaveButton";
import { SavedPlaceDetails } from "../components/saved/SavedPlaceCard";

export default function CollectionPage() {
  const { slug } = useParams();
  const location = useLocation();
  const returnTo: unknown = location.state?.exploreReturnTo;
  const exploreUrl =
    typeof returnTo === "string" &&
    (returnTo === "/explore" || returnTo.startsWith("/explore?"))
      ? returnTo
      : "/explore";
  const [params] = useSearchParams();
  const collection = findCuratedCollection(slug);
  const destinations = useCollectionDestinations(slug);
  const saved = useSavedDestinationIds();
  const [detailId, setDetailId] = useState<string>();
  const focused = useRef("");
  const focusId =
    params.getAll("destinationId").length === 1
      ? params.get("destinationId")
      : null;
  useEffect(() => {
    const key = `${slug}:${focusId}`;
    if (
      !focusId ||
      focused.current === key ||
      !destinations.data?.items.some((item) => item.id === focusId)
    )
      return;
    const element = document.getElementById(`collection-${focusId}`);
    element?.focus();
    element?.scrollIntoView?.({ block: "center" });
    focused.current = key;
  }, [slug, focusId, destinations.data]);
  const selected = destinations.data?.items.find(
    (item) => item.id === detailId,
  );
  return (
    <div className="explore-page">
      <div className="explore-inner">
        <Button
          component={Link}
          className="collection-back"
          to={exploreUrl}
          variant="outlined"
          startIcon={<ArrowBackOutlined />}
          sx={{
            borderRadius: "999px",
            px: 2,
            fontWeight: 700,
            textTransform: "none",
            marginBottom: "16px",
          }}
        >
          Back to Explore
        </Button>
        {!collection ? (
          <>
            <h1>Collection not found</h1>
            <p>
              This collection is unavailable. Browse the collections on Explore.
            </p>
          </>
        ) : (
          <>
            <header className="collection-header">
              <span
                className="collection-icon"
                style={{
                  color: collection.color,
                  backgroundColor: `${collection.color}1a`,
                }}
                aria-hidden="true"
              >
                {(() => {
                  const Icon = COLLECTION_ICONS[collection.icon];
                  return <Icon />;
                })()}
              </span>
              <h1 className="explore-title">{collection.title}</h1>
              <p className="explore-subtitle">{collection.description}</p>
            </header>
            <section
              className="collection-suggestions"
              aria-label="Suggested trip preferences"
            >
              <h2>Make this theme your own</h2>
              <p>
                An editorial selection for inspiration. Start planning from a
                destination to try these preferences, then change them before
                generating your itinerary.
              </p>
              <div className="explore-filter-chips">
                {collection.suggestedInterests.map((id) => (
                  <Chip
                    key={id}
                    label={
                      INTEREST_OPTIONS.find((option) => option.id === id)
                        ?.label ?? id
                    }
                  />
                ))}
                <Chip
                  label={`Pace: ${PACE_OPTIONS.find((option) => option.value === collection.suggestedPace)?.label}`}
                />
              </div>
            </section>
            <h2>Destinations in this collection</h2>
            {destinations.isPending && (
              <p role="status">Loading collection destinations…</p>
            )}
            {destinations.isError && (
              <Alert
                severity="error"
                action={
                  <Button onClick={() => void destinations.refetch()}>
                    Retry collection
                  </Button>
                }
              >
                Could not load collection destinations. Please try again.
              </Alert>
            )}
            {saved.isError && (
              <Alert
                severity="warning"
                action={
                  <Button onClick={() => void saved.refetch()}>
                    Retry Saved status
                  </Button>
                }
              >
                Could not load Saved status. Your collection has not changed.
              </Alert>
            )}
            <div
              className="trend-grid collection-destinations"
              aria-busy={destinations.isFetching}
            >
              {destinations.isPending &&
                collection.destinationIds.map((id) => (
                  <Skeleton
                    key={id}
                    data-testid="collection-skeleton"
                    variant="rounded"
                    height={300}
                  />
                ))}
              {destinations.data?.items.map((destination) => (
                <div
                  key={destination.id}
                  id={`collection-${destination.id}`}
                  tabIndex={-1}
                  className="collection-destination"
                >
                  <ExploreDestinationCard
                    destination={destination}
                    collectionSlug={collection.slug}
                    onOpen={() => setDetailId(destination.id)}
                  />
                </div>
              ))}
            </div>
            {destinations.isSuccess && !destinations.data.items.length && (
              <p role="status">
                No destinations are currently available in this collection.
              </p>
            )}
            <SavedPlaceDetails
              collectionSlug={collection.slug}
              item={
                selected
                  ? {
                      type: "destinations",
                      key: selected.id,
                      row: {
                        destinationId: selected.id,
                        destination: selected,
                        createdAt: "",
                      },
                    }
                  : undefined
              }
              destinationAction={
                selected ? (
                  <DestinationSaveButton
                    destinationId={selected.id}
                    name={selected.city}
                  />
                ) : undefined
              }
              onClose={() => setDetailId(undefined)}
            />
          </>
        )}
      </div>
    </div>
  );
}

import { localizedCollection } from "../config/explore";
import { interestLabel as localizedInterest, paceLabel } from "../i18n/labels";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
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
  useTranslation();
  const { slug } = useParams();
  const location = useLocation();
  const returnTo: unknown = location.state?.exploreReturnTo;
  const exploreUrl =
    typeof returnTo === "string" &&
    (returnTo === "/explore" || returnTo.startsWith("/explore?"))
      ? returnTo
      : "/explore";
  const [params] = useSearchParams();
  const collection = localizedCollection(slug);
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
          {i18n.t("backToExplore", { ns: "explore/collections" })}</Button>
        {!collection ? (
          <>
            <h1>{i18n.t("collectionNotFound", { ns: "explore/collections" })}</h1>
            <p>
              {i18n.t("thisCollectionIsUnavailableBrowseTheCollectionsOn", { ns: "explore/collections" })}</p>
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
              aria-label={i18n.t("suggestedTripPreferences", { ns: "explore/collections" })}
            >
              <h2>{i18n.t("makeThisThemeYourOwn", { ns: "explore/collections" })}</h2>
              <p>
                {i18n.t("anEditorialSelectionForInspirationStartPlanningFrom", { ns: "explore/collections" })}</p>
              <div className="explore-filter-chips">
                {collection.suggestedInterests.map((id) => (
                  <Chip
                    key={id}
                    label={
                      localizedInterest(id)
                    }
                  />
                ))}
                <Chip
                  label={i18n.t("pace", { ns: "explore/collections", value0: paceLabel(collection.suggestedPace) })}
                />
              </div>
            </section>
            <h2>{i18n.t("destinationsInThisCollection", { ns: "explore/collections" })}</h2>
            {destinations.isPending && (
              <p role="status">{i18n.t("loadingCollectionDestinations", { ns: "explore/collections" })}</p>
            )}
            {destinations.isError && (
              <Alert
                severity="error"
                action={
                  <Button onClick={() => void destinations.refetch()}>
                    {i18n.t("retryCollection", { ns: "explore/collections" })}</Button>
                }
              >
                {i18n.t("couldNotLoadCollectionDestinationsPleaseTryAgain", { ns: "explore/collections" })}</Alert>
            )}
            {saved.isError && (
              <Alert
                severity="warning"
                action={
                  <Button onClick={() => void saved.refetch()}>
                    {i18n.t("retrySavedStatus", { ns: "explore/collections" })}</Button>
                }
              >
                {i18n.t("couldNotLoadSavedStatusYourCollectionHas", { ns: "explore/collections" })}</Alert>
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
                {i18n.t("noDestinationsAreCurrentlyAvailableInThisCollection", { ns: "explore/collections" })}</p>
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

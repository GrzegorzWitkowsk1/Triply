# Destination catalog

`packages/shared/src/destinations.json` is the existing canonical seed, also used
by Saved and trip selection. Its 212 `city-###` IDs remain unchanged. MongoDB's
`destinations` collection persists this catalog; it is not a separately maintained dataset.

`bun run --cwd apps/api seed` seeds the catalog before the existing user trip
fixtures. API startup also inserts missing catalog records. Both use indexed ID
upserts with `$setOnInsert`: reruns never delete records or overwrite curated
metadata, including nonempty values with empty seed values. Seed corrections to
existing records require an explicit reviewed data migration. Reads never seed.

The seed rejects missing names, invalid IDs and duplicate IDs before writing.
The public DTO allowlists fields, normalizes incomplete optional fields and rejects
unsafe image/link URLs. Malformed identity/name records are skipped with an ID-only
backend diagnostic. Invalid identity/name rows are excluded before counting and
pagination, so public totals and page boundaries agree.

Audit on implementation: all 212 records have distinct IDs and city/country pairs,
city and country names, HTTPS photo URLs, HTTP(S) source/license URLs, license labels and required
photographer credits. No records have missing image metadata. All retain their
existing `provisionally_usable` license audit status; this implementation makes no
new licensing determination. Credits, source and license links appear on images.
Missing credits or license/source metadata suppress the Explore image; failed
image requests use a fixed-size fallback. There are no runtime provider calls.

The source contains no coordinates, country codes, regions, summaries or slugs.
These remain unavailable rather than being generated or inferred. The existing
trip geocoding and selection behavior is unchanged. City/country spelling is
preserved from the prepared source; no external gazetteer verification is performed.

Public API: `GET /api/destinations?page=1&pageSize=24`, maximum page size 48,
positive integer page up to 1,000,000. Ordering uses normalized name (or selected
sort) with the unique canonical ID as a tie-breaker, server-side skip/limit and
one count query. No identity is required and
no guest session is created. Anonymous Save opens the existing login/Guest Mode
entry page; the user saves after entering a session.

## Implementation files

Created:

- `packages/shared/src/destinationCatalog.ts`: public validation and pagination contract.
- `apps/api/src/models/Destination.ts`: persisted catalog and unique ID index.
- `apps/api/src/seed/destinations.ts`: idempotent seed.
- `apps/api/src/seed/DESTINATIONS.md`: data audit and implementation notes.
- `apps/api/src/routes/destinations.ts`: public listing.
- `apps/api/src/routes/destinations.routes.test.ts`: MongoDB integration coverage.
- `apps/api/e2e/explore.spec.ts`: real browser catalog and Saved coverage.
- `apps/web/src/hooks/useExploreDestinations.ts`: cached API query.
- `apps/web/src/components/ExploreDestinationCard.tsx`: existing trend card markup with real data, attribution and fallback.
- `apps/web/src/pages/ExplorePage.test.tsx`: frontend integration coverage.

Modified:

- `packages/shared/src/index.ts`: contract exports.
- `apps/api/src/app.ts`: public route registration.
- `apps/api/src/server.ts`: seed catalog on startup.
- `apps/api/src/seed/index.ts`: seed catalog before existing trip fixtures.
- `apps/api/e2e/server.ts`: reseed isolated catalog after fixture reset.
- `apps/api/e2e/saved.spec.ts`: expired sessions can still browse public Explore.
- `apps/web/src/App.tsx`: public Explore route.
- `apps/web/src/components/layout/Header.tsx`: anonymous entry links.
- `apps/web/src/components/DestinationSaveButton.tsx`: anonymous identity entry.
- `apps/web/src/components/saved/SavedPlaceCard.tsx`: reusable detail dialog action.
- `apps/web/src/config/explore.ts`: remove obsolete mocked trip array.
- `apps/web/src/pages/ExplorePage.tsx`: real catalog, states, pagination and details.
- `apps/web/src/styles.css`: stable image space, attribution and dialog save positioning.

# Explore discovery (Step 15B)

The existing 212-record JSON seed and persisted `destinations` collection remain
the catalog. No destination IDs, images, licenses or classifications were changed.
The current source has country names but no country codes, regions, aliases or
interest tags. Country keys are normalized canonical country names (`spain`), not
invented ISO codes. They are stable across case, spacing and diacritic changes;
a canonical country rename requires updating bookmarked keys or a future alias migration.

## Search and data maintenance

MongoDB stores derived `searchText`, `nameSort`, `countrySort`, `countryKey` and
`regionKey` fields on the same documents. Search uses case folding, NFKD mark
removal, repeated whitespace normalization, and explicit folds for ł, ø, æ, œ, ß.
Each query word must occur literally somewhere in city, country, region or aliases.
Partial matches are supported; typo tolerance, translation and geographic inference
are not. Regex metacharacters are escaped. A 120-character limit and 3-second MongoDB
query limit bound work. Substring search scans candidate documents; with 212 records
this is deliberate. Country and sorting indexes narrow common queries. No external
search, geocoding, AI or provider calls occur.

Optional `region`, `aliases` and `interests` fields allow explicit reviewed curation.
Interest IDs reuse the seven trip `INTEREST_OPTIONS`. Use document `save()` to keep
derived fields synchronized, or run the existing seed command after bulk/raw database
edits. Startup/seed backfills derived fields from persisted metadata, preserving all
curated source fields. Never infer interest tags from city names. Region/interest
controls appear only where metadata has positive counts. Tests enrich isolated
fixtures only. Production currently exposes country filtering, search and three sorts.

## API

`GET /api/destinations` accepts `q` (max 120 characters), `country` (normalized key,
max 120), `region` (country-scoped key such as `spain:catalonia`, max 250),
`interests` (comma-separated known taxonomy IDs, duplicates removed), `sort`, `page`
and `pageSize`. Region requires a country. Unknown interest IDs, unknown parameters,
repeated structured parameters and invalid pagination are rejected with 400.
Unknown country or region keys return no matches. Invalid sort falls back to `name-asc`.
Page is a positive integer up to 1,000,000; pageSize defaults to 24, maximum 48.
Out-of-range pages clamp to the last available page (or 1 for no results).

AND applies between query words and independent filter groups. OR applies within
the comma-separated interest list. Unclassified documents cannot match interests.
Search, filters and sorting execute in MongoDB before skip/limit. Sorts are normalized
name ascending, normalized name descending, or country then name ascending. All use
ascending canonical ID as the final tie-breaker. Default is name ascending.

`GET /api/destinations/filters` returns global catalog total, countries, country-scoped
regions and supported interests with counts. Counts do not depend on the active search.
Repeated interest tags count a destination only once. A separate aggregation and
five-minute public HTTP cache avoid recalculation on each keystroke. The frontend
caches metadata for fifteen minutes. Neither endpoint creates guest sessions or
exposes private, ownership, MongoDB or derived search fields.

## Frontend

React Router parameters are the committed discovery state. Typing updates them after
300 ms using replace navigation; discrete filter/sort/page changes create history
entries. Clearing text is immediate. Filter/sort changes reset the page. Pagination
preserves filters. Back/Forward cancels pending typing and restores controls. Invalid
URL fields fall back independently, preserving other valid values. The frontend
replaces an out-of-range URL page with the server's clamped page.

TanStack Query keys include every normalized query parameter; requests consume an
AbortSignal. Result keys separate old and new responses, avoiding stale overwrites.
Catalog data has a five-minute stale time. Saved continues to use its identity-scoped
queries/mutations and never invalidates catalog queries. Controls have labels, selected
interest buttons use aria-pressed, and loading/result counts use a live status region.
Controls stack below 600px and active chips wrap. No new sidebar or library was added.

Catalog metadata is optional and incomplete rows retain Step 15A fallbacks.
Step 15D excludes malformed persisted identity/name records before counting,
pagination and filter metadata aggregation. Invalid individual filter options
are omitted rather than breaking the entire metadata response.

## Files changed for Step 15B

Created: `apps/api/src/services/destinationDiscovery.ts`,
`apps/api/src/routes/destinationDiscovery.routes.test.ts`,
`apps/api/src/seed/DESTINATION_DISCOVERY.md`,
`apps/api/e2e/exploreDiscovery.spec.ts`,
`apps/web/src/hooks/useExploreState.ts`,
`apps/web/src/pages/ExploreDiscovery.test.tsx`.

Modified: `packages/shared/src/destinationCatalog.ts`,
`apps/api/src/models/Destination.ts`, `apps/api/src/seed/destinations.ts`,
`apps/api/src/routes/destinations.ts`, `apps/api/src/routes/destinations.routes.test.ts`,
`apps/api/e2e/explore.spec.ts`, `apps/api/e2e/saved.spec.ts`,
`apps/web/src/hooks/useExploreDestinations.ts`, `apps/web/src/pages/ExplorePage.tsx`,
`apps/web/src/pages/ExplorePage.test.tsx`, `apps/web/src/styles.css`,
`apps/api/src/seed/DESTINATIONS.md` (correct the source-link protocol audit wording).

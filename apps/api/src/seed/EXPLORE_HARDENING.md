# Explore hardening — Step 15D

## Audit and changes

- The existing 212-record seed and persisted MongoDB catalog remain canonical.
  IDs and curated metadata are preserved. Repeated seeds avoid unchanged derived
  search-field writes. No catalog rows are deleted.
- Invalid identity/name rows previously consumed page slots and inflated totals.
  Visibility validation now runs before count, sort, pagination and metadata.
  Optional malformed filter metadata is omitted safely.
- Saved previously resolved the JSON seed, diverging from persisted catalog edits.
  It now resolves MongoDB in one batch. Deleted references remain stored with a
  null public destination; new saves require a valid persisted destination.
  Ownership, unique constraints, guest migration and generation quotas are unchanged.
- A late page clamp could cancel pending typed search. Pending edits now take
  precedence. Query keys still contain all normalized filters and pagination.
- Catalog requests are abortable with a 15-second timeout. Failed Saved status
  has a shared retry control; mutation errors reconcile identity-scoped Saved
  queries without invalidating destination searches. No optimistic heart is
  committed before a successful Save response.
- Public catalog routes share a 120-request/minute per-IP limit. URL validation
  normalizes URLs before rejecting credentials and unsafe protocols. Public DTOs
  remain allowlisted and listing does not create a guest.
- Shared Explore/Saved destination media keeps a fixed aspect ratio, lazy loading,
  credit links and a fallback for missing, unsafe, broken or slow photos. The
  15-second image deadline starts near the viewport. Provided CC0 credits remain
  visible even where attribution is optional. Reduced motion and focus indicators
  are respected; Save touch targets are at least 44px.
- Requested visual changes: remove the redundant Explore destinations heading/icon,
  bold the result count with 32px bottom spacing, and center pagination with 40px
  top spacing.

## Search, filtering and performance

Search runs in MongoDB before pagination, normalizes accents/case/whitespace and
escapes user regex characters. Words combine with AND; independent filter groups
combine with AND; interests within one group combine with OR. Metadata counts
describe the global visible catalog. Country, region and interest data are never
inferred. Name ascending/descending and country sorts use an ID tie-breaker.
An explicit descending-name index supports that sort. This remains a bounded,
simple search for the current catalog, not an indexed substring search engine.

Regression coverage asserts stable page traversal, seed idempotency, real
MongoDB index execution, safe Unicode/regex input, cancellation, timeout, stale
URL updates and malformed responses. Browser measurements count completed
requests separately from React development StrictMode's cancelled attempts.
No numerical speed-up is claimed. Existing bundle-size warnings remain.

Observed Chromium development-server run: the first 24-destination JSON body was
21,126 bytes. Initial loading completed one catalog, one metadata and one Saved
status request. React StrictMode produced five initial attempts including
cancellations; these are not counted as completed responses. Three rapid search
edits completed one additional catalog request. These are fixture measurements,
not production latency or throughput benchmarks.

## Files touched by this hardening pass

- API: `app.ts`, `models/Destination.ts`, `services/destinationDiscovery.ts`,
  `routes/destinations.ts`, `routes/saved.ts`, `seed/destinations.ts`.
- Shared: `destinationCatalog.ts`, `saved.ts`.
- Web: `api/client.ts`, `api/saved.ts`, `hooks/useExploreDestinations.ts`,
  `hooks/useDestinationPrefill.ts`, `hooks/useExploreState.ts`,
  `hooks/useSavedDestinations.ts`, `pages/ExplorePage.tsx`, `styles.css`,
  `components/DestinationSaveButton.tsx`, `components/ExploreDestinationCard.tsx`,
  `components/saved/SavedPlaceCard.tsx`, `components/trips/PhotoAttribution.tsx`.
- New: `components/DestinationImage.tsx`, its tests, `api/client.timeout.test.ts`,
  API `routes/exploreHardening.routes.test.ts`, E2E `exploreHardening.spec.ts`.
- Coverage/fixtures: ExploreDiscovery frontend tests; Saved, Saved Attractions
  and migration API fixtures; guarded E2E server; original Explore E2E heading
  assertion; existing CI workflow and docs.

## Local validation

- Backend: 53 test files, 809 tests passed, including Saved, migration, guest
  quotas, canonical trip planning and new hardening regression cases.
- Frontend: 36 test files, 287 tests passed. After the visual adjustments,
  the affected Explore/image suites were rerun: 3 files, 43 tests passed.
- Root TypeScript checks and E2E TypeScript checks passed.
- Final combined Chromium run: 14 tests passed in 2.4 minutes across
  `exploreHardening.spec.ts`, `exploreDiscovery.spec.ts`, `explore.spec.ts`,
  `destinationPlanning.spec.ts` and `saved.spec.ts`. This includes real
  browser/Fastify/MongoDB communication, provider fixtures, API recovery,
  identity isolation, quotas and all five viewport widths.
- Production builds for shared, API and web passed. Vite reports the existing
  large main chunk and dependency annotation warnings; neither is suppressed.
- `git diff --check` passed (Git also reports normal LF/CRLF conversion warnings).
- There is no configured lint command. CI itself has not been run remotely.

Explore is feature-complete for the current catalog and ready to precede
Step 16A. Curated region/interest enrichment, independent license verification,
broader browser/accessibility certification and application-wide bundle splitting
remain separate work. No AI Packing Assistant functionality was introduced.

## Data limitations

All seed IDs and city/country pairs are unique and all records contain required
photo metadata. Licenses retain the existing `provisionally_usable` audit status;
this pass is not an independent licensing or gazetteer verification. Missing or
unsupported photo audit metadata results in a safe fallback.

The source has no coordinates, country codes, regions, aliases or interest tags.
Country keys therefore use normalized stored names. Region and interest support
remains hidden until real curated data exists. Existing geocoding safeguards
still resolve trips where coordinates are missing. Krakow accent coverage uses
the actual catalog record; São Paulo is an isolated test fixture, absent from the
production seed. No production destination or classification was fabricated.

Browser checks cover Chromium at five widths, not every browser or a manual
screen-reader/contrast certification. External providers are deterministic test
fixtures. GitHub-hosted execution must still confirm the workflow on Linux.
The existing pending guest-import prompt may be offered again when moving between
Explore's public layout and the protected layout. The identity test explicitly
defers it; this pass does not change the migration architecture.

# Curated collections — Step 15E

## Repository findings and architecture

Explore had four inert editorial cards in `apps/web/src/config/explore.ts`.
The canonical 212-city seed is persisted in MongoDB; destination DTOs, images,
Saved, public detail lookup and Home's trip wizard already exist. No new catalog,
MongoDB collection, Saved system, dependency or generation endpoint was added.

`packages/shared/src/curatedCollections.ts` now owns the four editorial definitions:
slug, title, description, icon key, color, destination IDs, suggested interests,
pace and display order. React icon components remain in the web presentation
configuration. Copy, colors and icon concepts are preserved. These associations
are editorial inspiration, not verified rankings or catalog interest tags.

## Canonical membership and suggestions

| Collection | Published city/country identities | Interests | Pace |
| --- | --- | --- | --- |
| food-first-weekends | city-003 Barcelona, Spain; city-140 Bologna, Italy | food, culture | relaxed |
| architecture-and-icons | city-003 Barcelona, Spain; city-005 Rome, Italy; city-025 Prague, Czech Republic | architecture, culture | balanced |
| slow-coastal-escapes | city-011 Lisbon, Portugal; city-002 Nice, France | nature | relaxed |
| culture-deep-dives | city-005 Rome, Italy; city-025 Prague, Czech Republic; city-017 Vienna, Austria | culture | balanced |

San Sebastián/Donostia and Cascais are absent from the existing catalog and seed
infrastructure. They are omitted, not replaced or fabricated. Tests assert exact
city-country identities against the existing seed, unique IDs and supported
preferences. No production seed data or destination IDs changed.

Local culture, history and museums map to the supported Culture option.
Relaxation has no exact supported interest and is omitted; relaxed pace still
expresses that collection's suggestion. No new wizard options were introduced.
Suggestions never set dates, budget, currency, travelers, transport or duration.

## Public access and UI

`GET /api/destinations/collections/:slug` resolves one trusted definition and runs
one indexed-ID MongoDB query, bounded to 12 records with a 3-second query limit.
It returns `{ slug, items }` with allowlisted existing public destination DTOs in
editorial order. Unknown slugs return 404. Malformed/missing destinations are
omitted; an empty collection returns an empty items array. This route shares the
existing public catalog rate limit. Browsing creates no sessions, trips or quota
entries and calls no providers. No redundant collection listing endpoint exists:
the small shared editorial configuration supplies collection metadata.

Explore cards have an accessible main link and separate destination links, with
no nested interactive elements. A destination chip opens its collection with a
canonical `destinationId` focus reference. The real destination card receives
focus when loaded. The existing responsive grid and visual identity remain.

`/explore/collections/:slug` is public and supports refresh, direct links, browser
history, loading skeletons, retry, not-found and empty states. It reuses the
existing cards, details dialog, Saved controls and hardened image handling with
lazy loading, fixed dimensions, failure fallback and preserved attribution.
The Back to Explore control is an outlined pill button with a left arrow. Its
underlying Router link restores the originating Explore URL when available;
browser back also preserves the existing search/filter/sort URL.

The collection query key is `["destinations", "collection", slug]`, with a
five-minute stale time, cancellation and the existing short-request timeout.
Resolved destinations seed the existing detail query cache. Saved queries retain
their existing identity scope and deduplication. Save/unsave does not invalidate
collections. Identity transitions may intentionally clear caches as before.

## Existing wizard integration and precedence

The existing route is `/home?destinationId=city-003&collection=architecture-and-icons`.
Only identifiers travel in the URL. Both navigation and initialization validate
collection membership against trusted configuration. Unknown, duplicate,
overlong, malformed or mismatched collection references are ignored while valid
destination prefill remains usable. URL-supplied interests, pace and coordinates
are never consumed as preferences.

Manual edits take precedence over suggestions. A destination response cannot
overwrite a manually edited prompt. Interest edits made while a lookup is pending
remain selected. Meaningful in-memory wizard work uses the existing explicit
Use selected destination / Continue existing draft conflict choice, including
different collections targeting the same city. There is no existing persisted
Home wizard restoration subsystem, and none was introduced. Explicit destination
replacement retains the established draft-reset behavior; Continue preserves work.

Suggestions are applied once to unedited interest/pace fields, ahead of defaults.
The user can remove/add interests and change pace, dates, budget and destination
in the existing UI. Changing destination clears collection context, and changing
it in requirements review also removes stale destination/collection URL values.
Review changes remain the authoritative draft values; suggestions are not
reapplied during generation. No collection metadata is attached to saved trips.

The existing analyze request accepts optional explicit `interests` (up to 24
trimmed strings of 1–60 characters, matching the existing requirements form's
custom-interest support). When supplied, these selections and an explicit valid
pace take precedence over parser suggestions. Legacy callers omitting interests
keep the previous parser behavior. Collection suggestions themselves contain only
existing supported taxonomy IDs. User-entered custom interests remain editable.

The end-to-end test exposed an existing bug: requirements updates merged interests
with the old array, restoring removed selections. Updates now replace the array,
retaining normalization, deduplication and limits. Omitted interests preserve
existing values; explicit null/empty clears them, as before.

Navigation and prefill do not invoke AI or create drafts. The existing explicit
Plan my trip action still performs parsing/draft preparation; Generate my trip
starts full itinerary generation through the unchanged pipeline. Backend guest
quota enforcement remains authoritative and unchanged. Anonymous planning uses
the existing Guest/auth entry and preserves both identifiers. Saved guest-to-account
import uses the existing migration and unique destination records.

## Files in this step

Created:

- `packages/shared/src/curatedCollections.ts`
- `apps/api/src/routes/collections.routes.test.ts`
- `apps/web/src/hooks/useCollectionDestinations.ts`
- `apps/web/src/pages/CollectionPage.tsx`
- `apps/web/src/pages/CollectionPage.test.tsx`
- `apps/api/e2e/collections.spec.ts`
- This report.

Modified:

- `packages/shared/src/index.ts`, `packages/shared/src/trip.ts`
- `apps/api/src/routes/destinations.ts`, `apps/api/src/routes/trips.ts`
- `apps/api/src/services/tripDraft.ts`
- `apps/api/src/routes/destinationPlanning.routes.test.ts`
- `apps/web/src/App.tsx`, `apps/web/src/config/explore.ts`, `apps/web/src/config/tripPlanning.ts`
- `apps/web/src/components/DestinationPlanButton.tsx`, `apps/web/src/components/ExploreDestinationCard.tsx`
- `apps/web/src/components/saved/SavedPlaceCard.tsx`
- `apps/web/src/pages/ExplorePage.tsx`, `apps/web/src/pages/HomePage.tsx`, `apps/web/src/pages/HomePage.planning.test.tsx`
- `apps/web/src/styles.css`, guarded test-only `apps/api/e2e/server.ts`, `.github/CI.md`

The working tree also contains earlier Explore steps; those pre-existing changes
were preserved. No commits or pushes were made.

## Limitations and readiness

Missing San Sebastián and Cascais need independently verified catalog enrichment
before inclusion. Existing photo licenses retain the catalog's provisional audit
status; this step makes no new licensing determination. Country labels and city
names use the catalog's existing spellings. Collections are code-maintained
editorial selections, not recommendations calculated from destination attributes.

Responsive/keyboard E2E checks cover Chromium at 320, 375, 768, 1024 and 1440px;
they are not an all-browser or manual screen-reader certification. Existing large
bundle and dependency annotation warnings remain. There is no configured lint
script. The existing CI command discovers `collections.spec.ts` automatically;
no new workflow or production credentials are required. Remote CI is not run here.

## Executed validation

| Check | Final result |
| --- | --- |
| `bun run --cwd apps/api test` | 54 files, 821 tests passed |
| `bun run --cwd apps/web test` | 37 files, 309 tests passed |
| Playwright collections + destinationPlanning + exploreDiscovery + saved + guestMigration | 16 tests passed together in 3.2 minutes |
| `bun run typecheck` | Shared, API and web passed |
| `bun run typecheck:e2e` | Passed |
| `bun run build` | Shared, API and web production builds passed |
| `git diff --check` | Passed; normal LF/CRLF conversion warnings only |

The initial browser run caught the interest-removal persistence defect; the final
combined run above includes the corrected behavior. Backend tests also verify
normalization and duplicate removal when replacing interests. Full regressions
cover existing Saved Attractions, guest quotas, migration and trip creation.
No live external providers or production credentials were used.

Step 15E is complete for the available canonical catalog and ready to precede
Step 16A — Packing Assistant Foundation. The two unavailable editorial cities
remain documented data gaps, not fabricated catalog entries.

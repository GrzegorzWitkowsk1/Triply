# Explore to trip planning (Step 15C)

## Existing flow and entry contract

The existing wizard is Home (`/home`): prompt analysis, requirements dialog, brief
review, explicit **Generate my trip**, confirm, and the existing Trip page generation
orchestration. There is no second wizard or generation endpoint.

`/home?destinationId=city-003` is the shared planning URL. Explore cards, Explore
details, Saved cards and Saved details use `DestinationPlanButton` and
`tripPlanningUrl`. Only a canonical ID is carried; Explore's preceding history entry
retains its query, filters, sorting and page. The optional legacy navigation-state
reference remains readable for old in-app history entries.

The Home route still requires an authenticated or explicitly started guest session.
The existing route guard retains the intended URL during login; Guest Mode now uses
that same return URL, including its destination parameter. Switching between login
and registration preserves the return state. No guest session starts automatically.
Users enter a valid identity before they can configure the protected wizard, so no
new pre-authentication form storage is needed.

## Trusted resolution and initialization

`GET /api/destinations/:destinationId` is public and reads one indexed MongoDB
record. It validates the `city-###` identity, returns the existing allowlisted DTO,
and returns a recoverable 400/404 for invalid, missing, deleted or incomplete records.
It does not geocode, run AI, create trips, write a usage ledger or create sessions.
It ignores arbitrary URL coordinates. Country and city must be present to plan.

The Home prefill query consumes an AbortSignal, caches a single ID for five minutes,
and checks that the response matches the requested ID. Duplicate, empty, malformed
or oversized URL references are rejected locally. Loading feedback stays beside the
prompt; errors allow retry or manual entry. An arriving response cannot overwrite
manual edits. Meaningful in-memory work prompts an explicit choice between using
the newly selected destination and continuing the existing work. Preferences remain
intact. Home has no persisted local creation-form draft to merge.

Authenticated catalog analysis creates a distinct server draft after the explicit
**Plan my trip** action, preserving earlier server drafts in My trips. Guest analysis
continues to use its existing atomic slot reservation. Opening a planning URL creates
no draft. Explicitly choosing a different prefill resets the current in-memory brief;
an already persisted earlier draft is not deleted or overwritten.

## Destination precedence and generation

Editing prompt preferences preserves the selected ID. The selected city/country are
announced as authoritative. **Change destination** clears the canonical reference
and returns to normal prompt entry. The existing requirements dialog also allows
editing city/country; its existing merge logic clears a stale ID, invalidates the old
location and runs the existing country-aware geocoding safeguards.

The analysis route resolves canonical IDs from the same persisted catalog, adds an
explicit destination-precedence instruction to the parser input, and overrides the
parser's destination, country and location with the trusted selection. No source
coordinates exist today, so the existing validated geocoding pipeline resolves them
when the user explicitly analyzes the prompt. The resulting draft stores the
canonical ID, city and country together. No provider, scheduler, weather, routing,
editing or regeneration algorithms changed.

The existing **Plan my trip** action performs prompt parsing and can enrich the
draft. It is not full itinerary generation. Dates, budget, currency, interests, pace
and walking preferences are edited with the existing validated requirements dialog.
The review card's **Generate my trip** remains the explicit generation confirmation.
No parser/provider call occurs merely from navigating or resolving a destination.

## Quotas and limitations

Guest limits remain server-enforced: six concurrent stored trips, two full
generations and two AI day-regeneration previews per rolling 24 hours, and seven
destination-local calendar days. Existing frontend recovery messages are retained;
they do not replace backend checks. Lookup/navigation consumes none of these limits.
The E2E quota fixture exercises the UI guard and a direct request to the real
generation endpoint, which must independently reject exhausted guests with 429.

The catalog still lacks coordinates, country codes and production regions. No
metadata was fabricated. Refreshing Home restores the destination reference, not
unsaved form edits; this follows the existing wizard's local-state behavior.

## Implementation files

Created:

- `apps/web/src/config/tripPlanning.ts`
- `apps/web/src/components/DestinationPlanButton.tsx`
- `apps/web/src/hooks/useDestinationPrefill.ts`
- `apps/web/src/pages/HomePage.planning.test.tsx`
- `apps/web/src/components/LoginPage.planning.test.tsx`
- `apps/api/src/services/catalogDestination.ts`
- `apps/api/src/routes/destinationPlanning.routes.test.ts`
- `apps/api/e2e/destinationPlanning.spec.ts`
- `apps/api/src/seed/DESTINATION_PLANNING.md`

Modified:

- `apps/web/src/components/ExploreDestinationCard.tsx`
- `apps/web/src/components/saved/SavedPlaceCard.tsx`
- `apps/web/src/components/LoginPage.tsx`
- `apps/web/src/pages/HomePage.tsx`
- `apps/web/src/pages/HomePage.preferences.test.tsx`
- `apps/web/src/pages/SavedPage.test.tsx`
- `apps/api/src/routes/destinations.ts`
- `apps/api/src/routes/trips.ts`
- `apps/api/src/services/tripDraft.ts`
- `apps/api/e2e/data.ts`
- `apps/api/e2e/server.ts`
- `apps/api/e2e/saved.spec.ts`

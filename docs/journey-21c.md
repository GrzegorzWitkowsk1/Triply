# Journey #21C

## Architecture

Journey is a presentation mode on the existing Trip Page, selected with `?mode=journey`. An absent mode opens Plan. Day selection uses the existing `day` query parameter, so day/mode navigation supports browser Back/Forward. The initial day is chosen once using the saved destination timezone and calendar date; an unknown timezone falls back to the first day rather than the browser/server timezone.

Plan's timeline, preference drafts, Budget form, and the single existing Leaflet map remain mounted when switching modes. Planning dialogs temporarily disable mode switching. Journey hides planning actions and uses the existing visit controls, mutation hook, account expense preference, optional expense prompt, expense form, and Budget query cache. No database contracts, endpoints, planner behavior, visit semantics, or expense calculations were added.

JourneyOverview uses shared `visitProgress` for whole-trip/day visited, skipped, remaining, and visited percentage. Actual spending comes from Budget summary totals, preserving separate currencies and existing expense day assignments. JourneyDay displays ordered attraction activities only, saved local scheduled time/duration, next planned occurrence, visit controls, linked actual expenses, and external navigation.

Occurrence UUIDs remain authoritative. Legacy route carriers without UUIDs are paired once with corresponding activities using exact provider IDs and route order for display only; visit identity always remains the activity UUID. Duplicate attractions are distinct occurrences. No names or timestamps transfer progress.

The existing map receives logical stop indices, status, and next-stop props. Status changes update existing marker classes/accessible labels rather than rebuilding map layers. List and marker selection share existing state. Invalid coordinates are excluded from markers/bounds and navigation links. Navigation is a normal new-tab Google Maps anchor with encoded validated destination coordinates, without GPS requests, a new routing provider, or Places calls. Map movement is unanimated; list and expense-form scrolling respect reduced motion.

## Files

- Components: `JourneyDay.tsx`, `JourneyOverview.tsx`, `TripModeSwitch.tsx` under `apps/web/src/components/trip/`.
- Integration: `TripPage.tsx`, `TripMap.tsx`, `TripBudgetCard.tsx`, `useTripDaySelection.ts`, `useTripBudget.ts`, `styles.css`.
- Utilities: `apps/web/src/config/journey.ts`.
- Translations: `i18n/namespaces.ts` and EN/PL `itinerary/journey.json`.
- Tests: `JourneyDay.test.tsx`, `journey.test.ts`, and existing Trip Page, map, and day-selection test files.

Earlier uncommitted #21A/#21B files remain intact. #21C introduces no backend production changes.

## Verification

Executed checks:

- Full frontend: 59 files, 543 tests passed.
- Full backend: 58 files, 968 tests passed.
- Focused Journey/map/day/Trip Page suite: 5 files, 61 tests passed before the final full-suite run.
- Workspace typecheck: passed for shared, API, and web.
- Workspace build: passed; shared and API were cached there and also built directly afterward, successfully.
- Translation validation (web test/build): zero errors and warnings; 185 repeated-value audit groups for contextual review.
- `git diff --check`: passed, with an existing LF-to-CRLF notice for `useTrips.ts`.
- No lint script is provided by the repository.

Deterministic coverage includes mode/history/day preservation, unsaved Plan preferences and expense drafts, status mutations/errors/refetch, guest behavior, optional expense prompt and preference, manual expense creation/deletion, actual Budget updates, empty/missing itineraries, keyboard/mobile behavior, bilingual labels, next attraction, marker/list selection and statuses, invalid coordinates, timezone boundaries, and repeated legacy occurrences. Tests use local mocks and no live AI/Places APIs.

## Limitations

- The stored itinerary contracts have no attraction image field, so Journey does not fetch or fabricate images.
- Missing coordinates suppress navigation and map placement while preserving visit controls.
- Cross-tab convergence uses the existing query refetch behavior; this phase adds no realtime channel or offline synchronization.
- Actual expenses retain their existing spending day/date after itinerary moves; linked expenses remain visible on their occurrence.
- Browser/mobile visual QA and Playwright are not claimed as executed. Bundle-size and dependency annotation build warnings are reported separately.
- #21D rules remain deferred: no visited-item editing restrictions or automatic posting of estimated costs.

## Manual QA with an existing saved trip

1. Open a saved ready trip without a mode parameter. Confirm Plan, existing editing/drag controls, and destination-local current day (or first day when outside trip dates). Select another day.
2. Start a Plan preference or Budget draft, switch to Journey and back, and confirm the day and entered values survive. Use browser Back/Forward to restore mode/day. No regeneration should run.
3. In Journey, mark a planned item visited, another skipped, and reset each. Verify day/trip visited counts, separate skipped/remaining counts, next planned cue, and map marker labels/colors. All-skipped must show zero percent visited.
4. Enable the existing expense prompt setting. Newly mark an unprompted item visited; confirm the optional prompt appears only after save. Add an expense with an explicitly entered amount. Check linked expense, selected-day actual spending, and Budget totals. Edit/delete it in Budget and confirm Journey updates. Repeat with prompts disabled; manual expenses must remain available.
5. Select a Journey item and its map marker in both directions. Confirm matching selection, sensible map focus, and no GPS permission prompt. A coordinate-less item must retain visit controls and explain unavailable navigation.
6. Follow Navigate for a valid item. Confirm an external Google Maps tab opens with the correct destination. Return without changing visit status.
7. Switch to Plan and confirm statuses match, edit/move controls still work, and no expense prompt opens merely from switching modes. Refresh; server statuses/expenses and URL day/mode should restore without a new prompt.
8. Open the same trip in a second tab, mutate a status/expense, then refocus/refetch the first tab. Confirm it converges through existing queries.
9. At a mobile viewport, switch days/modes, use visit controls and Next, and inspect compact map/list layout for overflow. Use Tab, Enter, Space, and toggle arrow keys; repeat in Polish and English and with reduced motion enabled.
10. Test an empty day and an existing trip without an itinerary. Confirm useful neutral messages and access back to Plan generation. Test an owned guest trip using its existing guest identity.
11. In Network tools, filter Places requests while switching modes/days, visiting items, and selecting markers on the saved trip. None should be added by Journey. Existing Leaflet tile/network behavior remains unchanged.

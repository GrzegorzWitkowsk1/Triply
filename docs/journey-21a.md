# Journey #21A: persistent visit tracking

## Architecture and repository audit

The existing Mongoose `Trip` stores scheduled activities (`attraction`, `travel`,
`break`) and route stops under `itinerary.days`. Activities had provider `placeId`
values, but no occurrence identity. The existing editor addresses provider IDs,
prohibits duplicate attractions, rebuilds schedules, and saves with an
`itineraryVersion` comparison. There is no independent scheduled-time editing
endpoint; reorder, move and reroute recalculate times. Regeneration stores an
expiring, versioned preview; apply replaces the selected day. Discard closes the
client dialog without applying the stored preview. Retry replaces the preview.

The implementation adds UUID `itineraryItemId` values to attraction activities.
Stops carry the same IDs through existing editing operations. Travel, breaks and
unscheduled candidates do not represent trackable visits. IDs are independent of
provider IDs, display names, times and array positions. Repeated provider IDs
still receive distinct occurrence IDs, including legacy data.

New model documents and generated itinerary output receive IDs before persistence.
Private trip reads, editing and regeneration previews lazily backfill old data
using a compare-and-set on the itinerary revision and the original missing ID.
Concurrent backfills reload the winner. Backfill does not regenerate, reschedule,
advance the schedule revision, or erase a preview. A missing stored revision is
normalized to zero. Existing trips default to an empty visit ledger/revision zero.

`Trip.visits` is a sparse ledger: absence means planned. Each record contains only
an occurrence UUID, visited/skipped status, the matching server timestamp and
`updatedAt`. Zod and Mongoose validate status, UUIDs and timestamps; the array
validator rejects duplicate records. `visitRevision` advances independently of
`itineraryVersion`. Percentages and counts are never persisted.

The visit service verifies a current attraction occurrence belongs to the owned
ready trip, then updates only the ledger and visit revision. The update compares
both revisions, retries conflicts, and returns the canonical full `TripDetail`.
Identical requests return the existing result without changing timestamps or
revisions. Different tabs use last successfully persisted mutation ordering.

`PATCH /api/trips/:id/visits/:itemId` accepts `{ "status": "visited" }`,
`{ "status": "skipped" }` or `{ "status": "planned" }`. It uses existing
`currentTripOwner`, `ownerFilter`, session and origin protection. The guest
allowlist adds only this PATCH path; ownership isolation and user-only assistant
access remain enforced. Invalid bodies/item IDs return 400, unknown or unowned
trips/items return 404, missing identity returns 401, and exhausted concurrent
retries return 409, following the existing `{ error }` format.

The web client uses the existing identity-aware TanStack mutation wrapper and
confirmed-trip cache. Mutations are non-optimistic, immediately locked against
duplicate submission, and display loading/error states. Cache merging compares
the schedule and visit revisions independently, including GET/refetch responses.
An older itinerary response can therefore contribute newer visits without
replacing a newer schedule, and an older visit response cannot replace newer
visits. The existing focus/refetch behavior updates other tabs; no push channel
or offline synchronization was introduced.

The timeline retains its layout, editing actions and dedicated drag activators.
Native accessible MUI buttons and status chips expose planned, visited, skipped
and reset controls. English and Polish resources use `itinerary/visits`.
`visitProgress` in the shared package calculates daily or whole-trip totals,
visited, skipped, planned/remaining and visited percentage. It counts attraction
activities only, ignores historical records, and returns zero for an empty day.

## Editing, regeneration and history policy

- Reorder, cross-day move and schedule recalculation carry the selected stop's
  occurrence ID into the rebuilt activity. Unrelated days retain their IDs.
- Add and replace create new IDs and start planned. Removing and later adding the
  same provider attraction creates a new logical visit.
- Removed visited/skipped records remain in the minimal ledger as retired visit
  history. Current counts join the ledger against current attraction occurrences,
  so historical records cannot inflate progress. The mutation API rejects retired
  IDs. This is deliberate history retention, not a reference used to edit a
  nonexistent activity. There is no history screen or history-reset endpoint in
  this phase, and history does not copy attraction metadata.
- Preview, discard, failure and retry never write the ledger. A preview retains
  an existing ID only for an exact provider ID occurring once in both the original
  day and proposed day. Missing/ambiguous provider IDs get new planned identities;
  names and coordinates never transfer completed status.
- Commit preserves the stored preview IDs and only changes the selected schedule.
  Pre-feature previews receive IDs on apply. Visits changed after preview creation
  remain intact because commit never writes the ledger.
- Full requirements regeneration creates fresh itinerary occurrences; prior
  completed records remain history. The planner algorithm is unchanged.

## Files

- Shared: `packages/shared/src/{visits,index,scheduling,trip}.ts`.
- API model/authorization/routes: `apps/api/src/models/Trip.ts`,
  `apps/api/src/middleware/tripIdentity.ts`, `apps/api/src/routes/trips.ts`.
- API services: `apps/api/src/services/{itineraryIdentity,tripVisits,tripDraft,
  tripGeneration,tripItineraryEditor,tripRegeneration}.ts`.
- API tests: `apps/api/src/services/itineraryIdentity.test.ts`,
  `apps/api/src/routes/{trips.editing,trips.regeneration,guestTrips}.routes.test.ts`.
- Web: `apps/web/src/api/trips.ts`, `apps/web/src/hooks/{useTripVisits,useTrips}.ts`,
  `apps/web/src/query/confirmedTrip.ts`, `apps/web/src/config/itineraryAdapters.ts`,
  `apps/web/src/components/trip/{VisitControls,TripTimeline}.tsx`,
  `apps/web/src/pages/TripPage.tsx`.
- Web tests: `apps/web/src/components/trip/{VisitControls,TripTimeline.editing}.test.tsx`,
  `apps/web/src/pages/TripPage.editing.test.tsx`,
  `apps/web/src/query/confirmedTrip.test.ts`, `apps/web/src/config/visits.test.ts`.
- Translations: `apps/web/src/i18n/namespaces.ts` and
  `apps/web/src/i18n/locales/{en,pl}/itinerary/visits.json`.
- This report: `docs/journey-21a.md`.

## Manual browser QA

Use a saved ready trip with at least two scheduled places and two days. The basic
status/editing scenarios require no Places Service or new trip generation. In
DevTools Network, inspect the private trip GET/PATCH responses to record the
selected attraction's `itineraryItemId`, `startTime`, `visits` and `visitRevision`.

1. Click **Mark visited**. Expect a visited chip, daily visited count +1, and a
   PATCH response containing that occurrence ID and a server `visitedAt`. Refresh;
   the status and timestamp must remain. Click it rapidly; only one mutation may
   be pending.
2. Click **Skip** on another place. Expect a skipped chip and separate skipped
   count. Skipping every place must display 0% visited, with zero remaining.
3. Click **Undo** for visited and skipped places. Both become planned; their
   current ledger records disappear. Refresh and check again.
4. Mark a place visited, open its edit menu, and move it to another day. Its ID,
   status and timestamp must follow it; both days' counts must update.
5. On a day with multiple places, mark a later place visited and use **Move
   earlier** or drag its handle. Check its recalculated scheduled time, unchanged
   ID/status/timestamp, and correct map/selection. Existing UI has no separate
   direct time-input control; this exercises its supported time-change path.
6. Remove a visited place. Current progress excludes it, but the GET `visits`
   ledger retains its minimal historical record. Add it again from saved
   attractions: expect a new ID and planned status. Repeat with a skipped place.
7. For a day with visited places, generate a relaxed preview using saved options.
   Inspect the persisted trip before apply; visits must remain unchanged. Discard,
   reopen and retry. Apply: genuinely retained provider visits keep their original
   IDs/statuses; additions are planned. If the provider cannot supply an
   alternative, expect an error and unchanged persisted progress. This scenario
   can use saved candidates; regeneration's existing optional provider discovery
   may still be attempted when its pool is small.
8. Open the trip in a second tab. Change a status in tab one, then focus or refresh
   tab two. Both show the persisted result. Change two different items in the two
   tabs; neither record may disappear after refresh.
9. Copy a visit PATCH from DevTools as fetch. In another account/guest session,
   request the original trip/item: expect 404 and unchanged original progress.
   Without a session expect 401. Using an item UUID from a different owned trip
   must also return 404. Never use another person's production credentials.
10. At a mobile viewport, select a place, change its status, use the editing menu,
    and drag only its handle. Status controls must share one row, stay vertically
    centered and tappable, and never start a drag. With keyboard only, Tab to a visit button and activate with
    Enter/Space; use the separate keyboard drag handle to reorder. Switch between
    English and Polish and check controls, loading/error and progress text.
11. In DevTools, block the visit PATCH URL and try a mutation. Expect an error,
    unchanged confirmed status, and an enabled retry after failure. Restore the
    request, retry, then verify persistence by refresh.

Manual browser QA is a handoff checklist; it was not executed in this workspace.

## Limitations

- Historical records have no attraction snapshot or dedicated UI and remain until
  their trip is deleted. Ledger growth is proportional to completed/retired visits.
- The existing editor's ban on repeated provider attractions is unchanged. Tracking
  assigns distinct identities even to repeated legacy occurrences, but it does not
  expand which itineraries the existing editor can safely edit.
- Regeneration conservatively treats legacy visits without an unambiguous provider
  ID as new occurrences. Their completed history is retained separately in the
  ledger, never guessed from names.
- Cross-tab updates rely on existing query focus/refetch behavior. Continuous
  simultaneous contention can return a retryable 409 after eight attempts.
- No expense integration, mode toggle, GPS, new AI/provider calls, or Journey
  screens were added.

## Executed verification

Final runs on this implementation:

| Check | Result |
| --- | --- |
| `bun run --cwd apps/api test` | 58 files, 958 tests passed |
| `bun run --cwd apps/web test` | 54 files, 505 tests passed |
| `bun run typecheck` | All workspace typechecks passed |
| `bun run --cwd packages/shared build` | Passed; also part of the root build graph |
| `bun run --cwd apps/api build` | Passed; also executed in the final root build |
| `bun run --cwd apps/web build` | Passed; also executed in the final root build |
| `bun run build` | All three workspace build tasks succeeded |
| Translation validation, invoked by web test/build scripts | 0 errors, 0 warnings |
| `git -c safe.directory=C:/Users/grzes/Desktop/Files/Triply diff --check` | Passed |

The repository provides no lint script. Tests use the existing Vitest, React
Testing Library, Fastify/Supertest and in-memory MongoDB conventions; Journey
regressions use saved fixtures and mock providers, with no live AI/provider calls.

One intermediate full backend run failed the unchanged guest-session login
rotation assertion in `guest.routes.test.ts`; subsequent full runs passed,
including the final 958-test run. No unrelated authentication code was changed.
Initial sandboxed Vitest/Vite attempts could not load configuration because of
filesystem access; verification succeeded after approved elevated reruns. Vite
reported Zod annotation and large-chunk warnings. Turbo typecheck reported a
sandbox Git dirty-hash warning, while all checks completed successfully. Git
reported LF-to-CRLF normalization for `useTrips.ts`, without whitespace errors.

No commit or push was performed.

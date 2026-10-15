Current migration implementation: [Step 13C](GUEST_MODE_13C.md). This report records the preceding step.

# Guest trips — Step 13B

Implementation checklist:
- [x] Audit identity, ownership, routes, wizard, generation claims, regeneration previews, exports, sharing, rate limits and tests.
- [x] Add explicit guest ownership and method-specific route authorization.
- [x] Enforce atomic storage slots, rolling generation quotas and local calendar-day bounds.
- [x] Reuse the trip wizard, planner, editor, exports and sharing UI.
- [x] Add usage feedback, deletion, cache invalidation and expired-session handling.
- [x] Add concurrency, isolation, failure/retry, frontend and browser coverage.
- [x] Run backend/frontend tests, TypeScript checks, builds and full browser regression suite.
- [x] Finish validation after final authorization review.

## Executed validation

- `bun run --cwd apps/api test`: **45 files, 684 tests passed** on the final run, including configured-limit reduction and concurrency coverage. Existing Geoapify quota tests and authenticated regressions are included.
- `bun run --cwd apps/web test`: **23 files, 142 tests passed**.
- `bun run test:e2e`: **12 tests passed**. A subsequent `bun run test:e2e -- guest.spec.ts` after method-specific authorization also passed **2/2**. The later storage-limit reduction refinement was checked by the final backend suite.
- `bun run --cwd apps/api typecheck`, `bun run --cwd apps/web typecheck`, `bun run typecheck:e2e`: passed. API typechecking was repeated after final backend refinements.
- `bun run build`: all three packages passed. `bun run --cwd apps/api build` passed again after final backend refinements.
- `git diff --check`: passed.

The initial guest browser run exposed an invalid `confirmedFields: ["notes"]` fixture (notes is not an askable field); the fixture now uses the actual contract and subsequent browser runs passed. Initial development test failures were corrected before the passing runs above. All external providers in tests are deterministic fixtures/mocks; Fastify endpoints are real in Playwright. Existing public-asset import, dependency annotation, chunk-size and EventEmitter listener warnings remain. Windows sandbox restrictions required escalation for frontend/browser/build processes.

## Ownership and authorization

Legacy user trips retain `user: ObjectId`. Guest trips have `guestId: string` and a numeric `guestSlot`, with no user reference. Model validation requires exactly one owner. Guest ownership/slot fields are immutable in ordinary model writes. A `(guestId, status)` index supports listing. The unique partial `(guestId, guestSlot)` index enforces storage reservations; indexes are explicitly prepared at startup even when automatic index creation is disabled.

`requireAuth` remains user-only. `requireTripIdentity` explicitly permits supported HTTP methods and trip paths for a verified guest session. Account/profile endpoints, the assistant and unknown endpoints remain user-only. `currentTripOwner`, `ownerFilter` and `storedOwner` centralize ownership. Internal service identities use `guest:<id>` tags; registered user IDs remain backward compatible. User filters require an absent/null guest ID; guest filters require an absent/null user reference. Ambiguous documents are inaccessible to either owner type. Request bodies never control ownership.

Route audit:

| Category | Routes | Guest policy |
| --- | --- | --- |
| Read | Trip list/detail, equipment, expenses/budget, usage | Verified current owner only; usage is current guest only |
| Mutation without AI | Requirements, confirmation, manual edits/rerouting, equipment, expenses/budget, preview apply | Verified current owner; existing revision/scheduling guards retained |
| Provider-backed generation | Full itinerary generation | Guest rolling generation allowance plus existing generation claim |
| AI-expensive preview | Day regeneration with free-text instructions | Separate rolling AI day allowance; apply is uncharged |
| Other provider-backed work | Draft analysis, geocoding, weather, candidate discovery, routing and preference-only preview | Existing provider protections plus guest/network request throttles |
| Owner-only management | Delete trip, sharing status/create/rotate/revoke, PDF/ICS export | Same explicit ownership checks |
| Public read-only | Shared trip, public PDF/ICS | Separate share token; no guest identity is created |
| Account-only | Profile and assistant conversations/actions | Guests denied |

## Limits and concurrency

Validated backend environment variables, documented in `.env.example`:

| Variable | Default |
| --- | ---: |
| GUEST_MAX_TRIPS | 6 |
| GUEST_AI_GENERATIONS_PER_24H | 2 |
| GUEST_DAY_REGENERATIONS_PER_24H | 2 |
| GUEST_MAX_TRIP_DAYS | 7 |

Before draft parsing or external calls, creation inserts a valid editable draft into one of the configured slots. The database unique index chooses the winner during concurrent inserts. A seventh draft cannot be inserted and no provider runs for that rejected request. Known creation failures delete the reserved draft. A process crash can leave an editable draft occupying a slot, which its owner can delete; there is no independently maintained counter to drift or refund twice. The existing authenticated upsert behavior is preserved; guest creation creates distinct drafts. Draft creation previously had no idempotency contract; callers must not assume that repeating analysis creates the same trip.

Deletion uses an owner-filtered atomic document deletion. The slot is released by removing that document. Repeated deletion returns 404. AI accounting is stored separately and is never deleted/refunded with a trip. When an operator lowers the storage limit, creation derives a slot prefix whose capacity plus all retained slots outside it fits the new limit. Concurrent creators compete for the same uniquely indexed slots; deletions can only expand the available prefix. API instances must use the same configured limits during deployment.

The `guest_usage` collection keeps a single document per guest identity. An atomic conditional update counts only entries within the last 24 hours and inserts a reservation if capacity remains. Separate operation kinds enforce independent generation/day budgets. There is no UTC-midnight reset. Resets reflect the next allowance, including configurations lowered below prior usage. Usage rows have seven-day TTL retention, safely longer than the rolling window.

Reservations wrap the existing generation operation, not a second generation job system. Full generation still uses `claimTripForGeneration` and its existing startedAt fence. Known local validation/claim failures refund reservations before provider work. The reservation is durably marked started before entering provider-backed work; subsequent failures, uncertain timeouts, disconnects and process crashes remain counted until rolling expiry. A successful generation consumes one allowance. Session expiry during execution does not refund work, and passive session touches cannot renew an already expired record.

`Idempotency-Key` supports up to 128 characters on chargeable operations. The server hashes it, binds it to URL/body, rejects concurrent or changed-input reuse with 409, and replays completed JSON responses within the rolling window. Failed/uncertain keys cannot rerun provider work; a deliberate new attempt needs a new key and another allowance. Ready-trip generation remains idempotent without a new charge. Existing frontend single-flight generation handling is retained; chargeable requests send UUID keys.

## Actual provider boundaries

The audited application uses the LLM for trip analysis and free-text day-instruction interpretation. Full itinerary construction uses the existing deterministic planner, weather/places and routing providers; its generation endpoint receives the requested two-per-window product limit. Trip parsing remains available for drafts independently of saved-trip and full-generation counts, and is bounded by existing planning throttles plus the network limiter.

Preference-only day previews invoke no AI and do not consume the AI day-regeneration quota. Free-text previews reserve that separate quota before interpretation, including a failed interpretation that falls back to selected preferences. Applying a stored preview is uncharged. Existing preview expiry and itineraryVersion conflict checks remain intact. Manual editing/rerouting does not consume either AI quota.

Guest duration is checked before enrichment during creation/requirements updates and before generation/regeneration. YYYY-MM-DD destination-local date labels are advanced with calendar arithmetic; inclusive end dates beyond the configured maximum are rejected independently of supplied durationDays. UI displays the server-provided maximum.

## Frontend and API

The existing TanStack Query session is reused. A disabled observer reads that same cache to enable `GET /api/guest/usage` only for guests. Safe usage DTOs include trip count/limit, independent remaining allowances/limits, maximum days and reset timestamps. Mutations invalidate usage after creation/deletion, generation and preview operations. Identity transitions cancel requests and clear resource caches.

Home, My Trips, trip detail and equipment use the existing components for guests. Trip detail exposes the editor, regeneration and PDF/calendar/sharing controls; the account-only assistant is hidden. The quota banner is compact and responsive. New-trip controls are guarded at the storage limit. Generation is guarded at zero allowance while existing itineraries remain editable. The day dialog distinguishes AI instructions from uncharged preferences. Deletion has an accessible confirmation dialog. Expired sessions return to login with an explanation and cannot silently inherit old trips. Explore/Saved/account features remain unavailable to guests. Account creation explicitly does not promise transfer yet.

Known quota errors carry codes, actionable messages, counts where appropriate, and reset/Retry-After data for rolling exhaustion. The existing API client preserves those messages and exposes the machine-readable code.

## Cost protection and limitations

Guest creation still uses the existing IP/IPv6-grouped auth limiter. Existing planning throttles now key guests by verified identity. A supplementary 120-request/15-minute IP/IPv6-prefix limiter spans guest identities and covers provider-backed reads as well as mutations. Registered users do not receive these guest limits. Existing Geoapify/global provider quota accounting is unchanged and covered by regression tests.

Network throttles are process-local, following existing infrastructure. Rotating networks or using multiple API instances can weaken that extra layer; per-identity storage and generation quotas are enforced in MongoDB across instances. Anonymous identities are not proof of a unique person. Infrastructure write failures fail closed. Uncertain failures can consume an allowance without a usable result. Large configurable limits must be chosen with MongoDB document-size/resource constraints in mind.

Expired guest trip cleanup and account migration are deferred. Guest trips can remain stored after cookie loss/expiry and cannot be recovered through a newly created identity. Step 13C must implement an explicit audited transfer that removes guest ownership/slot fields and updates the user owner safely; ordinary writes intentionally cannot change guest ownership. No migration, Saved or Explore implementation is included.

## Files

Created for 13B:
- `packages/shared/src/guest.ts`
- `apps/api/src/middleware/tripIdentity.ts`
- `apps/api/src/middleware/guestNetworkLimit.ts`
- `apps/api/src/services/guestLimits.ts`
- `apps/api/src/routes/guestUsage.ts`
- `apps/api/src/routes/guestTrips.routes.test.ts`
- `apps/web/src/hooks/useGuestUsage.ts`
- `apps/web/src/components/GuestUsage.tsx`
- `apps/web/src/components/GuestUsage.test.tsx`
- `GUEST_MODE_13B.md`

Modified for 13B:
- `.env.example`; `packages/shared/src/index.ts`
- API: `app.ts`, `config/env.ts`, `config/env.test.ts`, `config/mongoSession.ts`, `middleware/error.ts`, `middleware/rateLimit.ts`, `models/Trip.ts`
- API routes: `trips.ts`, `expenses.ts`, `pdf.ts`, `calendar.ts`, `sharing.ts`
- API services: `tripDraft.ts`, `tripGeneration.ts`, `tripDestination.ts`, `tripWeather.ts`, `tripItineraryEditor.ts`, `equipment.ts`, `expenses.ts`
- API tests: `guest.routes.test.ts`, `trips.routes.test.ts`, `trips.editing.routes.test.ts`, `trips.weather.routes.test.ts`; E2E: `guest.spec.ts`
- Web: `App.tsx`, `api/client.ts`, `api/trips.ts`, `auth/AuthProvider.tsx`, `auth/GuestSession.test.tsx`
- Web components: `LoginPage.tsx`, `layout/AppLayout.tsx`, `home/TripRequirementsDialog.tsx`, `trip/RegenerateDayDialog.tsx`
- Web hooks: `useTrips.ts`, `useTripAnalysis.ts`, `useTripGeneration.ts`, `useTripRegeneration.ts`
- Web pages: `HomePage.tsx`, `HomePage.preferences.test.tsx`, `MyTripsPage.tsx`, `TripPage.tsx`, `GuestPage.tsx`; `styles.css`
- `GUEST_MODE.md` links the historical 13A report to this implementation.

The working tree also contains the prior uncommitted Step 13A work. No commits or pushes were performed.

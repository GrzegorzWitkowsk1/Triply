# Guest Mode hardening - Step 13D

TODO / completed work:
- [x] Audit authentication, cookies, ownership, endpoint authorization and provider boundaries.
- [x] Verify configurable limits, atomic reservations and deterministic failure accounting.
- [x] Review migration fencing, transaction rollback, replay and sharing/export preservation.
- [x] Fix expired-session restoration, private HTTP caching and identity-transition cache races.
- [x] Extend backend, frontend and real browser regression coverage.
- [x] Extend existing CI visibility and retain traces without blanket retries.
- [x] Record final stable-source validation results below.

## Audit findings and fixes

1. An expired guest cookie restored as plain anonymous on a fresh page load. The opt-in identity session response now adds `reason: GUEST_SESSION_EXPIRED` when an obsolete guest cookie is presented. The frontend explains lost access and never creates a replacement session automatically. The legacy session response contract remains unchanged. This signal is informational, not authorization.
2. Cancelling queries did not cancel outstanding mutations. Late generation, editing, regeneration, budget or equipment responses could repopulate cleared private caches; optimistic errors could restore old snapshots. A shared identity-bound mutation hook suppresses cache callbacks after the identity changes. It preserves existing callback context for operations belonging to the current identity.
3. Private route state could survive an account switch. Session transitions now hold protected routes in their loading state until private caches are cleared. Identity-keyed route boundaries remount local forms. Tests verify account B never renders account A's cached trip list or draft notes.
4. Private trip responses lacked explicit HTTP cache controls. The protected trip API scope now sends `Cache-Control: no-store`, including ownership errors, independently of frontend cache cleanup.
5. An empty-source migration status could lose a race to confirmation/discard and return a pending response with an empty expiry. It now rereads the authoritative state when that compare-and-set loses.
6. CI retried all browser failures once and local failures lacked traces. Automatic retries are now disabled; failed browser tests retain traces and screenshots. CI keeps its existing single smoke job and includes every guest spec.

No backend ownership bypass was found in the reviewed allowlist and owner-filter paths. The fixes concern identity isolation, lifecycle feedback, caching and race handling. Registered-user quotas and itinerary algorithms were not changed.

## Authorization audit

| Endpoint category | Authorization and cost boundary |
| --- | --- |
| Trip listing/detail | Verified session identity and centralized owner filter; legacy user trips require user ownership and no guest owner. |
| Creation/requirements | Verified owner assigned server-side; atomic draft slots and destination-local duration validation. |
| Full generation | Ownership and requirements checked before reservation; existing generation claim plus atomic guest quota before external work. |
| Day preview/apply | Owner checked; AI free-text preview charged once; deterministic preference preview and apply remain uncharged; version checks preserved. |
| Manual edits/recalculation | Existing editor and optimistic concurrency; owner filter and no guest-specific scheduling. |
| Equipment/expenses/budget/weather/location | Explicit guest route/method allowlist, owner checks where trip-scoped, network/provider limits retained. |
| Sharing management/private exports | Owner authorization; share credentials independent of guest sessions. |
| Public view/PDF/calendar | Separate read-only share-token lookup and DTO allowlist; public exports revalidate revocation after rendering. |
| Profile/assistant/account endpoints | Registered-user authorization remains required. Guest credentials cannot act as users. |
| Migration | Registered destination plus server-only context and authenticated-session hash; no request body guest/user ID grants authority. |

Cookies remain HttpOnly, SameSite=Lax, Path=/ and Secure in production with persistent expiry. Guest secrets are hashed in MongoDB. Login/register rotate sessions. Mutation Origin validation uses the configured concrete web origin, with no wildcard credentialed CORS. Raw cookies, session secrets and provider credentials are not emitted in application error logs. No bearer credentials are stored in localStorage or URLs.

## Limits and concurrency verification

Validated environment defaults remain:

| Setting | Default |
| --- | --- |
| GUEST_MAX_TRIPS | 6 |
| GUEST_AI_GENERATIONS_PER_24H | 2 |
| GUEST_DAY_REGENERATIONS_PER_24H | 2 |
| GUEST_MAX_TRIP_DAYS | 7 |

The unique guest-slot index bounds persisted drafts atomically. At five trips, concurrent creates produce one success and one rejection. Failed draft creation releases its slot; deletion frees exactly one slot and never changes AI accounting. Configured-limit reduction is covered.

The guest ledger atomically reserves rolling-window allowance. Full generation and AI day interpretation use separate counters. Known pre-provider failures release reservations; uncertain provider execution remains charged. Idempotent keys bind to input and completed results; concurrent duplicates do not invoke providers twice. Reservations expire from usage at the rolling 24-hour boundary, so abandoned reservations cannot block quota indefinitely. Remaining counts are clamped at zero and reset times account for configured-limit reductions.

Duration uses inclusive local calendar labels, not UTC millisecond division. Seven/eight-day cases and DST are covered. Authenticated users keep existing policies. Network throttling spans guest identities, including IPv6 network normalization, alongside guest creation throttling and existing global Geoapify credit protection.

## Migration verification

Backend and browser coverage verifies registration and existing-account login, zero/one/six trips, preserved existing account data, unchanged trip IDs, manual data, itineraryVersion, diagnostics, sharing and exports. Transactions transfer ownership only; no providers run. Concurrent confirmation, completed receipt replay, wrong account/session, arbitrary IDs, expired/discarded context, two-tab login and active guest work are covered.

An injected failure after real transactional writes rolls back the entire import. Retry imports each document once. Old guest credentials lose private permissions immediately after authentication; public links remain independent. Guest quota records remain unchanged.

## Browser coverage

The complete suite contains 17 independent scenarios. Guest scenarios cover onboarding/reload/mobile exit, restored persistent cookies in a new browser context, expired-session reload, wizard/generation/manual editing with other-day preservation, PDF, full-generation exhaustion without provider calls, six-trip storage/deletion, cross-guest isolation, sharing with anonymous PDF/calendar exports and revocation, and both migration paths including interruption/retry.

The browser talks to real Fastify and an isolated single-node Mongo replica set. External AI/geocoding/weather/POI/routing responses are deterministic. Internal API routes are not mocked. A token-protected loopback harness changes test database expiry or injects transaction failures; those controls do not exist in production routes. There are no arbitrary sleep-based waits or shared quota identities between tests.

The restored-cookie test approximates reopening a browser through a fresh isolated context with serialized persistent storage; it does not physically restart the Chromium process. Day-regeneration concurrency and preview/apply accounting are exercised deterministically in backend tests; the browser suite exercises the common itinerary UI.

## Step 13D files

Created:
- `apps/web/src/hooks/useIdentityMutation.ts`
- `apps/web/src/hooks/useIdentityMutation.test.tsx`
- `apps/web/src/auth/IdentityIsolation.test.tsx`
- `GUEST_MODE_13D.md`

Modified:
- `packages/shared/src/session.ts`
- `apps/api/src/app.ts`, `apps/api/src/routes/auth.ts`
- `apps/api/src/services/guestMigration.ts`
- `apps/api/src/routes/guest.routes.test.ts`, `guestTrips.routes.test.ts`, `guestMigration.routes.test.ts`
- `apps/web/src/auth/AuthProvider.tsx`, `RouteGuards.tsx`, `GuestSession.test.tsx`
- `apps/web/src/components/GuestMigration.tsx`
- `apps/web/src/hooks/useTripAnalysis.ts`, `useTripGeneration.ts`, `useTripRegeneration.ts`, `useItineraryEditing.ts`, `useTripWeather.ts`, `useTripEquipment.ts`, `useTripBudget.ts`, `useTripAssistant.ts`, `useTrips.ts`
- `apps/api/e2e/server.ts`, `guest.spec.ts`, `README.md`
- `playwright.config.ts`, `.github/workflows/ci.yml`

The working tree also contains preceding uncommitted Steps 13A-13C. Nothing was committed or pushed.

## Validation

Executed commands:

| Check | Result |
| --- | --- |
| `bun run --cwd apps/api test` | 47 files, 703 tests passed. |
| `bun run --cwd apps/web test` | 26 files, 160 tests passed. |
| `bun run test:e2e` | All 17 tests passed in 2.3 minutes, with no retries, including Guest Mode and existing authenticated smoke coverage. |
| `bun run --cwd packages/shared build` | Passed (also executed by the browser script). |
| `bun run --cwd apps/api typecheck` | Passed. |
| `bun run --cwd apps/web typecheck` | Passed after the final route/test changes. |
| `bun run typecheck:e2e` | Passed. |
| `bun run build` | All three production tasks passed; shared was cached on the final build. |
| `git diff --check` | Passed, with Git line-ending notices. |
| `docker compose config --quiet` | Exit 0; configuration parsed. Docker service not launched. |

No lint script is provided in the root or workspace manifests. Backend tests emit existing EventEmitter listener warnings; builds emit dependency annotation and bundle-size warnings. These warnings do not fail the checks.

Earlier failed runs were not skipped: an assertion was updated for the new anonymous reason field; two new browser tests were corrected to await completed guest entry before API calls; another browser run overlapped live Vite source edits and reset an open wizard. The final browser run uses unchanged application source and no retries.

## Operational limits and readiness

- Imports require transaction-capable MongoDB. Standalone Mongo fails closed with unchanged data and a safe retry error. Local Compose configures a single-node replica set; `docker compose config --quiet` passed, with a sandbox warning reading Docker's user configuration. The Docker service itself was not started. Real replica-set and standalone integration tests run locally.
- A hard process crash can leave a guest activity lease. Import fails closed rather than guessing that uncertain work cannot resume. Contexts expire after 15 minutes; fences/receipts have a 30-day TTL. Automatic crash-lease reconciliation remains an operational limitation.
- Expired/discarded guest trips are retained; no destructive orphan-trip cleanup policy was introduced. There is no indefinite import recovery promise. Losing or signing out of the bound authentication session closes that handoff.
- Fresh identities and distributed IPs can still multiply allowances. Existing per-network throttles and global provider quotas reduce abuse; process-local network counters are not a distributed anti-abuse service.
- Existing build dependency-annotation/bundle warnings and the offline city-asset Vite warning remain outside Guest Mode scope.

The intended Guest Mode journey is implemented and regression-covered. Deployment still needs the transaction-capable database configuration and acceptance of the documented conservative crash recovery/retention behavior; this report does not claim automatic operational recovery or production Docker validation.

# Guest-to-account migration - Step 13C

Implementation checklist:
- [x] Audit existing guest sessions, ownership, authentication, quotas and caches.
- [x] Add a verified, session-bound authentication handoff.
- [x] Implement explicit import, defer, discard and expiry.
- [x] Transfer ownership transactionally with idempotent completion receipts.
- [x] Fence retired guest credentials and drain admitted guest mutations.
- [x] Preserve itinerary data, sharing, exports and quota records.
- [x] Add backend, frontend and real browser integration coverage.
- [x] Execute tests, type checks, production builds and whitespace validation.

## Authentication and authorization

After valid login or registration credentials, the server captures the verified guest identity and rotates to a fresh authenticated session. A random 256-bit context ID exists only in server-side session data. The handoff binds that context to both the destination user and a SHA-256 hash of the new authenticated session secret. No frontend guest ID, destination ID, public share token or URL credential can authorize import.

The handoff lasts 15 minutes. A compare-and-set changes the source from active to pending, immediately fencing old guest credentials. The previous session is deleted; a durable fence protects access even if deletion fails. Responses from already-running guest requests cannot overwrite the new authenticated cookie. Already-admitted operations retain activity leases; confirmation waits for them to finish before transferring all guest trips. Concurrent login attempts cannot claim the same source twice.

Existing cookie flags, Origin validation, credentialed CORS and authenticated-only authorization remain in force. Migration endpoints require a registered user, are rate limited, return no-store responses and reject unexpected mutation fields.

## API and ownership transfer

- `GET /api/auth/guest-migration/status`: none, pending with count/expiry/busy, completed, discarded or expired.
- `POST /api/auth/guest-migration/confirm`: imported count and already-imported receipt.
- `POST /api/auth/guest-migration/discard`: invalidate pending authorization without deleting trips.

Confirmation uses a MongoDB transaction with snapshot reads and majority writes. The transaction updates the handoff and all eligible trip ownership together. It sets `user` and removes `guestId`/`guestSlot`; it does not copy documents or change timestamps, IDs, itineraryVersion, itinerary content, diagnostics, sharing configuration or export data. Existing account trips are untouched. No provider or scheduling code runs.

Concurrent confirmations serialize through the handoff document. Driver transaction retries handle conflicts; a committed receipt returns a consistent result to retries from the same authorized session. Another user or another session for the same user cannot replay it. Failed transactions roll back both ownership and completion state.

Transactions require a replica set or sharded deployment. Local Compose now configures its existing Mongo service as a single-node replica set and initializes it through its healthcheck without replacing the data volume. Standalone MongoDB fails closed with a retryable 503 and unchanged ownership; it does not fall back to partial updates. The Compose service was not launched during validation.

## Lifecycle and quotas

Successful authentication retires guest access before confirmation. Zero-trip sources skip the prompt once outstanding guest work finishes. Not now keeps a resumable panel in the same authenticated session within the 15-minute window. Discard and expiry retain trip documents but invalidate transfer authorization. Later login or account switching cannot silently reuse it.

Handoff fences and completion receipts have a 30-day TTL. Existing guest quota records retain their separate lifecycle; migration neither refunds consumed quota nor copies counters to user quotas. Authenticated sessions remain valid after import. Guest cookies cannot edit transferred trips.

## Frontend

The existing application shell shows an accessible confirmation dialog after login or registration. It supports checking, count, busy state, importing, retry, completed receipt, expiry, defer/resume and explicit discard. Buttons prevent repeated confirmation during import. Mobile layout and keyboard confirmation are covered in the browser suite.

TanStack Query owns migration status, keyed by authenticated user. Successful import refreshes session, trips, details, sharing, candidate and guest usage caches and removes inactive guest data. Existing identity changes clear private caches. The login/register response contract and existing forms are preserved.

## Files for Step 13C

Created:
- `packages/shared/src/guestMigration.ts`
- `apps/api/src/models/GuestHandoff.ts`
- `apps/api/src/middleware/guestActivity.ts`
- `apps/api/src/services/guestMigration.ts`
- `apps/api/src/routes/guestMigration.ts`
- `apps/api/src/routes/guestMigration.routes.test.ts`
- `apps/api/src/routes/guestMigration.standalone.test.ts`
- `apps/web/src/api/guestMigration.ts`
- `apps/web/src/components/GuestMigration.tsx`
- `apps/web/src/components/GuestMigration.test.tsx`
- `apps/api/e2e/guestMigration.spec.ts`
- `GUEST_MODE_13C.md`

Modified:
- `packages/shared/src/index.ts`
- `apps/api/src/config/session.ts`, `apps/api/src/config/mongoSession.ts`
- `apps/api/src/middleware/tripIdentity.ts`, `apps/api/src/app.ts`, `apps/api/src/routes/auth.ts`
- `apps/web/src/components/layout/AppLayout.tsx`
- `apps/web/src/components/GuestUsage.tsx`, `apps/web/src/components/GuestUsage.test.tsx`
- `apps/api/e2e/server.ts`, `apps/api/e2e/README.md`
- `docker-compose.yml`, `README.md`, `GUEST_MODE.md`, `GUEST_MODE_13B.md`

The working tree also contains the preceding uncommitted Steps 13A/13B.

## Executed validation

- `bun run --cwd apps/api test`: 47 files, 702 tests passed.
- `bun run --cwd apps/web test`: 24 files, 153 tests passed.
- `bun run test:e2e`: all 14 Playwright tests passed, including both new migration journeys.
- `bun run --cwd packages/shared build`: passed.
- `bun run --cwd apps/api typecheck`: passed.
- `bun run --cwd apps/web typecheck`: passed.
- `bun run typecheck:e2e`: passed.
- `bun run build`: all three production build tasks passed. Vite reports dependency annotation and bundle-size warnings.
- `git diff --check`: passed.

Backend coverage includes zero/one/six trips, registration and existing-account login, unchanged BSON data, existing account data, parallel confirmation, interrupted transaction rollback/retry, session/account binding, concurrent two-tab login, active guest work, expiration, discard, quotas, sharing and private/public PDF/ICS export. Standalone MongoDB rollback safety has a separate real-database test.

Browser tests use real Fastify, session cookies and a single-node Mongo replica set. External providers are deterministic fixtures; internal API routes are not mocked. Registration verifies generated itinerary preservation, mobile keyboard import, reload, old-cookie denial and public sharing. Existing-account login verifies six trips, defer/resume, an interruption after real transactional writes, retry, receipt replay and preserved existing trips.

## Limitations and Step 13D

- Production MongoDB must support transactions. Validate the changed Compose healthcheck in the intended Docker environment.
- A process crash can leave an activity lease behind. It fails closed rather than allowing import while uncertain work could still mutate. Safe lease reconciliation and operational recovery belong in lifecycle hardening.
- Discarded/expired sources retain their trips. Orphan-trip retention and cleanup are deferred; there is no indefinite recovery promise.
- Import authorization belongs to one authenticated session. Logout, session rotation or loss of that session cannot move the context to a later account.
- Existing account creation and network protections remain; creating fresh identities across networks remains a residual abuse risk. Migration adds no quota refunds.

Ready for Step 13D lifecycle and security hardening, with the transaction deployment requirement and conservative crash-recovery behavior documented. No commits or pushes were made.

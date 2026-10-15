Current migration implementation: [Step 13C](GUEST_MODE_13C.md). This report records the preceding step.

# Guest Mode — Step 13A

This is the historical Step 13A report. Current guest trip functionality and limits are documented in [Step 13B](GUEST_MODE_13B.md).

Implementation checklist:
- [x] Audit existing sessions, auth, Origin protection, rate limiting, frontend routing and public sharing.
- [x] Extend sessions with explicit guest creation, restoration and termination.
- [x] Add shared identity contracts and guest-aware frontend state/navigation.
- [x] Add lifecycle, authorization, frontend and browser coverage.
- [x] Run backend/frontend tests, TypeScript checks and production builds.
- [x] Finish browser regression rerun and final diff review.

Validation results:
- Backend: 44 files, 660 tests passed.
- Frontend: 22 files, 131 tests passed; final guest UI rerun: 8 tests passed.
- API/web TypeScript checks, E2E TypeScript check and all three production builds passed.
- Playwright guest, existing smoke and public sharing suites: 9 tests passed on the final run. The first run passed 8/9, with a Prague generation response timeout that did not reproduce on rerun.
- `git diff --check` passed. Existing public-asset import, bundle-size, dependency annotation and EventEmitter listener warnings remain.

## Sessions and security

Guest sessions reuse the signed `triply.sid` cookie and MongoDB `sessions` collection. Explicit entry generates a 256-bit random secret and an independent stable 128-bit guest ID. MongoDB stores a SHA-256 hash of the guest secret as the record key, guest ID, creation time, existing lastModified metadata and expiration. No User document, email, password or fingerprint is created. Public page visits create no persistent identity.

Existing cookies retain HttpOnly, SameSite=Lax, Path=/, seven-day persistent rolling expiration and Secure in production. The existing TTL index and server-side expiration checks apply. Last activity is approximate because unchanged sessions are touched daily. Guest API expiry reflects database expiry. Existing authenticated sessions retain their compatible storage protocol.

Guest writes inherit strict WEB_ORIGIN validation, fixed-origin credentialed CORS and the existing shared authentication rate limit (10 attempts per IP per 15 minutes). Login/registration rotate and replace guest sessions. Existing authenticated-only middleware accepts only registered users. No trip or AI permissions are granted to guests.

## API

- `POST /api/auth/guest`: create/reuse a guest, preserving an existing authenticated identity.
- `GET /api/auth/session?identity=1`: shared `IdentitySession` union with anonymous, guest and authenticated responses.
- `GET /api/auth/session`: existing user-only response and 401 behavior retained for compatibility.
- `POST /api/auth/guest/end`: revoke the presented guest and clear its cookie; preserve authenticated sessions.

Raw secrets never appear in API responses or localStorage. Guest termination revokes server state; replaying the cookie does not restore identity.

## Frontend

TanStack Query owns session state. AuthProvider exposes loading/anonymous/guest/authenticated status, user/guest values and permission helpers. Successful identity changes cancel pending queries and clear cached resources. Failed exit preserves the current identity and displays a retryable error.

Login/register provides Continue as guest. The explicitly guest-capable shell displays a Guest indicator, Create account, Log in and End guest session. Guest pages explain unavailable trip features without mounting authenticated forms. Private trip routes keep user-only guards. Profile and notification controls are hidden. Public shared trips remain outside session guards. Mobile navigation and keyboard focus are supported.

## Files

Created:
- `packages/shared/src/session.ts`
- `apps/web/src/pages/GuestPage.tsx`
- `apps/api/src/routes/guest.routes.test.ts`
- `apps/web/src/auth/GuestSession.test.tsx`
- `apps/api/e2e/guest.spec.ts`
- `GUEST_MODE.md`

Modified:
- `packages/shared/src/index.ts`
- `apps/api/src/config/mongoSession.ts`
- `apps/api/src/config/session.ts`
- `apps/api/src/routes/auth.ts`
- `apps/web/src/api/auth.ts`
- `apps/web/src/auth/AuthProvider.tsx`
- `apps/web/src/auth/RouteGuards.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/components/LoginPage.tsx`
- `apps/web/src/components/layout/Header.tsx`
- `apps/web/src/components/layout/BottomNav.tsx`
- `apps/web/src/styles.css`

## Scope and Step 13B

The stable guest ID is ready for explicit guest ownership and quota contracts in Step 13B. Trip generation, guest AI access, quota consumption and account migration are intentionally deferred. Step 13C must define ownership transfer before replacing a guest session. Step 13D can extend revocation/concurrency hardening.

Guests currently see explanatory pages for unavailable features. Cookie loss or expiration ends recoverability. Concurrent initial entry in separate tabs before either receives a cookie can create separate identities. No commits or pushes were performed.

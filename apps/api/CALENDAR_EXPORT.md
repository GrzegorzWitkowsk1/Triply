# Manual itinerary calendar export

Calendar endpoints serialize the existing safe `PublicTrip` DTO using
`ical-generator`. ICAL.js validates generated files in deterministic tests and in
the local sample script. Production serialization handles RFC 5545 TEXT escaping,
CRLF, Unicode-safe 75-octet line folding, and required event/calendar properties.
No calendar account, OAuth, external service or synchronization is involved.

- Owner: `GET /api/trips/:id/export/calendar`, existing session and ownership filter.
- Public: `GET /api/public/trips/:shareToken/export/calendar`, current enabled token
  hash checked before and after rendering, matching PDF revocation semantics.
- `text/calendar; charset=utf-8`, sanitized `.ics` attachment name, `no-store`,
  `no-referrer` and `noindex, nofollow`. Count headers report exported, excluded,
  unscheduled and invalid items. Errors have safe codes for frontend localization.

Data comes directly from the existing database projection and safe mapper.
Descriptions contain only public attraction text, duration, opening-hours
uncertainty, destination-local times and Triply attribution. Missing addresses
are explicitly marked unavailable. Budgets, expenses, notes, identities, provider
identifiers and raw diagnostics are excluded. Calendar export never invokes the
trip-detail backfill path, providers, routes or weather refresh, and performs no
database writes or itineraryVersion changes.

One timed event is emitted per attraction or explicit scheduled break. Calculated
travel activities are omitted by design. Unresolved, missing, malformed or
nonpositive start/end intervals are excluded; end times are never fabricated from
duration. Additional unscheduled attractions are counted without double-counting
an unresolved attraction already present in the timeline. Empty/no-event exports
return an actionable 422 response instead of an empty calendar. Events are sorted
by their resolved real-world start times.

Destination-local strings are converted to UTC using the saved day's IANA zone
and the existing `isValidTimeZone`/`offsetMinutes` utilities. Explicit persisted
offsets must agree with the IANA zone. Offset-free repeated DST times and missing
spring-forward times are rejected rather than guessed. No browser timezone or
hardcoded offset is used. UTC output needs no VTIMEZONE and remains the correct
instant in Google, Apple and Outlook; each calendar displays it in its chosen zone.
Ambiguous legacy schedules need a valid explicit offset before export.

Calendar-only optional metadata leaves the existing public page and PDF payloads
unchanged. `calendarUid` is an opaque SHA-256 identifier in the shared DTO, derived from a
versioned namespace, trip identity, upstream attraction identity and visit
occurrence. It contains no raw database identifier or share token. Unique
attractions retain UIDs across reordering, rescheduling and day moves. Repeated
visits need day/occurrence disambiguation; changing that identity may change their
UID. Breaks use day, title and occurrence because the existing schema has no
separate stable break ID. DTSTAMP is the export instant, shared by all events in
one file. Stable UIDs do not guarantee that every calendar deduplicates imports.

Owner actions are grouped in a menu after Regenerate Day: PDF, calendar, Share.
Public pages keep separate PDF and calendar buttons. The calendar label stays
"Export to Calendar" in both languages as explicitly requested. Other calendar
messages use the existing Polish/English `triply.language` preference; this repo
has no i18next infrastructure. Exclusion summaries use the existing toast.
The backpack action has the requested "What should I take?" label.

Limits: 365 days, 2,000 source activities, 300,000 DTO characters, 2 MiB output and
10 requests/minute per route/IP using the existing store. Work yields between days.
Files exist only in memory for download. Downloaded copies cannot be recalled.

Generate and parser-validate Barcelona, Prague, Tokyo and DST sample files:

```powershell
bun run --cwd apps/api scripts/inspectCalendar.ts
```

Samples go to the OS temporary directory unless an output path is passed. No live
calendar credentials are used. Parser validation is automated; manual import into
Google Calendar, Apple Calendar or Outlook has not been performed.

Files added:
- `packages/shared/src/calendar.ts`
- `apps/api/src/services/tripCalendar.ts`, `tripCalendar.test.ts`, `tripCalendar.fixtures.ts`
- `apps/api/src/routes/calendar.ts`, `calendar.routes.test.ts`
- `apps/api/scripts/inspectCalendar.ts`, `apps/api/e2e/calendar.spec.ts`, this document
- `apps/web/src/api/calendar.ts`, `calendar.test.ts`
- `apps/web/src/config/calendarExport.ts`
- `apps/web/src/components/trip/TripExportActions.tsx`, `TripExportActions.test.tsx`

Files updated:
- `apps/api/package.json`, `bun.lock`, `apps/api/src/app.ts`, `apps/api/src/routes/sharing.ts`
- `packages/shared/src/index.ts`, `packages/shared/src/sharing.ts`
- `apps/web/src/pages/TripPage.tsx`, `TripPage.test.tsx`, `TripPage.editing.test.tsx`
- `apps/web/src/pages/SharedTripPage.tsx`, `SharedTripPage.test.tsx`
- `apps/web/src/components/trip/TripPdfDownload.tsx`, `TripSharing.tsx`, `apps/web/src/styles.css`
- `apps/api/e2e/fixtures.ts`, `pdf.spec.ts`, `sharing.spec.ts`

# Initial trip attachments (#20D)

`POST /api/trips/analyze` retains its JSON contract. Authenticated callers can
instead send multipart with one `metadata` JSON string and one to three `files`
parts. Guests and anonymous callers cannot use multipart. No other endpoint
accepts attachments.

Limits and safe codes are exported from `@triply/shared` (`attachments.ts`).
Extraction errors return `{ code, failures: [{ index, code }] }`; indices refer
to submitted file order. Failed files must be removed. No filename is returned
or stored by the server. AI/service failures permit retry.

PDF.js 6.4.299 is a runtime dependency and requires Node >=22.13.0. Production
uses `node dist/start.js`; `tsc` emits `dist/services/pdfTextWorker.js` next to
the extraction service. The worker loads PDF.js's legacy ESM build and packaged
PDF.js worker through normal module resolution. Ship installed production
dependencies, not only the API's dist directory. There is no deployment
manifest in this repository; the hosting runtime still needs to meet the
declared Node engine requirement. Local Node 24 and Bun development worker
smoke tests use generated PDFs without external calls.

PDF parsing uses a dedicated terminable worker per file, at most two workers
per process and no waiting queue. Node worker heap/stack limits are 128 MiB/4
MiB; execution is terminated after five seconds. Extraction has a ten-second
combined deadline. Worker flags are independent of test-runner loader flags.
Only embedded text is read: no rendering, OCR, scripts, document actions, or
document-controlled fetches. Password-protected/encrypted and textless PDFs
are rejected. Upload reading is bounded to fifteen seconds; multipart framing
has a separate eleven-MiB cap. Over-limit streaming transports may be closed.

Authorization and attachment admission occur after session loading but before
`parts()` consumes the upload. Admission is six attempts per ten minutes per
account, at most one active request per account and two per API instance.
The existing planning limiter also applies. Counters and concurrency are
process-local, consistent with the current limiter infrastructure; multi-instance
deployments should enforce a shared upstream limit as well.

The direct prompt is analyzed independently of documents. A separate strict
supplemental extraction uses the configured provider, bounded input, 3,000
output tokens and a thirty-second deadline. It cannot select endpoints,
providers, tools, or authentication actions. Application merging protects
direct requirements, negative/flexible protected fields, and explicit UI
selections. Documents only fill missing supported requirements. Profile
defaults follow merging; later requirements edits remain authoritative.

Original buffers are cleared after extraction. Extracted text exists only for
the request and is never written to the database, prompt, notes, or logs.
Private AI responses are byte-bounded and upstream error text is redacted.
No original files are written to disk. The frontend explains external AI
transmission without promising anything about provider retention.

Only bounded structured creation context is saved on the draft. Generation
matches nearby real candidates first, then uses one bounded named Overpass
query with at most one fallback endpoint. Exact local/English/Polish aliases
are supported within 5 km; ambiguous or unavailable results remain unresolved.
Names are escaped, provider coordinates validated, and places deduplicated.
Requested places receive candidate slots before ordinary budget selection,
with room retained for other suggestions. Existing routing, opening hours,
weather, budgets, and capacity checks still apply.

Final outcomes are computed from actual scheduled activities. They distinguish
included, unresolved, resolved but unscheduled, and excluded places. The UI
labels these as initial-creation outcomes; later editing does not replay
documents or rewrite this historical report. Successful generation clears
temporary creation context and retains bounded outcomes. Failed generation
keeps structured context for retry, with destination-specific matches resolved
afresh against the current destination.

## Changed files

Modified:

```text
bun.lock
packages/shared/src/index.ts
packages/shared/src/trip.ts
apps/api/package.json
apps/api/src/ai/aiService.ts
apps/api/src/ai/types.ts
apps/api/src/ai/providers/gemini.ts
apps/api/src/ai/providers/openrouter.ts
apps/api/src/models/Trip.ts
apps/api/src/routes/trips.ts
apps/api/src/services/attractions.ts
apps/api/src/services/tripDraft.ts
apps/api/src/services/tripGeneration.ts
apps/web/src/api/client.ts
apps/web/src/api/trips.ts
apps/web/src/components/home/TripPlanSummaryCard.tsx
apps/web/src/hooks/useTripAnalysis.ts
apps/web/src/i18n/errors.ts
apps/web/src/i18n/locales/en/tripCreator/home.json
apps/web/src/i18n/locales/pl/tripCreator/home.json
apps/web/src/pages/HomePage.tsx
apps/web/src/pages/TripPage.tsx
apps/web/src/styles.css
```

Added:

```text
packages/shared/src/attachments.ts
apps/api/ATTACHMENTS.md
apps/api/src/ai/privateResponse.ts
apps/api/src/ai/privateResponse.test.ts
apps/api/src/ai/prompts/attachmentContext.ts
apps/api/src/http/attachments.ts
apps/api/src/routes/attachments.routes.test.ts
apps/api/src/services/attachmentContext.ts
apps/api/src/services/attachmentContext.test.ts
apps/api/src/services/attachmentExtraction.ts
apps/api/src/services/attachmentExtraction.test.ts
apps/api/src/services/creationAttractionPreferences.ts
apps/api/src/services/creationAttractionPreferences.test.ts
apps/api/src/services/pdfTextWorker.ts
apps/web/src/api/attachments.test.ts
apps/web/src/components/home/AttachmentRequirements.tsx
apps/web/src/components/home/AttachmentRequirements.test.tsx
apps/web/src/components/trip/RequestedAttractionOutcomes.tsx
apps/web/src/hooks/useTripAttachments.ts
apps/web/src/hooks/useTripAttachments.test.tsx
apps/web/src/pages/HomePage.attachments.test.tsx
```

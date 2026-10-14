# Trip itinerary PDF export

PDFKit produces text-based A4 PDFs on the server. This provides direct downloads,
embedded Unicode fonts and predictable pagination without a production browser,
HTML execution, screenshots or a conversion service. Client-only generation would
not enforce revocation on already-loaded data; browser print dialogs would not
provide consistent direct downloads. PDF.js and native canvas are development-only
dependencies for parsing tests and preview inspection.

Both exports reuse `PublicTrip` and `toPublicTrip`. The DTO adds optional structured
opening-hours status, duration provenance and allowlisted warning codes. Raw
warning strings, provider identifiers, private notes, budgets, expenses and owner
identity never reach the renderer. There is no separate itinerary model. The
existing model has no distinct trip title, so the document uses the destination.

- `GET /api/trips/:id/export/pdf`: existing session authentication and owner filter.
- `GET /api/public/trips/:shareToken/export/pdf`: current enabled token hash, checked
  again after rendering to catch revocation or rotation during an export.
- Successful responses use `application/pdf`, a sanitized attachment filename,
  `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `noindex, nofollow`.
- Reads use a database projection directly, never the detail route's backfill logic.
  No itinerary generation, weather refresh, routing, external requests or writes occur.

The layout uses Triply coral, readable text, compact headers, local calendar dates,
saved destination-local time strings, day sections, attraction descriptions,
addresses, travel details, uncertainty messages and numbered
footers. Ordinary entries stay together; oversized entries split between lines.
Manual itinerary order is preserved, including unresolved visits. Saved forecasts
are labelled as saved and must be verified before departure. No prices or maps
are included. Noto Sans fonts are embedded from the local OFL-licensed package;
European scripts and diacritics use their appropriate font subsets. Unsupported
scripts/glyphs outside Noto Sans coverage are not guaranteed, including emoji/CJK.

Limits: 365 days, 1,500 activities, 200,000 input characters, 120 pages, 8 MiB output,
15-second cooperative rendering deadline, two active exports per API process and
10 requests per minute per route/IP using the existing rate-limit store. Rendering
yields between entries and lengthy text blocks. Limits return controlled errors,
and slots are released on failure. PDFs exist only in memory for the response.
Downloaded copies cannot be recalled when sharing is later disabled.

Generate local sample PDFs and PNG previews with:

```powershell
bun run --cwd apps/api scripts/inspectPdf.ts
```

Pass an output directory as the final argument if needed. This script is for
development and uses only deterministic fixtures and local fonts. No external
services are contacted. Production deployment must install the API's runtime
dependencies, including `@fontsource/noto-sans`; no font copy build step is needed.

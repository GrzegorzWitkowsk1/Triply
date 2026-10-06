# Triply

Trip organizer monorepo: React + TypeScript frontend, Express + TypeScript backend, MongoDB.

Brand color: `#f2664b`

## Structure

```
apps/
  api/   Express + Mongoose backend (port 4000)
  web/   Vite + React frontend (port 5173)
packages/
  shared/   Shared types, zod schemas and trip helpers
```

## Prerequisites

- [Bun](https://bun.sh)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

## Setup

```bash
bun install
cp .env.example apps/api/.env
docker compose up -d
```

## AI

Trip parsing (free-form request → structured trip preferences) runs through a provider-agnostic AI layer in `apps/api/src/ai/`. Configure it in `apps/api/.env`:

```
AI_PROVIDER=gemini        # gemini (default) or openrouter
AI_TIMEOUT_MS=45000
GEMINI_API_KEY=your-google-ai-studio-key
OPENROUTER_API_KEY=your-openrouter-key
```

- `AI_PROVIDER` selects the provider; any other value fails at startup with a clear error.
- `AI_MODEL` is the model for the selected provider. Gemini defaults to `gemini-flash-latest`; `openrouter` requires an explicit `AI_MODEL` (e.g. `google/gemma-4-26b-a4b-it:free`).
- Only the selected provider's API key is required; missing credentials answer the analyze endpoint with a `500` and an explanatory message.

## Weather

Per-day forecast (daily max temperature + WMO weather code) is fetched from the free Open-Meteo API (no key required) in `apps/api/src/services/weather.ts`, stored on the trip, and served with `GET /api/trips/:id`.

- Fetched alongside geocoding when a draft is saved or requirements change; the trip detail endpoint backfills it on load.
- Forecast coverage is limited to about 16 days ahead — trips starting further out get weather automatically once they enter range. Stored weather refreshes at most once per 24 hours.

## Run

```bash
bun run dev      # both apps at once (turborepo)
bun run dev:api  # backend only on http://localhost:4000
bun run dev:web  # frontend only on http://localhost:5173
```

## Endpoints

- `GET /health` — service health, includes MongoDB connection status
- `POST /api/trips/analyze` — `{ prompt, badges }` → AI-parsed trip analysis, stored as a draft trip. Returns `{ draftId, analysis, missingFields, requirementsComplete }`
- `PATCH /api/trips/:id/requirements` — merges answers into the draft, returns the same payload

Both trip endpoints require an authenticated session. The analyze endpoint is rate limited to 20 requests per 10 minutes.

The Vite dev server proxies `/health` and `/api` to the backend.

## Authentication

Authentication uses an HttpOnly `triply.sid` cookie backed by MongoDB. Set a unique `SESSION_SECRET` of at least 32 characters in `apps/api/.env`. The compiled API start command forces production mode; production deployments should set `WEB_ORIGIN`, configure `TRUST_PROXY` for the reverse proxy, and forward `/api` to the API with an SPA fallback for frontend routes.

Public web routes are `/login` and `/register`; authenticated app routes are protected in the client and by the API session middleware.

## Useful commands

```bash
bun run typecheck   # typecheck both apps (turborepo)
bun run test        # run tests (turborepo)
bun run build       # build both apps (turborepo, cached)
docker compose down  # stop database (data kept in volume)
```

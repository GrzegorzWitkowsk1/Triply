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

Trip planning calls the Gemini API from the backend. Create an API key in Google AI Studio and set it in `apps/api/.env`:

```
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-3.8-flash
```

`GEMINI_MODEL` is optional and defaults to `gemini-3.8-flash`. Without a key the analyze endpoint answers with a `500` and an explanatory message.

## Run

```bash
bun run dev      # both apps at once (turborepo)
bun run dev:api  # backend only on http://localhost:4000
bun run dev:web  # frontend only on http://localhost:5173
```

## Endpoints

- `GET /health` — service health, includes MongoDB connection status
- `POST /api/trips/analyze` — `{ prompt, badges }` → Gemini analysis, stored as a draft trip. Returns `{ draftId, analysis, missingFields, requirementsComplete }`
- `PATCH /api/trips/:id/requirements` — merges answers into the draft, returns the same payload

Both trip endpoints require an authenticated session. The analyze endpoint is rate limited to 20 requests per 10 minutes.

The Vite dev server proxies `/health` and `/api` to the backend.

## Authentication

Authentication uses an HttpOnly `triply.sid` cookie backed by MongoDB. Set a unique `SESSION_SECRET` of at least 32 characters in `apps/api/.env`. The compiled API start command forces production mode; production deployments should set `WEB_ORIGIN`, configure `TRUST_PROXY` for the reverse proxy, and forward `/api` to the API with an SPA fallback for frontend routes.

Public web routes are `/login` and `/register`; authenticated app routes are protected in the client and by the API session middleware.

## Useful commands

```bash
bun run typecheck   # typecheck both apps (turborepo)
bun run build       # build both apps (turborepo, cached)
docker compose down  # stop database (data kept in volume)
```

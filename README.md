# Triply

Trip organizer monorepo: React + TypeScript frontend, Express + TypeScript backend, MongoDB.

Brand color: `#f2664b`

## Structure

```
apps/
  api/   Express + Mongoose backend (port 4000)
  web/   Vite + React frontend (port 5173)
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

## Run

```bash
bun run dev      # both apps at once (turborepo)
bun run dev:api  # backend only on http://localhost:4000
bun run dev:web  # frontend only on http://localhost:5173
```

## Endpoints

- `GET /health` — service health, includes MongoDB connection status

The Vite dev server proxies `/health` and `/api` to the backend.

## Useful commands

```bash
bun run typecheck   # typecheck both apps (turborepo)
bun run build       # build both apps (turborepo, cached)
docker compose down  # stop database (data kept in volume)
```

# FSYT2

YouTube channel and video manager: React (Vite + Tailwind) frontend, FastAPI backend, PostgreSQL, WebSocket for live queue updates.

## Quick start

1. Ensure PostgreSQL is running at **10.50.1.250**, database **fsyt2** (user `postgres`, password `farstar`), or set `DATABASE_URL` in `.env`.
2. **Media storage**: Create `.env` from `.env.example` and set `SMB_USER` and `SMB_PASS` for the network share `\\10.50.1.250\Media\FSyt2`. The backend uses a CIFS volume to mount this share. If you prefer a mapped drive, see [docker-compose.media-bind.example.yml](docker-compose.media-bind.example.yml).
3. From repo root:
   ```bash
   docker compose up --build
   ```
4. Open http://localhost:10200 (frontend). API: http://localhost:8000.

## Development and debugging

See [docs/dev-docker.md](docs/dev-docker.md) for:

- Running with Docker dev override (volume mounts, backend reload, **debugpy** on port 5678).
- Running the frontend locally with `npm run dev` while the backend runs in Docker.
- Attaching the IDE debugger to the backend container.

## Project layout

- **backend/** – FastAPI app, REST API (channels, videos, queue, control, charged_errors), WebSocket `/ws`, job processor loop, migrations.
- **frontend/** – React 19, Vite 7, Tailwind, React Router, Dashboard / Channels / Videos / Queue pages.
- **docker-compose.yml** – backend + frontend (no PostgreSQL container; uses your existing DB).
- **docker-compose.dev.yml** – override for dev and debugging.

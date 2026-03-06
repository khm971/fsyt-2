# FSYT2 – Development and Docker

## Prerequisites

- Docker Desktop (Windows)
- Existing PostgreSQL at **10.50.1.250**, database **fsyt2**, user `postgres`, password `farstar`
- Node 20+ and Python 3.12+ (optional, for running backend/frontend locally)

## Run with Docker (production-style)

```bash
# From repo root
docker compose up --build
```

- Frontend: http://localhost:10200
- Backend API: http://localhost:8000
- Backend runs migrations on startup and starts the job loop.

## Run with Docker (dev + debugging)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

- Backend code is mounted from `./backend`; uvicorn runs with `--reload`.
- Backend also runs with **debugpy**; attach your IDE to **localhost:5678** to hit breakpoints.
- In Cursor/VSCode: add a "Python: Remote Attach" (or "Docker: Attach to Python") configuration with host `localhost`, port `5678`.

## Run frontend locally (no Docker for UI)

1. Start the backend (Docker or local):

   ```bash
   docker compose up backend
   # or: cd backend && uvicorn main:app --reload --port 8000
   ```

2. From another terminal, run the frontend:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

3. Open http://localhost:5173. The Vite proxy forwards `/api` and `/ws` to the backend (default `http://localhost:8000`). No need to set `VITE_API_URL` unless the backend is elsewhere.

## Environment

- Copy `.env.example` to `.env` and adjust if needed (e.g. `DATABASE_URL` when DB is not reachable at 10.50.1.250 from inside the container).
- Backend reads `DATABASE_URL` and `MEDIA_ROOT`; frontend reads `VITE_API_URL` and `VITE_WS_URL` only when you need to point at a different host.

## Database

- Schema and migrations live in `backend/migrations/`. They are applied automatically on backend startup.
- To run migrations manually: `cd backend && python run_migrations.py` (with `DATABASE_URL` set).

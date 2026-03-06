"""Run SQL migrations from backend/migrations in order."""
import asyncio
import os
from pathlib import Path

import asyncpg

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:farstar@10.50.1.250/fsyt2",
)
MIGRATIONS_DIR = Path(__file__).parent / "migrations"


async def run_migrations() -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS _migrations (
                name VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        applied = await conn.fetch("SELECT name FROM _migrations")
        applied_set = {r["name"] for r in applied}

        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            name = path.name
            if name in applied_set:
                print(f"Skip (already applied): {name}")
                continue
            print(f"Applying: {name}")
            sql = path.read_text(encoding="utf-8")
            await conn.execute(sql)
            await conn.execute(
                "INSERT INTO _migrations (name) VALUES ($1)",
                name,
            )
        print("Migrations done.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run_migrations())

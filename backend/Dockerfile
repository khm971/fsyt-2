FROM python:3.12-slim

WORKDIR /app

# ffmpeg required by yt-dlp for merging bestvideo+bestaudio; curl + unzip for Deno install
RUN apt-get update && apt-get install -y --no-install-recommends curl ffmpeg unzip \
    && rm -rf /var/lib/apt/lists/*

# Deno: JS runtime for yt-dlp YouTube extraction (EJS)
ENV DENO_INSTALL=/usr/local
RUN curl -fsSL https://deno.land/install.sh | sh

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
# Migrations run on startup via main.py lifespan

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

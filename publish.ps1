# Publish fsyt2 images to Docker Hub as khm971
# Run from project root. Requires: docker login (as khm971)

$ErrorActionPreference = "Stop"
$HubUser = "khm971"

Write-Host "Building images..." -ForegroundColor Cyan
docker compose build

Write-Host "Tagging for Docker Hub..." -ForegroundColor Cyan
docker tag fsyt2-backend:latest "${HubUser}/fsyt2-backend:latest"
docker tag fsyt2-frontend:latest "${HubUser}/fsyt2-frontend:latest"

Write-Host "Pushing to Docker Hub..." -ForegroundColor Cyan
docker push "${HubUser}/fsyt2-backend:latest"
docker push "${HubUser}/fsyt2-frontend:latest"

Write-Host "Done. Images published:" -ForegroundColor Green
Write-Host "  - ${HubUser}/fsyt2-backend:latest"
Write-Host "  - ${HubUser}/fsyt2-frontend:latest"

#!/bin/bash
set -e
log() { echo -e "\n[$(date +'%H:%M:%S')] ==> $1"; }

APP_DIR="/home/ec2-user/Towing"
# Secrets live only here on the server, never in the repo (it is public).
ENV_FILE="/home/ec2-user/.env.production"
cd $APP_DIR

if ! grep -q "^POSTGRES_PASSWORD=." "$ENV_FILE" 2>/dev/null; then
  log "ERROR: POSTGRES_PASSWORD is missing from $ENV_FILE. Run 'sudo bash deploy.sh rotate-secrets' once first."
  exit 1
fi

log "Stopping old docker containers"
docker-compose down || true

log "Pulling latest code"
git fetch origin main
git reset --hard origin/main

# Build Frontend & Backend NATIVELY on the host to avoid Docker OOMs
log "Building applications natively on host with 4GB swap"
export NODE_OPTIONS="--max-old-space-size=4096"
export NEXT_PUBLIC_USE_MOCKS=false

CI=true pnpm install --frozen-lockfile

log "Building Frontend"
pnpm --filter towfleet-web build

log "Building Backend"
pnpm --filter @towing/backend build

log "Writing simplified docker-compose.yml for DBs only"
cat > /home/ec2-user/docker-compose.yml << 'COMPOSE'
version: "3.8"
services:
  postgres:
    image: postgis/postgis:16-3.4
    restart: unless-stopped
    environment:
      POSTGRES_USER: towfleet
      # From the env file (--env-file below); only used when the volume is first created.
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in /home/ec2-user/.env.production}
      POSTGRES_DB: towfleet
    volumes:
      - postgres-data:/var/lib/postgresql/data
    # Loopback only: the backend runs on this host. Never on a public interface.
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U towfleet -d towfleet"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 30s

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "128mb", "--maxmemory-policy", "allkeys-lru"]
    volumes:
      - redis-data:/data
    # Loopback only: Redis has no password.
    ports:
      - "127.0.0.1:6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
volumes:
  postgres-data:
  redis-data:
COMPOSE

cd /home/ec2-user
docker-compose --env-file "$ENV_FILE" up -d postgres redis
sleep 15

log "Running DB migrations"
cd $APP_DIR
node apps/backend/dist/db/migrate.js || true

log "Setting up Backend Systemd Service"
cat > /etc/systemd/system/towing-backend.service << SERVICE
[Unit]
Description=TowFleet NestJS Backend
After=network.target docker.service

[Service]
Type=simple
User=ec2-user
WorkingDirectory=${APP_DIR}/apps/backend
Environment=NODE_ENV=production
Environment=PORT=4000
EnvironmentFile=/home/ec2-user/.env.production
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable towing-backend
systemctl restart towing-backend

log "Restarting nginx and frontend"
systemctl restart towing-frontend
systemctl restart nginx

log "Deployment Complete - 100% Native Mode"

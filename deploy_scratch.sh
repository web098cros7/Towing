#!/bin/bash
set -e
log() { echo -e "\n[$(date +'%H:%M:%S')] ==> $1"; }

APP_DIR="/home/ec2-user/Towing"
cd $APP_DIR

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
      POSTGRES_PASSWORD: towfleet_prod_pw
      POSTGRES_DB: towfleet
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
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
    ports:
      - "6379:6379"
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
docker-compose up -d postgres redis
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

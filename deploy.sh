#!/bin/bash
# =============================================================================
# Towing Platform - EC2 Deploy Script
# Run this once on a fresh Amazon Linux 2023 t3.micro (or larger) instance.
# Subsequent updates: just run `cd /home/ec2-user/Towing && ./deploy.sh update`
# =============================================================================

set -e

MODE="${1:-fresh}"      # fresh | update
REPO="https://github.com/web098cros7/Towing.git"
APP_DIR="/home/ec2-user/Towing"
ENV_FILE="/home/ec2-user/.env.production"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# ─── 1. System setup (fresh installs only) ───────────────────────────────────
if [ "$MODE" = "fresh" ]; then
  log "==> System setup"

  # 4 GB swap (t3.micro has 1 GB RAM; pnpm install + next build need headroom)
  if [ ! -f /swapfile ]; then
    dd if=/dev/zero of=/swapfile bs=128M count=32
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo "/swapfile swap swap defaults 0 0" >> /etc/fstab
  fi

  dnf update -y
  dnf install -y docker git nginx certbot python3-certbot-nginx

  # Docker
  systemctl enable docker && systemctl start docker
  usermod -aG docker ec2-user

  # Docker Compose v2
  curl -fsSL "https://github.com/docker/compose/releases/download/v2.27.0/docker-compose-$(uname -s)-$(uname -m)" \
    -o /usr/local/bin/docker-compose
  chmod +x /usr/local/bin/docker-compose

  # Node.js 22 + pnpm (for building the frontend on the host)
  curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
  dnf install -y nodejs
  corepack enable
  corepack prepare pnpm@11.1.2 --activate

  log "==> Cloning repo"
  git clone "$REPO" "$APP_DIR" || true
  chown -R ec2-user:ec2-user /home/ec2-user

  log "==> Creating production .env"
  # Generate strong secrets
  JWT_ACCESS=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
  JWT_REFRESH=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
  FILE_SIGN=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
  WEBHOOK_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")

  # EDIT THESE: replace placeholders before running
  DOMAIN="mitow.in"          # your domain
  ADMIN_EMAIL="admin@mitow.in"

  cat > "$ENV_FILE" << ENV
# ── Core ──────────────────────────────────────────────────────────────────────
NODE_ENV=production
PORT=4000
LOG_LEVEL=info

# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=postgres://towfleet:towfleet_prod_pw@postgres:5432/towfleet
DATABASE_POOL_MAX=10
REDIS_URL=redis://redis:6379

# ── Auth ──────────────────────────────────────────────────────────────────────
JWT_ACCESS_SECRET=${JWT_ACCESS}
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=2592000
FILE_SIGNING_SECRET=${FILE_SIGN}
REFRESH_GRACE_SECONDS=10

# ── OTP ───────────────────────────────────────────────────────────────────────
OTP_TTL_SECONDS=300
OTP_MAX_ATTEMPTS=5
OTP_SEND_WINDOW_SECONDS=86400
OTP_SEND_MAX_PER_WINDOW=10
OTP_SEND_MIN_INTERVAL_SECONDS=30
AUTH_DEV_OTP_ECHO=false

# ── CORS + public URLs ────────────────────────────────────────────────────────
CORS_ORIGINS=https://${DOMAIN},https://www.${DOMAIN}
PUBLIC_WS_URL=https://${DOMAIN}
PUBLIC_TRACK_BASE_URL=https://${DOMAIN}

# ── Realtime ──────────────────────────────────────────────────────────────────
REALTIME_ENABLED=true
REALTIME_FLUSH_MS=1000
REALTIME_TICKET_TTL_SECONDS=60
REALTIME_METRICS_DEBOUNCE_MS=2000

# ── Queue ─────────────────────────────────────────────────────────────────────
QUEUE_ENABLED=true
QUEUE_CONCURRENCY=4
COMPLIANCE_SWEEP_CRON=0 * * * *
BULK_IMPORT_SYNC_MAX_ROWS=500
BULK_IMPORT_MAX_ROWS=10000

# ── Money ─────────────────────────────────────────────────────────────────────
LEDGER_RECONCILE_CRON=30 19 * * *
LEDGER_DRIFT_TOLERANCE_PAISE=0
LEDGER_OPS_EMAIL=${ADMIN_EMAIL}
PAYOUT_PROVIDER=dev
PAYOUT_MIN_PAISE=100000
PAYOUT_MAX_PAISE=50000000
PAYOUT_RECONCILE_CRON=*/5 * * * *
PAYOUT_STUCK_MINUTES=15
PAYOUT_DEV_SETTLE_MS=5000
PAYOUT_WEBHOOK_SECRET=${WEBHOOK_SECRET}
PAYMENT_GATEWAY=dev
PAYMENT_DEV_SETTLE_MS=0
PAYMENT_WEBHOOK_SECRET=${WEBHOOK_SECRET}
PAYMENT_RECONCILE_CRON=*/5 * * * *
PAYMENT_STUCK_MINUTES=30

# ── Notifications (log = no vendor key needed) ────────────────────────────────
NOTIFY_ENABLED=true
NOTIFY_PUSH_PROVIDER=log
NOTIFY_SMS_PROVIDER=log
NOTIFY_WHATSAPP_PROVIDER=log
NOTIFY_EMAIL_PROVIDER=log
NOTIFY_SWEEP_CRON=*/5 * * * *
NOTIFY_STRANDED_MINUTES=5
EXTERNAL_CALL_TIMEOUT_MS=5000
EXTERNAL_CALL_BREAKER_THRESHOLD=5
EXTERNAL_CALL_BREAKER_RESET_MS=30000

# ── Routing / geocoding (haversine = no Google key needed) ───────────────────
ROUTING_PROVIDER=haversine
GEOCODING_PROVIDER=local
DIRECTIONS_PROVIDER=haversine
DIRECTIONS_ENABLED=true
HAVERSINE_ROUTE_FACTOR=1.3
FALLBACK_SPEED_KPH=22
ROUTING_TIMEOUT_MS=1500
GEOCODING_TIMEOUT_MS=1200
DIRECTIONS_TIMEOUT_MS=4000
GOOGLE_DISTANCE_MATRIX_URL=https://maps.googleapis.com/maps/api/distancematrix/json
GOOGLE_PLACES_URL=https://maps.googleapis.com/maps/api/place
GOOGLE_GEOCODING_URL=https://maps.googleapis.com/maps/api/geocode/json
GOOGLE_DIRECTIONS_URL=https://maps.googleapis.com/maps/api/directions/json
GOOGLE_JWKS_URL=https://www.googleapis.com/oauth2/v3/certs
GOOGLE_JWKS_TIMEOUT_MS=3000
GOOGLE_JWKS_CACHE_SECONDS=3600
APPLE_LOGIN_ENABLED=false
APPLE_JWKS_URL=https://appleid.apple.com/auth/keys
APPLE_JWKS_TIMEOUT_MS=3000
APPLE_JWKS_CACHE_SECONDS=3600

# ── Location pipeline ─────────────────────────────────────────────────────────
LOCATION_FLUSH_MS=30000

# ── Telephony ─────────────────────────────────────────────────────────────────
TELEPHONY_PROVIDER=direct
EXOTEL_BASE_URL=https://api.exotel.com/v1/Accounts
EXOTEL_TIMEOUT_MS=4000

# ── Expo push ─────────────────────────────────────────────────────────────────
EXPO_PUSH_URL=https://exp.host/--/api/v2/push/send
EXPO_PUSH_RECEIPTS_URL=https://exp.host/--/api/v2/push/getReceipts
EXPO_RECEIPT_DELAY_MS=900000

# ── Hardening ─────────────────────────────────────────────────────────────────
TRUST_PROXY_HOPS=1
THROTTLE_READS_LIMIT=300
THROTTLE_MONEY_LIMIT=20
THROTTLE_AUTH_LIMIT=5
THROTTLE_REFRESH_LIMIT=30
THROTTLE_REALTIME_LIMIT=60
DB_SLOW_QUERY_MS=200
DB_SLOW_QUERY_SQL_MAX=300
METRICS_ENABLED=true

# ── Earnings ──────────────────────────────────────────────────────────────────
EARNINGS_WEEKLY_CRON=30 3 * * 1

# ── Misc ──────────────────────────────────────────────────────────────────────
SHARE_LINK_GRACE_MINUTES=30
MSG91_BASE_URL=https://control.msg91.com
WHATSAPP_BASE_URL=https://graph.facebook.com/v21.0
SES_REGION=ap-south-1
SES_FROM_EMAIL=no-reply@${DOMAIN}
RAZORPAY_BASE_URL=https://api.razorpay.com
RAZORPAY_TIMEOUT_MS=5000
ENV

  chmod 600 "$ENV_FILE"
  log "==> .env written to $ENV_FILE - review secrets before going live"
fi

# ─── 2. Pull latest code ──────────────────────────────────────────────────────
log "==> Pulling latest code"
cd "$APP_DIR"
git fetch origin main
git reset --hard origin/main

# ─── 3. Build frontend (on host - avoids Lambda/Docker memory limits) ─────────
log "==> Building frontend (this takes ~2 min)"
cd "$APP_DIR"

# Set env for build
export NEXT_PUBLIC_USE_MOCKS=false
export NODE_OPTIONS="--max-old-space-size=3072"

pnpm install --frozen-lockfile
pnpm --filter towfleet-web build

log "==> Frontend built at apps/towfleet-web/.next"

# ─── 4. Write docker-compose.yml ─────────────────────────────────────────────
log "==> Writing docker-compose.yml"
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
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  backend:
    build:
      context: ./Towing
      dockerfile: apps/backend/Dockerfile.prod
    image: towing-backend:latest
    restart: unless-stopped
    env_file: /home/ec2-user/.env.production
    environment:
      NODE_OPTIONS: "--max-old-space-size=512"
    ports:
      - "4000:4000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:4000/v1/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

volumes:
  postgres-data:
  redis-data:
COMPOSE

# ─── 5. Run DB migrate then start services ────────────────────────────────────
log "==> Starting postgres + redis"
cd /home/ec2-user
docker-compose up -d postgres redis --build backend

log "==> Waiting for postgres to be healthy..."
sleep 15

log "==> Running DB migrations"
docker-compose run --rm backend sh -c "node apps/backend/dist/db/migrate.js" 2>/dev/null || \
  log "WARNING: migrate command failed - run manually if this is first deploy"

log "==> Starting backend"
docker-compose up -d backend

# ─── 6. nginx config ─────────────────────────────────────────────────────────
log "==> Configuring nginx"

DOMAIN_NAME="mitow.in"   # change if needed

cat > /etc/nginx/conf.d/towing.conf << NGINX
# ── Towing Platform - nginx reverse proxy ─────────────────────────────────────
upstream nextjs  { server 127.0.0.1:3000; }
upstream backend { server 127.0.0.1:4000; }

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name ${DOMAIN_NAME} www.${DOMAIN_NAME};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${DOMAIN_NAME} www.${DOMAIN_NAME};

    # certbot fills these in after: certbot --nginx -d mitow.in -d www.mitow.in
    # ssl_certificate     /etc/letsencrypt/live/${DOMAIN_NAME}/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/${DOMAIN_NAME}/privkey.pem;

    # Security headers
    add_header X-Content-Type-Options  nosniff;
    add_header X-Frame-Options         SAMEORIGIN;
    add_header Referrer-Policy         strict-origin-when-cross-origin;

    # WebSocket: Socket.io (realtime)
    location /socket.io/ {
        proxy_pass         http://backend;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_read_timeout 3600s;
    }

    # Static Next.js assets - long cache, no proxy buffering needed
    location /_next/static/ {
        proxy_pass         http://nextjs;
        proxy_cache_valid  200 365d;
        add_header         Cache-Control "public, max-age=31536000, immutable";
    }

    # Everything else → Next.js
    location / {
        proxy_pass          http://nextjs;
        proxy_http_version  1.1;
        proxy_set_header    Upgrade      \$http_upgrade;
        proxy_set_header    Connection   "upgrade";
        proxy_set_header    Host         \$host;
        proxy_set_header    X-Real-IP    \$remote_addr;
        proxy_set_header    X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header    X-Forwarded-Proto \$scheme;
    }
}
NGINX

nginx -t && systemctl enable nginx && systemctl restart nginx
log "==> nginx running"

# ─── 7. systemd unit for Next.js frontend ────────────────────────────────────
log "==> Installing Next.js systemd service"

cat > /etc/systemd/system/towing-frontend.service << SERVICE
[Unit]
Description=TowFleet Next.js Frontend
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=${APP_DIR}/apps/towfleet-web
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=384
Environment=PORT=3000
Environment=NEXT_PUBLIC_USE_MOCKS=false
Environment=API_BASE_URL=http://localhost:4000
ExecStart=/usr/bin/pnpm run start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable towing-frontend
systemctl start towing-frontend
log "==> Frontend service started"

# ─── 8. Done ─────────────────────────────────────────────────────────────────
log "============================================================"
log "  Deploy complete!"
log "============================================================"

#!/bin/bash
cat > /etc/systemd/system/towing-frontend.service << 'SERVICE'
[Unit]
Description=TowFleet Next.js Frontend
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/home/ec2-user/Towing/apps/towfleet-web
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=1024
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
systemctl restart towing-frontend

cat > /etc/nginx/conf.d/towing.conf << NGINX
upstream nextjs  { server 127.0.0.1:3000; }
upstream backend { server 127.0.0.1:4000; }

server {
    listen 80;
    server_name mitow.in www.mitow.in;
    
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

    location /_next/static/ {
        proxy_pass         http://nextjs;
        proxy_cache_valid  200 365d;
        add_header         Cache-Control "public, max-age=31536000, immutable";
    }

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

#!/bin/bash
sed -i 's/RUN pnpm --filter @towing\/backend build/ENV NODE_OPTIONS="--max-old-space-size=4096"\nRUN pnpm --filter @towing\/backend build/g' /home/ec2-user/Towing/apps/backend/Dockerfile.prod
cd /home/ec2-user/Towing
sudo bash deploy.sh fresh

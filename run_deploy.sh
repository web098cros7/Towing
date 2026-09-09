#!/bin/bash
cd /home/ec2-user
if [ ! -d Towing ]; then
  git clone https://github.com/web098cros7/Towing.git
fi
cd Towing
git config --global --add safe.directory /home/ec2-user/Towing
git fetch origin main
git reset --hard origin/main
sed -i 's/pnpm install/CI=true pnpm install/g' deploy.sh
sudo bash deploy.sh fresh

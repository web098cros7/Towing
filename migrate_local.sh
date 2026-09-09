#!/bin/bash
cd /home/ec2-user/Towing
export DATABASE_URL="postgres://towfleet:towfleet_prod_pw@127.0.0.1:5432/towfleet"
export JWT_ACCESS_SECRET="182B89k0QAdHLHb7YdmCyATMuehcZVNNyofIoazKz9DoyNjo28LvswsUO1uH1tBt"
export FILE_SIGNING_SECRET="0OgB8lyDMZlkcEhZY2Y10ZNjV8Wm7ym7ZZ20vg8-lSZuyl8W7DvG14N8vrI5e6ma"
export REDIS_URL="redis://127.0.0.1:6379"
node apps/backend/dist/db/migrate.js

#!/bin/bash
sudo rm -rf /var/lib/docker
sudo systemctl start docker
cd /home/ec2-user/Towing
sudo bash deploy.sh fresh

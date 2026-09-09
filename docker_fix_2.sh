#!/bin/bash
sudo systemctl restart containerd
sudo systemctl start docker
cd /home/ec2-user/Towing
sudo bash deploy.sh fresh

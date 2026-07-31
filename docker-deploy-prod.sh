#!/bin/bash

# Stop and remove existing container
sudo docker stop laserreporting
sudo docker rm laserreporting

# Build the image
sudo docker build -t moline-apps/laserreporting .

# Run the container
# DATABASE_PATH and XML_MONITOR_DIRECTORY are set here rather than in .env so they
# always match the volume mounts below. Everything else comes from .env.
sudo docker run --restart=unless-stopped -d -p 3000:3000 \
  --env-file .env \
  -e DATABASE_PATH=/data/data.db \
  -e XML_MONITOR_DIRECTORY=/xml \
  -v laserreporting-db:/data:z \
  -v /mnt/laser_report:/xml \
  --name laserreporting moline-apps/laserreporting

#!/bin/bash
set -euo pipefail

XML_MOUNT=/mnt/laser_report

# Fail early with a clear message rather than a docker error at the last step
if [ ! -f .env ]; then
  echo "error: .env not found. Copy .env.default to .env and fill it in." >&2
  exit 1
fi

# Docker bind mounts are private: the container captures whatever is at this path
# when it starts. If the cifs share isn't mounted yet, /xml is silently empty for
# the life of the container, so refuse to deploy rather than start a broken one.
if ! mountpoint -q "$XML_MOUNT"; then
  echo "error: $XML_MOUNT is not mounted. Run 'sudo mount -a' and check 'dmesg | tail'." >&2
  exit 1
fi

# Stop and remove existing container (absent on first deploy, so don't fail)
sudo docker stop laserreporting || true
sudo docker rm laserreporting || true

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
  -v "$XML_MOUNT":/xml \
  --name laserreporting moline-apps/laserreporting

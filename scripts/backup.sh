#!/usr/bin/env bash
# Nightly backup of the prod-like stack: database dump + the documents folder, kept locally and (optionally) copied off-host.
# Financial records must survive the host (constitution §7): point BACKUP_OFFSITE at a mounted remote, rclone
# destination, or an Azure Blob container; the copy step is the only part that knows where.
#
#   0 3 * * * /opt/af/scripts/backup.sh >> /var/log/af-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST=${BACKUP_DIR:-./backups}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-30}
mkdir -p "$DEST"

echo "[$STAMP] database"
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U "${POSTGRES_USER:-af}" -Fc "${POSTGRES_DB:-af}" > "$DEST/db-$STAMP.dump"

echo "[$STAMP] documents"
# the documents volume (F107): plain files, one per document — a tar of the folder is the whole store, and
# `rsync` of the same folder works just as well (`docker volume inspect` gives its path on the host)
docker run --rm --volumes-from "$(docker compose -f docker-compose.prod.yml ps -q app)" -v "$(pwd)/$DEST":/backup alpine \
  tar czf "/backup/blobs-$STAMP.tgz" -C /data/documents .

if [ -n "${BACKUP_OFFSITE:-}" ]; then
  echo "[$STAMP] offsite → $BACKUP_OFFSITE"
  cp "$DEST/db-$STAMP.dump" "$DEST/blobs-$STAMP.tgz" "$BACKUP_OFFSITE/"
fi

find "$DEST" -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
find "$DEST" -name 'blobs-*.tgz' -mtime +"$KEEP_DAYS" -delete
echo "[$STAMP] done"

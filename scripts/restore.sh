#!/usr/bin/env bash
# Restore a backup into the prod stack — and the way a backup is proven (constitution §7: a backup that was never
# restored is a hope). Stops the app, restores the database dump and the blob data, starts the app again.
#
#   ./scripts/restore.sh backups/db-20261020T030000Z.dump backups/blobs-20261020T030000Z.tgz
#
# To prove a backup without touching production, run the same against a second checkout with its own .env.prod
# and volumes (`docker compose -p af-restore-test …`).
set -euo pipefail
cd "$(dirname "$0")/.."
DUMP=${1:?database dump (db-*.dump)}
BLOBS=${2:?blob archive (blobs-*.tgz)}
COMPOSE="docker compose -f docker-compose.prod.yml"
DB_USER=${POSTGRES_USER:-af}
DB_NAME=${POSTGRES_DB:-af}

echo "stopping the app"
$COMPOSE stop app

echo "restoring the database from $DUMP"
$COMPOSE exec -T db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS \"${DB_NAME}_restore\";" \
  -c "CREATE DATABASE \"${DB_NAME}_restore\";"
$COMPOSE exec -T db pg_restore -U "$DB_USER" -d "${DB_NAME}_restore" --no-owner --no-acl < "$DUMP"
$COMPOSE exec -T db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -q \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS \"$DB_NAME\";" \
  -c "ALTER DATABASE \"${DB_NAME}_restore\" RENAME TO \"$DB_NAME\";"

echo "restoring the documents from $BLOBS"
# the documents volume (F107) is mounted by the app, stopped above; the archive is the folder's content
docker run --rm --volumes-from "$($COMPOSE ps -aq app)" -v "$(cd "$(dirname "$BLOBS")" && pwd)":/backup alpine \
  sh -c "rm -rf /data/documents/* && tar xzf /backup/$(basename "$BLOBS") -C /data/documents"

echo "starting the app (migrations run first)"
$COMPOSE up -d app
$COMPOSE exec -T app wget -qO- http://127.0.0.1:3000/api/health && echo
echo "restored"

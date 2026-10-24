#!/bin/bash
# Build the AF dev environment from nothing in a cloud agent session (or any Linux box), the way CI does:
# one Postgres on :5433 (the test database, used for everything), Azurite blob on :10000, .env.local,
# migrations, the seed, the production build and `next start` on :3000. Every step is idempotent.
#
#   scripts/dev-env.sh            # = up: db deps env migrate seed azurite chromium build start
#   scripts/dev-env.sh <step>...  # db | deps | env | migrate | seed | azurite | chromium | build | start
#                                 # | stop | reset | status
#
# The why of each step and the manual fallbacks: scripts/dev-env.md.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD

MIG_URL=${DATABASE_TEST_MIGRATION_URL:-postgresql://af:test@localhost:5433/af_test}
APP_URL=${DATABASE_TEST_URL:-postgresql://af_app:app@localhost:5433/af_test}
APP_PORT=${PORT:-3000}
LOGS=${AF_DEV_ENV_LOGS:-${TMPDIR:-/tmp}/af-dev-env}
AZURITE_CONN='DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;'
mkdir -p "$LOGS"

say() { printf '\033[1m▸ %s\033[0m\n' "$*"; }
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
wait_port() { for _ in $(seq 1 "${2:-60}"); do port_open "$1" && return 0; sleep 1; done; echo "port $1 not up" >&2; return 1; }
docker_ok() { command -v docker >/dev/null && docker info >/dev/null 2>&1; }
# The schema engine (prisma migrate) is downloaded from binaries.prisma.sh, which the cloud proxy blocks.
engine_present() { compgen -G "node_modules/@prisma/engines/schema-engine*" >/dev/null || [ -n "${PRISMA_SCHEMA_ENGINE_BINARY:-}" ]; }
prisma() { if engine_present; then npx prisma "$@"; else PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx prisma "$@"; fi; }

# ── Postgres on :5433 (roles of docker-compose.yml's db-test: af/test superuser; the migrations create af_app/app)
db() {
  say "postgres :5433"
  if psql "$MIG_URL" -tAc 'select 1' >/dev/null 2>&1; then echo "  up"; return; fi
  if docker_ok; then
    docker compose up -d db-test
  else
    local ver
    ver=$(ls /usr/lib/postgresql | sort -n | tail -1)
    if ! pg_lsclusters -h | awk '{print $2}' | grep -qx aftest; then
      pg_createcluster "$ver" aftest -p 5433 -- --auth-local=trust --auth-host=scram-sha-256 >/dev/null
    fi
    pg_ctlcluster "$ver" aftest start 2>/dev/null || true
    wait_port 5433 30
    runuser -u postgres -- psql -p 5433 -qtAc "select 1 from pg_roles where rolname='af'" | grep -q 1 ||
      runuser -u postgres -- psql -p 5433 -qc "CREATE ROLE af LOGIN SUPERUSER PASSWORD 'test'"
    runuser -u postgres -- psql -p 5433 -qtAc "select 1 from pg_database where datname='af_test'" | grep -q 1 ||
      runuser -u postgres -- psql -p 5433 -qc "CREATE DATABASE af_test OWNER af"
    # the cluster inherits the box's time zone; CI's and the image's Postgres run in UTC, and a date filter
    # test (partners › dates by year) fails around midnight otherwise — see docs/lessons.md
    runuser -u postgres -- psql -p 5433 -qc "ALTER DATABASE af_test SET timezone TO 'UTC'"
  fi
  for _ in $(seq 1 30); do psql "$MIG_URL" -tAc 'select 1' >/dev/null 2>&1 && { echo "  up"; return; }; sleep 1; done
  echo "postgres not reachable at $MIG_URL" >&2; return 1
}

# ── node_modules + the generated Prisma client (postinstall's `prisma generate` fails without the engine)
deps() {
  say "dependencies"
  if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 npm ci --ignore-scripts --no-audit --no-fund
  fi
  node scripts/copy-pdf-worker.mjs
  prisma generate >/dev/null && echo "  prisma client generated"
}

# ── .env.local (never committed; .gitignore has .env*)
env_local() {
  say ".env.local"
  if [ -f .env.local ]; then echo "  exists — left as is"; return; fi
  local chromium
  chromium=$(ls /opt/pw-browsers/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1 || true)
  cat >.env.local <<EOF
# written by scripts/dev-env.sh — one database (the test one, :5433) for the app, the tests and the e2e, like CI
DATABASE_URL=$APP_URL
DATABASE_MIGRATION_URL=$MIG_URL
DATABASE_TEST_URL=$APP_URL
DATABASE_TEST_MIGRATION_URL=$MIG_URL
AUTH_SECRET=$(openssl rand -base64 32)
AUTH_URL=http://localhost:$APP_PORT
AZURE_STORAGE_CONNECTION_STRING=$AZURITE_CONN
AZURE_STORAGE_CONTAINER=documents
AZURE_DI_ENDPOINT=
AZURE_DI_KEY=
NEXT_PUBLIC_SENTRY_DSN=
LOG_LEVEL=info
ECB_API_BASE_URL=https://data-api.ecb.europa.eu/service/data
${chromium:+CHROMIUM_PATH=$chromium}
EOF
  echo "  written"
}

# ── migrations: `prisma migrate deploy` when the engine is there, else each migration.sql by psql,
#    recorded in _prisma_migrations with Prisma's checksum so a later `migrate deploy` sees them as applied
migrate() {
  say "migrations"
  if engine_present && [ -z "${PRISMA_SCHEMA_ENGINE_BINARY:-}" ]; then
    DATABASE_URL=$MIG_URL DATABASE_MIGRATION_URL=$MIG_URL npx prisma migrate deploy
    return
  fi
  psql "$MIG_URL" -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);
SQL
  local applied=0 dir name sum
  for dir in prisma/migrations/*/; do
    name=$(basename "$dir")
    [ -f "$dir/migration.sql" ] || continue
    if [ "$(psql "$MIG_URL" -tAc "select count(*) from _prisma_migrations where migration_name='$name' and finished_at is not null and rolled_back_at is null")" != 0 ]; then
      continue
    fi
    sum=$(sha256sum "$dir/migration.sql" | cut -d' ' -f1)
    psql "$MIG_URL" -q -v ON_ERROR_STOP=1 -f "$dir/migration.sql" >/dev/null
    psql "$MIG_URL" -q -v ON_ERROR_STOP=1 -c "insert into _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) values (gen_random_uuid(), '$sum', now(), '$name', now(), 1)"
    echo "  applied $name"
    applied=$((applied + 1))
  done
  echo "  $applied new, $(psql "$MIG_URL" -tAc 'select count(*) from _prisma_migrations') in total"
}

# ── the seed runs as the migration role (it creates the tenant; the RLS app role cannot)
seed() {
  say "seed"
  DATABASE_URL=$MIG_URL npx tsx prisma/seed.ts
}

# ── Azurite (blob only) on :10000, the documents container, CORS for the PDF preview
azurite() {
  say "azurite :10000"
  if ! port_open 10000; then
    if docker_ok; then
      docker compose up -d azurite
    else
      setsid nohup npx --yes azurite@3 azurite-blob --blobHost 127.0.0.1 --blobPort 10000 \
        --location "$LOGS/azurite" --skipApiVersionCheck --loose >"$LOGS/azurite.log" 2>&1 </dev/null &
    fi
    wait_port 10000 90
  fi
  AZURE_STORAGE_CONNECTION_STRING=$AZURITE_CONN AZURE_STORAGE_CONTAINER=documents node -e "
    const { BlobServiceClient } = require('@azure/storage-blob');
    BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING)
      .getContainerClient(process.env.AZURE_STORAGE_CONTAINER).createIfNotExists()
      .then((r) => console.log('  container', r.succeeded ? 'created' : 'exists'))"
  npx tsx scripts/setup-azurite-cors.ts | sed 's/^/  /'
}

# ── Chromium for the e2e and the PDFs: cdn.playwright.dev is blocked; the image ships an older build in
#    /opt/pw-browsers — expose it under the revision this Playwright expects
chromium() {
  say "chromium"
  local want real dir
  for kind in chromium chromium-headless-shell; do
    # Playwright ≥1.6x no longer exports its registry: ask the CLI where the build goes (first "Install location")
    want=$(node -e "const {registry}=require('playwright-core/lib/server/registry/index');console.log(registry.findExecutable('$kind').executablePath())" 2>/dev/null) || {
      dir=$(npx playwright install --dry-run "$kind" | awk '/Install location/{print $3; exit}')
      if [ "$kind" = chromium ]; then want="$dir/chrome-linux64/chrome"; else want="$dir/chrome-headless-shell-linux64/chrome-headless-shell"; fi
    }
    if [ -x "$want" ]; then echo "  $kind ok"; continue; fi
    if [ "$kind" = chromium ]; then
      real=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome 2>/dev/null | sort -V | tail -1 || true)
    else
      # older images: chrome-linux/headless_shell; newer: chrome-headless-shell-linux64/chrome-headless-shell
      real=$(ls -d /opt/pw-browsers/chromium_headless_shell-*/chrome-linux*/*headless_shell \
        /opt/pw-browsers/chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell \
        2>/dev/null | sort -V | tail -1 || true)
    fi
    if [ -z "$real" ]; then
      npx playwright install "$kind" || echo "  no $kind — the e2e and real PDFs will not run" >&2
      continue
    fi
    dir=$(dirname "$want")
    mkdir -p "$dir" && ln -sf "$real" "$want"
    echo "  $kind → $real"
  done
}

# ── production build, like CI (no standalone); the system font stack (D40) — nothing to download
build() {
  say "build"
  NEXT_OUTPUT_STANDALONE=false npm run build >"$LOGS/build.log" 2>&1 || {
    tail -40 "$LOGS/build.log"
    return 1
  }
  tail -3 "$LOGS/build.log"
}

# ── next start on :3000 (detached; log in $LOGS/server.log); restarted when the build changed
start() {
  say "next start :$APP_PORT"
  [ -f .next/BUILD_ID ] || build
  if port_open "$APP_PORT"; then
    if [ "$(cat "$LOGS/server.build-id" 2>/dev/null)" = "$(cat .next/BUILD_ID)" ]; then echo "  already up"; return; fi
    echo "  new build — restarting"
    stop >/dev/null
    for _ in $(seq 1 20); do port_open "$APP_PORT" || break; sleep 0.5; done
  fi
  PORT=$APP_PORT HOSTNAME=localhost setsid nohup npx next start -p "$APP_PORT" >"$LOGS/server.log" 2>&1 </dev/null &
  npx wait-on "http://localhost:$APP_PORT" --timeout 60000 || { tail -40 "$LOGS/server.log"; return 1; }
  cp .next/BUILD_ID "$LOGS/server.build-id"
  echo "  up — log: $LOGS/server.log"
}

stop() {
  say "stop next start"
  # [n]: keeps pkill from matching a shell whose own command line holds the pattern
  pkill -f "[n]ext start -p $APP_PORT|[n]ext-server" && echo "  stopped" || echo "  not running"
  rm -f "$LOGS/server.build-id"
}

# ── empty what the e2e journeys leave behind, then seed again (roadmap: before every e2e run)
reset() {
  DATABASE_TEST_MIGRATION_URL=$MIG_URL scripts/reset-e2e-data.sh >/dev/null
  echo "  e2e data reset"
  seed
}

status() {
  say "status"
  psql "$MIG_URL" -tAc 'select 1' >/dev/null 2>&1 && echo "  postgres :5433   up" || echo "  postgres :5433   down"
  port_open 10000 && echo "  azurite  :10000  up" || echo "  azurite  :10000  down"
  port_open "$APP_PORT" && echo "  app      :$APP_PORT   up" || echo "  app      :$APP_PORT   down"
  engine_present && echo "  prisma engine    present" || echo "  prisma engine    missing — migrations by psql, tests with SKIP_MIGRATE_DEPLOY=1"
  [ -f .env.local ] && echo "  .env.local       present" || echo "  .env.local       missing"
  [ -f .next/BUILD_ID ] && echo "  build            $(cat .next/BUILD_ID)" || echo "  build            none"
}

up() { db; deps; env_local; migrate; seed; azurite; chromium; build; start; status; }

[ $# -eq 0 ] && set -- up
for step in "$@"; do
  case $step in
  up | db | deps | migrate | seed | azurite | chromium | build | start | stop | reset | status) "$step" ;;
  env) env_local ;;
  *) echo "unknown step: $step (see the header of $0)" >&2; exit 2 ;;
  esac
done

# Deployment

One image everywhere (constitution §1.8): the same `ghcr.io/zzkool/af` image runs on a laptop, on the homelab and on Azure; environment differences are env vars only; nothing assumes continuous uptime (§1.9 — the jobs queue lives in Postgres and resumes). This page is the runbook: what CI publishes, how the homelab runs it, how a backup is proven, and the Azure path for later.

## What CI publishes

`.github/workflows/publish.yml` — on every push to `main` and every `v*` tag — builds two images from the one `Dockerfile` and pushes them to GitHub's registry (no secrets: `GITHUB_TOKEN` with `packages: write`):

| image | stage | what |
|---|---|---|
| `ghcr.io/zzkool/af` | `runner` | Next.js standalone + the pg-boss worker + Chromium (PDFs); `/api/health` answers with the version |
| `ghcr.io/zzkool/af-migrate` | `migrate` | the Prisma CLI + `prisma/migrations`, one shot: `prisma migrate deploy` as the migration role |

Tags: `main` (moving, the latest main), `sha-<12 chars>` (every build), `v1.2.3` (a release tag). The homelab **pulls, never builds**; `AF_TAG` pins what runs.

The runtime image carries no Prisma CLI and no migrations engine — the app never migrates itself. Migrations run as a separate one-shot container before the app (compose: `migrate` → `app` with `condition: service_completed_successfully`); on Azure the same image is a job run before the revision switches.

## The homelab (production)

Any Linux box with Docker. The first time:

```bash
sudo mkdir -p /opt/af && cd /opt/af
git clone https://github.com/zzKool/af.git .           # the compose file, the scripts, the Caddyfile example
cp .env.prod.example .env.prod && $EDITOR .env.prod      # secrets: POSTGRES_PASSWORD, AF_APP_PASSWORD (+ DATABASE_URL), AUTH_SECRET, AUTH_URL, DI keys
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d          # db → migrate (exits 0) → app; azurite as blob storage
curl -s localhost:3000/api/health                        # {"status":"ok","db":"ok","jobs":"enabled","version":"sha-…"}
```

Then the first user: with `AUTH_SIGNUP` unset, register on `/register` (the first account becomes the owner of its tenant). **Then close the box**: `AUTH_SIGNUP=closed` in `.env.prod` and `docker compose -f docker-compose.prod.yml up -d app` — from then on `/register` is a 404, Better Auth refuses sign-ups and new organisations, and the login page shows no *create an account* (D61, F105). A second user (the accountant, F03) is added by the admin CLI when it exists (F112), never by reopening sign-up. Seed data (`prisma/seed.ts`) is for development only — never run it against production.

The app role's password: the migrations create `af_app` with the password `app`; the migrate container then runs `scripts/set-app-password.mjs`, which sets it to `AF_APP_PASSWORD` from `.env.prod` — so `DATABASE_URL` must carry the same value. Changing it is editing both lines and `up -d` (migrate runs again, the app restarts with the new URL).

**TLS and the name**: `deploy/Caddyfile.example` → `deploy/Caddyfile` with the real host; Caddy gets the certificate from Let's Encrypt by itself and proxies to `127.0.0.1:3000`. `AUTH_URL` must be that public address (Better Auth validates origins). Keep `AF_PORT` bound to localhost behind the proxy (`AF_PORT=127.0.0.1:3000` in `.env`).

**Update** (after CI published a new `main`):

```bash
cd /opt/af && git pull                                   # only when the compose file or the scripts changed
AF_TAG=sha-abc123def456 docker compose -f docker-compose.prod.yml pull   # or AF_TAG=main
AF_TAG=sha-abc123def456 docker compose -f docker-compose.prod.yml up -d  # migrate runs, then the app restarts
```

Put `AF_TAG` in a file named **`.env`** next to the compose file to make it stick — not in `.env.prod`: compose chooses images and ports from `.env` (interpolation), `.env.prod` only reaches the containers (`env_file`). The same goes for `AF_PORT`: `AF_PORT=127.0.0.1:3000` in `.env` keeps the app off the local network behind a proxy; in `.env.prod` it is ignored and the port binds on every interface. Check with `docker compose -f docker-compose.prod.yml config`. Before an update, snapshot the host or VM: a new image may migrate the database, so rolling back means restoring the snapshot, not only the tag. A migration that fails leaves the app on the previous image (the `migrate` container exits non-zero and `app` does not start) — fix forward or roll `AF_TAG` back.

**Backups** (constitution §7: financial records survive the host): `scripts/backup.sh` nightly from cron — a `pg_dump` custom-format dump plus the blob volume as a tarball, kept 30 days, copied off-host when `BACKUP_OFFSITE` points at a mounted remote (a NAS share, an rclone mount, an Azure Blob container mounted with blobfuse):

```
0 3 * * * BACKUP_OFFSITE=/mnt/nas/af /opt/af/scripts/backup.sh >> /var/log/af-backup.log 2>&1
```

**Proving a backup** — a backup that was never restored is a hope. Once a quarter, on a second checkout with its own project name and volumes:

```bash
git clone https://github.com/zzKool/af.git /opt/af-restore-test && cd /opt/af-restore-test
cp /opt/af/.env.prod .env.prod && sed -i 's/^AF_PORT=.*/AF_PORT=127.0.0.1:3100/' .env.prod
docker compose -p af-restore-test -f docker-compose.prod.yml up -d db azurite
COMPOSE_PROJECT_NAME=af-restore-test ./scripts/restore.sh /mnt/nas/af/db-<stamp>.dump /mnt/nas/af/blobs-<stamp>.tgz
curl -s localhost:3100/api/health                        # then log in and open last month's package
docker compose -p af-restore-test -f docker-compose.prod.yml down -v
```

`scripts/restore.sh` stops the app, restores the dump into a fresh database and swaps it in, replaces the blob volume's data, starts the app (migrations run first) and calls the health endpoint.

**Monitoring**: the container's `HEALTHCHECK` is `/api/health` (database round trip, jobs state, version, uptime); `restart: unless-stopped` brings the app back after a reboot; Sentry stays **off** on the owner's box (D51 — `NEXT_PUBLIC_SENTRY_DSN` empty); the logs are JSON on stdout (`docker compose logs -f app`, `LOG_LEVEL`).

**Azure Document Intelligence** is the one cloud dependency of the homelab stack (OCR): `AZURE_DI_ENDPOINT` / `AZURE_DI_KEY` (F0 free tier, 500 pages a month). Without them the mock OCR runs — fine for a trial, not for real receipts.

## Azure (later, scale to zero)

The same two images, the same env vars. Resources, one resource group `af-prod` in `swedencentral`:

| resource | SKU | role | ≈ €/month |
|---|---|---|---|
| Container Apps environment + app `af` | consumption, min replicas 0, max 1, 0.5 vCPU / 1 GiB | the app image; ingress on 3000; secrets as env | 0–5 (scale to zero; a cold start is ~10 s) |
| Container Apps job `af-migrate` | consumption, manual trigger | the migrate image, run before each revision | ~0 |
| Azure Database for PostgreSQL Flexible Server | B1ms burstable, 32 GiB, 7-day backups | `DATABASE_URL` (app role) / `DATABASE_MIGRATION_URL` (admin) | ~14 |
| Storage account | Standard LRS, one private container `documents` | `AZURE_STORAGE_CONNECTION_STRING` + `AZURE_STORAGE_CONTAINER` (replaces Azurite — the two env vars) | ~1 |
| Document Intelligence | F0 | OCR | 0 |
| Container Registry | none — pull from `ghcr.io` with a registry secret (a GitHub PAT with `read:packages`) | | 0 |

Total ≈ €17–20 a month, the figure of phase-0. The pg-boss worker runs inside the single replica; with min replicas 0 the queue resumes on the next request (constitution §1.9 — the ECB sync's missed occurrences are caught up `once`).

Deploy = the CI `deploy` job (`ci.yml`, currently `if: false`): run the migrate job with the new tag, then `az containerapp update --image ghcr.io/zzkool/af:sha-…`. Enable it once the resources exist and the secrets (`AZURE_CREDENTIALS`, the registry secret) are in the repository's `production` environment. Backups: the server's own PITR (7 days) plus the same `backup.sh` idea against the storage account (`az storage blob download-batch`) from the homelab, so the two sites back each other up.

Nothing in the code knows which site it is on — the Azurite connection string becomes the storage account's, `DATABASE_URL` becomes the server's; that is the whole migration.

## Related

- [[docker-compose]] — the dev stack and the prod stack side by side
- [[ci-cd]] — the pipeline, the e2e gate, the publish workflow
- [[environment-variables]] — every variable and its purpose
- [[verify-gate]] — what runs before a merge

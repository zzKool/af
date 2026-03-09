# Local Environment Setup

How to set up and verify the local development environment for DefterFab.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | v24.x LTS | Runtime for Next.js |
| Docker Desktop | 28.x+ | Container runtime for local services |
| Git | Any recent | Version control |

## Services Overview

The [[docker-compose]] configuration provides three services:

- **db-dev** — PostgreSQL 17 development database on port 5432
- **db-test** — PostgreSQL 17 test database on port 5433 (used by Vitest integration tests)
- **azurite** — Azure Storage emulator on ports 10000 (blob), 10001 (queue), 10002 (table)

Next.js runs locally (not in Docker) via `npm run dev`.

## Setup Steps

1. Clone the repo and switch to `develop` branch
2. Copy `.env.example` to `.env.local`
3. Run `docker compose up -d` to start all services
4. Verify connectivity using commands in the [[docker-compose]] section of README

## Environment Variables

See [[environment-variables]] for the full list. The `.env.example` file contains all required variables with local development defaults pre-filled, including the well-known Azurite connection string.

## Troubleshooting

- **Port conflict on 5432:** Another PostgreSQL instance may be running. Stop it or change the host port in `docker-compose.yml`.
- **Azurite returns 403:** This is expected for unauthenticated container listing requests. The service is running correctly.
- **Docker not found:** Ensure Docker Desktop is installed and running. Verify with `docker compose version`.

# Jungle Wagering Processor

A local evaluation implementation of a wagering and wallet processor built with **Bun**, **TypeScript**, **NestJS**, **PostgreSQL**, **MikroORM**, and **LocalStack SQS**.

The project exposes an HTTP API for wallet and wagering operations. Two separate background processes handle asynchronous messaging: an SQS worker for wagering requests and an Outbox publisher for processed-transaction events.

> This repository is intended for local evaluation. Authentication and provider-level authorization are not implemented; do not expose the services to an untrusted network.

## Contents

- [Requirements](#requirements)
- [Run on Windows](#run-on-windows)
- [Run with Docker Compose](#run-with-docker-compose)
- [Services and URLs](#services-and-urls)
- [Environment configuration](#environment-configuration)
- [Try the API](#try-the-api)
- [HTTP endpoints](#http-endpoints)
- [Transaction rules](#transaction-rules)
- [Asynchronous processing](#asynchronous-processing)
- [Tests and validation](#tests-and-validation)
- [Stopping and resetting the environment](#stopping-and-resetting-the-environment)
- [Known limitations](#known-limitations)

## Requirements

For the provided Windows startup scripts:

- Windows 10/11.
- [Bun 1.x](https://bun.sh/).
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) using the Linux container engine.
- Internet access in the browser to load Swagger UI assets from the unpkg CDN.

Check the tools in PowerShell:

```powershell
bun --version
docker --version
docker compose version
```

Start Docker Desktop and wait until the Docker Engine is running before starting the project.

## Run on Windows

1. Extract the project to a local folder.
2. Open Docker Desktop and wait for it to finish starting.
3. Open the project folder in File Explorer.
4. Double-click `INICIAR.bat`.

The script checks Bun and Docker, creates `.env` from `.env.example` if `.env` does not exist, installs dependencies, builds and starts the Docker Compose services, waits for the API readiness endpoint, and opens Swagger UI.

The first run may take a few minutes while dependencies and Docker images are downloaded.

To follow the logs, double-click `LOGS.bat`. To stop the containers, double-click `PARAR.bat`.

## Run with Docker Compose

Run the following commands from the project root.

Create the local environment file if it does not exist:

```powershell
Copy-Item .env.example .env
```

Install dependencies on the host (useful for running tests and TypeScript checks):

```powershell
bun install
```

Build and start the services:

```powershell
docker compose up --build -d
```

Check service status:

```powershell
docker compose ps
```

Check the API:

```powershell
Invoke-RestMethod http://localhost:3000/health/ready
```

Expected response:

```json
{
  "status": "ok",
  "database": "connected"
}
```

Open the interactive API documentation:

- Swagger UI: <http://localhost:3000/docs>
- OpenAPI document: <http://localhost:3000/openapi.json>

Useful log commands:

```powershell
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f publisher
docker compose logs -f postgres
docker compose logs -f localstack
```

## Services and URLs

| Service | Local address / role |
|---|---|
| API | `http://localhost:3000` |
| Swagger UI | `http://localhost:3000/docs` |
| OpenAPI JSON | `http://localhost:3000/openapi.json` |
| API liveness | `http://localhost:3000/health/live` |
| API readiness | `http://localhost:3000/health/ready` |
| PostgreSQL | `localhost:5432` |
| LocalStack (SQS) | `http://localhost:4566` |

Docker Compose starts these containers:

| Container service | Responsibility |
|---|---|
| `postgres` | Persistent PostgreSQL database (`postgres_data` volume) |
| `localstack` | Local SQS queues |
| `migrate` | Applies SQL migrations before application services start |
| `api` | NestJS HTTP API |
| `worker` | Consumes wagering request messages from SQS |
| `publisher` | Publishes committed Outbox events to the SQS events queue |

The local SQS queues are:

- `wager-transactions.fifo` — incoming wagering requests.
- `wager-transactions-dlq.fifo` — dead-letter queue configured for the wagering request queue after repeated receives.
- `wager-events.fifo` — events published by the Outbox publisher.

Swagger UI loads its CSS and JavaScript from the unpkg CDN. The OpenAPI JSON itself is served by this application.

## Environment configuration

`.env.example` contains the local Docker Compose configuration. Copy it to `.env` before starting the stack:

```powershell
Copy-Item .env.example .env
```

The variables are:

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port used by the API container |
| `DATABASE_URL` | PostgreSQL connection string used by the application containers |
| `AWS_REGION` | AWS SDK region for LocalStack |
| `AWS_ACCESS_KEY_ID` | LocalStack development access key |
| `AWS_SECRET_ACCESS_KEY` | LocalStack development secret key |
| `SQS_ENDPOINT` | LocalStack endpoint used by the worker and publisher |
| `SQS_QUEUE_URL` | Wagering request FIFO queue consumed by the worker |
| `SQS_EVENTS_QUEUE_URL` | FIFO events queue used by the Outbox publisher |

The credentials in `.env.example` are local development placeholders for LocalStack, not production AWS credentials. The PostgreSQL host in `DATABASE_URL` is `postgres`, which is the Docker Compose service name; do not change it to `localhost` when running the application inside Compose.

The PostgreSQL database name, user, password and published host port are currently defined directly in `docker-compose.yml`. If you change those values, update `DATABASE_URL` to match.

Keep `.env` private. It is excluded by `.gitignore` and should not be included in a source-code delivery archive.

## Try the API

### 1. Create a wallet

In Swagger UI, expand **POST `/wallets`**, choose **Try it out**, and submit:

```json
{
  "playerId": "player-1001",
  "initialBalance": {
    "amount": "100.00",
    "currency": "BRL"
  }
}
```

Copy the `id` from the response. It is the `walletId` required by wagering requests.

A wallet is unique by `(playerId, currency)`. A non-zero initial balance also creates an internal `OPENING` transaction and an initial credit in the wallet ledger.

### 2. Submit a BET

Expand **POST `/wagering/transactions`** and use this example, replacing `walletId` with the ID returned above:

```json
{
  "providerId": "provider-a",
  "externalTransactionId": "bet-0001",
  "playerId": "player-1001",
  "walletId": "REPLACE_WITH_WALLET_ID",
  "roundId": "round-01",
  "gameId": "game-01",
  "kind": "BET",
  "money": {
    "amount": "10.00",
    "currency": "BRL"
  }
}
```

Add the required `Idempotency-Key` header, for example:

```text
provider-a:bet-0001
```

A successful BET debits the wallet and creates a ledger entry.

### 3. Inspect the result

Use the wallet ID and transaction ID to call:

- `GET /wallets/{id}` — current wallet balance and version.
- `GET /wallets/{id}/ledger` — ledger entries.
- `POST /wallets/{id}/reconciliation` — compares the stored balance with the balance calculated from ledger entries.
- `GET /wagering/transactions/{id}` — transaction status.
- `GET /providers/{providerId}/wagering/transactions/{externalId}` — lookup by provider reference.

The Swagger document includes request examples for BET, WIN, LOSS, REFUND and ROLLBACK.

## HTTP endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health/live` | Liveness probe |
| `GET` | `/health/ready` | Readiness probe; checks the database connection |
| `POST` | `/wallets` | Create a wallet |
| `GET` | `/wallets/{id}` | Retrieve a wallet and current balance |
| `GET` | `/wallets/{id}/ledger?limit=50` | List ledger entries (limit is bounded to 1–100; default 50) |
| `POST` | `/wallets/{id}/reconciliation` | Reconcile the wallet balance against ledger entries |
| `POST` | `/wagering/transactions` | Submit a wagering transaction; requires `Idempotency-Key` |
| `GET` | `/wagering/transactions/{id}` | Retrieve a transaction by internal ID |
| `GET` | `/providers/{providerId}/wagering/transactions/{externalId}` | Retrieve a transaction by provider and external IDs |

### Money format

All monetary `amount` values must be JSON strings with exactly two decimal places:

```json
{
  "amount": "10.00",
  "currency": "BRL"
}
```

Do not send a JSON number such as `10` or `10.00`. The currency must be a three-letter uppercase code.

## Transaction rules

Supported externally submitted transaction kinds:

| Kind | Balance behavior |
|---|---|
| `BET` | Debits the wallet if sufficient funds are available; otherwise records `REJECTED` with `INSUFFICIENT_FUNDS`. |
| `WIN` | Credits the wallet. |
| `LOSS` | Must have amount `0.00`; records the transaction without changing the wallet balance. |
| `REFUND` | Requires a reference to a previously processed BET and credits the wallet. |
| `ROLLBACK` | Requires a reference to a previously processed BET, WIN or REFUND and reverses the referenced amount according to the referenced operation. |

`OPENING` is an internal transaction kind created when a wallet is initialized with a non-zero balance. It cannot be submitted through the wagering endpoint.

Additional rules:

- `Idempotency-Key` is required and has a maximum length of 200 characters.
- Reusing the same provider and idempotency key with the same business payload returns the original transaction result.
- Reusing an idempotency key with a different business payload returns a conflict.
- `externalTransactionId` must be unique per provider.
- The player and wallet must match, and the transaction currency must match the wallet currency.
- REFUND and ROLLBACK require `referenceExternalTransactionId`.
- A missing reversal reference is stored with status `PENDING_REFERENCE`. Automatic retry scheduling for this state is not implemented.
- Business-rule rejections such as insufficient funds are represented in the transaction response and persisted as transaction records.

## Asynchronous processing

### Wagering request worker

The `worker` service continuously polls `wager-transactions.fifo` for messages. It expects an envelope with this shape:

```json
{
  "type": "WagerTransactionRequested",
  "id": "message-unique-id",
  "data": {
    "kind": "LOSS",
    "money": {
      "amount": "0.00",
      "currency": "BRL"
    },
    "providerId": "provider-a",
    "externalTransactionId": "loss-0001",
    "walletId": "WALLET_UUID",
    "playerId": "player-1001",
    "roundId": "round-01",
    "gameId": "game-01",
    "idempotencyKey": "provider-a:loss-0001"
  }
}
```

The worker passes the message data to the same wagering service used by the HTTP API. The Inbox record is written in the same database transaction as the financial operation. The SQS message is deleted only after the service completes successfully. A repeated message ID with the same payload is ignored; reusing the same message ID with a different payload is rejected.

The queue is configured with a dead-letter queue and a redrive policy. Actual redelivery and DLQ behavior should be validated in an integration environment before relying on it operationally.

### Outbox publisher

The API writes a `WagerTransactionProcessed` event to `outbox_messages` in the same database transaction as the wagering result. The `publisher` service reserves pending rows using PostgreSQL row locking (`FOR UPDATE SKIP LOCKED`), publishes them to `wager-events.fifo`, and marks successful publications. Publish failures increment the attempt count and schedule a retry with a bounded delay.

The Outbox publisher sends events; this project does not include a separate consumer for `wager-events.fifo`.

## Tests and validation

Run the automated tests:

```powershell
bun test
```

Run the TypeScript compiler check:

```powershell
bunx tsc --noEmit
```

The current automated test file contains two unit-level checks covering decimal arithmetic and a simplified concurrent-debit condition. These are not end-to-end or database concurrency integration tests.

For local manual inspection, use the Docker Compose logs and Swagger endpoints described above. The API, worker, publisher and database should be checked independently.

## Stopping and resetting the environment

Stop and remove the containers while preserving the named PostgreSQL volume:

```powershell
docker compose down
```

Or use `PARAR.bat`.

To start again:

```powershell
docker compose up --build -d
```

**Warning:** the following command deletes the PostgreSQL data volume and all local database data:

```powershell
docker compose down -v
```

The migration-down script is also destructive: it drops the project tables and trigger/function objects. Do not run it against data you need to keep.

## Known limitations

- OIDC/authentication and provider-level authorization/isolation are not implemented. The API trusts `providerId` supplied in the request body; this is not suitable for an exposed production API.
- `PENDING_REFERENCE` records are persisted, but automatic retry scheduling, backoff and TTL are not implemented.
- Ledger pagination uses a bounded `limit`; opaque cursor pagination is not implemented.
- Automated integration tests for multi-instance concurrency, process crashes, SQS redelivery after a crash, and DLQ behavior are still required.
- Messaging is designed for at-least-once delivery with database-backed deduplication. It does not claim end-to-end exactly-once delivery.
- The project is an evaluation implementation and is not represented as production-ready.

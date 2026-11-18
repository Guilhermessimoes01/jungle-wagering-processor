# Architecture & engineering decisions

## Runtime and boundaries

- Bun 1.x executes NestJS and scripts.
- NestJS exposes the HTTP API. The SQS worker is a separate process (`src/worker.ts`) and reuses the wagering application service.
- PostgreSQL is the source of truth. LocalStack provides SQS in the local Docker Compose environment.
- MikroORM/PostgreSQL provides the connection and `EntityManager.transactional`; explicit SQL is used where constraints, locks and atomicity need to remain visible.
- OpenAPI 3.0 is served from `/openapi.json`; Swagger UI is available at `/docs`. The specification is maintained in `src/openapi.ts` without adding a runtime dependency. Swagger UI browser assets are loaded from unpkg CDN.

## Financial correctness

- HTTP money values arrive as strings with two decimal places. `Decimal.js` performs arithmetic; JavaScript `number` is not used for financial calculations.
- `wallets.balance` is `numeric(20,2)` with `CHECK(balance >= 0)`.
- `wallets` has uniqueness `(player_id,currency)`.
- Each financial operation locks the wallet with `SELECT ... FOR UPDATE` inside a SQL transaction. This serializes writers for that wallet across processes.
- Ledger is append-only: `UNIQUE(wallet_id,transaction_id)`, validation of `balance_before/after` and a trigger rejecting UPDATE/DELETE.
- Idempotency is persisted by `(provider_id,idempotency_key)`; `(provider_id,external_transaction_id)` is also unique.

## Reversals and ordering

REFUND references BET; ROLLBACK references BET/WIN/REFUND. The reference must be processed and match player, wallet, round, currency and amount. A missing reference is stored as `PENDING_REFERENCE`, but automatic retry scheduling with backoff/TTL is not implemented. Duplicate reversal protection is enforced in the transaction flow.

## Events

Financial decisions write an Outbox event in the same database transaction. The publisher reserves pending rows using `SKIP LOCKED`, publishes to the LocalStack FIFO events queue, marks successful publications and schedules retry/backoff after publish failures. The SQS worker consumes wagering request messages and calls the same application service. Inbox message ID and payload hash are persisted transactionally with the financial operation; the worker deletes the SQS message only after the service returns successfully.

The design targets at-least-once delivery with durable deduplication. It does not promise exactly-once delivery across PostgreSQL and SQS. Automated crash/recovery, multi-instance and DLQ integration tests remain necessary.

## Authentication and security

The challenge permits authentication to be left unimplemented if documented and an extension point exists. This version does not implement OIDC on business endpoints. Run only in a local evaluation environment; do not expose the API to an untrusted network. A future implementation can use Keycloak/OIDC/JWKS, a NestJS guard, derive `providerId` from the authenticated principal (never trust it from the request body), and enforce provider-level authorization. Health endpoints remain public. Local secrets belong in `.env`, which is excluded from version control and the delivery archive.

## Operational limits

Docker Compose starts PostgreSQL, LocalStack, migration, API, worker and Outbox publisher. `PENDING_REFERENCE` retry/backoff/TTL, opaque ledger cursor pagination, OIDC/provider isolation and automated distributed failure tests are outstanding. Do not describe this evaluation implementation as production-ready.

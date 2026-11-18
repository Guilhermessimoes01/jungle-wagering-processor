CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE wallets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id varchar(128) NOT NULL,
 currency char(3) NOT NULL, balance numeric(20,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
 version bigint NOT NULL DEFAULT 1 CHECK (version >= 1), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(player_id,currency)
);
CREATE TABLE wager_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id varchar(128) NOT NULL,
 external_transaction_id varchar(128) NOT NULL, idempotency_key varchar(200) NOT NULL,
 payload_hash char(64) NOT NULL, wallet_id uuid NOT NULL REFERENCES wallets(id), player_id varchar(128) NOT NULL,
 round_id varchar(128) NOT NULL, game_id varchar(128) NOT NULL,
 kind varchar(16) NOT NULL CHECK (kind IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
 amount numeric(20,2) NOT NULL CHECK(amount >= 0), currency char(3) NOT NULL,
 reference_external_transaction_id varchar(128), reference_transaction_id uuid REFERENCES wager_transactions(id),
 status varchar(24) NOT NULL CHECK(status IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
 failure_code varchar(64), balance_after numeric(20,2), created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
 UNIQUE(provider_id,external_transaction_id), UNIQUE(provider_id,idempotency_key)
);
CREATE INDEX wager_reference_idx ON wager_transactions(provider_id, external_transaction_id);
CREATE INDEX wager_wallet_idx ON wager_transactions(wallet_id, created_at DESC);
CREATE TABLE wallet_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid NOT NULL REFERENCES wallets(id),
 transaction_id uuid NOT NULL REFERENCES wager_transactions(id), direction varchar(8) NOT NULL CHECK(direction IN ('DEBIT','CREDIT')),
 amount numeric(20,2) NOT NULL CHECK(amount > 0), currency char(3) NOT NULL,
 balance_before numeric(20,2) NOT NULL CHECK(balance_before >= 0), balance_after numeric(20,2) NOT NULL CHECK(balance_after >= 0),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(wallet_id,transaction_id), CHECK(balance_after = CASE WHEN direction='CREDIT' THEN balance_before+amount ELSE balance_before-amount END)
);
CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'wallet_ledger is append-only'; END $$;
CREATE TRIGGER wallet_ledger_immutable BEFORE UPDATE OR DELETE ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TABLE inbox_messages (consumer_name varchar(100) NOT NULL, message_id varchar(200) NOT NULL, payload_hash char(64) NOT NULL, processed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(consumer_name,message_id));
CREATE TABLE outbox_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), aggregate_id uuid NOT NULL, event_type varchar(100) NOT NULL, payload jsonb NOT NULL, attempts int NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), locked_by uuid, locked_until timestamptz, published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX outbox_pending_idx ON outbox_messages(next_attempt_at) WHERE published_at IS NULL;

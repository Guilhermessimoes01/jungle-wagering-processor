DROP TABLE IF EXISTS outbox_messages, inbox_messages, wallet_ledger, wager_transactions, wallets CASCADE;
DROP FUNCTION IF EXISTS prevent_ledger_mutation();

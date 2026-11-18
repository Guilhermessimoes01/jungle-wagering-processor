ALTER TABLE outbox_messages
ADD COLUMN IF NOT EXISTS locked_by uuid;

ALTER TABLE outbox_messages
ADD COLUMN IF NOT EXISTS locked_until timestamptz;
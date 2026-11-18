import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  SQSClient,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { database } from './db';

const endpoint = process.env.SQS_ENDPOINT ?? 'http://localhost:4566';
const queueUrl = process.env.SQS_EVENTS_QUEUE_URL;

if (!queueUrl) {
  throw new Error('SQS_EVENTS_QUEUE_URL is not configured');
}

const sqs = new SQSClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
  },
});

const publisherId = randomUUID();
const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

type OutboxEvent = {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
};

async function reserveBatch(): Promise<OutboxEvent[]> {
  const orm = await database();

  return orm.em.transactional(async (em) => {
    return em.getConnection().execute<OutboxEvent[]>(
      `WITH candidates AS (
         SELECT id
         FROM outbox_messages
         WHERE published_at IS NULL
           AND next_attempt_at <= now()
           AND (locked_until IS NULL OR locked_until < now())
         ORDER BY created_at
         LIMIT 10
         FOR UPDATE SKIP LOCKED
       )
       UPDATE outbox_messages AS o
       SET locked_by = ?,
           locked_until = now() + interval '2 minutes'
       FROM candidates
       WHERE o.id = candidates.id
       RETURNING o.id, o.aggregate_id, o.event_type, o.payload, o.attempts`,
      [publisherId],
    );
  });
}

async function publishEvent(event: OutboxEvent): Promise<void> {
  const orm = await database();

  try {
    await sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        id: event.id,
        type: event.event_type,
        data: event.payload,
      }),
      MessageGroupId: event.aggregate_id,
      MessageDeduplicationId: event.id,
    }));

    await orm.em.getConnection().execute(
      `UPDATE outbox_messages
       SET published_at = now(),
           locked_by = NULL,
           locked_until = NULL
       WHERE id = ? AND locked_by = ? AND published_at IS NULL`,
      [event.id, publisherId],
    );

    console.log(`Published outbox event: ${event.id}`);
  } catch (error) {
    const delaySeconds = Math.min(
      300,
      2 ** Math.min(event.attempts + 1, 8),
    );

    await orm.em.getConnection().execute(
      `UPDATE outbox_messages
       SET attempts = attempts + 1,
           next_attempt_at = now() + (? * interval '1 second'),
           locked_by = NULL,
           locked_until = NULL
       WHERE id = ? AND locked_by = ? AND published_at IS NULL`,
      [delaySeconds, event.id, publisherId],
    );

    console.error(`Failed to publish event ${event.id}:`, error);
  }
}

await database();
console.log(`Outbox publisher started: ${publisherId}`);

while (true) {
  try {
    const events = await reserveBatch();

    for (const event of events) {
      await publishEvent(event);
    }
  } catch (error) {
    console.error('Outbox publisher batch failed:', error);
  }

  await sleep(1000);
}

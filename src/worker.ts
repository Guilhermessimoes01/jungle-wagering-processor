
import 'reflect-metadata';

import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';

import { createHash } from 'node:crypto';
import { database } from './db';
import { WageringService } from './wagering.service';

const endpoint =
  process.env.SQS_ENDPOINT ?? 'http://localhost:4566';

const queue =
  process.env.SQS_QUEUE_URL ??
  `${endpoint}/000000000000/wager-transactions.fifo`;

const sqs = new SQSClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
  },
});

const service = new WageringService();

await database();

console.log('SQS worker started');

while (true) {
  const batch = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: queue,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 45,
      AttributeNames: ['All'],
    }),
  );

  for (const msg of batch.Messages ?? []) {
    try {
      const rawBody = msg.Body ?? '{}';
      const parsed = JSON.parse(rawBody);

      if (parsed.type !== 'WagerTransactionRequested') {
        throw new Error('Unsupported message type');
      }

      if (typeof parsed.id !== 'string' || !parsed.id.trim()) {
        throw new Error('Message ID missing');
      }

      if (!parsed.data || typeof parsed.data !== 'object') {
        throw new Error('Message data missing or invalid');
      }

      const data = parsed.data;

      const payloadHash = createHash('sha256')
        .update(rawBody)
        .digest('hex');

      const result = await service.submit(
        data,
        data.idempotencyKey,
        {
          consumerName: 'wager-transactions-worker',
          messageId: parsed.id,
          payloadHash,
        },
      );

      if (result && 'duplicateMessage' in result && result.duplicateMessage) {
        console.log(`Duplicate message ignored: ${parsed.id}`);
      } else {
        console.log(`Message processed: ${parsed.id}`);
      }

      // A mensagem só é removida da fila depois que a transação
      // financeira e o registro na Inbox foram confirmados.
      if (msg.ReceiptHandle) {
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: queue,
            ReceiptHandle: msg.ReceiptHandle,
          }),
        );
      }
    } catch (e) {
      console.error(
        'Message processing failed; message will be retried/DLQ by redrive policy',
        e,
      );
    }
  }
}

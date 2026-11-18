import { database, query } from '../src/db';
import { readFile } from 'node:fs/promises';

const direction = process.argv[2] ?? 'up';
const orm = await database();

try {
  if (direction === 'up') {
    const rows = await query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'wallets'
      ) AS exists
    `);

    if (!rows[0]?.exists) {
      const sql = await readFile(
        new URL('../migrations/001_init.sql', import.meta.url),
        'utf8'
      );
      await query(sql);
      console.log('Migration 001: OK');
    } else {
      console.log('Migration 001: já aplicada.');
    }

    const outboxSql = await readFile(
      new URL('../migrations/002_outbox_locking.sql', import.meta.url),
      'utf8'
    );

    await query(outboxSql);
    console.log('Migration 002: OK');
  } else if (direction === 'down') {
    const sql = await readFile(
      new URL('../migrations/001_down.sql', import.meta.url),
      'utf8'
    );
    await query(sql);
    console.log('Migration down: OK');
  } else {
    throw new Error('Use up ou down');
  }
} finally {
  await orm.close(true);
}
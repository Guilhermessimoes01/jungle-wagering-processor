
import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { database } from './db';
import { createHash, randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';

const canonical = (v: any): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
      : JSON.stringify(v);

const hash = (v: any) =>
  createHash('sha256').update(canonical(v)).digest('hex');

const money = (v: any, allowZero = false) => {
  if (
    !v ||
    typeof v.amount !== 'string' ||
    !/^(0|[1-9]\d*)\.\d{2}$/.test(v.amount) ||
    (!allowZero && v.amount === '0.00') ||
    typeof v.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(v.currency)
  ) {
    throw new BadRequestException(
      'money inválido; use amount decimal string com 2 casas e currency ISO-4217',
    );
  }
  return v;
};

@Injectable()
export class WageringService {
  async createWallet(body: any) {
    if (!body?.playerId || typeof body.playerId !== 'string') {
      throw new BadRequestException('playerId obrigatório');
    }

    const initial = money(body.initialBalance, true);
    const orm = await database();

    try {
      return await orm.em.transactional(async em => {
        const id = randomUUID();

        await em.getConnection().execute(
          'INSERT INTO wallets(id,player_id,currency,balance,version) VALUES(?,?,?,?,1)',
          [id, body.playerId, initial.currency, initial.amount],
        );

        const wallet = {
          id,
          playerId: body.playerId,
          balance: initial,
          version: 1,
        };

        if (initial.amount !== '0.00') {
          const txId = randomUUID();

          await em.getConnection().execute(
            `INSERT INTO wager_transactions(
              id,provider_id,external_transaction_id,idempotency_key,
              payload_hash,wallet_id,player_id,round_id,game_id,
              kind,amount,currency,status,balance_after,processed_at
            )
            VALUES(?,?,?,?,?,?,?,?,?,'OPENING',?,?, 'PROCESSED',?,now())`,
            [
              txId,
              '__internal__',
              `opening:${id}`,
              `opening:${id}`,
              hash(wallet),
              id,
              body.playerId,
              '__opening__',
              '__system__',
              initial.amount,
              initial.currency,
              initial.amount,
            ],
          );

          await em.getConnection().execute(
            `INSERT INTO wallet_ledger(
              wallet_id,transaction_id,direction,amount,
              currency,balance_before,balance_after
            ) VALUES(?,?,'CREDIT',?,?,0,?)`,
            [id, txId, initial.amount, initial.currency, initial.amount],
          );
        }

        return wallet;
      });
    } catch (e: any) {
      if (String(e?.message).includes('unique')) {
        throw new ConflictException(
          'Já existe wallet para playerId e currency',
        );
      }
      throw e;
    }
  }

  async submit(
    body: any,
    idempotencyKey?: string,
    inbox?: {
      consumerName: string;
      messageId: string;
      payloadHash: string;
    },
  ) {
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new BadRequestException(
        'Header Idempotency-Key obrigatório (máximo 200 caracteres)',
      );
    }

    const allowed = ['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'];

    if (!body || !allowed.includes(body.kind)) {
      throw new BadRequestException('kind inválido; OPENING é interno');
    }

    const m = money(body.money, body.kind === 'LOSS');

    for (const k of [
      'providerId',
      'externalTransactionId',
      'walletId',
      'playerId',
      'roundId',
      'gameId',
    ]) {
      if (typeof body[k] !== 'string' || !body[k]) {
        throw new BadRequestException(`${k} obrigatório`);
      }
    }

    if (
      ['REFUND', 'ROLLBACK'].includes(body.kind) &&
      !body.referenceExternalTransactionId
    ) {
      throw new BadRequestException(
        'referenceExternalTransactionId obrigatório',
      );
    }

    if (body.kind === 'LOSS' && m.amount !== '0.00') {
      throw new BadRequestException('LOSS exige amount 0.00');
    }

    const business = {
      providerId: body.providerId,
      externalTransactionId: body.externalTransactionId,
      walletId: body.walletId,
      playerId: body.playerId,
      roundId: body.roundId,
      gameId: body.gameId,
      kind: body.kind,
      money: m,
      referenceExternalTransactionId:
        body.referenceExternalTransactionId ?? null,
    };

    const payloadHash = hash(business);
    const orm = await database();

    return orm.em.transactional(async em => {
      const conn = em.getConnection();

      // Inbox: registra a mensagem dentro da mesma transação financeira.
      if (inbox) {
        const inserted = await conn.execute(
          `INSERT INTO inbox_messages
             (consumer_name, message_id, payload_hash)
           VALUES (?, ?, ?)
           ON CONFLICT (consumer_name, message_id) DO NOTHING
           RETURNING message_id`,
          [
            inbox.consumerName,
            inbox.messageId,
            inbox.payloadHash,
          ],
        );

        if (!inserted.length) {
          const previous = await conn.execute(
            `SELECT payload_hash
             FROM inbox_messages
             WHERE consumer_name = ? AND message_id = ?`,
            [inbox.consumerName, inbox.messageId],
          );

          if (!previous.length) {
            throw new Error('Não foi possível verificar a mensagem na Inbox');
          }

          if (previous[0].payload_hash.trim() !== inbox.payloadHash) {
            throw new ConflictException(
              'Message ID reutilizado com payload diferente',
            );
          }

          return { duplicateMessage: true };
        }
      }

      const existing = await conn.execute(
        `SELECT *
         FROM wager_transactions
         WHERE provider_id = ? AND idempotency_key = ?
         FOR UPDATE`,
        [body.providerId, idempotencyKey],
      );

      if (existing.length) {
        if (existing[0].payload_hash !== payloadHash) {
          throw new ConflictException(
            'Idempotency-Key reutilizada com payload diferente',
          );
        }

        return this.response(existing[0], true);
      }

      const sameExternal = await conn.execute(
        `SELECT id
         FROM wager_transactions
         WHERE provider_id = ? AND external_transaction_id = ?`,
        [body.providerId, body.externalTransactionId],
      );

      if (sameExternal.length) {
        throw new ConflictException(
          'externalTransactionId já utilizado com outra chave',
        );
      }

      const wallets = await conn.execute(
        'SELECT * FROM wallets WHERE id = ? FOR UPDATE',
        [body.walletId],
      );

      if (!wallets.length) {
        throw new NotFoundException('Wallet não encontrada');
      }

      const w = wallets[0];
      const txId = randomUUID();

      let status = 'PENDING';
      let failure: string | null = null;
      let referenceId: string | null = null;

      const insert = async () =>
        conn.execute(
          `INSERT INTO wager_transactions(
            id,provider_id,external_transaction_id,idempotency_key,
            payload_hash,wallet_id,player_id,round_id,game_id,
            kind,amount,currency,reference_external_transaction_id,
            reference_transaction_id,status,failure_code
          )
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            txId,
            body.providerId,
            body.externalTransactionId,
            idempotencyKey,
            payloadHash,
            body.walletId,
            body.playerId,
            body.roundId,
            body.gameId,
            body.kind,
            m.amount,
            m.currency,
            business.referenceExternalTransactionId,
            referenceId,
            status,
            failure,
          ],
        );

      if (w.player_id !== body.playerId) {
        throw new UnprocessableEntityException('PLAYER_WALLET_MISMATCH');
      }

      if (w.currency !== m.currency) {
        throw new UnprocessableEntityException('CURRENCY_MISMATCH');
      }

      if (['BET', 'WIN', 'LOSS'].includes(body.kind)) {
        await insert();

        let after = String(w.balance);

        if (body.kind === 'BET') {
          if (
            new Decimal(String(w.balance)).lessThan(
              new Decimal(m.amount),
            )
          ) {
            status = 'REJECTED';
            failure = 'INSUFFICIENT_FUNDS';
          } else {
            after = new Decimal(String(w.balance))
              .minus(m.amount)
              .toFixed(2);
          }
        } else if (body.kind === 'WIN') {
          after = new Decimal(String(w.balance))
            .plus(m.amount)
            .toFixed(2);
        }

        if (status === 'PENDING') {
          if (body.kind !== 'LOSS') {
            await conn.execute(
              `UPDATE wallets
               SET balance = ?, version = version + 1, updated_at = now()
               WHERE id = ?`,
              [after, body.walletId],
            );

            await conn.execute(
              `INSERT INTO wallet_ledger(
                wallet_id,transaction_id,direction,amount,
                currency,balance_before,balance_after
              ) VALUES(?,?,?,?,?,?,?)`,
              [
                body.walletId,
                txId,
                body.kind === 'BET' ? 'DEBIT' : 'CREDIT',
                m.amount,
                m.currency,
                w.balance,
                after,
              ],
            );
          }

          status = 'PROCESSED';
        }

        await conn.execute(
          `UPDATE wager_transactions
           SET status = ?, failure_code = ?, balance_after = ?, processed_at = now()
           WHERE id = ?`,
          [status, failure, after, txId],
        );

        await conn.execute(
          `INSERT INTO outbox_messages(aggregate_id,event_type,payload)
           VALUES(?,?,?::jsonb)`,
          [
            txId,
            'WagerTransactionProcessed',
            JSON.stringify({
              transactionId: txId,
              status,
              failureCode: failure,
              balance: { amount: after, currency: m.currency },
            }),
          ],
        );
      } else {
        const refs = await conn.execute(
          `SELECT *
           FROM wager_transactions
           WHERE provider_id = ? AND external_transaction_id = ?
           FOR UPDATE`,
          [body.providerId, body.referenceExternalTransactionId],
        );

        if (!refs.length) {
          status = 'PENDING_REFERENCE';
          await insert();
        } else {
          const ref = refs[0];
          referenceId = ref.id;

          await insert();

          const validKind =
            body.kind === 'REFUND'
              ? ref.kind === 'BET'
              : ['BET', 'WIN', 'REFUND'].includes(ref.kind);

          const same =
            ref.status === 'PROCESSED' &&
            ref.player_id === body.playerId &&
            ref.wallet_id === body.walletId &&
            ref.round_id === body.roundId &&
            ref.currency === m.currency &&
            String(ref.amount) === m.amount;

          const dup = await conn.execute(
            `SELECT id
             FROM wager_transactions
             WHERE reference_transaction_id = ?
               AND kind = ?
               AND status IN ('PROCESSED', 'PENDING')
               AND id <> ?`,
            [ref.id, body.kind, txId],
          );

          if (!validKind || !same) {
            status = 'REJECTED';
            failure = 'INVALID_REFERENCE';
          } else if (dup.length) {
            status = 'REJECTED';
            failure = 'REFERENCE_ALREADY_REVERSED';
          } else {
            const credit =
              body.kind === 'REFUND' || ref.kind === 'BET';

            const nextDecimal = credit
              ? new Decimal(String(w.balance)).plus(m.amount)
              : new Decimal(String(w.balance)).minus(m.amount);

            const next = nextDecimal.toFixed(2);

            if (nextDecimal.isNegative()) {
              status = 'REJECTED';
              failure = 'ROLLBACK_NEGATIVE_BALANCE';
            } else {
              status = 'PROCESSED';

              await conn.execute(
                `UPDATE wallets
                 SET balance = ?, version = version + 1, updated_at = now()
                 WHERE id = ?`,
                [next, body.walletId],
              );

              await conn.execute(
                `INSERT INTO wallet_ledger(
                  wallet_id,transaction_id,direction,amount,
                  currency,balance_before,balance_after
                ) VALUES(?,?,?,?,?,?,?)`,
                [
                  body.walletId,
                  txId,
                  credit ? 'CREDIT' : 'DEBIT',
                  m.amount,
                  m.currency,
                  w.balance,
                  next,
                ],
              );
            }
          }

          const afterRow = await conn.execute(
            'SELECT balance FROM wallets WHERE id = ?',
            [body.walletId],
          );

          await conn.execute(
            `UPDATE wager_transactions
             SET status = ?, failure_code = ?, reference_transaction_id = ?,
                 balance_after = ?, processed_at = now()
             WHERE id = ?`,
            [
              status,
              failure,
              referenceId,
              afterRow[0].balance,
              txId,
            ],
          );

          await conn.execute(
            `INSERT INTO outbox_messages(aggregate_id,event_type,payload)
             VALUES(?,?,?::jsonb)`,
            [
              txId,
              'WagerTransactionProcessed',
              JSON.stringify({
                transactionId: txId,
                status,
                failureCode: failure,
                balance: {
                  amount: String(afterRow[0].balance),
                  currency: m.currency,
                },
              }),
            ],
          );
        }
      }

      const row = await conn.execute(
        'SELECT * FROM wager_transactions WHERE id = ?',
        [txId],
      );

      return this.response(row[0], false);
    });
  }

  private response(row: any, replay: boolean) {
    return {
      transactionId: row.id,
      status: row.status,
      failureCode: row.failure_code ?? undefined,
      balance:
        row.balance_after == null
          ? undefined
          : {
              amount: String(row.balance_after),
              currency: row.currency,
            },
      idempotentReplay: replay,
    };
  }

  async getWallet(id: string) {
    const rows = await (await database()).em.getConnection().execute(
      `SELECT id,player_id AS "playerId",currency,balance,
              version,created_at AS "createdAt"
       FROM wallets WHERE id = ?`,
      [id],
    );

    if (!rows.length) throw new NotFoundException();

    const w = rows[0];

    return {
      ...w,
      balance: { amount: String(w.balance), currency: w.currency },
    };
  }

  async ledger(id: string, limit = 50) {
    const n = Math.min(100, Math.max(1, Number(limit) || 50));

    return (await database()).em.getConnection().execute(
      `SELECT id,transaction_id AS "transactionId",direction,amount,
              currency,balance_before AS "balanceBefore",
              balance_after AS "balanceAfter",created_at AS "createdAt"
       FROM wallet_ledger
       WHERE wallet_id = ?
       ORDER BY created_at DESC,id DESC
       LIMIT ?`,
      [id, n],
    );
  }

  async transaction(id: string) {
    const r = await (await database()).em.getConnection().execute(
      'SELECT * FROM wager_transactions WHERE id = ?',
      [id],
    );

    if (!r.length) throw new NotFoundException();

    return this.response(r[0], false);
  }

  async providerTransaction(provider: string, external: string) {
    const r = await (await database()).em.getConnection().execute(
      `SELECT *
       FROM wager_transactions
       WHERE provider_id = ? AND external_transaction_id = ?`,
      [provider, external],
    );

    if (!r.length) throw new NotFoundException();

    return this.response(r[0], false);
  }

  async reconcile(id: string) {
    const c = (await database()).em.getConnection();

    const rows = await c.execute(
      'SELECT * FROM wallets WHERE id = ?',
      [id],
    );

    if (!rows.length) throw new NotFoundException();

    const w = rows[0];

    const sums = await c.execute(
      `SELECT
         COALESCE(SUM(
           CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END
         ), 0) AS total,
         COUNT(*) AS entries
       FROM wallet_ledger
       WHERE wallet_id = ?`,
      [id],
    );

    const calculated = new Decimal(String(sums[0].total));
    const stored = new Decimal(String(w.balance));
    const difference = stored.minus(calculated);

    return {
      walletId: id,
      storedBalance: {
        amount: stored.toFixed(2),
        currency: w.currency,
      },
      calculatedBalance: {
        amount: calculated.toFixed(2),
        currency: w.currency,
      },
      difference: {
        amount: difference.toFixed(2),
        currency: w.currency,
      },
      consistent: difference.isZero(),
      checkedEntries: Number(sums[0].entries),
    };
  }
}

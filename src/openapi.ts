/** OpenAPI 3.0 document for the HTTP API. Kept dependency-free so local startup
 * does not require an additional Swagger package. */
export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Jungle Wagering Processor API',
    version: '1.0.0',
    description:
      'HTTP API for wallet management, wagering transactions, ledger inspection and financial reconciliation. This documentation describes the synchronous HTTP API; the SQS worker and Outbox publisher run as separate Docker services.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local Docker Compose environment' }],
  tags: [
    { name: 'Health', description: 'Liveness and readiness checks' },
    { name: 'Wallets', description: 'Wallet creation and balance queries' },
    { name: 'Ledger', description: 'Append-only wallet ledger' },
    { name: 'Wagering', description: 'BET, WIN, LOSS, REFUND and ROLLBACK operations' },
    { name: 'Reconciliation', description: 'Compare stored wallet balance with ledger totals' },
    { name: 'Providers', description: 'Look up a transaction by provider reference' },
  ],
  paths: {
    '/health/live': {
      get: {
        tags: ['Health'], summary: 'Liveness probe', operationId: 'healthLive',
        responses: { '200': { description: 'API process is alive', content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' }, example: { status: 'ok' } } } } },
      },
    },
    '/health/ready': {
      get: {
        tags: ['Health'], summary: 'Readiness probe', operationId: 'healthReady',
        responses: {
          '200': { description: 'API and database are ready', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' }, database: { type: 'string', example: 'connected' } } }, example: { status: 'ok', database: 'connected' } } } },
          '500': { description: 'Database is unavailable' },
        },
      },
    },
    '/wallets': {
      post: {
        tags: ['Wallets'], summary: 'Create a wallet', operationId: 'createWallet',
        description: 'A wallet is unique by playerId and currency. A non-zero initial balance creates an opening transaction and ledger entry.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateWalletRequest' }, example: { playerId: 'player-1001', initialBalance: { amount: '100.00', currency: 'BRL' } } } } },
        responses: {
          '201': { description: 'Wallet created', content: { 'application/json': { schema: { $ref: '#/components/schemas/WalletCreated' }, example: { id: '6e8ea29a-c57d-4d98-a260-513568e2c053', playerId: 'player-1001', balance: { amount: '100.00', currency: 'BRL' }, version: 1 } } } },
          '400': { description: 'Invalid request body or money format' }, '409': { description: 'A wallet already exists for this player and currency' },
        },
      },
    },
    '/wallets/{id}': {
      get: {
        tags: ['Wallets'], summary: 'Get wallet and current balance', operationId: 'getWallet',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Wallet details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Wallet' }, example: { id: '6e8ea29a-c57d-4d98-a260-513568e2c053', playerId: 'player-1001', currency: 'BRL', balance: { amount: '95.00', currency: 'BRL' }, version: '2', createdAt: '2026-11-17T16:07:29.885Z' } } } }, '404': { description: 'Wallet not found' } },
      },
    },
    '/wallets/{id}/ledger': {
      get: {
        tags: ['Ledger'], summary: 'List wallet ledger entries', operationId: 'getWalletLedger',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'limit', in: 'query', required: false, description: 'Maximum number of entries (1–100, default 50)', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
        ],
        responses: { '200': { description: 'Ledger entries, newest first', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/LedgerEntry' } }, example: [{ id: 'ledger-entry-id', transactionId: 'transaction-id', direction: 'DEBIT', amount: '5.00', currency: 'BRL', balanceBefore: '100.00', balanceAfter: '95.00', createdAt: '2026-11-17T16:10:00.000Z' }] } } }, '404': { description: 'Wallet not found or no matching wallet' } },
      },
    },
    '/wallets/{id}/reconciliation': {
      post: {
        tags: ['Reconciliation'], summary: 'Reconcile wallet balance against ledger', operationId: 'reconcileWallet',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '201': { description: 'Reconciliation result', content: { 'application/json': { schema: { $ref: '#/components/schemas/Reconciliation' }, example: { walletId: '6e8ea29a-c57d-4d98-a260-513568e2c053', storedBalance: { amount: '95.00', currency: 'BRL' }, calculatedBalance: { amount: '95.00', currency: 'BRL' }, difference: { amount: '0.00', currency: 'BRL' }, consistent: true, checkedEntries: 2 } } } }, '404': { description: 'Wallet not found' } },
      },
    },
    '/wagering/transactions': {
      post: {
        tags: ['Wagering'], summary: 'Submit a wagering transaction', operationId: 'submitWageringTransaction',
        description: 'Requires Idempotency-Key. Amounts must be decimal strings with exactly two fractional digits. LOSS requires amount 0.00. REFUND and ROLLBACK require referenceExternalTransactionId. OPENING is internal and cannot be submitted.',
        parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, description: 'Unique key per provider (max 200 characters). Reusing the same key and payload returns the original result.', schema: { type: 'string', maxLength: 200 }, example: 'provider-a:bet-0001' }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/WagerTransactionRequest' }, examples: {
          bet: { summary: 'BET example', value: { providerId: 'provider-a', externalTransactionId: 'bet-0001', playerId: 'player-1001', walletId: '6e8ea29a-c57d-4d98-a260-513568e2c053', roundId: 'round-01', gameId: 'game-01', kind: 'BET', money: { amount: '10.00', currency: 'BRL' } } },
          win: { summary: 'WIN example', value: { providerId: 'provider-a', externalTransactionId: 'win-0001', playerId: 'player-1001', walletId: '6e8ea29a-c57d-4d98-a260-513568e2c053', roundId: 'round-01', gameId: 'game-01', kind: 'WIN', money: { amount: '25.00', currency: 'BRL' } } },
          loss: { summary: 'LOSS example (zero amount)', value: { providerId: 'provider-a', externalTransactionId: 'loss-0001', playerId: 'player-1001', walletId: '6e8ea29a-c57d-4d98-a260-513568e2c053', roundId: 'round-01', gameId: 'game-01', kind: 'LOSS', money: { amount: '0.00', currency: 'BRL' } } },
          refund: { summary: 'REFUND example (references a BET)', value: { providerId: 'provider-a', externalTransactionId: 'refund-0001', referenceExternalTransactionId: 'bet-0001', playerId: 'player-1001', walletId: '6e8ea29a-c57d-4d98-a260-513568e2c053', roundId: 'round-01', gameId: 'game-01', kind: 'REFUND', money: { amount: '10.00', currency: 'BRL' } } },
          rollback: { summary: 'ROLLBACK example', value: { providerId: 'provider-a', externalTransactionId: 'rollback-0001', referenceExternalTransactionId: 'win-0001', playerId: 'player-1001', walletId: '6e8ea29a-c57d-4d98-a260-513568e2c053', roundId: 'round-01', gameId: 'game-01', kind: 'ROLLBACK', money: { amount: '25.00', currency: 'BRL' } } },
        } } } },
        responses: {
          '201': { description: 'Transaction accepted and processed or rejected by business rules', content: { 'application/json': { schema: { $ref: '#/components/schemas/WagerTransactionResult' }, examples: {
            processed: { summary: 'Processed', value: { transactionId: 'transaction-uuid', status: 'PROCESSED', balance: { amount: '90.00', currency: 'BRL' }, idempotentReplay: false } },
            insufficientFunds: { summary: 'Rejected for insufficient funds', value: { transactionId: 'transaction-uuid', status: 'REJECTED', failureCode: 'INSUFFICIENT_FUNDS', balance: { amount: '5.00', currency: 'BRL' }, idempotentReplay: false } },
            replay: { summary: 'Idempotent replay', value: { transactionId: 'transaction-uuid', status: 'PROCESSED', balance: { amount: '90.00', currency: 'BRL' }, idempotentReplay: true } },
          } } } },
          '400': { description: 'Invalid body, money format or missing Idempotency-Key' }, '404': { description: 'Wallet not found' }, '409': { description: 'Idempotency key or external transaction ID conflict' }, '422': { description: 'Player-wallet or currency mismatch' },
        },
      },
    },
    '/wagering/transactions/{id}': {
      get: { tags: ['Wagering'], summary: 'Get transaction by internal ID', operationId: 'getWageringTransaction', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Transaction result', content: { 'application/json': { schema: { $ref: '#/components/schemas/WagerTransactionResult' } } } }, '404': { description: 'Transaction not found' } } },
    },
    '/providers/{providerId}/wagering/transactions/{externalId}': {
      get: { tags: ['Providers'], summary: 'Get transaction by provider and external ID', operationId: 'getProviderTransaction', parameters: [{ name: 'providerId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'externalId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Transaction result', content: { 'application/json': { schema: { $ref: '#/components/schemas/WagerTransactionResult' } } } }, '404': { description: 'Transaction not found' } } },
    },
  },
  components: {
    schemas: {
      Health: { type: 'object', properties: { status: { type: 'string', example: 'ok' } }, required: ['status'] },
      Money: { type: 'object', required: ['amount', 'currency'], properties: { amount: { type: 'string', pattern: '^(0|[1-9]\\d*)\\.\\d{2}$', example: '100.00', description: 'Decimal string with exactly two fractional digits; do not send a JSON number.' }, currency: { type: 'string', pattern: '^[A-Z]{3}$', example: 'BRL' } } },
      CreateWalletRequest: { type: 'object', required: ['playerId', 'initialBalance'], properties: { playerId: { type: 'string', example: 'player-1001' }, initialBalance: { $ref: '#/components/schemas/Money' } } },
      WalletCreated: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, playerId: { type: 'string' }, balance: { $ref: '#/components/schemas/Money' }, version: { type: 'integer' } } },
      Wallet: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, playerId: { type: 'string' }, currency: { type: 'string' }, balance: { $ref: '#/components/schemas/Money' }, version: { type: 'string' }, createdAt: { type: 'string' } } },
      WagerTransactionRequest: { type: 'object', required: ['providerId', 'externalTransactionId', 'playerId', 'walletId', 'roundId', 'gameId', 'kind', 'money'], properties: { providerId: { type: 'string', example: 'provider-a' }, externalTransactionId: { type: 'string', example: 'bet-0001' }, referenceExternalTransactionId: { type: 'string', description: 'Required for REFUND and ROLLBACK.' }, playerId: { type: 'string', example: 'player-1001' }, walletId: { type: 'string', format: 'uuid' }, roundId: { type: 'string', example: 'round-01' }, gameId: { type: 'string', example: 'game-01' }, kind: { type: 'string', enum: ['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'] }, money: { $ref: '#/components/schemas/Money' } } },
      WagerTransactionResult: { type: 'object', properties: { transactionId: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['PROCESSED', 'REJECTED', 'PENDING', 'PENDING_REFERENCE', 'FAILED'] }, failureCode: { type: 'string' }, balance: { $ref: '#/components/schemas/Money' }, idempotentReplay: { type: 'boolean' } } },
      LedgerEntry: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, transactionId: { type: 'string', format: 'uuid' }, direction: { type: 'string', enum: ['DEBIT', 'CREDIT'] }, amount: { type: 'string', example: '10.00' }, currency: { type: 'string', example: 'BRL' }, balanceBefore: { type: 'string' }, balanceAfter: { type: 'string' }, createdAt: { type: 'string' } } },
      Reconciliation: { type: 'object', properties: { walletId: { type: 'string', format: 'uuid' }, storedBalance: { $ref: '#/components/schemas/Money' }, calculatedBalance: { $ref: '#/components/schemas/Money' }, difference: { $ref: '#/components/schemas/Money' }, consistent: { type: 'boolean' }, checkedEntries: { type: 'integer' } } },
    },
  },
} as const;

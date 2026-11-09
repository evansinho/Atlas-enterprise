import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest'

import {
  closeRedis,
  connectRedis,
  redis,
} from '../src/infrastructure/redis/client.js'

import {
  consumeOidcTransaction,
  createOidcTransaction,
} from '../src/modules/identity/transaction-store.js'

const createdStates: string[] = []
const KEY_PREFIX = 'atlas:oidc:transaction:'

async function createTrackedTransaction() {
  const transaction = await createOidcTransaction()
  createdStates.push(transaction.state)
  return transaction
}

async function cleanupTransactions() {
  if (createdStates.length === 0) return

  await redis.del(
    createdStates.map((state) => `${KEY_PREFIX}${state}`),
  )

  createdStates.length = 0
}

describe('OIDC transaction store', () => {
  beforeAll(async () => {
    await connectRedis()
  })

  afterEach(async () => {
    await cleanupTransactions()
  })

  afterAll(async () => {
    await closeRedis()
  })

  it('creates a transaction with unique secure values', async () => {
    const transaction = await createTrackedTransaction()

    expect(transaction.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(transaction.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(transaction.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(transaction.browserBindingSecret).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    )

    const another = await createTrackedTransaction()

    expect(another.state).not.toBe(transaction.state)
    expect(another.nonce).not.toBe(transaction.nonce)
    expect(another.codeVerifier).not.toBe(transaction.codeVerifier)
  })

  it('stores transactions with a five-minute expiration', async () => {
    const transaction = await createTrackedTransaction()

    const ttl = await redis.ttl(
      `${KEY_PREFIX}${transaction.state}`,
    )

    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(300)
  })

  it('consumes a transaction with the correct browser secret', async () => {
    const transaction = await createTrackedTransaction()

    const consumed = await consumeOidcTransaction(
      transaction.state,
      transaction.browserBindingSecret,
    )

    expect(consumed).not.toBeNull()
    expect(consumed?.nonce).toBe(transaction.nonce)
    expect(consumed?.codeVerifier).toBe(transaction.codeVerifier)
    expect(typeof consumed?.createdAt).toBe('number')
  })

  it('does not consume a transaction with the wrong browser secret', async () => {
    const transaction = await createTrackedTransaction()

    const result = await consumeOidcTransaction(
      transaction.state,
      'wrong-browser-secret-that-is-not-valid',
    )

    expect(result).toBeNull()

    // The legitimate browser must still be able to consume it.
    const consumed = await consumeOidcTransaction(
      transaction.state,
      transaction.browserBindingSecret,
    )

    expect(consumed).not.toBeNull()
  })

  it('does not allow a transaction to be consumed twice', async () => {
    const transaction = await createTrackedTransaction()

    const first = await consumeOidcTransaction(
      transaction.state,
      transaction.browserBindingSecret,
    )

    const second = await consumeOidcTransaction(
      transaction.state,
      transaction.browserBindingSecret,
    )

    expect(first).not.toBeNull()
    expect(second).toBeNull()
  })

  it('allows only one concurrent callback to consume a transaction', async () => {
    const transaction = await createTrackedTransaction()

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        consumeOidcTransaction(
          transaction.state,
          transaction.browserBindingSecret,
        ),
      ),
    )

    const successfulConsumptions = results.filter(
      (result) => result !== null,
    )

    expect(successfulConsumptions).toHaveLength(1)
  })

  it('rejects expired transactions', async () => {
    const transaction = await createTrackedTransaction()
    const key = `${KEY_PREFIX}${transaction.state}`

    await redis.expire(key, 1)

    await new Promise((resolve) => setTimeout(resolve, 1100))

    const consumed = await consumeOidcTransaction(
      transaction.state,
      transaction.browserBindingSecret,
    )

    expect(consumed).toBeNull()
  })

  it('rejects malformed state and browser secrets', async () => {
    expect(
      await consumeOidcTransaction('invalid-state', 'invalid-secret'),
    ).toBeNull()
  })
})

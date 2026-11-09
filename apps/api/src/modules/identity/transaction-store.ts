import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { connectRedis, redis } from '../../infrastructure/redis/client.js'

const TRANSACTION_TTL_SECONDS = 300
const TRANSACTION_KEY_PREFIX = 'atlas:oidc:transaction:'

interface StoredOidcTransaction {
  nonce: string
  codeVerifier: string
  browserBindingHash: string
  createdAt: number
}

export interface OidcTransaction {
  state: string
  nonce: string
  codeVerifier: string
  browserBindingSecret: string
}

export interface ConsumedOidcTransaction {
  nonce: string
  codeVerifier: string
  createdAt: number
}

function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function transactionKey(state: string): string {
  return `${TRANSACTION_KEY_PREFIX}${state}`
}

// Compare the browser binding and delete the transaction atomically.
// A callback with the wrong browser secret must not consume a valid transaction.
const CONSUME_TRANSACTION_SCRIPT = `
  local value = redis.call('GET', KEYS[1])

  if not value then
    return nil
  end

  local transaction = cjson.decode(value)

  if transaction.browserBindingHash ~= ARGV[1] then
    return nil
  end

  redis.call('DEL', KEYS[1])
  return value
`

export async function createOidcTransaction(): Promise<OidcTransaction> {
  await connectRedis()

  const state = randomToken()
  const nonce = randomToken()
  const codeVerifier = randomToken()
  const browserBindingSecret = randomToken()

  const storedTransaction: StoredOidcTransaction = {
    nonce,
    codeVerifier,
    browserBindingHash: hashToken(browserBindingSecret),
    createdAt: Date.now(),
  }

  const result = await redis.set(
    transactionKey(state),
    JSON.stringify(storedTransaction),
    {
      EX: TRANSACTION_TTL_SECONDS,
      NX: true,
    },
  )

  if (result !== 'OK') {
    throw new Error('Failed to store OIDC transaction')
  }

  return {
    state,
    nonce,
    codeVerifier,
    browserBindingSecret,
  }
}

export async function consumeOidcTransaction(
  state: string,
  browserBindingSecret: string,
): Promise<ConsumedOidcTransaction | null> {
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    !/^[A-Za-z0-9_-]{43}$/.test(browserBindingSecret)
  ) {
    return null
  }

  await connectRedis()

  const storedValue: unknown = await redis.eval(
    CONSUME_TRANSACTION_SCRIPT,
    {
      keys: [transactionKey(state)],
      arguments: [hashToken(browserBindingSecret)],
    },
  )

  if (typeof storedValue !== 'string') {
    return null
  }

  let transaction: StoredOidcTransaction

  try {
    transaction = JSON.parse(storedValue) as StoredOidcTransaction
  } catch {
    return null
  }

  if (
    typeof transaction.nonce !== 'string' ||
    typeof transaction.codeVerifier !== 'string' ||
    typeof transaction.browserBindingHash !== 'string' ||
    typeof transaction.createdAt !== 'number'
  ) {
    return null
  }

  // Additional defensive comparison of the stored binding hash.
  const expectedHash = Buffer.from(
    transaction.browserBindingHash,
    'hex',
  )
  const suppliedHash = Buffer.from(
    hashToken(browserBindingSecret),
    'hex',
  )

  if (
    expectedHash.length !== suppliedHash.length ||
    !timingSafeEqual(expectedHash, suppliedHash)
  ) {
    return null
  }

  return {
    nonce: transaction.nonce,
    codeVerifier: transaction.codeVerifier,
    createdAt: transaction.createdAt,
  }
}

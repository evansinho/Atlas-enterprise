
import { createHash } from 'node:crypto'

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
  createSession,
  getSession,
  revokeSession,
} from '../src/modules/identity/session-store.js'

const createdTokens: string[] = []
const SESSION_KEY_PREFIX = 'atlas:session:'

async function createTrackedSession(userId = 'test-user-123') {
  const result = await createSession(userId)
  createdTokens.push(result.token)
  return result
}

async function cleanupSessions() {
  if (createdTokens.length === 0) return

  const keys = createdTokens.map((token) => {
    const hash = createHash('sha256').update(token).digest('hex')
    return `${SESSION_KEY_PREFIX}${hash}`
  })

  await redis.del(keys)
  createdTokens.length = 0
}

describe('Session store', () => {
  beforeAll(async () => {
    await connectRedis()
  })

  afterEach(async () => {
    await cleanupSessions()
  })

  afterAll(async () => {
    await closeRedis()
  })

  it('creates a session with a secure random token', async () => {
    const result = await createTrackedSession()

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(result.session.userId).toBe('test-user-123')
    expect(result.session.expiresAt).toBeGreaterThan(
      result.session.createdAt,
    )
  })

  it('stores only the hashed session token in Redis', async () => {
    const result = await createTrackedSession()

    const hash = createHash('sha256')
      .update(result.token)
      .digest('hex')

    const storedKey = `${SESSION_KEY_PREFIX}${hash}`

    expect(await redis.exists(storedKey)).toBe(1)
    expect(await redis.exists(`${SESSION_KEY_PREFIX}${result.token}`)).toBe(0)
  })

  it('retrieves an existing session', async () => {
    const result = await createTrackedSession()

    const session = await getSession(result.token)

    expect(session).toMatchObject({
      userId: result.session.userId,
      createdAt: result.session.createdAt,
      expiresAt: result.session.expiresAt,
    })
  })

  it('generates unique session tokens', async () => {
    const first = await createTrackedSession()
    const second = await createTrackedSession()

    expect(first.token).not.toBe(second.token)
  })

  it('rejects malformed session tokens', async () => {
    expect(await getSession('invalid-token')).toBeNull()
  })

  it('revokes a session immediately', async () => {
    const result = await createTrackedSession()

    await revokeSession(result.token)

    expect(await getSession(result.token)).toBeNull()
  })

  it('rejects expired sessions', async () => {
    const result = await createTrackedSession()

    const hash = createHash('sha256')
      .update(result.token)
      .digest('hex')

    await redis.expire(`${SESSION_KEY_PREFIX}${hash}`, 1)

    await new Promise((resolve) => setTimeout(resolve, 1100))

    expect(await getSession(result.token)).toBeNull()
  })
})

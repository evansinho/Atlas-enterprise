
import { createHash, randomBytes } from 'node:crypto'

import {
  connectRedis,
  redis,
} from '../../infrastructure/redis/client.js'

const SESSION_TTL_SECONDS = 8 * 60 * 60
const SESSION_KEY_PREFIX = 'atlas:session:'

interface StoredSession {
  userId: string
  createdAt: number
  expiresAt: number
}

export interface Session {
  userId: string
  createdAt: number
  expiresAt: number
}

export interface CreatedSession {
  token: string
  session: Session
}

function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

function hashSessionToken(token: string): string {
  return createHash('sha256')
    .update(token)
    .digest('hex')
}

function sessionKey(token: string): string {
  return `${SESSION_KEY_PREFIX}${hashSessionToken(token)}`
}

function isValidSessionToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token)
}

export async function createSession(
  userId: string,
): Promise<CreatedSession> {
  if (!userId) {
    throw new Error('User ID is required to create a session')
  }

  await connectRedis()

  const token = generateSessionToken()
  const createdAt = Date.now()
  const expiresAt = createdAt + SESSION_TTL_SECONDS * 1000

  const session: Session = {
    userId,
    createdAt,
    expiresAt,
  }

  const storedSession: StoredSession = session

  const result = await redis.set(
    sessionKey(token),
    JSON.stringify(storedSession),
    {
      EX: SESSION_TTL_SECONDS,
      NX: true,
    },
  )

  if (result !== 'OK') {
    throw new Error('Failed to create session')
  }

  return {
    token,
    session,
  }
}

export async function getSession(
  token: string,
): Promise<Session | null> {
  if (!isValidSessionToken(token)) {
    return null
  }

  await connectRedis()

  const storedValue = await redis.get(sessionKey(token))

  if (!storedValue) {
    return null
  }

  let session: StoredSession

  try {
    session = JSON.parse(storedValue) as StoredSession
  } catch {
    return null
  }

  if (
    typeof session.userId !== 'string' ||
    session.userId.length === 0 ||
    typeof session.createdAt !== 'number' ||
    typeof session.expiresAt !== 'number'
  ) {
    return null
  }

  if (session.expiresAt <= Date.now()) {
    await redis.del(sessionKey(token))
    return null
  }

  return {
    userId: session.userId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  }
}

export async function revokeSession(
  token: string,
): Promise<void> {
  if (!isValidSessionToken(token)) {
    return
  }

  await connectRedis()
  await redis.del(sessionKey(token))
}

import type { FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'

import { db, users } from '@atlas/database'
import { getSession, revokeSession } from './session-store.js'

const SESSION_COOKIE_NAME = 'atlas_session'

export interface AuthenticatedUser {
  id: string
  email: string | null
  displayName: string | null
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: AuthenticatedUser
}

export function assertAuthenticated(
  request: FastifyRequest,
): asserts request is AuthenticatedRequest {
  if (!request.user) {
    throw new Error('Authenticated request is missing its user')
  }
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = request.cookies[SESSION_COOKIE_NAME]

  if (!token) {
    reply.code(401).send({
      error: 'UNAUTHENTICATED',
      message: 'Authentication is required',
    })
    return
  }

  try {
    const session = await getSession(token)

    if (!session) {
      reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
      reply.code(401).send({
        error: 'UNAUTHENTICATED',
        message: 'Your session is invalid or has expired',
      })
      return
    }

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1)

    if (!user) {
      await revokeSession(token)
      reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
      reply.code(401).send({
        error: 'UNAUTHENTICATED',
        message: 'Your session is no longer valid',
      })
      return
    }

    if (user.status !== 'active') {
      await revokeSession(token)
      reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
      reply.code(403).send({
        error: 'ACCOUNT_DISABLED',
        message: 'This Atlas account is disabled',
      })
      return
    }

    request.user = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    }
  } catch (error) {
    request.log.error(
      { err: error },
      'Failed to authenticate request',
    )

    reply.code(503).send({
      error: 'AUTHENTICATION_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable',
    })
  }
}

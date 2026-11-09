import type { FastifyPluginAsync } from 'fastify'
import '@fastify/cookie'
import * as oidc from 'openid-client'
import { z } from 'zod'

import {
  getOidcConfiguration,
  getOidcRedirectUri,
} from './oidc.js'

import {
  consumeOidcTransaction,
  createOidcTransaction,
} from './transaction-store.js'

import { verifiedOidcClaimsSchema } from './schemas.js'
import { provisionUser } from './service.js'
import { createSession } from './session-store.js'

const BROWSER_COOKIE_PREFIX = 'atlas_oidc_browser_'
const TRANSACTION_TTL_SECONDS = 300
const SESSION_TTL_SECONDS = 8 * 60 * 60

const CALLBACK_PATH = '/auth/oidc/callback'
const SESSION_COOKIE_NAME = 'atlas_session'

const callbackQuerySchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().optional(),
  error: z.string().optional(),
})

export const identityRoutes: FastifyPluginAsync = async (app) => {
  app.get('/login', async (request, reply) => {
    try {
      const configuration = await getOidcConfiguration()
      const transaction = await createOidcTransaction()

      const codeChallenge = await oidc.calculatePKCECodeChallenge(
        transaction.codeVerifier,
      )

      const authorizationUrl = oidc.buildAuthorizationUrl(
        configuration,
        {
          redirect_uri: getOidcRedirectUri(),
          scope: 'openid profile email',
          response_type: 'code',
          state: transaction.state,
          nonce: transaction.nonce,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        },
      )

      reply.setCookie(
        `${BROWSER_COOKIE_PREFIX}${transaction.state}`,
        transaction.browserBindingSecret,
        {
          path: CALLBACK_PATH,
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: TRANSACTION_TTL_SECONDS,
        },
      )

      return reply.redirect(authorizationUrl.href)
    } catch (error) {
      request.log.error(
        { err: error },
        'Failed to start OIDC login',
      )

      return reply.code(503).send({
        error: 'Authentication is temporarily unavailable',
      })
    }
  })

  app.get('/oidc/callback', async (request, reply) => {
    const parsedQuery = callbackQuerySchema.safeParse(request.query)

    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: 'Invalid authentication callback',
      })
    }

    const { state, code, error } = parsedQuery.data

    const cookieName = `${BROWSER_COOKIE_PREFIX}${state}`
    const browserBindingSecret = request.cookies[cookieName]

    reply.clearCookie(cookieName, {
      path: CALLBACK_PATH,
    })

    if (!browserBindingSecret) {
      return reply.code(400).send({
        error: 'Authentication transaction is missing',
      })
    }

    let transaction

    try {
      transaction = await consumeOidcTransaction(
        state,
        browserBindingSecret,
      )
    } catch (err) {
      request.log.error(
        { err },
        'Failed to consume OIDC transaction',
      )

      return reply.code(503).send({
        error: 'Authentication is temporarily unavailable',
      })
    }

    if (!transaction) {
      return reply.code(400).send({
        error: 'Authentication transaction is invalid or expired',
      })
    }

    if (error || !code) {
      return reply.code(401).send({
        error: 'Authentication was not completed',
      })
    }

    // Exchange the authorization code and validate the ID token.
    let verifiedClaims

    try {
      const configuration = await getOidcConfiguration()

      const callbackUrl = new URL(
        request.url,
        getOidcRedirectUri(),
      )

      const tokens = await oidc.authorizationCodeGrant(
        configuration,
        callbackUrl,
        {
          expectedState: state,
          expectedNonce: transaction.nonce,
          pkceCodeVerifier: transaction.codeVerifier,
        },
        {
          redirect_uri: getOidcRedirectUri(),
        },
      )

      const claims = tokens.claims()

      if (
        !claims ||
        typeof claims.iss !== 'string' ||
        typeof claims.sub !== 'string'
      ) {
        return reply.code(401).send({
          error: 'Identity provider returned invalid identity claims',
        })
      }

      const parsedClaims = verifiedOidcClaimsSchema.safeParse({
        issuer: claims.iss,
        subject: claims.sub,
        ...(typeof claims.email === 'string'
          ? { email: claims.email }
          : {}),
        ...(typeof claims.name === 'string'
          ? { displayName: claims.name }
          : {}),
      })

      if (!parsedClaims.success) {
        request.log.warn(
          { issues: parsedClaims.error.issues },
          'Verified OIDC claims did not match the Atlas identity schema',
        )

        return reply.code(401).send({
          error: 'Identity provider returned unsupported identity claims',
        })
      }

      verifiedClaims = parsedClaims.data
    } catch (err) {
      request.log.warn(
        { err },
        'OIDC authorization code exchange or token validation failed',
      )

      return reply.code(401).send({
        error: 'Unable to verify authentication',
      })
    }

    // Provision or retrieve the Atlas user using verified claims.
    try {
      const result = await provisionUser(verifiedClaims)

      if (result.user.status !== 'active') {
        return reply.code(403).send({
          error: 'This Atlas account is disabled',
        })
      }

      // Create a server-side session only after successful verification.
      const { session, token } = await createSession(result.user.id)

      reply.setCookie(SESSION_COOKIE_NAME, token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_TTL_SECONDS,
      })

      return reply.send({
        status: 'authenticated',
        message: 'Successfully authenticated with Atlas',
        user: {
          id: result.user.id,
          email: result.user.email,
          displayName: result.user.displayName,
        },
        session: {
          expiresAt: new Date(session.expiresAt).toISOString(),
        },
      })
    } catch (err) {
      request.log.error(
        { err },
        'Failed to provision Atlas identity or create session',
      )

      return reply.code(500).send({
        error: 'Unable to complete authentication',
      })
    }
  })
}

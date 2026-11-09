import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest'

import { buildApp } from '../src/app.js'
import {
  closeRedis,
  connectRedis,
} from '../src/infrastructure/redis/client.js'
import {
  consumeOidcTransaction,
  createOidcTransaction,
} from '../src/modules/identity/transaction-store.js'

const app = buildApp()

describe('Identity routes', () => {
  beforeAll(async () => {
    await connectRedis()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await closeRedis()
  })

  it('rejects a callback with malformed state', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/oidc/callback?state=invalid-state',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      error: 'Invalid authentication callback',
    })
  })

  it('rejects a callback without a browser-binding cookie', async () => {
    const state = 'A'.repeat(43)

    const response = await app.inject({
      method: 'GET',
      url: `/auth/oidc/callback?state=${state}&code=test-code`,
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      error: 'Authentication transaction is missing',
    })
  })

  it('rejects an incorrect browser-binding cookie', async () => {
    const transaction = await createOidcTransaction()

    const cookieName = `atlas_oidc_browser_${transaction.state}`

    const response = await app.inject({
      method: 'GET',
      url: `/auth/oidc/callback?state=${transaction.state}&code=test-code`,
      headers: {
        cookie: `${cookieName}=wrong-browser-secret`,
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      error: 'Authentication transaction is invalid or expired',
    })

    // An incorrect browser secret must not consume the valid transaction.
    const consumed = await consumeOidcTransaction(
      transaction.state,
      transaction.browserBindingSecret,
    )

    expect(consumed).not.toBeNull()
  })

  it('rejects a callback for a nonexistent transaction', async () => {
    const state = 'B'.repeat(43)

    const response = await app.inject({
      method: 'GET',
      url: `/auth/oidc/callback?state=${state}&code=test-code`,
      headers: {
        cookie: `atlas_oidc_browser_${state}=wrong-browser-secret`,
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      error: 'Authentication transaction is invalid or expired',
    })
  })
})

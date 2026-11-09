import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

import {
  db,
  pool,
  users,
} from '@atlas/database'

import {
  findUserByOidcIdentity,
  provisionUser,
} from '../src/modules/identity/service.js'

describe('Identity service', () => {
  const runId = randomUUID()
  const issuer = 'https://identity.atlas.test'
  const subject = `user-${runId}`
  const email = `identity-${runId}@example.com`

  afterAll(async () => {
    await db
      .delete(users)
      .where(eq(users.email, email))

    await pool.end()
  })

  it('provisions a user from verified OIDC claims', async () => {
    const result = await provisionUser({
      issuer,
      subject,
      email,
      displayName: 'Atlas Test User',
    })

    expect(result.created).toBe(true)

    expect(result.user).toMatchObject({
      email,
      displayName: 'Atlas Test User',
      status: 'active',
    })
  })

  it('returns the existing user when the identity is provisioned again', async () => {
    const first = await provisionUser({
      issuer,
      subject,
      email,
    })

    const second = await provisionUser({
      issuer,
      subject,
      email,
    })

    expect(second.created).toBe(false)
    expect(second.user.id).toBe(first.user.id)
  })

  it('finds a user by OIDC issuer and subject', async () => {
    const user = await findUserByOidcIdentity(
      issuer,
      subject,
    )

    expect(user).not.toBeNull()
    expect(user?.email).toBe(email)
  })

  it('handles concurrent provisioning requests', async () => {
    const concurrentSubject = `concurrent-${runId}`
    const concurrentEmail = `concurrent-${runId}@example.com`

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        provisionUser({
          issuer,
          subject: concurrentSubject,
          email: concurrentEmail,
        }),
      ),
    )

    const userIds = new Set(
      results.map((result) => result.user.id),
    )

    expect(userIds.size).toBe(1)
    expect(results.filter((result) => result.created)).toHaveLength(1)

    await db
      .delete(users)
      .where(eq(users.email, concurrentEmail))
  })
})

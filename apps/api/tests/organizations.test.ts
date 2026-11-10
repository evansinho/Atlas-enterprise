import { randomUUID } from 'node:crypto'
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'

import { buildApp } from '../src/app.js'

import {
  closeRedis,
  connectRedis,
} from '../src/infrastructure/redis/client.js'

import {
  createSession,
  revokeSession,
} from '../src/modules/identity/session-store.js'

import {
  db,
  withUserContext,
  organizationMemberships,
  organizations,
  pool,
  users,
  workspaces,
} from '@atlas/database'
import { adminDb, closeAdminDatabase } from './admin-database.js'

describe.skipIf(process.env.ATLAS_RLS_TESTS !== 'true')(
  'Organization API (requires migration 0002)',
  () => {
  let app: FastifyInstance

  let ownerUserId: string
  let memberUserId: string
  let outsiderUserId: string

  let ownerToken: string
  let memberToken: string
  let outsiderToken: string

  let organizationId: string
  let otherOrganizationId: string

  const slug = `atlas-test-${randomUUID()}`

  function authenticatedCookie(token: string) {
    return `atlas_session=${token}`
  }

  async function createTestUser(email: string): Promise<string> {
    const [user] = await adminDb
      .insert(users)
      .values({
        email,
        displayName: 'Atlas Test User',
        status: 'active',
      })
      .returning({
        id: users.id,
      })

    if (!user) {
      throw new Error('Failed to create test user')
    }

    return user.id
  }

  beforeAll(async () => {
    await connectRedis()

    app = buildApp()
    await app.ready()

    ownerUserId = await createTestUser(
      `owner-${randomUUID()}@test.local`,
    )

    memberUserId = await createTestUser(
      `member-${randomUUID()}@test.local`,
    )

    outsiderUserId = await createTestUser(
      `outsider-${randomUUID()}@test.local`,
    )

    const ownerSession = await createSession(ownerUserId)
    const memberSession = await createSession(memberUserId)
    const outsiderSession = await createSession(outsiderUserId)

    ownerToken = ownerSession.token
    memberToken = memberSession.token
    outsiderToken = outsiderSession.token

    const [otherOrganization] = await adminDb
      .insert(organizations)
      .values({
        name: 'Other Atlas Test Organization',
        slug: `atlas-other-${randomUUID()}`,
      })
      .returning({ id: organizations.id })

    if (!otherOrganization) {
      throw new Error('Failed to create the other test organization')
    }

    otherOrganizationId = otherOrganization.id
    await adminDb.insert(workspaces).values({
      organizationId: otherOrganizationId,
      name: 'Other Engineering',
      slug: 'other-engineering',
    })
  })

  afterAll(async () => {
    if (organizationId) {
      await adminDb
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
    }

    if (otherOrganizationId) {
      await adminDb
        .delete(organizations)
        .where(eq(organizations.id, otherOrganizationId))
    }

    if (ownerUserId) {
      await adminDb.delete(users).where(eq(users.id, ownerUserId))
    }

    if (memberUserId) {
      await adminDb.delete(users).where(eq(users.id, memberUserId))
    }

    if (outsiderUserId) {
      await adminDb.delete(users).where(eq(users.id, outsiderUserId))
    }

    if (ownerToken) await revokeSession(ownerToken)
    if (memberToken) await revokeSession(memberToken)
    if (outsiderToken) await revokeSession(outsiderToken)

    await app.close()
    await closeRedis()
    await closeAdminDatabase()
    await pool.end()
  })

  it('rejects requests without authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${randomUUID()}`,
    })

    expect(response.statusCode).toBe(401)
  })

  it('creates an organization and assigns the creator as owner', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: {
        cookie: authenticatedCookie(ownerToken),
      },
      payload: {
        name: 'Atlas Test Organization',
        slug,
      },
    })

    expect(response.statusCode).toBe(201)

    const body = response.json()

    expect(body.data).toMatchObject({
      name: 'Atlas Test Organization',
      slug,
    })

    expect(body.data.id).toBeDefined()

    organizationId = body.data.id

    const memberships = await adminDb
      .select()
      .from(organizationMemberships)
      .where(eq(organizationMemberships.organizationId, organizationId))

    expect(memberships).toHaveLength(1)
    expect(memberships[0]).toMatchObject({
      organizationId,
      userId: ownerUserId,
      role: 'owner',
      status: 'active',
    })
  })

  it('allows an active organization owner to retrieve the organization', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${organizationId}`,
      headers: {
        cookie: authenticatedCookie(ownerToken),
      },
    })

    expect(response.statusCode).toBe(200)

    expect(response.json().data).toMatchObject({
      id: organizationId,
      slug,
    })
  })

  it('rejects duplicate organization slugs', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: {
        cookie: authenticatedCookie(ownerToken),
      },
      payload: {
        name: 'Another Organization',
        slug,
      },
    })

    expect(response.statusCode).toBe(409)

    expect(response.json()).toMatchObject({
      error: 'CONFLICT',
    })
  })

  it('rejects invalid organization data', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: {
        cookie: authenticatedCookie(ownerToken),
      },
      payload: {
        name: 'A',
        slug: 'Invalid Slug!',
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('VALIDATION_ERROR')
  })

  it('allows an owner to create a workspace', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationId}/workspaces`,
      headers: {
        cookie: authenticatedCookie(ownerToken),
      },
      payload: {
        name: 'Engineering',
        slug: 'engineering',
      },
    })

    expect(response.statusCode).toBe(201)

    expect(response.json().data).toMatchObject({
      organizationId,
      name: 'Engineering',
      slug: 'engineering',
    })
  })

  it('allows an owner to list organization workspaces', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${organizationId}/workspaces`,
      headers: {
        cookie: authenticatedCookie(ownerToken),
      },
    })

    expect(response.statusCode).toBe(200)

    expect(response.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId,
          slug: 'engineering',
        }),
      ]),
    )
  })

  it('allows an active member to retrieve the organization', async () => {
    await adminDb.insert(organizationMemberships).values({
      organizationId,
      userId: memberUserId,
      role: 'member',
      status: 'active',
    })

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${organizationId}`,
      headers: {
        cookie: authenticatedCookie(memberToken),
      },
    })

    expect(response.statusCode).toBe(200)
  })

  it('allows an active member to list workspaces', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${organizationId}/workspaces`,
      headers: {
        cookie: authenticatedCookie(memberToken),
      },
    })

    expect(response.statusCode).toBe(200)
  })

  it('prevents a regular member from creating workspaces', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationId}/workspaces`,
      headers: {
        cookie: authenticatedCookie(memberToken),
      },
      payload: {
        name: 'Unauthorized Workspace',
        slug: 'unauthorized-workspace',
      },
    })

    expect(response.statusCode).toBe(403)

    expect(response.json()).toMatchObject({
      error: 'INSUFFICIENT_PERMISSIONS',
    })
  })

  it('prevents a non-member from accessing an organization', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${organizationId}`,
      headers: {
        cookie: authenticatedCookie(outsiderToken),
      },
    })

    expect(response.statusCode).toBe(403)
  })

  it('prevents a non-member from creating workspaces', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${organizationId}/workspaces`,
      headers: {
        cookie: authenticatedCookie(outsiderToken),
      },
      payload: {
        name: 'Outsider Workspace',
        slug: 'outsider-workspace',
      },
    })

    expect(response.statusCode).toBe(403)
  })

  describe('PostgreSQL RLS integration', () => {
    it('does not allow User A to access User B organization workspaces', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/organizations/${otherOrganizationId}/workspaces`,
        headers: { cookie: authenticatedCookie(ownerToken) },
      })

      expect(response.statusCode).toBe(403)
    })

    it('rejects direct owner membership insertion through atlas_app', async () => {
      await expect(
        db.insert(organizationMemberships).values({
          organizationId,
          userId: outsiderUserId,
          role: 'owner',
          status: 'active',
        }),
      ).rejects.toMatchObject({ cause: { code: '42501' } })
    })

    it('returns no tenant rows when transaction-local identity is missing', async () => {
      const visibleOrganizations = await db.select().from(organizations)
      expect(visibleOrganizations).toEqual([])
    })

    it('does not leak transaction-local identity to the next pooled transaction', async () => {
      const scopedOrganizations = await withUserContext(
        ownerUserId,
        (tx) => tx.select().from(organizations),
      )
      expect(scopedOrganizations.map(({ id }) => id)).toContain(organizationId)

      const unscopedOrganizations = await db.select().from(organizations)
      expect(unscopedOrganizations).toEqual([])
    })
  })
  },
)

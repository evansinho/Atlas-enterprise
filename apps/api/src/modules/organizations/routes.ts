import type { FastifyPluginAsync } from 'fastify'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import {
  withUserContext,
  organizations,
  workspaces,
} from '@atlas/database'

import {
  authenticate,
  assertAuthenticated,
} from '../identity/authenticate.js'

import {
  canManageOrganization,
  getActiveOrganizationMembership,
} from './authorization.js'

const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
})

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
})

const idSchema = z.string().uuid()

function isPostgresError(
  error: unknown,
  code: string,
): boolean {
  let current: unknown = error
  const visited = new Set<object>()

  while (
    typeof current === 'object' &&
    current !== null &&
    !visited.has(current)
  ) {
    visited.add(current)

    if ('code' in current && current.code === code) {
      return true
    }

    current = 'cause' in current ? current.cause : undefined
  }

  return false
}

export const organizationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // Create an organization and assign its creator as owner.
  app.post('/organizations', async (request, reply) => {
    assertAuthenticated(request)

    const parsed = createOrganizationSchema.safeParse(request.body)

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Invalid organization data',
        details: parsed.error.flatten(),
      })
    }

    try {
      const organization = await withUserContext(
        request.user.id,
        async (tx) => {
          type Organization = typeof organizations.$inferSelect
          const result = await tx.execute(sql<Organization>`
            SELECT
              organization.id,
              organization.name,
              organization.slug,
              organization.created_at AS "createdAt",
              organization.updated_at AS "updatedAt"
            FROM public.create_organization_with_owner(
              ${parsed.data.name}::varchar(160),
              ${parsed.data.slug}::varchar(80)
            ) AS organization
          `)
          const [createdOrganization] = result.rows

          if (!createdOrganization) {
            throw new Error('Organization creation returned no result')
          }

          return createdOrganization
        },
      )

      return reply.code(201).send({ data: organization })
    } catch (error) {
      if (isPostgresError(error, '23505')) {
        return reply.code(409).send({
          error: 'CONFLICT',
          message: 'An organization with this slug already exists',
        })
      }

      request.log.error(
        { err: error },
        'Failed to create organization',
      )

      return reply.code(500).send({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create organization',
      })
    }
  })

  // Retrieve an organization.
  app.get<{ Params: { id: string } }>(
    '/organizations/:id',
    async (request, reply) => {
      assertAuthenticated(request)

      const parsed = idSchema.safeParse(request.params.id)

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Invalid organization ID',
        })
      }

      const result = await withUserContext(
        request.user.id,
        async (tx) => {
          const membership = await getActiveOrganizationMembership(
            tx,
            parsed.data,
            request.user.id,
          )

          if (!membership) {
            return { kind: 'forbidden' } as const
          }

          const [organization] = await tx
            .select()
            .from(organizations)
            .where(eq(organizations.id, parsed.data))
            .limit(1)

          if (!organization) {
            return { kind: 'not_found' } as const
          }

          return {
            kind: 'ok',
            organization,
          } as const
        },
      )

      if (result.kind === 'forbidden') {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: 'You do not have access to this organization',
        })
      }

      if (result.kind === 'not_found') {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: 'Organization not found',
        })
      }

      return { data: result.organization }
    },
  )

  // Create a workspace inside an organization.
  app.post<{ Params: { id: string } }>(
    '/organizations/:id/workspaces',
    async (request, reply) => {
      assertAuthenticated(request)

      const organizationId = idSchema.safeParse(request.params.id)
      const body = createWorkspaceSchema.safeParse(request.body)

      if (!organizationId.success || !body.success) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Invalid organization ID or workspace data',
          details: body.success ? undefined : body.error.flatten(),
        })
      }

      try {
        const result = await withUserContext(
          request.user.id,
          async (tx) => {
            const membership = await getActiveOrganizationMembership(
              tx,
              organizationId.data,
              request.user.id,
            )

            if (!membership) {
              return { kind: 'forbidden' } as const
            }

            if (!canManageOrganization(membership.role)) {
              return { kind: 'insufficient_permissions' } as const
            }

            const [workspace] = await tx
              .insert(workspaces)
              .values({
                organizationId: organizationId.data,
                ...body.data,
              })
              .returning()

            return {
              kind: 'created',
              workspace,
            } as const
          },
        )

        if (result.kind === 'forbidden') {
          return reply.code(403).send({
            error: 'FORBIDDEN',
            message: 'You do not have access to this organization',
          })
        }

        if (result.kind === 'insufficient_permissions') {
          return reply.code(403).send({
            error: 'INSUFFICIENT_PERMISSIONS',
            message: 'You need an owner or admin role to create workspaces',
          })
        }

        return reply.code(201).send({ data: result.workspace })
      } catch (error) {
        if (isPostgresError(error, '23503')) {
          return reply.code(404).send({
            error: 'NOT_FOUND',
            message: 'Organization not found',
          })
        }

        if (isPostgresError(error, '23505')) {
          return reply.code(409).send({
            error: 'CONFLICT',
            message: 'A workspace with this slug already exists in this organization',
          })
        }

        request.log.error(
          { err: error },
          'Failed to create workspace',
        )

        return reply.code(500).send({
          error: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create workspace',
        })
      }
    },
  )

  // List workspaces belonging to an organization.
  app.get<{ Params: { id: string } }>(
    '/organizations/:id/workspaces',
    async (request, reply) => {
      assertAuthenticated(request)

      const parsed = idSchema.safeParse(request.params.id)

      if (!parsed.success) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Invalid organization ID',
        })
      }

      const result = await withUserContext(
        request.user.id,
        async (tx) => {
          const membership = await getActiveOrganizationMembership(
            tx,
            parsed.data,
            request.user.id,
          )

          if (!membership) {
            return { kind: 'forbidden' } as const
          }

          const workspacesForOrganization = await tx
            .select()
            .from(workspaces)
            .where(eq(workspaces.organizationId, parsed.data))

          return {
            kind: 'ok',
            workspaces: workspacesForOrganization,
          } as const
        },
      )

      if (result.kind === 'forbidden') {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: 'You do not have access to this organization',
        })
      }

      return { data: result.workspaces }
    },
  )
}

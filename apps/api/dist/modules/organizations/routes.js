import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, organizations, workspaces, } from '@atlas/database';
const createOrganizationSchema = z.object({
    name: z.string().trim().min(2).max(160),
    slug: z
        .string()
        .trim()
        .min(2)
        .max(80)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});
const createWorkspaceSchema = z.object({
    name: z.string().trim().min(2).max(160),
    slug: z
        .string()
        .trim()
        .min(2)
        .max(80)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});
const idSchema = z.string().uuid();
function isPostgresError(error, code) {
    let current = error;
    const visited = new Set();
    while (typeof current === 'object' &&
        current !== null &&
        !visited.has(current)) {
        visited.add(current);
        if ('code' in current && current.code === code) {
            return true;
        }
        current = 'cause' in current ? current.cause : undefined;
    }
    return false;
}
export const organizationRoutes = async (app) => {
    // Create an organization
    app.post('/organizations', async (request, reply) => {
        const parsed = createOrganizationSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({
                error: 'VALIDATION_ERROR',
                message: 'Invalid organization data',
                details: parsed.error.flatten(),
            });
        }
        try {
            const [organization] = await db
                .insert(organizations)
                .values(parsed.data)
                .returning();
            return reply.code(201).send({ data: organization });
        }
        catch (error) {
            if (isPostgresError(error, '23505')) {
                return reply.code(409).send({
                    error: 'CONFLICT',
                    message: 'An organization with this slug already exists',
                });
            }
            request.log.error({ err: error }, 'Failed to create organization');
            return reply.code(500).send({
                error: 'INTERNAL_SERVER_ERROR',
                message: 'Failed to create organization',
            });
        }
    });
    // Retrieve an organization
    app.get('/organizations/:id', async (request, reply) => {
        const parsed = idSchema.safeParse(request.params.id);
        if (!parsed.success) {
            return reply.code(400).send({
                error: 'VALIDATION_ERROR',
                message: 'Invalid organization ID',
            });
        }
        const [organization] = await db
            .select()
            .from(organizations)
            .where(eq(organizations.id, parsed.data))
            .limit(1);
        if (!organization) {
            return reply.code(404).send({
                error: 'NOT_FOUND',
                message: 'Organization not found',
            });
        }
        return { data: organization };
    });
    // Create a workspace inside an organization
    app.post('/organizations/:id/workspaces', async (request, reply) => {
        const organizationId = idSchema.safeParse(request.params.id);
        const body = createWorkspaceSchema.safeParse(request.body);
        if (!organizationId.success || !body.success) {
            return reply.code(400).send({
                error: 'VALIDATION_ERROR',
                message: 'Invalid organization ID or workspace data',
                details: body.success ? undefined : body.error.flatten(),
            });
        }
        try {
            const [workspace] = await db
                .insert(workspaces)
                .values({
                organizationId: organizationId.data,
                ...body.data,
            })
                .returning();
            return reply.code(201).send({ data: workspace });
        }
        catch (error) {
            if (isPostgresError(error, '23503')) {
                return reply.code(404).send({
                    error: 'NOT_FOUND',
                    message: 'Organization not found',
                });
            }
            if (isPostgresError(error, '23505')) {
                return reply.code(409).send({
                    error: 'CONFLICT',
                    message: 'A workspace with this slug already exists in this organization',
                });
            }
            request.log.error({ err: error }, 'Failed to create workspace');
            return reply.code(500).send({
                error: 'INTERNAL_SERVER_ERROR',
                message: 'Failed to create workspace',
            });
        }
    });
    // List workspaces belonging to an organization
    app.get('/organizations/:id/workspaces', async (request, reply) => {
        const parsed = idSchema.safeParse(request.params.id);
        if (!parsed.success) {
            return reply.code(400).send({
                error: 'VALIDATION_ERROR',
                message: 'Invalid organization ID',
            });
        }
        const [organization] = await db
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.id, parsed.data))
            .limit(1);
        if (!organization) {
            return reply.code(404).send({
                error: 'NOT_FOUND',
                message: 'Organization not found',
            });
        }
        const results = await db
            .select()
            .from(workspaces)
            .where(eq(workspaces.organizationId, parsed.data));
        return { data: results };
    });
};

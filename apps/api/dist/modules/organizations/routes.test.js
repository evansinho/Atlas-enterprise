import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { db, organizations, pool, } from '@atlas/database';
describe('Organization API', () => {
    let app;
    let organizationId;
    const slug = `atlas-test-${randomUUID()}`;
    beforeAll(async () => {
        app = buildApp();
        await app.ready();
    });
    afterAll(async () => {
        if (organizationId) {
            await db
                .delete(organizations)
                .where(eq(organizations.id, organizationId));
        }
        await app.close();
        await pool.end();
    });
    it('creates an organization', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/organizations',
            payload: {
                name: 'Atlas Test Organization',
                slug,
            },
        });
        expect(response.statusCode).toBe(201);
        const body = response.json();
        expect(body.data).toMatchObject({
            name: 'Atlas Test Organization',
            slug,
        });
        expect(body.data.id).toBeDefined();
        organizationId = body.data.id;
    });
    it('retrieves an organization', async () => {
        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/organizations/${organizationId}`,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().data).toMatchObject({
            id: organizationId,
            slug,
        });
    });
    it('rejects duplicate organization slugs', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/organizations',
            payload: {
                name: 'Another Organization',
                slug,
            },
        });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({
            error: 'CONFLICT',
        });
    });
    it('rejects invalid organization data', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/organizations',
            payload: {
                name: 'A',
                slug: 'Invalid Slug!',
            },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toBe('VALIDATION_ERROR');
    });
    it('creates a workspace within an organization', async () => {
        const response = await app.inject({
            method: 'POST',
            url: `/api/v1/organizations/${organizationId}/workspaces`,
            payload: {
                name: 'Engineering',
                slug: 'engineering',
            },
        });
        expect(response.statusCode).toBe(201);
        expect(response.json().data).toMatchObject({
            organizationId,
            name: 'Engineering',
            slug: 'engineering',
        });
    });
    it('lists workspaces belonging to an organization', async () => {
        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/organizations/${organizationId}/workspaces`,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().data).toEqual(expect.arrayContaining([
            expect.objectContaining({
                organizationId,
                slug: 'engineering',
            }),
        ]));
    });
    it('returns 404 for a nonexistent organization', async () => {
        const response = await app.inject({
            method: 'GET',
            url: `/api/v1/organizations/${randomUUID()}/workspaces`,
        });
        expect(response.statusCode).toBe(404);
    });
});

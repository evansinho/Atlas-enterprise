import { pgTable, pgEnum, uuid, varchar, timestamp, uniqueIndex, index, foreignKey, } from 'drizzle-orm/pg-core';
// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------
export const userStatusEnum = pgEnum('user_status', [
    'active',
    'disabled',
]);
export const membershipStatusEnum = pgEnum('membership_status', [
    'active',
    'invited',
    'suspended',
]);
export const organizationRoleEnum = pgEnum('organization_role', [
    'owner',
    'admin',
    'member',
]);
export const workspaceRoleEnum = pgEnum('workspace_role', [
    'admin',
    'member',
]);
// -----------------------------------------------------------------------------
// Organizations
// -----------------------------------------------------------------------------
export const organizations = pgTable('organizations', {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 160 }).notNull(),
    slug: varchar('slug', { length: 80 }).notNull(),
    createdAt: timestamp('created_at', {
        withTimezone: true,
    })
        .defaultNow()
        .notNull(),
    updatedAt: timestamp('updated_at', {
        withTimezone: true,
    })
        .defaultNow()
        .notNull(),
}, (table) => [
    uniqueIndex('organizations_slug_unique').on(table.slug),
]);
// -----------------------------------------------------------------------------
// Workspaces
// -----------------------------------------------------------------------------
export const workspaces = pgTable('workspaces', {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
        .notNull()
        .references(() => organizations.id, {
        onDelete: 'cascade',
    }),
    name: varchar('name', { length: 160 }).notNull(),
    slug: varchar('slug', { length: 80 }).notNull(),
    createdAt: timestamp('created_at', {
        withTimezone: true,
    })
        .defaultNow()
        .notNull(),
    updatedAt: timestamp('updated_at', {
        withTimezone: true,
    })
        .defaultNow()
        .notNull(),
}, (table) => [
    uniqueIndex('workspaces_organization_slug_unique').on(table.organizationId, table.slug),
    uniqueIndex('workspaces_id_organization_id_unique').on(table.id, table.organizationId),
    index('workspaces_organization_id_idx').on(table.organizationId),
]);
// -----------------------------------------------------------------------------
// Users
// -----------------------------------------------------------------------------
export const users = pgTable('users', {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 320 }),
    displayName: varchar('display_name', { length: 160 }),
    status: userStatusEnum('status')
        .default('active')
        .notNull(),
    createdAt: timestamp('created_at', {
        withTimezone: true,
    })
        .defaultNow()
        .notNull(),
    updatedAt: timestamp('updated_at', {
        withTimezone: true,
    })
        .defaultNow()
        .notNull(),
});
// -----------------------------------------------------------------------------
// Authentication identities
// -----------------------------------------------------------------------------
export const authIdentities = pgTable('auth_identities', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id, {
        onDelete: 'cascade',
    }),
    issuer: varchar('issuer', { length: 512 }).notNull(),
    subject: varchar('subject', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', {
        withTimezone: true,
    })
        .defaultNow()
        .notNull(),
}, (table) => [
    uniqueIndex('auth_identities_issuer_subject_unique').on(table.issuer, table.subject),
    index('auth_identities_user_id_idx').on(table.userId),
]);
// -----------------------------------------------------------------------------
// Organization memberships
// -----------------------------------------------------------------------------
export const organizationMemberships = pgTable('organization_memberships', {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
        .notNull()
        .references(() => organizations.id, {
        onDelete: 'cascade',
    }),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id, {
        onDelete: 'cascade',
    }),
    role: organizationRoleEnum('role')
        .default('member')
        .notNull(),
    status: membershipStatusEnum('status')
        .default('active')
        .notNull(),
    createdAt: timestamp('created_at', {
        withTimezone: true,
    })
        .defaultNow()
        .notNull(),
    updatedAt: timestamp('updated_at', {
        withTimezone: true,
    })
        .defaultNow()
        .notNull(),
}, (table) => [
    uniqueIndex('organization_memberships_org_user_unique').on(table.organizationId, table.userId),
    index('organization_memberships_user_id_idx').on(table.userId),
]);
// -----------------------------------------------------------------------------
// Workspace memberships
// -----------------------------------------------------------------------------
export const workspaceMemberships = pgTable('workspace_memberships', {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: workspaceRoleEnum('role')
        .default('member')
        .notNull(),
    status: membershipStatusEnum('status')
        .default('active')
        .notNull(),
    createdAt: timestamp('created_at', {
        withTimezone: true,
    })
        .defaultNow()
        .notNull(),
    updatedAt: timestamp('updated_at', {
        withTimezone: true,
    })
        .defaultNow()
        .notNull(),
}, (table) => [
    uniqueIndex('workspace_memberships_workspace_user_unique').on(table.workspaceId, table.userId),
    index('workspace_memberships_user_id_idx').on(table.userId),
    foreignKey({
        name: 'workspace_memberships_workspace_org_fk',
        columns: [table.workspaceId, table.organizationId],
        foreignColumns: [
            workspaces.id,
            workspaces.organizationId,
        ],
    }).onDelete('cascade'),
    foreignKey({
        name: 'workspace_memberships_org_user_fk',
        columns: [table.organizationId, table.userId],
        foreignColumns: [
            organizationMemberships.organizationId,
            organizationMemberships.userId,
        ],
    }).onDelete('cascade'),
]);

import { and, eq } from 'drizzle-orm'

import {
  organizationMemberships,
  type DatabaseTransaction,
} from '@atlas/database'

export type OrganizationRole = 'owner' | 'admin' | 'member'

export async function getActiveOrganizationMembership(
  tx: DatabaseTransaction,
  organizationId: string,
  userId: string,
) {
  const [membership] = await tx
    .select({
      id: organizationMemberships.id,
      role: organizationMemberships.role,
    })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, 'active'),
      ),
    )
    .limit(1)

  return membership ?? null
}

export function canManageOrganization(role: OrganizationRole): boolean {
  return role === 'owner' || role === 'admin'
}

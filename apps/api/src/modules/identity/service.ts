import { and, eq } from 'drizzle-orm'
import {
  authIdentities,
  db,
  users,
} from '@atlas/database'

import type { VerifiedOidcClaims } from './schemas.js'
import { IdentityIntegrityError } from './errors.js'

export async function findUserByOidcIdentity(
  issuer: string,
  subject: string,
) {
  const [identity] = await db
    .select({
      userId: authIdentities.userId,
    })
    .from(authIdentities)
    .where(
      and(
        eq(authIdentities.issuer, issuer),
        eq(authIdentities.subject, subject),
      ),
    )
    .limit(1)

  if (!identity) {
    return null
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, identity.userId))
    .limit(1)

  if (!user) {
    throw new IdentityIntegrityError(
      'Authentication identity references a nonexistent user',
    )
  }

  return user
}

export async function provisionUser(
  claims: VerifiedOidcClaims,
) {
  return db.transaction(async (tx) => {
    const [existingIdentity] = await tx
      .select({
        userId: authIdentities.userId,
      })
      .from(authIdentities)
      .where(
        and(
          eq(authIdentities.issuer, claims.issuer),
          eq(authIdentities.subject, claims.subject),
        ),
      )
      .limit(1)

    if (existingIdentity) {
      const [existingUser] = await tx
        .select()
        .from(users)
        .where(eq(users.id, existingIdentity.userId))
        .limit(1)

      if (!existingUser) {
        throw new IdentityIntegrityError(
          'Authentication identity references a nonexistent user',
        )
      }

      return {
        user: existingUser,
        created: false,
      }
    }

    const [user] = await tx
      .insert(users)
      .values({
        email: claims.email ?? null,
        displayName: claims.displayName ?? null,
      })
      .returning()

    if (!user) {
      throw new IdentityIntegrityError(
        'Failed to create user',
      )
    }

    const [identity] = await tx
      .insert(authIdentities)
      .values({
        userId: user.id,
        issuer: claims.issuer,
        subject: claims.subject,
      })
      .onConflictDoNothing({
        target: [
          authIdentities.issuer,
          authIdentities.subject,
        ],
      })
      .returning()

    if (identity) {
      return {
        user,
        created: true,
      }
    }

    // Another request provisioned this identity concurrently.
    // Remove our unused user and return the winning identity's user.
    await tx
      .delete(users)
      .where(eq(users.id, user.id))

    const [concurrentIdentity] = await tx
      .select({
        userId: authIdentities.userId,
      })
      .from(authIdentities)
      .where(
        and(
          eq(authIdentities.issuer, claims.issuer),
          eq(authIdentities.subject, claims.subject),
        ),
      )
      .limit(1)

    if (!concurrentIdentity) {
      throw new IdentityIntegrityError(
        'Identity provisioning conflict could not be resolved',
      )
    }

    const [concurrentUser] = await tx
      .select()
      .from(users)
      .where(eq(users.id, concurrentIdentity.userId))
      .limit(1)

    if (!concurrentUser) {
      throw new IdentityIntegrityError(
        'Authentication identity references a nonexistent user',
      )
    }

    return {
      user: concurrentUser,
      created: false,
    }
  })
}

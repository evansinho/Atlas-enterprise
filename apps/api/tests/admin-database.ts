import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'

import * as schema from '@atlas/database'

const connectionString = process.env.DATABASE_MIGRATION_URL

if (!connectionString) {
  throw new Error('DATABASE_MIGRATION_URL is required for API integration tests')
}

const adminPool = new Pool({ connectionString, max: 4 })

export const adminDb = drizzle(adminPool, { schema })

export async function closeAdminDatabase(): Promise<void> {
  await adminPool.end()
}

import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

const migrationUrl = process.env.DATABASE_MIGRATION_URL

if (!migrationUrl) {
  throw new Error('DATABASE_MIGRATION_URL is required for migrations')
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: migrationUrl,
  },
})

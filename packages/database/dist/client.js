import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL is required');
}
export const pool = new Pool({
    connectionString,
    max: 10,
});
export const db = drizzle(pool, { schema });
export async function withUserContext(userId, callback) {
    return db.transaction(async (tx) => {
        await tx.execute(sql `SELECT set_config('app.current_user_id', ${userId}, true)`);
        return callback(tx);
    });
}

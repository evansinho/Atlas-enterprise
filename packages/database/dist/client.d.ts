import { Pool } from 'pg';
import * as schema from './schema.js';
export declare const pool: Pool;
export declare const db: import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema> & {
    $client: Pool;
};
export type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export declare function withUserContext<T>(userId: string, callback: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;

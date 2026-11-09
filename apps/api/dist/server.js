import dotenv from 'dotenv';
import { z } from 'zod';
dotenv.config({
    path: '../../packages/database/.env',
});
const envSchema = z.object({
    NODE_ENV: z
        .enum(['development', 'test', 'production'])
        .default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
});
const env = envSchema.parse(process.env);
const { buildApp } = await import('./app.js');
const app = buildApp();
async function start() {
    try {
        await app.listen({
            host: env.HOST,
            port: env.PORT,
        });
    }
    catch (error) {
        app.log.error(error);
        process.exit(1);
    }
}
async function shutdown() {
    app.log.info('Shutting down API server');
    await app.close();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
await start();

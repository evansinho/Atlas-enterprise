import Fastify from 'fastify'
import { pool } from '@atlas/database'
import { organizationRoutes } from './modules/organizations/routes.js'

export function buildApp() {
  const app = Fastify({
    logger: true,
  })

  app.get('/health', async () => ({
    status: 'ok',
    service: 'atlas-api',
  }))

  app.get('/health/database', async (_request, reply) => {
    try {
      await pool.query('SELECT 1')

      return {
        status: 'ok',
        database: 'connected',
      }
    } catch (error) {
      app.log.error({ err: error }, 'Database health check failed')

      return reply.code(503).send({
        status: 'error',
        database: 'unavailable',
      })
    }
  })

  app.register(organizationRoutes, {
    prefix: '/api/v1',
  })

  return app
}

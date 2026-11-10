import type { AuthenticatedUser } from '../modules/identity/authenticate.js'

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser | null
  }
}

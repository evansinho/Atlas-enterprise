import { createClient } from 'redis'

const redisUrl = process.env.REDIS_URL

if (!redisUrl) {
  throw new Error('REDIS_URL is required')
}

export const redis = createClient({
  url: redisUrl,
})

redis.on('error', (error) => {
  console.error('Redis client error:', error)
})

let connectionPromise: Promise<void> | undefined

export function connectRedis(): Promise<void> {
  if (redis.isOpen) {
    return Promise.resolve()
  }

connectionPromise = redis.connect().then(
  () => undefined,
  (error: unknown) => {
    connectionPromise = undefined
    throw error
    },
  )

  return connectionPromise
}

export async function closeRedis(): Promise<void> {
  connectionPromise = undefined

  if (redis.isOpen) {
    await redis.close()
  }
}

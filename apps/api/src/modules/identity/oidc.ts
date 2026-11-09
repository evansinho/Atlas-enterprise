import * as oidc from 'openid-client'
import { z } from 'zod'

const oidcEnvironmentSchema = z.object({
  OIDC_ISSUER_URL: z.string().url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  OIDC_REDIRECT_URI: z.string().url(),
})

let configurationPromise: Promise<oidc.Configuration> | undefined

async function discoverProvider(): Promise<oidc.Configuration> {
  const env = oidcEnvironmentSchema.parse(process.env)

  const issuerUrl = new URL(env.OIDC_ISSUER_URL)
  const redirectUrl = new URL(env.OIDC_REDIRECT_URI)

  const isLoopback =
    issuerUrl.hostname === 'localhost' ||
    issuerUrl.hostname === '127.0.0.1' ||
    issuerUrl.hostname === '[::1]'

  const isLocalDevelopment =
    process.env.NODE_ENV !== 'production' &&
    issuerUrl.protocol === 'http:' &&
    isLoopback

  if (issuerUrl.protocol !== 'https:' && !isLocalDevelopment) {
    throw new Error(
      'OIDC issuer must use HTTPS outside local development',
    )
  }

  if (
    process.env.NODE_ENV === 'production' &&
    redirectUrl.protocol !== 'https:'
  ) {
    throw new Error(
      'OIDC redirect URI must use HTTPS in production',
    )
  }

  const metadata = {
    client_secret: env.OIDC_CLIENT_SECRET,
  }

  if (isLocalDevelopment) {
    return oidc.discovery(
      issuerUrl,
      env.OIDC_CLIENT_ID,
      metadata,
      oidc.ClientSecretBasic(env.OIDC_CLIENT_SECRET),
      {
        execute: [oidc.allowInsecureRequests],
      },
    )
  }

  return oidc.discovery(
    issuerUrl,
    env.OIDC_CLIENT_ID,
    metadata,
    oidc.ClientSecretBasic(env.OIDC_CLIENT_SECRET),
  )
}

export function getOidcConfiguration(): Promise<oidc.Configuration> {
  if (!configurationPromise) {
    configurationPromise = discoverProvider().catch((error: unknown) => {
      configurationPromise = undefined
      throw error
    })
  }

  return configurationPromise
}

export function getOidcRedirectUri(): string {
  return oidcEnvironmentSchema.parse(process.env).OIDC_REDIRECT_URI
}

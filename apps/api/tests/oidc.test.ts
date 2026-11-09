import { afterAll, describe, expect, it } from 'vitest'
import { getOidcConfiguration } from '../src/modules/identity/oidc.ts'

describe('OIDC provider discovery', () => {
  afterAll(() => {
    // No database connection is opened by this test.
  })

  it('discovers the Atlas Keycloak realm', async () => {
    const config = await getOidcConfiguration()

    expect(config.serverMetadata().issuer).toBe(
      'http://localhost:8080/realms/atlas',
    )

    expect(config.clientMetadata().client_id).toBe('atlas-api')
  })
})

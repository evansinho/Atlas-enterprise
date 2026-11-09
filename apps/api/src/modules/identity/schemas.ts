import { z } from 'zod'

export const verifiedOidcClaimsSchema = z.object({
  issuer: z.string().url().max(512),
  subject: z.string().min(1).max(255),
  email: z.string().email().max(320).optional(),
  displayName: z.string().trim().min(1).max(160).optional(),
})

export type VerifiedOidcClaims = z.infer<
  typeof verifiedOidcClaimsSchema
>

export class IdentityIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentityIntegrityError'
  }
}

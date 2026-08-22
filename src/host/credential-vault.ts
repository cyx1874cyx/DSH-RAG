import { AsyncEntry } from '@napi-rs/keyring'

export type CredentialVaultBackend =
  | 'windows-credential-manager'
  | 'macos-keychain'
  | 'linux-secret-service'
  | 'unsupported'

export interface CredentialVaultInfo {
  readonly available: boolean
  readonly configured: boolean
  readonly writable: boolean
  readonly persistent: boolean
  readonly backend: CredentialVaultBackend
}

export class CredentialVaultError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CredentialVaultError'
  }
}

function backendFor(platform: NodeJS.Platform): CredentialVaultBackend {
  if (platform === 'win32') return 'windows-credential-manager'
  if (platform === 'darwin') return 'macos-keychain'
  if (platform === 'linux') return 'linux-secret-service'
  return 'unsupported'
}

/**
 * Stores exactly one provider secret in the current user's native OS vault.
 * It has no file fallback: an unavailable desktop keyring must surface as
 * unavailable so the product can fall back only to inherited env/session use.
 */
export class SystemCredentialVault {
  readonly backend: CredentialVaultBackend
  private readonly entry: AsyncEntry | undefined

  constructor(service = 'io.github.imkelt.dsh-rag', account = 'siliconflow-api-key') {
    this.backend = backendFor(process.platform)
    this.entry = this.backend === 'unsupported' ? undefined : new AsyncEntry(service, account)
  }

  async describe(signal?: AbortSignal): Promise<CredentialVaultInfo> {
    if (this.entry === undefined) return this.info(false, false)
    try {
      const value = await this.entry.getPassword(signal)
      return this.info(true, value !== undefined && value !== null && value !== '')
    } catch {
      return this.info(false, false)
    }
  }

  async get(signal?: AbortSignal): Promise<string | undefined> {
    if (this.entry === undefined) return undefined
    try {
      const value = await this.entry.getPassword(signal)
      return value === undefined || value === null || value === '' ? undefined : value
    } catch (error) {
      throw new CredentialVaultError('The operating-system credential vault is unavailable', { cause: error })
    }
  }

  async set(value: string, signal?: AbortSignal): Promise<void> {
    if (value.trim() === '') throw new TypeError('credential must not be empty')
    if (this.entry === undefined) throw new CredentialVaultError('This operating system has no supported credential vault')
    try {
      await this.entry.setPassword(value, signal)
    } catch (error) {
      throw new CredentialVaultError('Failed to store the credential in the operating-system vault', { cause: error })
    }
  }

  async delete(signal?: AbortSignal): Promise<boolean> {
    if (this.entry === undefined) return false
    try {
      return await this.entry.deleteCredential(signal)
    } catch (error) {
      throw new CredentialVaultError('Failed to remove the credential from the operating-system vault', { cause: error })
    }
  }

  private info(available: boolean, configured: boolean): CredentialVaultInfo {
    return {
      available,
      configured,
      writable: available,
      persistent: available,
      backend: this.backend,
    }
  }
}

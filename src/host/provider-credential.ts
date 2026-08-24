import type { CredentialVaultInfo, SystemCredentialVault } from './credential-vault.ts'

export type ProviderCredentialSource = CredentialVaultInfo['backend'] | 'environment' | 'none'

export interface ProviderCredentialStatus {
  readonly configured: boolean
  readonly source: ProviderCredentialSource
  readonly osVaultAvailable: boolean
  readonly osVaultWritable: boolean
  readonly osVaultBackend: CredentialVaultInfo['backend']
}

type CredentialVault = Pick<SystemCredentialVault, 'describe' | 'get' | 'set' | 'delete'>

export class RuntimeProviderCredential {
  constructor(
    private readonly vault: CredentialVault,
    private readonly environmentValue: () => string | undefined = () => process.env.SILICONFLOW_API_KEY,
  ) {}

  async resolve(signal?: AbortSignal): Promise<string | undefined> {
    try {
      const stored = await this.vault.get(signal)
      if (stored !== undefined) return stored
    } catch {
      // A failed native vault must not block the explicit environment fallback.
    }
    const environment = this.environmentValue()?.trim()
    return environment === undefined || environment === '' ? undefined : environment
  }

  async describe(): Promise<ProviderCredentialStatus> {
    const vault = await this.vault.describe()
    const environmentConfigured = (this.environmentValue()?.trim() ?? '') !== ''
    return {
      configured: vault.configured || environmentConfigured,
      source: vault.configured
          ? vault.backend
          : environmentConfigured
            ? 'environment'
            : 'none',
      osVaultAvailable: vault.available,
      osVaultWritable: vault.writable,
      osVaultBackend: vault.backend,
    }
  }

  async set(value: string): Promise<void> {
    const normalized = value.trim()
    if (normalized === '') throw new TypeError('credential must not be empty')
    const info = await this.vault.describe()
    if (!info.available || !info.writable) throw new Error('operating-system credential vault is unavailable')
    await this.vault.set(normalized)
  }

  async delete(): Promise<void> {
    const info = await this.vault.describe()
    if (info.available) await this.vault.delete()
  }
}

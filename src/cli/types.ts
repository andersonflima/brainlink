export type VaultOptions = {
  readonly vault?: string
  readonly agent?: string
  readonly json?: boolean
}

export type InitOptions = {
  readonly json?: boolean
  readonly migrateFrom?: string
  readonly migrateExisting?: boolean
}

export type SearchOptions = VaultOptions & {
  readonly limit?: string
  readonly mode?: string
}

export type ContextOptions = SearchOptions & {
  readonly tokens?: string
}

export type ServerOptions = VaultOptions & {
  readonly host?: string
  readonly port?: string
  readonly index: boolean
  readonly watch?: boolean
}

export type AddOptions = VaultOptions & {
  readonly content?: string
  readonly allowSensitive?: boolean
  readonly contentFile?: string
  readonly autoIndex?: boolean
}

export type ConfigGetOptions = {
  readonly json?: boolean
}

export type ConfigSetVaultOptions = {
  readonly json?: boolean
  readonly global?: boolean
  readonly allowlist?: boolean
  readonly migrate?: boolean
  readonly migrateFrom?: string
  readonly index?: boolean
}

export type MigrateVaultOptions = {
  readonly json?: boolean
  readonly from?: string
  readonly to?: string
  readonly dryRun?: boolean
  readonly index?: boolean
}

export type AgentInstallOptions = {
  readonly json?: boolean
  readonly mcpOnly?: boolean
  readonly pluginPath?: string
  readonly allowedVaults?: string
  readonly brainlinkHome?: string
}

export type AgentStatusOptions = {
  readonly json?: boolean
}

export type VaultOptions = {
  readonly vault?: string
  readonly agent?: string
  readonly json?: boolean
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

export type StartServerInput = {
  readonly vaultPath: string
  readonly host: string
  readonly port: number
  readonly shouldIndex: boolean
  readonly shouldWatch: boolean
  readonly allowPublic?: boolean
}

export type RunningServer = {
  readonly url: string
  readonly close: () => Promise<void>
}

export type HttpResponse = {
  readonly body: string
  readonly statusCode: number
  readonly headers: Readonly<Record<string, string>>
}

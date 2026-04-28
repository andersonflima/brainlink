export const isLoopbackHost = (host: string): boolean =>
  host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.')

export const assertPublicBindAllowed = (host: string, allowPublic = false): void => {
  if (!allowPublic && !isLoopbackHost(host)) {
    throw new Error(`Refusing to bind Brainlink server to non-loopback host ${host}. Pass --allow-public only behind your own auth and TLS.`)
  }
}

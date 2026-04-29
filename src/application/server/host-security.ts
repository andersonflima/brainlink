export const isLoopbackHost = (host: string): boolean =>
  host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.')

export const assertLoopbackHost = (host: string): void => {
  if (!isLoopbackHost(host)) {
    throw new Error(`Refusing to bind Brainlink server to non-loopback host ${host}. Brainlink HTTP only runs on localhost.`)
  }
}

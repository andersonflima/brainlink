import { createServer } from 'node:http'
import { indexVault } from './index-vault.js'
import { startVaultWatcher } from './watch-vault.js'
import { assertPublicBindAllowed } from './server/host-security.js'
import { contentTypes, createJsonResponse, isHttpError } from './server/http.js'
import { route } from './server/routes.js'
import type { RunningServer, StartServerInput } from './server/types.js'

export const startServer = async (input: StartServerInput): Promise<RunningServer> => {
  assertPublicBindAllowed(input.host, input.allowPublic)

  if (input.shouldIndex) {
    await indexVault(input.vaultPath)
  }

  const watcher = input.shouldWatch
    ? startVaultWatcher({
        vaultPath: input.vaultPath,
        onError: (error) => console.error(error)
      })
    : null

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? input.host}`)

    route(request, url, input.vaultPath)
      .then((result) => {
        response.writeHead(result.statusCode, result.headers)
        response.end(result.body)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        const statusCode = isHttpError(error) ? error.statusCode : 500
        response.writeHead(statusCode, { 'content-type': contentTypes['.json'] })
        response.end(createJsonResponse({ error: message }))
      })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(input.port, input.host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : input.port

  return {
    url: `http://${input.host}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        watcher?.close()
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
  }
}

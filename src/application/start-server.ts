import { createServer } from 'node:http'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { indexVault } from './index-vault.js'
import { startVaultWatcher } from './watch-vault.js'
import { assertLoopbackHost } from './server/host-security.js'
import { contentTypes, createJsonResponse, isHttpError } from './server/http.js'
import { route } from './server/routes.js'
import type { RunningServer, StartServerInput } from './server/types.js'

const compressionThresholdBytes = 1024

const normalizeEncodingToken = (value: string): string =>
  value.trim().toLowerCase()

const supportsEncoding = (acceptEncoding: string | undefined, target: 'br' | 'gzip'): boolean => {
  if (!acceptEncoding) {
    return false
  }

  return acceptEncoding
    .split(',')
    .map((entry) => entry.split(';')[0] ?? '')
    .map(normalizeEncodingToken)
    .includes(target)
}

const isCompressibleContentType = (contentType: string | undefined): boolean => {
  const normalized = contentType?.toLowerCase() ?? ''

  return (
    normalized.includes('application/json') ||
    normalized.includes('text/javascript') ||
    normalized.includes('text/css') ||
    normalized.includes('text/html') ||
    normalized.startsWith('text/')
  )
}

const maybeCompressResponse = (
  requestHeaders: Readonly<Record<string, string | string[] | undefined>>,
  statusCode: number,
  headers: Readonly<Record<string, string>>,
  body: string
): { readonly headers: Readonly<Record<string, string>>; readonly body: string | Buffer } => {
  if (statusCode === 204 || statusCode === 304) {
    return { headers, body: '' }
  }

  if (!isCompressibleContentType(headers['content-type'])) {
    return { headers, body }
  }

  const bodyBuffer = Buffer.from(body, 'utf8')
  if (bodyBuffer.byteLength < compressionThresholdBytes) {
    return { headers, body }
  }

  if (headers['content-encoding']) {
    return { headers, body }
  }

  const acceptEncodingHeader = Array.isArray(requestHeaders['accept-encoding'])
    ? requestHeaders['accept-encoding'].join(',')
    : requestHeaders['accept-encoding']

  const vary = headers.vary ? `${headers.vary}, Accept-Encoding` : 'Accept-Encoding'
  const withVary = {
    ...headers,
    vary
  }

  if (supportsEncoding(acceptEncodingHeader, 'br')) {
    return {
      headers: {
        ...withVary,
        'content-encoding': 'br'
      },
      body: brotliCompressSync(bodyBuffer, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 5
        }
      })
    }
  }

  if (supportsEncoding(acceptEncodingHeader, 'gzip')) {
    return {
      headers: {
        ...withVary,
        'content-encoding': 'gzip'
      },
      body: gzipSync(bodyBuffer, {
        level: 6
      })
    }
  }

  return { headers: withVary, body }
}

export const startServer = async (input: StartServerInput): Promise<RunningServer> => {
  assertLoopbackHost(input.host)

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
        const encoded = maybeCompressResponse(request.headers, result.statusCode, result.headers, result.body)
        response.writeHead(result.statusCode, encoded.headers)
        response.end(encoded.body)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        const statusCode = isHttpError(error) ? error.statusCode : 500
        const fallback = maybeCompressResponse(
          request.headers,
          statusCode,
          { 'content-type': contentTypes['.json'] },
          createJsonResponse({ error: message })
        )
        response.writeHead(statusCode, fallback.headers)
        response.end(fallback.body)
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

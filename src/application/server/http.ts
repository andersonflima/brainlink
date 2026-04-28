import type { IncomingMessage } from 'node:http'

export const contentTypes: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
}

export const createJsonResponse = (value: unknown): string =>
  JSON.stringify(value, null, 2)

export const parsePositiveInteger = (value: string | null, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export type HttpError = Error & {
  readonly statusCode: number
}

export const isHttpError = (error: unknown): error is HttpError =>
  error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'

export const isReadMethod = (request: IncomingMessage): boolean =>
  request.method === 'GET' || request.method === 'HEAD'

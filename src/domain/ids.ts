import { createHash } from 'node:crypto'

export const createStableId = (input: string): string =>
  createHash('sha256').update(input).digest('hex').slice(0, 24)

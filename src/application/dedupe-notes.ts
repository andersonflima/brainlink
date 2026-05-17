import { createHash } from 'node:crypto'
import { createEmbeddingBuckets, createLocalEmbedding, cosineSimilarity } from '../domain/embeddings.js'
import { parseMarkdownDocument } from '../domain/markdown.js'
import { writeMarkdownFile, ensureVault, readMarkdownFiles } from '../infrastructure/file-system-vault.js'
import { indexVault } from './index-vault.js'

export type DuplicateDetectionKind = 'exact' | 'semantic'
export type DuplicateResolutionAction = 'merge' | 'link' | 'ignore'

export type DuplicateCandidate = {
  readonly id: string
  readonly possibleDuplicate: true
  readonly kind: DuplicateDetectionKind
  readonly score: number
  readonly left: {
    readonly title: string
    readonly path: string
    readonly agentId: string
  }
  readonly right: {
    readonly title: string
    readonly path: string
    readonly agentId: string
  }
  readonly reason: string
}

type ScanOptions = {
  readonly agentId?: string
  readonly limit?: number
  readonly minSemanticScore?: number
  readonly includeSemantic?: boolean
  readonly focusPath?: string
}

type ResolveOptions = {
  readonly leftPath: string
  readonly rightPath: string
  readonly action: DuplicateResolutionAction
  readonly autoIndex?: boolean
}

export type ResolveDuplicateResult = {
  readonly action: DuplicateResolutionAction
  readonly leftPath: string
  readonly rightPath: string
  readonly updatedPaths: readonly string[]
  readonly index?: Awaited<ReturnType<typeof indexVault>>
}

type NoteRecord = {
  readonly title: string
  readonly path: string
  readonly agentId: string
  readonly content: string
  readonly normalizedStrictContent: string
  readonly semanticContent: string
  readonly embedding: readonly number[]
  readonly buckets: readonly string[]
}

const tokenPattern = /[\p{L}\p{N}_-]+/gu
const frontmatterPattern = /^---\n[\s\S]*?\n---\n?/m
const rootHeadingPattern = /^#\s+.+\n+/m
const maxCandidatesPerBucket = 240

const normalizePath = (path: string): string =>
  path.replaceAll('\\', '/').replace(/^\.\//, '')

const toComparableBody = (content: string): string =>
  content
    .replace(frontmatterPattern, '')
    .replace(rootHeadingPattern, '')
    .replaceAll('\r\n', '\n')
    .trim()

const normalizeStrictContent = (content: string): string =>
  toComparableBody(content)

const normalizeSemanticContent = (content: string): string =>
  toComparableBody(content)
    .replace(/\s+/g, ' ')
    .trim()

const toHash = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex')

const toCandidateId = (leftPath: string, rightPath: string): string =>
  [normalizePath(leftPath), normalizePath(rightPath)].sort((left, right) => left.localeCompare(right)).join('|')

const hasSharedTokens = (left: string, right: string): boolean => {
  const leftTokens = new Set((left.match(tokenPattern) ?? []).map((token) => token.toLowerCase()).filter((token) => token.length > 2))
  const rightTokens = new Set((right.match(tokenPattern) ?? []).map((token) => token.toLowerCase()).filter((token) => token.length > 2))

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return false
  }

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      return true
    }
  }

  return false
}

const relatedMarker = (targetTitle: string): string =>
  `Related: [[${targetTitle}]] priority: low #related-to`

const ensureRelatedEdgeLine = (content: string, targetTitle: string): string => {
  const linkPattern = new RegExp(`\\[\\[\\s*${targetTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:[\\]|#])?`, 'i')
  if (linkPattern.test(content)) {
    return content
  }

  const trimmed = content.trimEnd()
  return `${trimmed}\n\n${relatedMarker(targetTitle)}\n`
}

const ensureMergedMarker = (content: string, targetTitle: string): string => {
  const marker = `Merged into [[${targetTitle}]]`
  if (content.includes(marker)) {
    return content
  }

  return `${content.trimEnd()}\n\n${marker} priority: low #related-to\n`
}

const appendMergedContent = (baseContent: string, mergedTitle: string, mergedContent: string): string => {
  const marker = `## Merged Memory From [[${mergedTitle}]]`
  if (baseContent.includes(marker)) {
    return baseContent
  }

  const mergedBody = normalizeSemanticContent(mergedContent)
  return `${baseContent.trimEnd()}\n\n${marker}\n\n${mergedBody}\n`
}

const loadNoteRecords = async (vaultPath: string, agentId?: string): Promise<readonly NoteRecord[]> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const files = await readMarkdownFiles(vaultPath)

  return files
    .map((file) => {
      const parsed = parseMarkdownDocument({
        absolutePath: file.absolutePath,
        vaultPath: absoluteVaultPath,
        content: file.content,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt
      })
      const strict = normalizeStrictContent(parsed.content)
      const semantic = normalizeSemanticContent(parsed.content)
      const embedding = createLocalEmbedding(`${parsed.title}\n${semantic}`)

      return {
        title: parsed.title,
        path: normalizePath(parsed.path),
        agentId: parsed.agentId,
        content: parsed.content,
        normalizedStrictContent: strict,
        semanticContent: semantic,
        embedding,
        buckets: createEmbeddingBuckets(embedding, 20)
      } satisfies NoteRecord
    })
    .filter((record) => (agentId ? record.agentId === agentId : true))
}

const pairToCandidate = (
  left: NoteRecord,
  right: NoteRecord,
  kind: DuplicateDetectionKind,
  score: number,
  reason: string
): DuplicateCandidate => ({
  id: toCandidateId(left.path, right.path),
  possibleDuplicate: true,
  kind,
  score: Number(score.toFixed(4)),
  left: {
    title: left.title,
    path: left.path,
    agentId: left.agentId
  },
  right: {
    title: right.title,
    path: right.path,
    agentId: right.agentId
  },
  reason
})

const indexCandidatePairs = (notes: readonly NoteRecord[]): readonly [number, number][] => {
  const bucketMap = new Map<string, number[]>()

  notes.forEach((note, index) => {
    note.buckets.forEach((bucket) => {
      const current = bucketMap.get(bucket) ?? []
      if (current.length < maxCandidatesPerBucket) {
        current.push(index)
        bucketMap.set(bucket, current)
      }
    })
  })

  const pairKeys = new Set<string>()
  const pairs: [number, number][] = []

  bucketMap.forEach((indexes) => {
    for (let leftIndex = 0; leftIndex < indexes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < indexes.length; rightIndex += 1) {
        const left = Math.min(indexes[leftIndex] ?? 0, indexes[rightIndex] ?? 0)
        const right = Math.max(indexes[leftIndex] ?? 0, indexes[rightIndex] ?? 0)
        const key = `${left}|${right}`
        if (!pairKeys.has(key)) {
          pairKeys.add(key)
          pairs.push([left, right])
        }
      }
    }
  })

  return pairs
}

export const scanDuplicateNotes = async (vaultPath: string, options: ScanOptions = {}): Promise<readonly DuplicateCandidate[]> => {
  const notes = await loadNoteRecords(vaultPath, options.agentId)
  if (notes.length < 2) {
    return []
  }

  const minSemanticScore = options.minSemanticScore ?? 0.92
  const includeSemantic = options.includeSemantic !== false
  const seen = new Map<string, DuplicateCandidate>()

  const byHash = notes.reduce<Map<string, NoteRecord[]>>((state, note) => {
    const key = toHash(note.normalizedStrictContent)
    const current = state.get(key) ?? []
    current.push(note)
    state.set(key, current)
    return state
  }, new Map())

  byHash.forEach((group) => {
    if (group.length < 2) {
      return
    }

    const [base, ...rest] = group.sort((left, right) => left.path.localeCompare(right.path))
    rest.forEach((note) => {
      const candidate = pairToCandidate(base, note, 'exact', 1, 'Exact content hash match')
      seen.set(candidate.id, candidate)
    })
  })

  if (includeSemantic) {
    const pairs = indexCandidatePairs(notes)
    pairs.forEach(([leftIndex, rightIndex]) => {
      const left = notes[leftIndex]
      const right = notes[rightIndex]
      if (!left || !right || left.path === right.path) {
        return
      }

      const id = toCandidateId(left.path, right.path)
      if (seen.has(id)) {
        return
      }

      const score = cosineSimilarity(left.embedding, right.embedding)
      const titleShared = hasSharedTokens(left.title, right.title)
      const contentShared = hasSharedTokens(left.semanticContent, right.semanticContent)
      if (score >= minSemanticScore && (titleShared || contentShared || score >= 0.975)) {
        const candidate = pairToCandidate(left, right, 'semantic', score, 'High semantic similarity')
        seen.set(id, candidate)
      }
    })
  }

  const focusPath = options.focusPath ? normalizePath(options.focusPath) : undefined
  const limited = Array.from(seen.values())
    .filter((item) => (focusPath ? item.left.path === focusPath || item.right.path === focusPath : true))
    .sort((left, right) => right.score - left.score || left.left.path.localeCompare(right.left.path))
    .slice(0, Math.max(1, options.limit ?? 25))

  return limited
}

export const resolveDuplicateNotes = async (vaultPath: string, options: ResolveOptions): Promise<ResolveDuplicateResult> => {
  const leftPath = normalizePath(options.leftPath)
  const rightPath = normalizePath(options.rightPath)
  if (leftPath === rightPath) {
    throw new Error('leftPath and rightPath must be different notes.')
  }

  const notes = await loadNoteRecords(vaultPath)
  const byPath = new Map(notes.map((note) => [note.path, note]))
  const left = byPath.get(leftPath)
  const right = byPath.get(rightPath)

  if (!left || !right) {
    throw new Error(`Duplicate resolution paths were not found in vault index source: ${leftPath}, ${rightPath}`)
  }

  const updates = new Map<string, string>()
  const leftRelated = ensureRelatedEdgeLine(left.content, right.title)
  const rightRelated = ensureRelatedEdgeLine(right.content, left.title)

  if (options.action === 'link') {
    updates.set(left.path, leftRelated)
    updates.set(right.path, rightRelated)
  } else if (options.action === 'ignore') {
    updates.set(left.path, leftRelated)
  } else {
    const mergedLeft = appendMergedContent(leftRelated, right.title, right.content)
    const mergedRight = ensureMergedMarker(rightRelated, left.title)
    updates.set(left.path, mergedLeft)
    updates.set(right.path, mergedRight)
  }

  for (const [path, content] of updates) {
    await writeMarkdownFile(vaultPath, path, content)
  }

  const shouldIndex = options.autoIndex !== false
  const index = shouldIndex ? await indexVault(vaultPath) : undefined

  return {
    action: options.action,
    leftPath,
    rightPath,
    updatedPaths: Array.from(updates.keys()).sort((leftValue, rightValue) => leftValue.localeCompare(rightValue)),
    ...(index ? { index } : {})
  }
}

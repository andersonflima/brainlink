import { basename, relative } from 'node:path'
import { resolveAgentIdFromPath, sanitizeAgentId } from './agents.js'
import { createStableId } from './ids.js'
import { estimateTokenCount } from './tokens.js'
import type { IndexedDocument, KnowledgeChunk, KnowledgeDocument, KnowledgeLink, LinkPriority } from './types.js'

type TitleResolver = {
  readonly get: (title: string) => string | null | undefined
}

type ParseMarkdownDocumentInput = {
  readonly absolutePath: string
  readonly vaultPath: string
  readonly content: string
  readonly createdAt: Date
  readonly updatedAt: Date
}

const frontmatterPattern = /^---\n([\s\S]*?)\n---\n?/
const wikiLinkPattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g
const tagPattern = /(^|\s)#([A-Za-z0-9][A-Za-z0-9_-]*)/g
const headingPattern = /^#\s+(.+)$/m

type WikiLinkReference = {
  readonly title: string
  readonly weight: number
  readonly priority: LinkPriority | null
}

type WikiLinkWeight = {
  readonly title: string
  readonly weight: number
  readonly priority: LinkPriority
}

type VisibleMarkdownLine = {
  readonly content: string
  readonly fenced: boolean
}

type VisibleMarkdownLineState = {
  readonly lines: VisibleMarkdownLine[]
  readonly fenced: boolean
}

const priorityRanks: Readonly<Record<LinkPriority, number>> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3
}

const priorityBoosts: Readonly<Record<LinkPriority, number>> = {
  low: 0,
  normal: 1,
  high: 3,
  critical: 6
}

const priorityPatterns: readonly (readonly [LinkPriority, RegExp])[] = [
  ['critical', /\b(?:priority|prioridade|importance|importancia|importância)\s*[:=]\s*(?:critical|critica|crítica|urgent|urgente|p0)\b/i],
  ['critical', /#(?:critical|critica|crítica|urgent|urgente|p0)\b/i],
  ['high', /\b(?:priority|prioridade|importance|importancia|importância)\s*[:=]\s*(?:high|alta|important|importante|p1)\b/i],
  ['high', /#(?:high-priority|important|importante|p1)\b/i],
  ['normal', /\b(?:priority|prioridade|importance|importancia|importância)\s*[:=]\s*(?:normal|medium|media|média|p2)\b/i],
  ['normal', /#(?:normal-priority|medium-priority|p2)\b/i],
  ['low', /\b(?:priority|prioridade|importance|importancia|importância)\s*[:=]\s*(?:low|baixa|p3)\b/i],
  ['low', /#(?:low-priority|baixa-prioridade|p3)\b/i]
]

const normalizeTitle = (title: string): string =>
  title.trim().replace(/\.md$/i, '')

const unique = (values: readonly string[]): readonly string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))

const maxPriority = (left: LinkPriority, right: LinkPriority): LinkPriority =>
  priorityRanks[left] >= priorityRanks[right] ? left : right

const parseFrontmatter = (content: string): Readonly<Record<string, string>> => {
  const match = content.match(frontmatterPattern)

  if (!match) {
    return {}
  }

  return match[1]
    .split('\n')
    .map((line) => line.match(/^([^:#]+):\s*(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .reduce<Record<string, string>>(
      (frontmatter, match) => ({
        ...frontmatter,
        [match[1].trim()]: match[2].trim().replace(/^["']|["']$/g, '')
      }),
      {}
    )
}

const stripFrontmatter = (content: string): string =>
  content.replace(frontmatterPattern, '')

const stripFencedCodeBlocks = (content: string): string =>
  content.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '')

const visibleMarkdownLines = (content: string): readonly VisibleMarkdownLine[] =>
  content.split('\n').reduce<VisibleMarkdownLineState>(
    (state, line) => {
      const togglesFence = /^\s*(?:```|~~~)/.test(line)
      const fenced = togglesFence ? !state.fenced : state.fenced
      state.lines.push({ content: line, fenced })

      return {
        lines: state.lines,
        fenced
      }
    },
    {
      lines: [],
      fenced: false
    }
  ).lines

const linePriority = (line: string): LinkPriority | null =>
  priorityPatterns.find(([, pattern]) => pattern.test(line))?.[0] ?? null

const linkReferenceWeight = (line: string, priority: LinkPriority | null): number => {
  const headingBoost = /^\s{0,3}#{1,6}\s+/.test(line) ? 2 : 0
  const taskBoost = /^\s*[-*]\s+\[[ x]\]/i.test(line) ? 1 : 0

  return 1 + (priority ? priorityBoosts[priority] : 0) + headingBoost + taskBoost
}

export const extractWikiLinkReferences = (content: string): readonly WikiLinkReference[] =>
  visibleMarkdownLines(content)
    .filter((line) => !line.fenced)
    .flatMap((line) => {
      const priority = linePriority(line.content)
      const weight = linkReferenceWeight(line.content, priority)

      return Array.from(line.content.matchAll(wikiLinkPattern), (match) => ({
        title: normalizeTitle(match[1]),
        weight,
        priority
      }))
    })

const priorityFromWeight = (weight: number): LinkPriority =>
  weight >= 8 ? 'critical' : weight >= 4 ? 'high' : 'normal'

export const extractWikiLinkWeights = (content: string): readonly WikiLinkWeight[] => {
  const weights = extractWikiLinkReferences(content).reduce<Map<string, WikiLinkWeight>>((state, reference) => {
    const titleKey = reference.title.toLowerCase()
    const current = state.get(titleKey)
    const weight = (current?.weight ?? 0) + reference.weight
    const explicitPriority = reference.priority
      ? maxPriority(current?.priority ?? reference.priority, reference.priority)
      : current?.priority
    const derivedPriority = priorityFromWeight(weight)
    const priority =
      explicitPriority === 'low' && weight === 1
        ? 'low'
        : maxPriority(explicitPriority ?? derivedPriority, derivedPriority)

    state.set(titleKey, {
      title: current?.title ?? reference.title,
      weight,
      priority
    })

    return state
  }, new Map())

  return Array.from(weights.values())
}

const extractTitle = (filePath: string, content: string, frontmatter: Readonly<Record<string, string>>): string => {
  if (frontmatter.title) {
    return normalizeTitle(frontmatter.title)
  }

  const heading = content.match(headingPattern)

  if (heading) {
    return normalizeTitle(heading[1])
  }

  return normalizeTitle(basename(filePath))
}

export const extractWikiLinks = (content: string): readonly string[] =>
  unique(extractWikiLinkReferences(content).map((reference) => reference.title))

export const extractTags = (content: string): readonly string[] =>
  unique(Array.from(stripFencedCodeBlocks(content).matchAll(tagPattern), (match) => match[2]))

const normalizeChunkContent = (content: string): string =>
  content
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export const splitIntoChunks = (documentId: string, content: string, maxCharacters = 1200): readonly KnowledgeChunk[] => {
  const paragraphs = normalizeChunkContent(stripFrontmatter(content))
    .split(/\n{2,}/)
    .filter(Boolean)

  const chunks = paragraphs.reduce<readonly string[]>(
    (state, paragraph) => {
      const lastChunk = state.at(-1)

      if (!lastChunk) {
        return [paragraph]
      }

      const merged = `${lastChunk}\n\n${paragraph}`

      if (merged.length <= maxCharacters) {
        return [...state.slice(0, -1), merged]
      }

      return [...state, paragraph]
    },
    []
  )

  return chunks.map((chunk, ordinal) => ({
    id: createStableId(`${documentId}:${ordinal}:${chunk}`),
    documentId,
    ordinal,
    content: chunk,
    tokenCount: estimateTokenCount(chunk),
    embeddingProvider: 'none',
    embedding: []
  }))
}

export const parseMarkdownDocument = (input: ParseMarkdownDocumentInput): KnowledgeDocument => {
  const relativePath = relative(input.vaultPath, input.absolutePath)
  const frontmatter = parseFrontmatter(input.content)
  const title = extractTitle(input.absolutePath, input.content, frontmatter)
  const agentId = frontmatter.agent ? sanitizeAgentId(frontmatter.agent) : resolveAgentIdFromPath(relativePath)

  return {
    id: createStableId(relativePath),
    agentId,
    title,
    path: relativePath,
    content: input.content,
    tags: extractTags(input.content),
    links: extractWikiLinks(input.content),
    frontmatter,
    createdAt: input.createdAt.toISOString(),
    updatedAt: input.updatedAt.toISOString()
  }
}

export const createIndexedDocument = (
  document: KnowledgeDocument,
  titleToDocumentId: TitleResolver,
  maxChunkCharacters = 1200
): IndexedDocument => {
  const chunks = splitIntoChunks(document.id, document.content, maxChunkCharacters)
  const linkWeights = new Map(extractWikiLinkWeights(document.content).map((link) => [link.title.toLowerCase(), link]))
  const links = document.links.map<KnowledgeLink>((toTitle) => ({
    fromDocumentId: document.id,
    toTitle,
    toDocumentId: titleToDocumentId.get(toTitle.toLowerCase()) ?? null,
    weight: linkWeights.get(toTitle.toLowerCase())?.weight ?? 1,
    priority: linkWeights.get(toTitle.toLowerCase())?.priority ?? 'normal'
  }))

  return {
    document,
    chunks,
    links
  }
}

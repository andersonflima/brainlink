import { basename, relative } from 'node:path'
import { resolveAgentIdFromPath, sanitizeAgentId } from './agents.js'
import { createStableId } from './ids.js'
import { estimateTokenCount } from './tokens.js'
import type { IndexedDocument, KnowledgeChunk, KnowledgeDocument, KnowledgeLink } from './types.js'

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

const normalizeTitle = (title: string): string =>
  title.trim().replace(/\.md$/i, '')

const unique = (values: readonly string[]): readonly string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))

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
  unique(Array.from(stripFencedCodeBlocks(content).matchAll(wikiLinkPattern), (match) => normalizeTitle(match[1])))

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
    tokenCount: estimateTokenCount(chunk)
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
  titleToDocumentId: ReadonlyMap<string, string>
): IndexedDocument => {
  const chunks = splitIntoChunks(document.id, document.content)
  const links = document.links.map<KnowledgeLink>((toTitle) => ({
    fromDocumentId: document.id,
    toTitle,
    toDocumentId: titleToDocumentId.get(toTitle.toLowerCase()) ?? null
  }))

  return {
    document,
    chunks,
    links
  }
}

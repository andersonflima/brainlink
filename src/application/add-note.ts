import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { writeMarkdownFile } from '../infrastructure/file-system-vault.js'
import { sanitizeAgentId, sharedAgentId } from '../domain/agents.js'
import { extractWikiLinks } from '../domain/markdown.js'
import { validateNoteInput } from '../domain/note-safety.js'
import { ensureVault } from '../infrastructure/file-system-vault.js'

type AddNoteOptions = {
  readonly allowSensitive?: boolean
}

export type AddNoteResult = {
  readonly path: string
  readonly autoLinked: boolean
  readonly linkTarget: string | null
}

const slugify = (title: string): string =>
  title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const systemHubTitle = 'Memory Hub'
const systemRootTitle = 'Knowledge Root'

const normalizeTitle = (title: string): string =>
  title.trim().replace(/\.md$/i, '').toLowerCase()

const noteFilename = (agentId: string, title: string): string =>
  `agents/${agentId}/${slugify(title) || 'untitled'}.md`

const buildNote = (title: string, content: string, agentId: string): string =>
  [
    `---`,
    `title: "${title.replaceAll('"', '\\"')}"`,
    `agent: "${agentId}"`,
    `---`,
    '',
    `# ${title}`,
    '',
    content.trim(),
    ''
  ].join('\n')

const ensureSystemNote = async (
  vaultPath: string,
  absoluteVaultPath: string,
  agentId: string,
  title: string,
  content: string
): Promise<void> => {
  const filename = noteFilename(agentId, title)
  const absolutePath = join(absoluteVaultPath, filename)

  try {
    await access(absolutePath)
    return
  } catch {}

  await writeMarkdownFile(vaultPath, filename, buildNote(title, content, agentId))
}

const ensureNonOrphanContent = async (
  vaultPath: string,
  absoluteVaultPath: string,
  title: string,
  content: string,
  agentId: string
): Promise<{ readonly content: string; readonly autoLinked: boolean; readonly linkTarget: string | null }> => {
  const links = extractWikiLinks(content).filter((link) => normalizeTitle(link) !== normalizeTitle(title))

  if (links.length > 0) {
    return {
      content: content.trim(),
      autoLinked: false,
      linkTarget: null
    }
  }

  const fallbackTitle = normalizeTitle(title) === normalizeTitle(systemHubTitle) ? systemRootTitle : systemHubTitle

  if (fallbackTitle === systemRootTitle) {
    await ensureSystemNote(
      vaultPath,
      absoluteVaultPath,
      agentId,
      systemRootTitle,
      `Entry point for agent memory. [[${systemHubTitle}]] #memory #root`
    )
  } else {
    await ensureSystemNote(
      vaultPath,
      absoluteVaultPath,
      agentId,
      systemHubTitle,
      'Central memory index for this agent namespace. #memory #hub'
    )
  }

  return {
    content: `${content.trim()}\n\nRelated: [[${fallbackTitle}]]`,
    autoLinked: true,
    linkTarget: fallbackTitle
  }
}

export const addNoteWithMetadata = async (
  vaultPath: string,
  title: string,
  content: string,
  agentId = sharedAgentId,
  options: AddNoteOptions = {}
): Promise<AddNoteResult> => {
  validateNoteInput({
    title,
    content,
    allowSensitive: options.allowSensitive
  })

  const sanitizedAgentId = sanitizeAgentId(agentId)
  const absoluteVaultPath = await ensureVault(vaultPath)
  const filename = `agents/${sanitizedAgentId}/${slugify(title) || 'untitled'}.md`
  const linkedContent = await ensureNonOrphanContent(vaultPath, absoluteVaultPath, title, content, sanitizedAgentId)
  const note = buildNote(title, linkedContent.content, sanitizedAgentId)
  const path = await writeMarkdownFile(vaultPath, filename, note)

  return {
    path,
    autoLinked: linkedContent.autoLinked,
    linkTarget: linkedContent.linkTarget
  }
}

export const addNote = async (
  vaultPath: string,
  title: string,
  content: string,
  agentId = sharedAgentId,
  options: AddNoteOptions = {}
): Promise<string> => (await addNoteWithMetadata(vaultPath, title, content, agentId, options)).path

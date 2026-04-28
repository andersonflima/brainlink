import { writeMarkdownFile } from '../infrastructure/file-system-vault.js'
import { sanitizeAgentId, sharedAgentId } from '../domain/agents.js'
import { validateNoteInput } from '../domain/note-safety.js'

type AddNoteOptions = {
  readonly allowSensitive?: boolean
}

const slugify = (title: string): string =>
  title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const addNote = async (
  vaultPath: string,
  title: string,
  content: string,
  agentId = sharedAgentId,
  options: AddNoteOptions = {}
): Promise<string> => {
  validateNoteInput({
    title,
    content,
    allowSensitive: options.allowSensitive
  })

  const sanitizedAgentId = sanitizeAgentId(agentId)
  const filename = `agents/${sanitizedAgentId}/${slugify(title) || 'untitled'}.md`
  const note = [
    `---`,
    `title: "${title.replaceAll('"', '\\"')}"`,
    `agent: "${sanitizedAgentId}"`,
    `---`,
    '',
    `# ${title}`,
    '',
    content.trim(),
    ''
  ].join('\n')

  return writeMarkdownFile(vaultPath, filename, note)
}

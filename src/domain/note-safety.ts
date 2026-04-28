export type SensitiveContentFinding = {
  readonly label: string
}

export type NoteValidationInput = {
  readonly title: string
  readonly content: string
  readonly allowSensitive?: boolean
}

const maxTitleLength = 160
const maxContentLength = 200_000

const sensitivePatterns: readonly {
  readonly label: string
  readonly pattern: RegExp
}[] = [
  {
    label: 'private key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/
  },
  {
    label: 'OpenAI API key',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/
  },
  {
    label: 'GitHub token',
    pattern: /\b(?:ghp|gho|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/
  },
  {
    label: 'AWS access key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/
  },
  {
    label: 'Slack token',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/
  },
  {
    label: 'JWT',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/
  },
  {
    label: 'secret assignment',
    pattern: /\b(?:api[_-]?key|secret|password|private[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/i
  }
]

export const findSensitiveContent = (value: string): readonly SensitiveContentFinding[] =>
  sensitivePatterns
    .filter(({ pattern }) => pattern.test(value))
    .map(({ label }) => ({ label }))

export const validateNoteInput = (input: NoteValidationInput): void => {
  if (!input.title.trim()) {
    throw new Error('Note title cannot be empty.')
  }

  if (!input.content.trim()) {
    throw new Error('Note content cannot be empty.')
  }

  if (input.title.length > maxTitleLength) {
    throw new Error(`Note title is too long. Maximum length is ${maxTitleLength} characters.`)
  }

  if (input.content.length > maxContentLength) {
    throw new Error(`Note content is too large. Maximum length is ${maxContentLength} characters.`)
  }

  const findings = findSensitiveContent(`${input.title}\n${input.content}`)

  if (findings.length > 0 && !input.allowSensitive) {
    const labels = Array.from(new Set(findings.map((finding) => finding.label))).join(', ')

    throw new Error(`Sensitive memory blocked (${labels}). Remove secrets or pass --allow-sensitive intentionally.`)
  }
}

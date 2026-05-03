export const sharedAgentId = 'shared'

export const sanitizeAgentId = (agentId: string): string =>
  agentId
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || sharedAgentId

export const resolveAgentIdFromPath = (path: string): string => {
  const normalizedPath = path.replace(/\\/g, '/')
  const [scope, agentId] = normalizedPath.split('/')

  return scope === 'agents' && agentId ? sanitizeAgentId(agentId) : sharedAgentId
}

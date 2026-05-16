import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { z } from 'zod'
import { getBrokenLinksReport, getOrphansReport, getStats, validateVault } from '../application/analyze-vault.js'
import { addNote } from '../application/add-note.js'
import { buildContextPackage } from '../application/build-context.js'
import { getGraph } from '../application/get-graph.js'
import { indexVault } from '../application/index-vault.js'
import { searchKnowledge } from '../application/search-knowledge.js'
import { sanitizeSearchMode } from '../infrastructure/config.js'
import { loadBrainlinkConfig } from '../infrastructure/config.js'
import { assertVaultAllowed } from '../infrastructure/file-system-vault.js'
import { getBootstrapPolicy, getBootstrapSessionStatus, setBootstrapPolicy, touchBootstrapSession } from '../infrastructure/session-state.js'

const positiveInteger = (fallback: number) =>
  z
    .number()
    .int()
    .positive()
    .optional()
    .transform((value) => value ?? fallback)

const vaultInput = {
  vault: z.string().min(1).optional().describe('Vault directory. Omit to use the configured Brainlink default vault.')
}

type ToolInput = {
  readonly vault?: string
  readonly agent?: string
}

const agentInput = {
  agent: z
    .string()
    .min(1)
    .optional()
    .describe('Agent memory namespace. Omit to use Brainlink.config defaultAgent, otherwise read all agent namespaces.')
}

const searchModeInput = {
  mode: z.enum(['fts', 'semantic', 'hybrid']).optional().describe('Search mode. Defaults to the Brainlink config value.')
}

const resolveExecutionContext = async (input: ToolInput) => {
  const config = await loadBrainlinkConfig()
  const vault = await assertVaultAllowed(input.vault ?? config.vault, config.allowedVaults)
  const agent = input.agent ?? config.defaultAgent

  return {
    config,
    vault,
    agent
  }
}

const inferTitleFromPath = (filePath: string): string => {
  const extension = extname(filePath)
  const fromFileName = basename(filePath, extension)

  return fromFileName
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const isTruthy = (value: boolean | undefined): boolean => value !== false

const jsonResult = (value: Readonly<Record<string, unknown>>): CallToolResult => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(value, null, 2)
    }
  ],
  structuredContent: value
})

const preflightResult = (value: Readonly<Record<string, unknown>>): CallToolResult => jsonResult({
  preflightRequired: true,
  ...value
})

const ensureBootstrapReady = async (
  context: { vault: string; agent?: string },
  input: Readonly<Record<string, unknown>>,
  toolName: string
): Promise<CallToolResult | undefined> => {
  const policy = await getBootstrapPolicy()

  if (!policy.enforceBootstrap) {
    return undefined
  }

  const status = await getBootstrapSessionStatus(context.vault, context.agent)

  if (status.ready) {
    return undefined
  }

  const mode = typeof input.mode === 'string' && ['fts', 'semantic', 'hybrid'].includes(input.mode) ? input.mode : 'hybrid'
  const query = typeof input.query === 'string' && input.query.trim().length > 0 ? input.query : undefined

  return preflightResult({
    vault: context.vault,
    agent: context.agent,
    blockedTool: toolName,
    policy,
    bootstrapStatus: status,
    guidance:
      'Run brainlink_bootstrap first for this vault/agent before using read tools. This keeps retrieval grounded and memory state consistent.',
    bootstrapArgs: {
      vault: context.vault,
      ...(context.agent ? { agent: context.agent } : {}),
      ...(query ? { query } : {}),
      mode
    }
  })
}

export const contextInputSchema = {
  ...vaultInput,
  ...agentInput,
  ...searchModeInput,
  query: z.string().min(1).describe('Task or question to retrieve Brainlink context for.'),
  limit: positiveInteger(12).describe('Maximum search results before context selection.'),
  tokens: positiveInteger(2000).describe('Maximum estimated context tokens.')
}

export const searchInputSchema = {
  ...vaultInput,
  ...agentInput,
  ...searchModeInput,
  query: z.string().min(1).describe('Search query.'),
  limit: positiveInteger(10).describe('Maximum result count.')
}

export const addNoteInputSchema = {
  ...vaultInput,
  title: z.string().min(1).describe('Markdown note title.'),
  content: z
    .string()
    .min(1)
    .describe(
      'Durable Markdown memory. Include explicit [[wiki links]] and #tags when the memory should be connected. Put priority markers near important links, for example priority: high, #important or #critical.'
    ),
  ...agentInput,
  allowSensitive: z.boolean().optional().default(false).describe('Allow content that looks like a secret.'),
  autoIndex: z.boolean().optional().default(true).describe('Reindex vault after writing note.')
}

export const addFileInputSchema = {
  ...vaultInput,
  ...agentInput,
  title: z.string().min(1).optional().describe('Optional note title override. If omitted, uses file name.'),
  filePath: z.string().min(1).describe('Filesystem path to markdown or text file to ingest.'),
  autoIndex: z.boolean().optional().default(true).describe('Reindex vault after ingesting file.'),
  allowSensitive: z.boolean().optional().default(false).describe('Allow content that looks like a secret.')
}

export const indexInputSchema = {
  ...vaultInput
}

export const validateInputSchema = {
  ...vaultInput,
  ...agentInput
}

export const graphInputSchema = {
  ...vaultInput,
  ...agentInput
}

export const brokenLinksInputSchema = {
  ...vaultInput,
  ...agentInput
}

export const orphansInputSchema = {
  ...vaultInput,
  ...agentInput
}

export const statsInputSchema = {
  ...vaultInput,
  ...agentInput
}

export const syncInputSchema = {
  ...vaultInput,
  ...agentInput,
  contextQuery: z.string().min(1).optional().describe('Optional context smoke query. Omit to skip context probe.'),
  mode: z.enum(['fts', 'semantic', 'hybrid']).optional().describe('Search mode for the optional context probe. Defaults to config value.'),
  contextLimit: positiveInteger(12).describe('Context smoke result limit when contextQuery is provided.'),
  contextTokens: positiveInteger(2000).describe('Context smoke token target when contextQuery is provided.')
}

export const bootstrapInputSchema = {
  ...vaultInput,
  ...agentInput,
  ...searchModeInput,
  query: z
    .string()
    .min(1)
    .optional()
    .describe('Optional task query. When provided, Brainlink also returns a context package in the same call.'),
  limit: positiveInteger(12).describe('Context limit used when query is provided.'),
  tokens: positiveInteger(2000).describe('Context token target used when query is provided.')
}

export const policyInputSchema = {
  ...vaultInput,
  ...agentInput,
  enforceBootstrap: z.boolean().optional().describe('Enable or disable bootstrap enforcement for MCP read tools.'),
  staleAfterMinutes: positiveInteger(120).describe('Bootstrap freshness window in minutes before read tools require a new bootstrap.')
}

export const contextTool = async (input: z.infer<z.ZodObject<typeof contextInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const preflight = await ensureBootstrapReady(context, input, 'brainlink_context')

  if (preflight) {
    return preflight
  }

  const mode = sanitizeSearchMode(input.mode, context.config.defaultSearchMode)
  const contextPackage = await buildContextPackage(
    context.vault,
    input.query,
    input.limit,
    input.tokens,
    context.agent,
    mode
  )

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    mode,
    ...contextPackage
  })
}

export const searchTool = async (input: z.infer<z.ZodObject<typeof searchInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const preflight = await ensureBootstrapReady(context, input, 'brainlink_search')

  if (preflight) {
    return preflight
  }

  const mode = sanitizeSearchMode(input.mode, context.config.defaultSearchMode)
  const results = await searchKnowledge(context.vault, input.query, input.limit, context.agent, mode)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    query: input.query,
    limit: input.limit,
    mode,
    results
  })
}

export const addNoteTool = async (input: z.infer<z.ZodObject<typeof addNoteInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const shouldIndex = isTruthy(input.autoIndex)
  const path = await addNote(context.vault, input.title, input.content, context.agent, {
    allowSensitive: input.allowSensitive
  })
  const index = shouldIndex ? await indexVault(context.vault) : undefined

  return jsonResult({
    vault: context.vault,
    title: input.title,
    agent: context.agent,
    path,
    ...(index ? { index } : {})
  })
}

export const addFileTool = async (input: z.infer<z.ZodObject<typeof addFileInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const content = await readFile(input.filePath, 'utf8')
  const inferredTitle = inferTitleFromPath(input.filePath)
  const title = input.title ?? inferredTitle

  if (title == null || title.length === 0) {
    throw new Error('Cannot infer note title from file path. Provide a title explicitly.')
  }

  const shouldIndex = isTruthy(input.autoIndex)
  const path = await addNote(context.vault, title, content, context.agent, {
    allowSensitive: input.allowSensitive
  })
  const index = shouldIndex ? await indexVault(context.vault) : undefined

  return jsonResult({
    vault: context.vault,
    title,
    agent: context.agent,
    filePath: input.filePath,
    path,
    ...(index ? { index } : {})
  })
}

export const indexTool = async (input: z.infer<z.ZodObject<typeof indexInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const result = await indexVault(context.vault)

  return jsonResult({
    vault: context.vault,
    ...result
  })
}

export const validateTool = async (input: z.infer<z.ZodObject<typeof validateInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const preflight = await ensureBootstrapReady(context, input, 'brainlink_validate')

  if (preflight) {
    return preflight
  }

  const validation = await validateVault(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    ...validation
  })
}

export const graphTool = async (input: z.infer<z.ZodObject<typeof graphInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const preflight = await ensureBootstrapReady(context, input, 'brainlink_graph')

  if (preflight) {
    return preflight
  }

  const graph = await getGraph(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    ...graph
  })
}

export const brokenLinksTool = async (input: z.infer<z.ZodObject<typeof brokenLinksInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const preflight = await ensureBootstrapReady(context, input, 'brainlink_broken_links')

  if (preflight) {
    return preflight
  }

  const brokenLinks = await getBrokenLinksReport(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    brokenLinks
  })
}

export const orphansTool = async (input: z.infer<z.ZodObject<typeof orphansInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const preflight = await ensureBootstrapReady(context, input, 'brainlink_orphans')

  if (preflight) {
    return preflight
  }

  const orphans = await getOrphansReport(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    orphans
  })
}

export const statsTool = async (input: z.infer<z.ZodObject<typeof statsInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const preflight = await ensureBootstrapReady(context, input, 'brainlink_stats')

  if (preflight) {
    return preflight
  }

  const stats = await getStats(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    stats
  })
}

export const syncTool = async (input: z.infer<z.ZodObject<typeof syncInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const preflight = await ensureBootstrapReady(context, input, 'brainlink_sync')

  if (preflight) {
    return preflight
  }

  const index = await indexVault(context.vault)
  const stats = await getStats(context.vault, context.agent)
  const validation = await validateVault(context.vault, context.agent)
  const brokenLinks = await getBrokenLinksReport(context.vault, context.agent)
  const orphans = await getOrphansReport(context.vault, context.agent)

  const response = {
    vault: context.vault,
    agent: context.agent,
    index,
    stats,
    validation,
    brokenLinks,
    orphans
  } as const

  if (!input.contextQuery) {
    return jsonResult(response)
  }

  const mode = sanitizeSearchMode(input.mode, context.config.defaultSearchMode)
  const contextPackage = await buildContextPackage(
    context.vault,
    input.contextQuery,
    input.contextLimit,
    input.contextTokens,
    context.agent,
    mode
  )

  return jsonResult({
    ...response,
    context: {
      mode,
      ...contextPackage
    }
  })
}

export const bootstrapTool = async (input: z.infer<z.ZodObject<typeof bootstrapInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const index = await indexVault(context.vault)
  const stats = await getStats(context.vault, context.agent)
  const validation = await validateVault(context.vault, context.agent)
  const mode = sanitizeSearchMode(input.mode, context.config.defaultSearchMode)
  const contextPackage = input.query
    ? await buildContextPackage(context.vault, input.query, input.limit, input.tokens, context.agent, mode)
    : undefined

  const guidance =
    stats.documentCount === 0
      ? 'Vault indexed with zero documents. Add durable notes with brainlink_add_note, then run brainlink_bootstrap again.'
      : input.query
        ? 'Use returned context as grounding baseline, then write durable updates with brainlink_add_note when needed.'
        : 'Run brainlink_context with the current task query to retrieve grounded context before answering.'
  const session = await touchBootstrapSession(context.vault, context.agent)
  const policy = await getBootstrapPolicy()

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    mode,
    index,
    stats,
    validation,
    policy,
    session,
    guidance,
    ...(contextPackage ? { context: contextPackage } : {})
  })
}

export const policyTool = async (input: z.infer<z.ZodObject<typeof policyInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const policy =
    typeof input.enforceBootstrap === 'boolean' || typeof input.staleAfterMinutes === 'number'
      ? await setBootstrapPolicy({
          ...(typeof input.enforceBootstrap === 'boolean' ? { enforceBootstrap: input.enforceBootstrap } : {}),
          ...(typeof input.staleAfterMinutes === 'number' ? { staleAfterMinutes: input.staleAfterMinutes } : {})
        })
      : await getBootstrapPolicy()
  const bootstrapStatus = await getBootstrapSessionStatus(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    policy,
    bootstrapStatus
  })
}

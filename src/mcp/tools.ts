import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { z } from 'zod'
import { getBrokenLinksReport, getOrphansReport, getStats, validateVault } from '../application/analyze-vault.js'
import { addNoteWithMetadata } from '../application/add-note.js'
import { buildContextPackage } from '../application/build-context.js'
import { resolveDuplicateNotes, scanDuplicateNotes } from '../application/dedupe-notes.js'
import { getGraph } from '../application/get-graph.js'
import { indexVault } from '../application/index-vault.js'
import { searchKnowledge } from '../application/search-knowledge.js'
import { resolveAgentRuntimeDefaults, sanitizeSearchMode } from '../infrastructure/config.js'
import { loadBrainlinkConfig } from '../infrastructure/config.js'
import { assertVaultAllowed } from '../infrastructure/file-system-vault.js'
import {
  getBootstrapPolicy,
  getBootstrapSessionStatus,
  getContextSessionStatus,
  setBootstrapPolicy,
  touchBootstrapSession,
  touchContextSession
} from '../infrastructure/session-state.js'

const positiveInteger = (fallback: number) =>
  z
    .number()
    .int()
    .positive()
    .optional()
    .transform((value) => value ?? fallback)

const optionalPositiveInteger = () =>
  z
    .number()
    .int()
    .positive()
    .optional()

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
  const defaults = resolveAgentRuntimeDefaults(config, agent)

  return {
    config,
    vault,
    agent,
    defaults
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

type ReadBootstrapMeta = {
  readonly autoBootstrapped: boolean
  readonly policy: Readonly<Record<string, unknown>>
  readonly statusBefore: Readonly<Record<string, unknown>>
  readonly statusAfter?: Readonly<Record<string, unknown>>
  readonly session?: Readonly<Record<string, unknown>>
  readonly index?: Readonly<Record<string, unknown>>
  readonly reason: string
}

type NextAction = {
  readonly tool: string
  readonly reason: string
  readonly args: Readonly<Record<string, unknown>>
}

const withNextActions = <T extends Readonly<Record<string, unknown>>>(
  value: T,
  nextActions: readonly NextAction[]
): T & { readonly nextActions: readonly NextAction[] } => ({
  ...value,
  nextActions
})

const ensureBootstrapReady = async (
  context: { vault: string; agent?: string },
  input: Readonly<Record<string, unknown>>,
  toolName: string
): Promise<{ readonly preflight?: CallToolResult; readonly bootstrap?: ReadBootstrapMeta }> => {
  const policy = await getBootstrapPolicy()

  if (!policy.enforceBootstrap) {
    return {
      bootstrap: {
        autoBootstrapped: false,
        policy,
        statusBefore: {
          ready: true,
          stale: false
        },
        reason: 'Bootstrap enforcement is disabled by policy.'
      }
    }
  }

  const status = await getBootstrapSessionStatus(context.vault, context.agent)

  if (status.ready) {
    return {
      bootstrap: {
        autoBootstrapped: false,
        policy,
        statusBefore: status,
        reason: 'Bootstrap session is already fresh for this vault/agent.'
      }
    }
  }

  if (policy.autoBootstrapOnRead) {
    const index = await indexVault(context.vault)
    const session = await touchBootstrapSession(context.vault, context.agent)
    const statusAfter = await getBootstrapSessionStatus(context.vault, context.agent)

    return {
      bootstrap: {
        autoBootstrapped: true,
        policy,
        statusBefore: status,
        statusAfter,
        session,
        index,
        reason: 'Auto-bootstrap was applied for this read call because bootstrap was missing or stale.'
      }
    }
  }

  const mode = typeof input.mode === 'string' && ['fts', 'semantic', 'hybrid'].includes(input.mode) ? input.mode : 'hybrid'
  const query = typeof input.query === 'string' && input.query.trim().length > 0 ? input.query : undefined
  const bootstrapArgs = {
    vault: context.vault,
    ...(context.agent ? { agent: context.agent } : {}),
    ...(query ? { query } : {}),
    mode
  }
  const nextActions: readonly NextAction[] = [
    {
      tool: 'brainlink_bootstrap',
      reason: 'Bootstrap is required before read tools so retrieval stays grounded in current vault state.',
      args: bootstrapArgs
    }
  ]

  return {
    preflight: preflightResult(withNextActions({
    vault: context.vault,
    agent: context.agent,
    blockedTool: toolName,
    policy,
    bootstrapStatus: status,
    guidance:
      'Run brainlink_bootstrap first for this vault/agent before using read tools. This keeps retrieval grounded and memory state consistent.',
    bootstrapArgs
    }, nextActions))
  }
}

const ensureContextReady = async (
  context: { vault: string; agent?: string; defaults: { defaultSearchMode: 'fts' | 'semantic' | 'hybrid'; defaultSearchLimit: number; defaultContextTokens: number } },
  input: Readonly<Record<string, unknown>>,
  toolName: string
): Promise<{ readonly preflight?: CallToolResult; readonly context?: Readonly<Record<string, unknown>> }> => {
  const policy = await getBootstrapPolicy()

  if (!policy.enforceContextFirst) {
    return {
      context: {
        policy,
        statusBefore: {
          ready: true,
          stale: false
        },
        reason: 'Context-first enforcement is disabled by policy.'
      }
    }
  }

  const status = await getContextSessionStatus(context.vault, context.agent)

  if (status.ready) {
    return {
      context: {
        policy,
        statusBefore: status,
        reason: 'Context session is already fresh for this vault/agent.'
      }
    }
  }

  const queryFromInput =
    typeof input.query === 'string' && input.query.trim().length > 0
      ? input.query
      : typeof input.contextQuery === 'string' && input.contextQuery.trim().length > 0
        ? input.contextQuery
        : '<task>'
  const mode = sanitizeSearchMode(
    typeof input.mode === 'string' ? input.mode : undefined,
    context.defaults.defaultSearchMode
  )
  const limit =
    typeof input.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0
      ? input.limit
      : typeof input.contextLimit === 'number' && Number.isFinite(input.contextLimit) && input.contextLimit > 0
        ? input.contextLimit
        : context.defaults.defaultSearchLimit
  const tokens =
    typeof input.tokens === 'number' && Number.isFinite(input.tokens) && input.tokens > 0
      ? input.tokens
      : typeof input.contextTokens === 'number' && Number.isFinite(input.contextTokens) && input.contextTokens > 0
        ? input.contextTokens
        : context.defaults.defaultContextTokens
  const contextArgs = {
    vault: context.vault,
    ...(context.agent ? { agent: context.agent } : {}),
    query: queryFromInput,
    mode,
    limit,
    tokens
  }
  const nextActions: readonly NextAction[] = [
    {
      tool: 'brainlink_context',
      reason: 'Context must be loaded first so Brainlink is the primary retrieval source before other read tools.',
      args: contextArgs
    }
  ]

  return {
    preflight: preflightResult(withNextActions({
      vault: context.vault,
      agent: context.agent,
      blockedTool: toolName,
      policy,
      contextStatus: status,
      guidance:
        'Run brainlink_context first for this vault/agent before other read tools so answers are grounded on Brainlink context.',
      contextArgs
    }, nextActions))
  }
}

export const contextInputSchema = {
  ...vaultInput,
  ...agentInput,
  ...searchModeInput,
  query: z.string().min(1).describe('Task or question to retrieve Brainlink context for.'),
  limit: optionalPositiveInteger().describe('Maximum search results before context selection.'),
  tokens: optionalPositiveInteger().describe('Maximum estimated context tokens.')
}

export const searchInputSchema = {
  ...vaultInput,
  ...agentInput,
  ...searchModeInput,
  query: z.string().min(1).describe('Search query.'),
  limit: optionalPositiveInteger().describe('Maximum result count.')
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
  contextLimit: optionalPositiveInteger().describe('Context smoke result limit when contextQuery is provided.'),
  contextTokens: optionalPositiveInteger().describe('Context smoke token target when contextQuery is provided.')
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
  limit: optionalPositiveInteger().describe('Context limit used when query is provided.'),
  tokens: optionalPositiveInteger().describe('Context token target used when query is provided.')
}

export const policyInputSchema = {
  ...vaultInput,
  ...agentInput,
  preset: z.enum(['fully-auto', 'strict']).optional().describe('Apply an opinionated policy preset before explicit overrides.'),
  enforceBootstrap: z.boolean().optional().describe('Enable or disable bootstrap enforcement for MCP read tools.'),
  enforceContextFirst: z.boolean().optional().describe('Require brainlink_context before other MCP read tools.'),
  autoBootstrapOnRead: z
    .boolean()
    .optional()
    .describe('When bootstrap is missing/stale, run automatic bootstrap on read tools instead of returning preflight-required responses.'),
  autoBootstrapOnStartup: z
    .boolean()
    .optional()
    .describe('Run automatic bootstrap during MCP server startup using configured default vault/agent.'),
  staleAfterMinutes: positiveInteger(120).describe('Bootstrap freshness window in minutes before read tools require a new bootstrap.')
}

export const recommendationsInputSchema = {
  ...vaultInput,
  ...agentInput,
  ...searchModeInput,
  query: z.string().min(1).optional().describe('Optional current task query to generate context-focused recommendations.'),
  limit: optionalPositiveInteger().describe('Optional context limit override for generated recommendations.'),
  tokens: optionalPositiveInteger().describe('Optional context token budget override for generated recommendations.')
}

export const dedupeInputSchema = {
  ...vaultInput,
  ...agentInput,
  limit: optionalPositiveInteger().describe('Maximum duplicate candidate pairs to return.'),
  minScore: z.number().min(0).max(1).optional().describe('Minimum semantic similarity score between 0 and 1.'),
  semantic: z.boolean().optional().default(true).describe('Enable semantic duplicate detection in addition to exact content hash matches.')
}

export const dedupeResolveInputSchema = {
  ...vaultInput,
  leftPath: z.string().min(1).describe('Left note path from dedupe results.'),
  rightPath: z.string().min(1).describe('Right note path from dedupe results.'),
  action: z.enum(['merge', 'link', 'ignore']).describe('Resolution action.'),
  autoIndex: z.boolean().optional().default(true).describe('Reindex after duplicate resolution.')
}

export const contextTool = async (input: z.infer<z.ZodObject<typeof contextInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const readiness = await ensureBootstrapReady(context, input, 'brainlink_context')

  if (readiness.preflight) {
    return readiness.preflight
  }

  const mode = sanitizeSearchMode(input.mode, context.defaults.defaultSearchMode)
  const limit = input.limit ?? context.defaults.defaultSearchLimit
  const tokens = input.tokens ?? context.defaults.defaultContextTokens
  const contextPackage = await buildContextPackage(
    context.vault,
    input.query,
    limit,
    tokens,
    context.agent,
    mode
  )
  const contextSession = await touchContextSession(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    mode,
    limit,
    tokens,
    contextSession,
    ...(readiness.bootstrap ? { bootstrap: readiness.bootstrap } : {}),
    ...contextPackage
  })
}

export const searchTool = async (input: z.infer<z.ZodObject<typeof searchInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const readiness = await ensureBootstrapReady(context, input, 'brainlink_search')

  if (readiness.preflight) {
    return readiness.preflight
  }

  const contextReadiness = await ensureContextReady(context, input, 'brainlink_search')

  if (contextReadiness.preflight) {
    return contextReadiness.preflight
  }

  const mode = sanitizeSearchMode(input.mode, context.defaults.defaultSearchMode)
  const limit = input.limit ?? context.defaults.defaultSearchLimit
  const results = await searchKnowledge(context.vault, input.query, limit, context.agent, mode)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    query: input.query,
    limit,
    mode,
    ...(readiness.bootstrap ? { bootstrap: readiness.bootstrap } : {}),
    ...(contextReadiness.context ? { contextReadiness: contextReadiness.context } : {}),
    results
  })
}

export const addNoteTool = async (input: z.infer<z.ZodObject<typeof addNoteInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const shouldIndex = isTruthy(input.autoIndex)
  const added = await addNoteWithMetadata(context.vault, input.title, input.content, context.agent, {
    allowSensitive: input.allowSensitive
  })
  const index = shouldIndex ? await indexVault(context.vault) : undefined
  const focusPath = added.path.includes('agents/') ? added.path.slice(added.path.indexOf('agents/')).replaceAll('\\', '/') : undefined
  const possibleDuplicates = await scanDuplicateNotes(context.vault, {
    agentId: context.agent,
    focusPath,
    limit: 5,
    minSemanticScore: 0.92,
    includeSemantic: true
  })

  return jsonResult({
    vault: context.vault,
    title: input.title,
    agent: context.agent,
    path: added.path,
    writeConnectivity: {
      autoLinked: added.autoLinked,
      linkTarget: added.linkTarget,
      guaranteedEdge: true
    },
    possibleDuplicates,
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
  const added = await addNoteWithMetadata(context.vault, title, content, context.agent, {
    allowSensitive: input.allowSensitive
  })
  const index = shouldIndex ? await indexVault(context.vault) : undefined

  return jsonResult({
    vault: context.vault,
    title,
    agent: context.agent,
    filePath: input.filePath,
    path: added.path,
    writeConnectivity: {
      autoLinked: added.autoLinked,
      linkTarget: added.linkTarget,
      guaranteedEdge: true
    },
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
  const readiness = await ensureBootstrapReady(context, input, 'brainlink_validate')

  if (readiness.preflight) {
    return readiness.preflight
  }

  const contextReadiness = await ensureContextReady(context, input, 'brainlink_validate')

  if (contextReadiness.preflight) {
    return contextReadiness.preflight
  }

  const validation = await validateVault(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    ...(readiness.bootstrap ? { bootstrap: readiness.bootstrap } : {}),
    ...(contextReadiness.context ? { contextReadiness: contextReadiness.context } : {}),
    ...validation
  })
}

export const graphTool = async (input: z.infer<z.ZodObject<typeof graphInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const readiness = await ensureBootstrapReady(context, input, 'brainlink_graph')

  if (readiness.preflight) {
    return readiness.preflight
  }

  const contextReadiness = await ensureContextReady(context, input, 'brainlink_graph')

  if (contextReadiness.preflight) {
    return contextReadiness.preflight
  }

  const graph = await getGraph(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    ...(readiness.bootstrap ? { bootstrap: readiness.bootstrap } : {}),
    ...(contextReadiness.context ? { contextReadiness: contextReadiness.context } : {}),
    ...graph
  })
}

export const brokenLinksTool = async (input: z.infer<z.ZodObject<typeof brokenLinksInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const readiness = await ensureBootstrapReady(context, input, 'brainlink_broken_links')

  if (readiness.preflight) {
    return readiness.preflight
  }

  const contextReadiness = await ensureContextReady(context, input, 'brainlink_broken_links')

  if (contextReadiness.preflight) {
    return contextReadiness.preflight
  }

  const brokenLinks = await getBrokenLinksReport(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    ...(readiness.bootstrap ? { bootstrap: readiness.bootstrap } : {}),
    ...(contextReadiness.context ? { contextReadiness: contextReadiness.context } : {}),
    brokenLinks
  })
}

export const orphansTool = async (input: z.infer<z.ZodObject<typeof orphansInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const readiness = await ensureBootstrapReady(context, input, 'brainlink_orphans')

  if (readiness.preflight) {
    return readiness.preflight
  }

  const contextReadiness = await ensureContextReady(context, input, 'brainlink_orphans')

  if (contextReadiness.preflight) {
    return contextReadiness.preflight
  }

  const orphans = await getOrphansReport(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    ...(readiness.bootstrap ? { bootstrap: readiness.bootstrap } : {}),
    ...(contextReadiness.context ? { contextReadiness: contextReadiness.context } : {}),
    orphans
  })
}

export const statsTool = async (input: z.infer<z.ZodObject<typeof statsInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const readiness = await ensureBootstrapReady(context, input, 'brainlink_stats')

  if (readiness.preflight) {
    return readiness.preflight
  }

  const contextReadiness = await ensureContextReady(context, input, 'brainlink_stats')

  if (contextReadiness.preflight) {
    return contextReadiness.preflight
  }

  const stats = await getStats(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    ...(readiness.bootstrap ? { bootstrap: readiness.bootstrap } : {}),
    ...(contextReadiness.context ? { contextReadiness: contextReadiness.context } : {}),
    stats
  })
}

export const syncTool = async (input: z.infer<z.ZodObject<typeof syncInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const readiness = await ensureBootstrapReady(context, input, 'brainlink_sync')

  if (readiness.preflight) {
    return readiness.preflight
  }

  const contextReadiness = await ensureContextReady(context, input, 'brainlink_sync')

  if (contextReadiness.preflight) {
    return contextReadiness.preflight
  }

  const index = await indexVault(context.vault)
  const stats = await getStats(context.vault, context.agent)
  const validation = await validateVault(context.vault, context.agent)
  const brokenLinks = await getBrokenLinksReport(context.vault, context.agent)
  const orphans = await getOrphansReport(context.vault, context.agent)

  const response = {
    vault: context.vault,
    agent: context.agent,
    ...(readiness.bootstrap ? { bootstrap: readiness.bootstrap } : {}),
    ...(contextReadiness.context ? { contextReadiness: contextReadiness.context } : {}),
    index,
    stats,
    validation,
    brokenLinks,
    orphans
  } as const

  if (!input.contextQuery) {
    return jsonResult(response)
  }

  const mode = sanitizeSearchMode(input.mode, context.defaults.defaultSearchMode)
  const contextLimit = input.contextLimit ?? context.defaults.defaultSearchLimit
  const contextTokens = input.contextTokens ?? context.defaults.defaultContextTokens
  const contextPackage = await buildContextPackage(
    context.vault,
    input.contextQuery,
    contextLimit,
    contextTokens,
    context.agent,
    mode
  )
  const contextSession = await touchContextSession(context.vault, context.agent)

  return jsonResult({
    ...response,
    context: {
      mode,
      contextSession,
      ...contextPackage
    }
  })
}

export const bootstrapTool = async (input: z.infer<z.ZodObject<typeof bootstrapInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const index = await indexVault(context.vault)
  const stats = await getStats(context.vault, context.agent)
  const validation = await validateVault(context.vault, context.agent)
  const mode = sanitizeSearchMode(input.mode, context.defaults.defaultSearchMode)
  const limit = input.limit ?? context.defaults.defaultSearchLimit
  const tokens = input.tokens ?? context.defaults.defaultContextTokens
  const contextPackage = input.query
    ? await buildContextPackage(context.vault, input.query, limit, tokens, context.agent, mode)
    : undefined
  const contextSession = input.query ? await touchContextSession(context.vault, context.agent) : undefined

  const guidance =
    stats.documentCount === 0
      ? 'Vault indexed with zero documents. Add durable notes with brainlink_add_note, then run brainlink_bootstrap again.'
      : input.query
        ? 'Use returned context as grounding baseline, then write durable updates with brainlink_add_note when needed.'
        : 'Run brainlink_context with the current task query to retrieve grounded context before answering.'
  const session = await touchBootstrapSession(context.vault, context.agent)
  const policy = await getBootstrapPolicy()
  const nextActions: readonly NextAction[] =
    stats.documentCount === 0
      ? [
          {
            tool: 'brainlink_add_note',
            reason: 'No indexed documents were found. Add durable Markdown memory first.',
            args: {
              vault: context.vault,
              ...(context.agent ? { agent: context.agent } : {}),
              title: 'Architecture',
              content: 'Durable memory with explicit [[links]] and #tags.'
            }
          },
          {
            tool: 'brainlink_bootstrap',
            reason: 'Re-run bootstrap after writing notes so context tools can work on fresh index state.',
            args: {
              vault: context.vault,
              ...(context.agent ? { agent: context.agent } : {}),
              mode
            }
          }
        ]
      : input.query
        ? [
            {
              tool: 'brainlink_add_note',
              reason: 'Persist relevant outcomes from this task as durable memory.',
              args: {
                vault: context.vault,
                ...(context.agent ? { agent: context.agent } : {}),
                title: 'Task Update',
                content: 'Summarize durable findings and connect with [[existing notes]].'
              }
            }
          ]
        : [
            {
              tool: 'brainlink_context',
              reason: 'Fetch grounded context for the current task.',
              args: {
                vault: context.vault,
                ...(context.agent ? { agent: context.agent } : {}),
                query: '<task>',
                mode,
                limit,
                tokens
              }
            }
          ]

  return jsonResult(withNextActions({
    vault: context.vault,
    agent: context.agent,
    mode,
    limit,
    tokens,
    index,
    stats,
    validation,
    policy,
    session,
    guidance,
    ...(contextPackage ? { context: contextPackage } : {}),
    ...(contextSession ? { contextSession } : {})
  }, nextActions))
}

export const policyTool = async (input: z.infer<z.ZodObject<typeof policyInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const presetPatch =
    input.preset === 'strict'
      ? {
          enforceBootstrap: true,
          enforceContextFirst: true,
          autoBootstrapOnRead: false,
          autoBootstrapOnStartup: false
        }
      : input.preset === 'fully-auto'
        ? {
            enforceBootstrap: true,
            enforceContextFirst: true,
            autoBootstrapOnRead: true,
            autoBootstrapOnStartup: true
          }
        : {}
  const policy =
    input.preset !== undefined ||
    typeof input.enforceBootstrap === 'boolean' ||
    typeof input.enforceContextFirst === 'boolean' ||
    typeof input.autoBootstrapOnRead === 'boolean' ||
    typeof input.autoBootstrapOnStartup === 'boolean' ||
    typeof input.staleAfterMinutes === 'number'
      ? await setBootstrapPolicy({
          ...presetPatch,
          ...(typeof input.enforceBootstrap === 'boolean' ? { enforceBootstrap: input.enforceBootstrap } : {}),
          ...(typeof input.enforceContextFirst === 'boolean' ? { enforceContextFirst: input.enforceContextFirst } : {}),
          ...(typeof input.autoBootstrapOnRead === 'boolean' ? { autoBootstrapOnRead: input.autoBootstrapOnRead } : {}),
          ...(typeof input.autoBootstrapOnStartup === 'boolean' ? { autoBootstrapOnStartup: input.autoBootstrapOnStartup } : {}),
          ...(typeof input.staleAfterMinutes === 'number' ? { staleAfterMinutes: input.staleAfterMinutes } : {})
        })
      : await getBootstrapPolicy()
  const bootstrapStatus = await getBootstrapSessionStatus(context.vault, context.agent)
  const contextStatus = await getContextSessionStatus(context.vault, context.agent)

  const nextActions: readonly NextAction[] = bootstrapStatus.ready
    ? []
    : [
        {
          tool: 'brainlink_bootstrap',
          reason: 'Bootstrap status is not ready. Run bootstrap before using read tools.',
          args: {
            vault: context.vault,
            ...(context.agent ? { agent: context.agent } : {}),
            mode: context.defaults.defaultSearchMode
          }
        }
      ]
  const withContextAction =
    policy.enforceContextFirst && !contextStatus.ready
      ? [
          ...nextActions,
          {
            tool: 'brainlink_context',
            reason: 'Context-first policy is enabled. Load context before other read tools.',
            args: {
              vault: context.vault,
              ...(context.agent ? { agent: context.agent } : {}),
              query: '<task>',
              mode: context.defaults.defaultSearchMode,
              limit: context.defaults.defaultSearchLimit,
              tokens: context.defaults.defaultContextTokens
            }
          }
        ]
      : nextActions

  return jsonResult(withNextActions({
    vault: context.vault,
    agent: context.agent,
    policy,
    bootstrapStatus,
    contextStatus,
    ...(input.preset ? { presetApplied: input.preset } : {})
  }, withContextAction))
}

export const recommendationsTool = async (
  input: z.infer<z.ZodObject<typeof recommendationsInputSchema>>
): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const policy = await getBootstrapPolicy()
  const bootstrapStatus = await getBootstrapSessionStatus(context.vault, context.agent)
  const contextStatus = await getContextSessionStatus(context.vault, context.agent)
  const stats = await getStats(context.vault, context.agent)
  const mode = sanitizeSearchMode(input.mode, context.defaults.defaultSearchMode)
  const limit = input.limit ?? context.defaults.defaultSearchLimit
  const tokens = input.tokens ?? context.defaults.defaultContextTokens
  const query = input.query?.trim()

  const recommendations: readonly NextAction[] = [
    ...(policy.enforceBootstrap && (!policy.autoBootstrapOnRead || !policy.autoBootstrapOnStartup)
      ? [
          {
            tool: 'brainlink_policy',
            reason: 'Enable fully automatic bootstrap for plug-and-play agent usage.',
            args: {
              preset: 'fully-auto'
            }
          }
        ]
      : []),
    ...(!bootstrapStatus.ready && !policy.autoBootstrapOnRead
      ? [
          {
            tool: 'brainlink_bootstrap',
            reason: 'Bootstrap is required before read tools when auto-bootstrap-on-read is disabled.',
            args: {
              vault: context.vault,
              ...(context.agent ? { agent: context.agent } : {}),
              mode,
              ...(query ? { query } : {})
            }
          }
        ]
      : []),
    ...(policy.enforceContextFirst && !contextStatus.ready
      ? [
          {
            tool: 'brainlink_context',
            reason: 'Context-first policy is enabled. Load context before other read operations.',
            args: {
              vault: context.vault,
              ...(context.agent ? { agent: context.agent } : {}),
              query: query ?? '<task>',
              mode,
              limit,
              tokens
            }
          }
        ]
      : []),
    ...(stats.documentCount === 0
      ? [
          {
            tool: 'brainlink_add_note',
            reason: 'Seed the vault with a first durable note so retrieval can return useful context.',
            args: {
              vault: context.vault,
              ...(context.agent ? { agent: context.agent } : {}),
              title: 'Architecture',
              content: 'Seed durable memory with explicit [[links]] and #tags.'
            }
          },
          {
            tool: 'brainlink_index',
            reason: 'Rebuild index after writing the first notes.',
            args: {
              vault: context.vault
            }
          }
        ]
      : []),
    {
      tool: 'brainlink_context',
      reason: 'Retrieve grounded memory context before responding.',
      args: {
        vault: context.vault,
        ...(context.agent ? { agent: context.agent } : {}),
        query: query ?? '<task>',
        mode,
        limit,
        tokens
      }
    },
    {
      tool: 'brainlink_dedupe',
      reason: 'Detect and resolve duplicate durable notes to keep memory quality high.',
      args: {
        vault: context.vault,
        ...(context.agent ? { agent: context.agent } : {}),
        limit: 10,
        minScore: 0.92,
        semantic: true
      }
    },
    {
      tool: 'brainlink_add_note',
      reason: 'Persist durable outcomes after task completion (write responses include connectivity metadata).',
      args: {
        vault: context.vault,
        ...(context.agent ? { agent: context.agent } : {}),
        title: 'Task Update',
        content: 'Durable findings connected to [[existing notes]].'
      }
    }
  ]

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    defaults: {
      mode,
      limit,
      tokens
    },
    policy,
    bootstrapStatus,
    contextStatus,
    stats,
    recommendations
  })
}

export const dedupeTool = async (input: z.infer<z.ZodObject<typeof dedupeInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const duplicates = await scanDuplicateNotes(context.vault, {
    agentId: context.agent,
    limit: input.limit ?? 25,
    minSemanticScore: input.minScore ?? 0.92,
    includeSemantic: input.semantic !== false
  })

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    duplicates
  })
}

export const dedupeResolveTool = async (
  input: z.infer<z.ZodObject<typeof dedupeResolveInputSchema>>
): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const result = await resolveDuplicateNotes(context.vault, {
    leftPath: input.leftPath,
    rightPath: input.rightPath,
    action: input.action,
    autoIndex: isTruthy(input.autoIndex)
  })

  return jsonResult({
    vault: context.vault,
    ...result
  })
}

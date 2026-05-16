import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { z } from 'zod'
import { getBrokenLinksReport, getOrphansReport, getStats, validateVault } from '../application/analyze-vault.js'
import { addNoteWithMetadata } from '../application/add-note.js'
import { buildContextPackage } from '../application/build-context.js'
import { getGraph } from '../application/get-graph.js'
import { indexVault } from '../application/index-vault.js'
import { searchKnowledge } from '../application/search-knowledge.js'
import { resolveAgentRuntimeDefaults, sanitizeSearchMode } from '../infrastructure/config.js'
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

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    mode,
    limit,
    tokens,
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

  const validation = await validateVault(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    ...(readiness.bootstrap ? { bootstrap: readiness.bootstrap } : {}),
    ...validation
  })
}

export const graphTool = async (input: z.infer<z.ZodObject<typeof graphInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const readiness = await ensureBootstrapReady(context, input, 'brainlink_graph')

  if (readiness.preflight) {
    return readiness.preflight
  }

  const graph = await getGraph(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    ...(readiness.bootstrap ? { bootstrap: readiness.bootstrap } : {}),
    ...graph
  })
}

export const brokenLinksTool = async (input: z.infer<z.ZodObject<typeof brokenLinksInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const readiness = await ensureBootstrapReady(context, input, 'brainlink_broken_links')

  if (readiness.preflight) {
    return readiness.preflight
  }

  const brokenLinks = await getBrokenLinksReport(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    ...(readiness.bootstrap ? { bootstrap: readiness.bootstrap } : {}),
    brokenLinks
  })
}

export const orphansTool = async (input: z.infer<z.ZodObject<typeof orphansInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const readiness = await ensureBootstrapReady(context, input, 'brainlink_orphans')

  if (readiness.preflight) {
    return readiness.preflight
  }

  const orphans = await getOrphansReport(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    ...(readiness.bootstrap ? { bootstrap: readiness.bootstrap } : {}),
    orphans
  })
}

export const statsTool = async (input: z.infer<z.ZodObject<typeof statsInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const readiness = await ensureBootstrapReady(context, input, 'brainlink_stats')

  if (readiness.preflight) {
    return readiness.preflight
  }

  const stats = await getStats(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    ...(readiness.bootstrap ? { bootstrap: readiness.bootstrap } : {}),
    stats
  })
}

export const syncTool = async (input: z.infer<z.ZodObject<typeof syncInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const readiness = await ensureBootstrapReady(context, input, 'brainlink_sync')

  if (readiness.preflight) {
    return readiness.preflight
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
  const mode = sanitizeSearchMode(input.mode, context.defaults.defaultSearchMode)
  const limit = input.limit ?? context.defaults.defaultSearchLimit
  const tokens = input.tokens ?? context.defaults.defaultContextTokens
  const contextPackage = input.query
    ? await buildContextPackage(context.vault, input.query, limit, tokens, context.agent, mode)
    : undefined

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
    ...(contextPackage ? { context: contextPackage } : {})
  }, nextActions))
}

export const policyTool = async (input: z.infer<z.ZodObject<typeof policyInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const presetPatch =
    input.preset === 'strict'
      ? {
          enforceBootstrap: true,
          autoBootstrapOnRead: false,
          autoBootstrapOnStartup: false
        }
      : input.preset === 'fully-auto'
        ? {
            enforceBootstrap: true,
            autoBootstrapOnRead: true,
            autoBootstrapOnStartup: true
          }
        : {}
  const policy =
    input.preset !== undefined ||
    typeof input.enforceBootstrap === 'boolean' ||
    typeof input.autoBootstrapOnRead === 'boolean' ||
    typeof input.autoBootstrapOnStartup === 'boolean' ||
    typeof input.staleAfterMinutes === 'number'
      ? await setBootstrapPolicy({
          ...presetPatch,
          ...(typeof input.enforceBootstrap === 'boolean' ? { enforceBootstrap: input.enforceBootstrap } : {}),
          ...(typeof input.autoBootstrapOnRead === 'boolean' ? { autoBootstrapOnRead: input.autoBootstrapOnRead } : {}),
          ...(typeof input.autoBootstrapOnStartup === 'boolean' ? { autoBootstrapOnStartup: input.autoBootstrapOnStartup } : {}),
          ...(typeof input.staleAfterMinutes === 'number' ? { staleAfterMinutes: input.staleAfterMinutes } : {})
        })
      : await getBootstrapPolicy()
  const bootstrapStatus = await getBootstrapSessionStatus(context.vault, context.agent)

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

  return jsonResult(withNextActions({
    vault: context.vault,
    agent: context.agent,
    policy,
    bootstrapStatus,
    ...(input.preset ? { presetApplied: input.preset } : {})
  }, nextActions))
}

export const recommendationsTool = async (
  input: z.infer<z.ZodObject<typeof recommendationsInputSchema>>
): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const policy = await getBootstrapPolicy()
  const bootstrapStatus = await getBootstrapSessionStatus(context.vault, context.agent)
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
    stats,
    recommendations
  })
}

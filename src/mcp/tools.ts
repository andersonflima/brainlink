import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
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
    vault,
    config,
    agent
  }
}

const jsonResult = (value: Readonly<Record<string, unknown>>): CallToolResult => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(value, null, 2)
    }
  ],
  structuredContent: value
})

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
    .describe('Durable Markdown memory. Include explicit [[wiki links]] and #tags when the memory should be connected. Put priority markers near important links, for example priority: high, #important or #critical.'),
  agent: z.string().min(1).optional().describe('Agent memory namespace.'),
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

export const contextTool = async (input: z.infer<z.ZodObject<typeof contextInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
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
  const path = await addNote(context.vault, input.title, input.content, context.agent, {
    allowSensitive: input.allowSensitive
  })
  const index = await indexVault(context.vault)

  return jsonResult({
    vault: context.vault,
    title: input.title,
    agent: context.agent,
    path,
    index
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
  const validation = await validateVault(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    ...validation
  })
}

export const graphTool = async (input: z.infer<z.ZodObject<typeof graphInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const graph = await getGraph(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    ...graph
  })
}

export const brokenLinksTool = async (input: z.infer<z.ZodObject<typeof brokenLinksInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const brokenLinks = await getBrokenLinksReport(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    brokenLinks
  })
}

export const orphansTool = async (input: z.infer<z.ZodObject<typeof orphansInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const orphans = await getOrphansReport(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    orphans
  })
}

export const statsTool = async (input: z.infer<z.ZodObject<typeof statsInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
  const stats = await getStats(context.vault, context.agent)

  return jsonResult({
    vault: context.vault,
    agent: context.agent,
    stats
  })
}

export const syncTool = async (input: z.infer<z.ZodObject<typeof syncInputSchema>>): Promise<CallToolResult> => {
  const context = await resolveExecutionContext(input)
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

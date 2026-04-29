import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { getBrokenLinksReport, getOrphansReport, validateVault } from '../application/analyze-vault.js'
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

const agentInput = {
  agent: z.string().min(1).optional().describe('Agent memory namespace. Omit to read shared/default indexed memory.')
}

const searchModeInput = {
  mode: z.enum(['fts', 'semantic', 'hybrid']).optional().describe('Search mode. Defaults to the Brainlink config value.')
}

const resolveVault = async (vault?: string): Promise<string> => {
  const config = await loadBrainlinkConfig()

  return assertVaultAllowed(vault ?? config.vault, config.allowedVaults)
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
    .describe('Durable Markdown memory. Include explicit [[wiki links]] and #tags when the memory should be connected.'),
  agent: z.string().min(1).optional().default('shared').describe('Agent memory namespace. Defaults to shared.'),
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

export const contextTool = async (input: z.infer<z.ZodObject<typeof contextInputSchema>>): Promise<CallToolResult> => {
  const vault = await resolveVault(input.vault)
  const config = await loadBrainlinkConfig()
  const mode = sanitizeSearchMode(input.mode, config.defaultSearchMode)
  const contextPackage = await buildContextPackage(vault, input.query, input.limit, input.tokens, input.agent, mode)

  return jsonResult({
    vault,
    agent: input.agent,
    mode,
    ...contextPackage
  })
}

export const searchTool = async (input: z.infer<z.ZodObject<typeof searchInputSchema>>): Promise<CallToolResult> => {
  const vault = await resolveVault(input.vault)
  const config = await loadBrainlinkConfig()
  const mode = sanitizeSearchMode(input.mode, config.defaultSearchMode)
  const results = await searchKnowledge(vault, input.query, input.limit, input.agent, mode)

  return jsonResult({
    vault,
    agent: input.agent,
    query: input.query,
    limit: input.limit,
    mode,
    results
  })
}

export const addNoteTool = async (input: z.infer<z.ZodObject<typeof addNoteInputSchema>>): Promise<CallToolResult> => {
  const vault = await resolveVault(input.vault)
  const path = await addNote(vault, input.title, input.content, input.agent, {
    allowSensitive: input.allowSensitive
  })
  const index = await indexVault(vault)

  return jsonResult({
    vault,
    title: input.title,
    agent: input.agent,
    path,
    index
  })
}

export const indexTool = async (input: z.infer<z.ZodObject<typeof indexInputSchema>>): Promise<CallToolResult> => {
  const vault = await resolveVault(input.vault)
  const result = await indexVault(vault)

  return jsonResult({
    vault,
    ...result
  })
}

export const validateTool = async (input: z.infer<z.ZodObject<typeof validateInputSchema>>): Promise<CallToolResult> => {
  const vault = await resolveVault(input.vault)
  const validation = await validateVault(vault, input.agent)

  return jsonResult({
    vault,
    agent: input.agent,
    ...validation
  })
}

export const graphTool = async (input: z.infer<z.ZodObject<typeof graphInputSchema>>): Promise<CallToolResult> => {
  const vault = await resolveVault(input.vault)
  const graph = await getGraph(vault, input.agent)

  return jsonResult({
    vault,
    agent: input.agent,
    ...graph
  })
}

export const brokenLinksTool = async (input: z.infer<z.ZodObject<typeof brokenLinksInputSchema>>): Promise<CallToolResult> => {
  const vault = await resolveVault(input.vault)
  const brokenLinks = await getBrokenLinksReport(vault, input.agent)

  return jsonResult({
    vault,
    agent: input.agent,
    brokenLinks
  })
}

export const orphansTool = async (input: z.infer<z.ZodObject<typeof orphansInputSchema>>): Promise<CallToolResult> => {
  const vault = await resolveVault(input.vault)
  const orphans = await getOrphansReport(vault, input.agent)

  return jsonResult({
    vault,
    agent: input.agent,
    orphans
  })
}

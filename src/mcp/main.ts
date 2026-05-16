#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createBrainlinkMcpServer } from './server.js'
import { runStartupBootstrap } from './startup.js'

const start = async (): Promise<void> => {
  const startup = await runStartupBootstrap()

  if (startup.error) {
    console.error(`Brainlink MCP startup bootstrap warning: ${startup.error}`)
  }

  const server = createBrainlinkMcpServer()
  const transport = new StdioServerTransport()

  await server.connect(transport)
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)

  console.error(message)
  process.exitCode = 1
})

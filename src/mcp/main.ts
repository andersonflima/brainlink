#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createBrainlinkMcpServer } from './server.js'

const server = createBrainlinkMcpServer()
const transport = new StdioServerTransport()

server.connect(transport).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)

  console.error(message)
  process.exitCode = 1
})

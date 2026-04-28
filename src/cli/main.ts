#!/usr/bin/env node
import { Command } from 'commander'
import { basename } from 'node:path'
import { registerReadCommands } from './commands/read-commands.js'
import { registerWriteCommands } from './commands/write-commands.js'

const program = new Command()
const cliName = basename(process.argv[1] ?? 'brainlink')
const displayName = cliName === 'blink' ? 'blink' : 'brainlink'
const aliasName = displayName === 'blink' ? 'brainlink' : 'blink'

program
  .name(displayName)
  .alias(aliasName)
  .description('Local-first knowledge memory for agents')
  .version('0.1.0')

registerWriteCommands(program)
registerReadCommands(program)

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)

  console.error(message)
  process.exitCode = 1
})

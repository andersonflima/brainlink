#!/usr/bin/env node
import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerAgentCommands } from './commands/agent-commands.js'
import { registerConfigCommands } from './commands/config-commands.js'
import { registerReadCommands } from './commands/read-commands.js'
import { registerWriteCommands } from './commands/write-commands.js'

type PackageMetadata = {
  readonly version?: string
}

const readPackageVersion = (): string => {
  const packagePath = join(dirname(fileURLToPath(import.meta.url)), '../../package.json')
  const metadata = JSON.parse(readFileSync(packagePath, 'utf8')) as PackageMetadata

  return metadata.version ?? '0.0.0'
}

const program = new Command()
const cliName = basename(process.argv[1] ?? 'brainlink')
const displayName = cliName === 'blink' ? 'blink' : 'brainlink'
const aliasName = displayName === 'blink' ? 'brainlink' : 'blink'

program
  .name(displayName)
  .alias(aliasName)
  .description('Local-first knowledge memory for agents')
  .version(readPackageVersion())

registerWriteCommands(program)
registerReadCommands(program)
registerConfigCommands(program)
registerAgentCommands(program)

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)

  console.error(message)
  process.exitCode = 1
})

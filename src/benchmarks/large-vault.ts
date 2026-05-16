import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { indexVault } from '../application/index-vault.js'
import { searchKnowledge } from '../application/search-knowledge.js'
import { ensureVault } from '../infrastructure/file-system-vault.js'

type BenchmarkOptions = {
  readonly notes: number
  readonly agent: string
  readonly keep: boolean
}

const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const readStringOption = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : undefined

  return value && !value.startsWith('--') ? value : undefined
}

const readOptions = (args: readonly string[]): BenchmarkOptions => ({
  notes: parsePositiveInteger(readStringOption(args, '--notes'), 2000),
  agent: readStringOption(args, '--agent') ?? 'benchmark-agent',
  keep: args.includes('--keep')
})

const topics = [
  'authentication jwt token refresh policy',
  'graph backlinks markdown vault indexing',
  'frontend canvas layout graph interaction',
  'agent memory context retrieval summarization',
  'security local server vault path allowlist',
  'operations release npm github actions smoke test',
  'architecture functional core imperative shell boundaries'
]

const formatNote = (index: number): string => {
  const topic = topics[index % topics.length]
  const previous = index > 0 ? `[[Benchmark Note ${index - 1}]]` : ''
  const related = index > 7 ? `[[Benchmark Note ${index - 7}]]` : ''

  return [
    `# Benchmark Note ${index}`,
    '',
    `This note captures ${topic}.`,
    `The implementation detail number ${index} repeats ${topic} for semantic retrieval pressure.`,
    `Related: ${[previous, related].filter(Boolean).join(' ')}`,
    '',
    `#benchmark #topic-${index % topics.length}`
  ].join('\n')
}

const writeBenchmarkVault = async (vaultPath: string, options: BenchmarkOptions): Promise<void> => {
  const agentPath = join(vaultPath, 'agents', options.agent)
  await mkdir(agentPath, { recursive: true, mode: 0o700 })
  await Promise.all(
    Array.from({ length: options.notes }, (_, index) =>
      writeFile(join(agentPath, `benchmark-note-${index}.md`), formatNote(index), { encoding: 'utf8', mode: 0o600 })
    )
  )
}

const timed = async <T>(name: string, operation: () => Promise<T>): Promise<readonly [string, number, T]> => {
  const start = performance.now()
  const result = await operation()

  return [name, performance.now() - start, result]
}

const printMetric = (name: string, durationMs: number): void => {
  console.log(`${name}: ${durationMs.toFixed(1)}ms`)
}

const main = async (): Promise<void> => {
  const options = readOptions(process.argv.slice(2))
  const vaultPath = await mkdtemp(join(tmpdir(), 'brainlink-benchmark-'))

  try {
    await ensureVault(vaultPath)
    const [, writeMs] = await timed('write', () => writeBenchmarkVault(vaultPath, options))
    const [, indexMs, indexResult] = await timed('index', () => indexVault(vaultPath))
    const [, semanticMs, semanticResults] = await timed('semantic search', () =>
      searchKnowledge(vaultPath, 'authentication token policy', 10, options.agent, 'semantic')
    )
    const [, hybridMs, hybridResults] = await timed('hybrid search', () =>
      searchKnowledge(vaultPath, 'graph retrieval indexing', 10, options.agent, 'hybrid')
    )

    console.log(`vault: ${vaultPath}`)
    console.log(`notes: ${options.notes}`)
    console.log(`documents: ${indexResult.documentCount}`)
    console.log(`chunks: ${indexResult.chunkCount}`)
    printMetric('write', writeMs)
    printMetric('index', indexMs)
    printMetric('semantic search', semanticMs)
    printMetric('hybrid search', hybridMs)
    console.log(`semantic top: ${semanticResults[0]?.title ?? 'none'}`)
    console.log(`hybrid top: ${hybridResults[0]?.title ?? 'none'}`)
  } finally {
    if (!options.keep) {
      await rm(vaultPath, { recursive: true, force: true })
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)

  console.error(message)
  process.exitCode = 1
})

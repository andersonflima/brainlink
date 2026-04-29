import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const defaultHomeDirectoryName = '.brainlink'
const defaultVaultDirectoryName = 'vault'

export const expandHomePath = (path: string): string =>
  path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(2)) : path

export const resolvePath = (path: string, cwd = process.cwd()): string => {
  const expandedPath = expandHomePath(path)

  return isAbsolute(expandedPath) ? expandedPath : resolve(cwd, expandedPath)
}

export const getBrainlinkHomePath = (): string => {
  const configuredHome = process.env.BRAINLINK_HOME?.trim()

  return configuredHome ? resolvePath(configuredHome) : join(homedir(), defaultHomeDirectoryName)
}

export const getDefaultVaultPath = (): string =>
  join(getBrainlinkHomePath(), defaultVaultDirectoryName)

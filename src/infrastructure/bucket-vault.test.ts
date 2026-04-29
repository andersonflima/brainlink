import { describe, expect, it } from 'vitest'
import { parseBucketVaultUri } from './bucket-vault.js'
import { assertVaultAllowed } from './file-system-vault.js'

describe('bucket vaults', () => {
  it('parses and normalizes s3 vault uris', () => {
    expect(parseBucketVaultUri('s3://memory-vault/team/brainlink/')).toEqual({
      uri: 's3://memory-vault/team/brainlink',
      bucket: 'memory-vault',
      prefix: 'team/brainlink'
    })
  })

  it('allows bucket vaults inside an allowed bucket prefix', () => {
    expect(assertVaultAllowed('s3://memory-vault/team/project', ['s3://memory-vault/team'])).toBe(
      's3://memory-vault/team/project'
    )
  })

  it('blocks bucket vaults outside allowed bucket prefixes', () => {
    expect(() => assertVaultAllowed('s3://memory-vault/other/project', ['s3://memory-vault/team'])).toThrow(
      'Vault path is not allowed'
    )
  })
})

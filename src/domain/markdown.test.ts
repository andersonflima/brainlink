import { describe, expect, it } from 'vitest'
import { createIndexedDocument, extractTags, extractWikiLinkWeights, extractWikiLinks, parseMarkdownDocument } from './markdown.js'

describe('markdown domain', () => {
  it('extracts wiki links from markdown content', () => {
    expect(extractWikiLinks('Use [[Architecture]] with [[Auth#JWT|JWT notes]] and [[Architecture]].')).toEqual([
      'Architecture',
      'Auth'
    ])
  })

  it('extracts tags from markdown content', () => {
    expect(extractTags('A #auth note with #jwt and #auth again')).toEqual(['auth', 'jwt'])
  })

  it('derives wiki link weights from repeated links and priority markers', () => {
    const content = [
      '# Architecture Map',
      '- [ ] Escalate [[Architecture]] priority: high',
      'Reference [[Architecture]] again.',
      'Keep [[Notes]] priority: low'
    ].join('\n')

    expect(extractWikiLinkWeights(content)).toEqual([
      { title: 'Architecture', weight: 6, priority: 'high' },
      { title: 'Notes', weight: 1, priority: 'low' }
    ])
  })

  it('ignores wiki links and tags inside fenced code blocks', () => {
    const content = ['# Real Note', 'See [[Architecture]]. #real', '', '```md', '[[Example]] #example', '```'].join('\n')

    expect(extractWikiLinks(content)).toEqual(['Architecture'])
    expect(extractTags(content)).toEqual(['real'])
  })

  it('resolves agent id from the dedicated agent folder or frontmatter', () => {
    const fromPath = parseMarkdownDocument({
      absolutePath: '/vault/agents/coding-agent/architecture.md',
      vaultPath: '/vault',
      content: '# Architecture',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z')
    })
    const fromFrontmatter = parseMarkdownDocument({
      absolutePath: '/vault/legacy/research.md',
      vaultPath: '/vault',
      content: ['---', 'agent: "Research Agent"', '---', '', '# Research'].join('\n'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z')
    })

    expect(fromPath.agentId).toBe('coding-agent')
    expect(fromFrontmatter.agentId).toBe('research-agent')
  })

  it('creates indexed documents with resolved links', () => {
    const auth = parseMarkdownDocument({
      absolutePath: '/vault/auth.md',
      vaultPath: '/vault',
      content: '# Auth\n\nSee [[Architecture]]. #auth',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z')
    })
    const architecture = parseMarkdownDocument({
      absolutePath: '/vault/architecture.md',
      vaultPath: '/vault',
      content: '# Architecture',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z')
    })
    const indexed = createIndexedDocument(auth, new Map([[architecture.title.toLowerCase(), architecture.id]]))

    expect(indexed.links).toEqual([
      {
        fromDocumentId: auth.id,
        toTitle: 'Architecture',
        toDocumentId: architecture.id,
        weight: 1,
        priority: 'normal'
      }
    ])
    expect(indexed.chunks).toHaveLength(1)
  })
})

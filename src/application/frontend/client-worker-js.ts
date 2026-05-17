export const createClientWorkerJs = (): string => `const normalize = value => String(value || '')
  .normalize('NFKD')
  .replace(/\\p{Diacritic}/gu, '')
  .toLowerCase()

let nodeIndex = []

const toNodeIndex = nodes =>
  (Array.isArray(nodes) ? nodes : [])
    .map(node => {
      const id = typeof node.id === 'string' ? node.id : ''
      if (!id) {
        return null
      }
      const title = normalize(node.title)
      const path = normalize(node.path)
      const tags = Array.isArray(node.tags) ? node.tags.map(tag => normalize(tag)) : []
      return {
        id,
        text: [title, path, ...tags].join(' ')
      }
    })
    .filter(Boolean)

const scoreText = (text, query) => {
  if (!query) return 0
  if (!text.includes(query)) return 0
  if (text.startsWith(query)) return 4
  return 1
}

const filterIds = (query, limit) => {
  const normalizedQuery = normalize(query).trim()
  if (!normalizedQuery) {
    return []
  }
  const rows = []
  for (let index = 0; index < nodeIndex.length; index += 1) {
    const row = nodeIndex[index]
    const score = scoreText(row.text, normalizedQuery)
    if (score > 0) {
      rows.push({ id: row.id, score })
    }
  }
  rows.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
  return rows.slice(0, Math.max(1, Number.isFinite(limit) ? limit : rows.length)).map(row => row.id)
}

self.onmessage = event => {
  const payload = event.data
  if (!payload || typeof payload !== 'object') {
    return
  }
  if (payload.type === 'load-nodes') {
    nodeIndex = toNodeIndex(payload.nodes)
    return
  }
  if (payload.type === 'filter') {
    const token = payload.token
    const ids = filterIds(payload.query, payload.limit)
    self.postMessage({ type: 'filter-result', token, ids })
  }
}

self.postMessage({ type: 'ready' })
`

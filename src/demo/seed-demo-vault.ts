import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { indexVault } from '../application/index-vault.js'
import { writeMarkdownFile } from '../infrastructure/file-system-vault.js'

type DemoNote = {
  readonly path: string
  readonly agentId: string
  readonly title: string
  readonly type: string
  readonly status: string
  readonly tags: readonly string[]
  readonly summary: string
  readonly links: readonly string[]
  readonly details?: readonly string[]
}

type ParsedArgs = {
  readonly vaultPath: string
  readonly clean: boolean
}

const note = (
  path: string,
  title: string,
  type: string,
  tags: readonly string[],
  summary: string,
  links: readonly string[],
  details: readonly string[] = [],
  agentId = 'shared'
): DemoNote => ({
  path,
  agentId,
  title,
  type,
  status: 'active',
  tags,
  summary,
  links,
  details
})

const slug = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const conceptPath = (title: string): string => `20-concepts/${slug(title)}.md`
const architecturePath = (title: string): string => `30-architecture/${slug(title)}.md`
const agentPath = (title: string): string => `40-agents/${slug(title)}.md`
const retrievalPath = (title: string): string => `50-retrieval/${slug(title)}.md`
const operationPath = (title: string): string => `60-operations/${slug(title)}.md`
const evaluationPath = (title: string): string => `70-evaluation/${slug(title)}.md`
const sessionPath = (title: string): string => `80-sessions/${slug(title)}.md`
const securityPath = (title: string): string => `90-security/${slug(title)}.md`
const agentMemoryPath = (title: string): string => `10-agent-memory/${slug(title)}.md`

const agentMemoryNote = (
  agentId: string,
  title: string,
  type: string,
  tags: readonly string[],
  summary: string,
  links: readonly string[],
  details: readonly string[] = []
): DemoNote => note(agentMemoryPath(title), title, type, tags, summary, links, details, agentId)

const mocNotes: readonly DemoNote[] = [
  note(
    '00-maps/moc-brainlink.md',
    'MOC Brainlink',
    'map',
    ['moc', 'brainlink'],
    'Mapa principal do vault demo. Conecta arquitetura, agentes, retrieval, operacao, seguranca e avaliacao.',
    ['MOC Agents', 'MOC Retrieval', 'MOC Architecture', 'MOC Operations', 'MOC Evaluation', 'MOC Security']
  ),
  note(
    '00-maps/moc-agents.md',
    'MOC Agents',
    'map',
    ['moc', 'agent'],
    'Mapa para memoria operacional de agentes que usam Brainlink antes de responder.',
    ['Agent Runtime Loop', 'Agent Memory Contract', 'Tool Use Policy', 'Agent Write Policy', 'Agent Read Policy', 'Agent Handoff Protocol']
  ),
  note(
    '00-maps/moc-retrieval.md',
    'MOC Retrieval',
    'map',
    ['moc', 'retrieval'],
    'Mapa de busca, ranking, chunking, compressao e contexto.',
    ['Retrieval Pipeline', 'Context Builder', 'Ranking Strategy', 'Chunking Strategy', 'Context Compression', 'Semantic Search']
  ),
  note(
    '00-maps/moc-architecture.md',
    'MOC Architecture',
    'map',
    ['moc', 'architecture'],
    'Mapa das decisoes arquiteturais do Brainlink.',
    ['Brainlink Architecture', 'Markdown Source Of Truth ADR', 'SQLite Derived Index ADR', 'CLI First ADR', 'HTTP Local API ADR', 'MCP Adapter ADR']
  ),
  note(
    '00-maps/moc-operations.md',
    'MOC Operations',
    'map',
    ['moc', 'operations'],
    'Mapa de runbooks e operacao local do vault.',
    ['Runbook Seed Demo Vault', 'Runbook Start Graph Server', 'Runbook Reindex Vault', 'Runbook Add Memory', 'Runbook Review Broken Links']
  ),
  note(
    '00-maps/moc-evaluation.md',
    'MOC Evaluation',
    'map',
    ['moc', 'evaluation'],
    'Mapa de avaliacao de qualidade de memoria, contexto e comportamento de agente.',
    ['Evaluation Checklist', 'Context Quality Rubric', 'Memory Quality Rules', 'Knowledge Graph Hygiene', 'Broken Link Review']
  ),
  note(
    '00-maps/moc-security.md',
    'MOC Security',
    'map',
    ['moc', 'security'],
    'Mapa de fronteiras locais, privacidade e exposicao HTTP/MCP.',
    ['Security Boundary', 'Local First Boundary', 'HTTP Exposure Risk', 'MCP Tool Boundary', 'Sensitive Memory Policy']
  )
]

const conceptNotes: readonly DemoNote[] = [
  note(conceptPath('Brainlink Architecture'), 'Brainlink Architecture', 'concept', ['architecture', 'brainlink'], 'Arquitetura em camadas para transformar Markdown em memoria recuperavel.', ['Markdown Vault', 'SQLite Index', 'Graph Explorer', 'Context Builder', 'MOC Architecture']),
  note(conceptPath('HTTP API'), 'HTTP API', 'concept', ['http', 'api'], 'API local para graph, graph-layout, search, context, links, backlinks, stats e indexacao.', ['HTTP Local API ADR', 'Graph Explorer', 'Security Boundary', 'Runbook Start Graph Server']),
  note(conceptPath('MCP Integration'), 'MCP Integration', 'concept', ['mcp', 'integration'], 'Adaptador MCP stdio que expoe Brainlink como ferramentas para agentes compativeis.', ['MCP Adapter ADR', 'Agent Runtime Loop', 'Tool Use Policy', 'Security Boundary']),
  note(conceptPath('Markdown Vault'), 'Markdown Vault', 'concept', ['markdown', 'vault'], 'Camada duravel e editavel por humanos.', ['Markdown Source Of Truth ADR', 'Obsidian Compatibility', 'Backlink Strategy', 'Runbook Add Memory']),
  note(conceptPath('SQLite Index'), 'SQLite Index', 'concept', ['sqlite', 'index'], 'Indice local reconstruivel para busca, chunks e links.', ['SQLite Derived Index ADR', 'Retrieval Pipeline', 'Graph Explorer', 'Runbook Reindex Vault']),
  note(conceptPath('Graph Explorer'), 'Graph Explorer', 'concept', ['graph', 'ui'], 'Frontend para navegar nos, vinculos, conteudo, tags e backlinks.', ['HTTP Local API ADR', 'Backlink Strategy', 'Knowledge Graph Hygiene', 'MOC Brainlink']),
  note(conceptPath('Backlink Strategy'), 'Backlink Strategy', 'concept', ['backlinks', 'graph'], 'Backlinks sao derivados de links existentes e ajudam navegacao contextual.', ['Markdown Vault', 'Graph Explorer', 'Broken Link Review']),
  note(conceptPath('Obsidian Compatibility'), 'Obsidian Compatibility', 'concept', ['obsidian', 'markdown'], 'Compatibilidade mental com Obsidian por Markdown, wiki links e tags.', ['Markdown Vault', 'Graph Explorer', 'Knowledge Graph Hygiene']),
  note(conceptPath('Memory Quality Rules'), 'Memory Quality Rules', 'concept', ['memory', 'quality'], 'Regras para decidir o que vira memoria duravel.', ['Agent Write Policy', 'Knowledge Graph Hygiene', 'Evaluation Checklist', 'Source Grounding']),
  note(conceptPath('Knowledge Graph Hygiene'), 'Knowledge Graph Hygiene', 'concept', ['graph', 'quality'], 'Praticas para evitar duplicacao, orfaos e links quebrados.', ['Broken Link Review', 'Memory Quality Rules', 'MOC Evaluation']),
  note(conceptPath('Broken Link Review'), 'Broken Link Review', 'concept', ['links', 'review'], 'Processo para revisar links sem destino e conceitos divergentes.', ['Knowledge Graph Hygiene', 'Runbook Review Broken Links', 'Graph Explorer']),
  note(conceptPath('Source Grounding'), 'Source Grounding', 'concept', ['source', 'grounding'], 'Respostas devem preservar fontes usadas pelo contexto recuperado.', ['Context Builder', 'Agent Read Policy', 'Evaluation Checklist']),
  note(conceptPath('Long Term Memory Model'), 'Long Term Memory Model', 'concept', ['memory', 'llm'], 'Memoria externa recuperavel, nao contexto infinito dentro do modelo.', ['Context Builder', 'Retrieval Pipeline', 'Semantic Search', 'Context Compression']),
  note(conceptPath('Atomic Note'), 'Atomic Note', 'concept', ['note', 'atomic'], 'Nota pequena focada em um conceito ou decisao.', ['Memory Quality Rules', 'Agent Write Policy', 'Knowledge Graph Hygiene']),
  note(conceptPath('Project Memory'), 'Project Memory', 'concept', ['project', 'memory'], 'Memoria compartilhada sobre decisoes, padroes e operacao do projeto.', ['Long Term Memory Model', 'User Preference Memory', 'Decision Memory']),
  note(conceptPath('Decision Memory'), 'Decision Memory', 'concept', ['decision', 'memory'], 'Registro de decisoes tecnicas com contexto, motivacao e consequencias.', ['ADR Template', 'Markdown Source Of Truth ADR', 'SQLite Derived Index ADR']),
  note(conceptPath('User Preference Memory'), 'User Preference Memory', 'concept', ['user', 'preference'], 'Preferencias duraveis do usuario salvas para orientar respostas futuras.', ['Agent Runtime Loop', 'Memory Quality Rules', 'Sensitive Memory Policy']),
  note(conceptPath('Context Window Budget'), 'Context Window Budget', 'concept', ['tokens', 'context'], 'Limite pratico de tokens que exige selecao e compressao de memoria.', ['Context Compression', 'Chunking Strategy', 'Ranking Strategy']),
  note(conceptPath('Link Density'), 'Link Density', 'metric', ['graph', 'metric'], 'Densidade de conexoes indica quao navegavel esta o vault.', ['Knowledge Graph Hygiene', 'Graph Explorer', 'Evaluation Checklist']),
  note(conceptPath('Orphan Note'), 'Orphan Note', 'metric', ['graph', 'metric'], 'Nota sem links de entrada ou saida que pode precisar de revisao.', ['Knowledge Graph Hygiene', 'Broken Link Review', 'Graph Explorer']),
  note(conceptPath('Tag Taxonomy'), 'Tag Taxonomy', 'concept', ['tags', 'taxonomy'], 'Conjunto consistente de tags para recuperar memoria por tema.', ['Memory Quality Rules', 'Knowledge Graph Hygiene', 'Evaluation Checklist']),
  note(conceptPath('Memory Lifecycle'), 'Memory Lifecycle', 'concept', ['memory', 'lifecycle'], 'Ciclo de criar, revisar, consolidar e remover memorias.', ['Agent Write Policy', 'Runbook Add Memory', 'Runbook Review Broken Links']),
  note(conceptPath('Context Drift'), 'Context Drift', 'risk', ['context', 'risk'], 'Risco de recuperar conteudo antigo, conflitante ou irrelevante.', ['Ranking Strategy', 'Memory Quality Rules', 'Context Quality Rubric']),
  note(conceptPath('Duplicate Memory'), 'Duplicate Memory', 'risk', ['memory', 'risk'], 'Risco de registrar a mesma decisao em notas diferentes.', ['Knowledge Graph Hygiene', 'Memory Lifecycle', 'Evaluation Checklist']),
  note(conceptPath('Retrieval Trace'), 'Retrieval Trace', 'concept', ['retrieval', 'trace'], 'Registro das fontes e trechos usados para responder.', ['Source Grounding', 'Context Builder', 'Agent Read Policy']),
  note(conceptPath('Graph Navigation'), 'Graph Navigation', 'concept', ['graph', 'navigation'], 'Navegacao por vizinhanca, backlinks, MOCs e tags.', ['Graph Explorer', 'Backlink Strategy', 'MOC Brainlink']),
  note(conceptPath('Vault Portability'), 'Vault Portability', 'principle', ['vault', 'portability'], 'O vault deve continuar util mesmo fora do Brainlink.', ['Markdown Vault', 'Obsidian Compatibility', 'Markdown Source Of Truth ADR'])
]

const architectureNotes: readonly DemoNote[] = [
  note(architecturePath('Markdown Source Of Truth ADR'), 'Markdown Source Of Truth ADR', 'adr', ['adr', 'markdown'], 'Decisao: Markdown e a fonte canonica do conhecimento.', ['Markdown Vault', 'Vault Portability', 'Obsidian Compatibility', 'Brainlink Architecture']),
  note(architecturePath('SQLite Derived Index ADR'), 'SQLite Derived Index ADR', 'adr', ['adr', 'sqlite'], 'Decisao: SQLite e indice derivado e descartavel.', ['SQLite Index', 'Markdown Source Of Truth ADR', 'Retrieval Pipeline']),
  note(architecturePath('CLI First ADR'), 'CLI First ADR', 'adr', ['adr', 'cli'], 'Decisao: CLI e primeira superficie de integracao por ser simples para agentes.', ['Tool Use Policy', 'MCP Adapter ADR', 'HTTP Local API ADR']),
  note(architecturePath('HTTP Local API ADR'), 'HTTP Local API ADR', 'adr', ['adr', 'http'], 'Decisao: HTTP API local alimenta frontend e agentes locais.', ['HTTP API', 'Graph Explorer', 'Security Boundary']),
  note(architecturePath('MCP Adapter ADR'), 'MCP Adapter ADR', 'adr', ['adr', 'mcp'], 'Decisao: MCP expõe ferramentas de memoria para clientes compativeis.', ['MCP Integration', 'Agent Runtime Loop', 'Tool Use Policy']),
  note(architecturePath('Watcher Indexing ADR'), 'Watcher Indexing ADR', 'adr', ['adr', 'watcher'], 'Decisao: watcher reindexa Markdown alterado para feedback quase realtime.', ['Watcher Indexing', 'Graph Explorer', 'Runbook Start Graph Server']),
  note(architecturePath('Graph Read Only ADR'), 'Graph Read Only ADR', 'adr', ['adr', 'graph'], 'Decisao: grafo visual e inicialmente read-only para preservar Markdown como interface de escrita.', ['Graph Explorer', 'Markdown Vault', 'HTTP API']),
  note(architecturePath('JSON Output ADR'), 'JSON Output ADR', 'adr', ['adr', 'json'], 'Decisao: comandos finitos devem oferecer JSON para agentes.', ['CLI First ADR', 'Agent Read Policy', 'HTTP API']),
  note(architecturePath('Functional Core ADR'), 'Functional Core ADR', 'adr', ['adr', 'functional'], 'Decisao: parsing, ranking e formatacao devem ficar em funcoes puras.', ['Brainlink Architecture', 'Context Builder', 'Ranking Strategy']),
  note(architecturePath('Embedding Provider Boundary ADR'), 'Embedding Provider Boundary ADR', 'adr', ['adr', 'embedding'], 'Decisao: embeddings entram por provider plugavel.', ['Embedding Provider', 'Semantic Search', 'Retrieval Pipeline']),
  note(architecturePath('ADR Template'), 'ADR Template', 'template', ['adr', 'template'], 'Template para registrar decisoes tecnicas.', ['Decision Memory', 'Markdown Source Of Truth ADR', 'SQLite Derived Index ADR'])
]

const agentNotes: readonly DemoNote[] = [
  note(agentPath('Agent Runtime Loop'), 'Agent Runtime Loop', 'agent', ['agent', 'runtime'], 'Loop: observar tarefa, recuperar contexto, agir, registrar aprendizado duravel.', ['Context Builder', 'Agent Read Policy', 'Agent Write Policy', 'Tool Use Policy', 'Source Grounding']),
  note(agentPath('Agent Memory Contract'), 'Agent Memory Contract', 'agent', ['agent', 'contract'], 'Contrato para agentes usarem Brainlink como memoria externa.', ['Brainlink Agent Contract', 'Agent Runtime Loop', 'Memory Quality Rules']),
  note(agentPath('Brainlink Agent Contract'), 'Brainlink Agent Contract', 'agent', ['agent', 'memory'], 'Agentes consultam Brainlink antes de responder perguntas dependentes de memoria.', ['Context Builder', 'Brainlink Architecture', 'Memory Quality Rules', 'Source Grounding']),
  note(agentPath('Agent Read Policy'), 'Agent Read Policy', 'policy', ['agent', 'read'], 'Antes de responder, agente deve recuperar contexto e avaliar qualidade das fontes.', ['Context Builder', 'Retrieval Trace', 'Source Grounding', 'Context Quality Rubric']),
  note(agentPath('Agent Write Policy'), 'Agent Write Policy', 'policy', ['agent', 'write'], 'Agente so deve salvar memoria duravel, clara, linkada e com tags.', ['Memory Quality Rules', 'Atomic Note', 'Runbook Add Memory', 'Memory Lifecycle']),
  note(agentPath('Tool Use Policy'), 'Tool Use Policy', 'policy', ['tools', 'policy'], 'Ferramentas devem reduzir incerteza ou executar acao verificavel.', ['Agent Runtime Loop', 'MCP Integration', 'HTTP API']),
  note(agentPath('Research Agent Persona'), 'Research Agent Persona', 'persona', ['agent', 'research'], 'Persona para investigar conhecimento existente antes de propor mudanca.', ['Agent Read Policy', 'Retrieval Pipeline', 'Source Grounding']),
  note(agentPath('Coding Agent Persona'), 'Coding Agent Persona', 'persona', ['agent', 'coding'], 'Persona para alterar codigo usando contexto do vault e validacao automatizada.', ['Agent Runtime Loop', 'Tool Use Policy', 'Evaluation Checklist']),
  note(agentPath('Documentation Agent Persona'), 'Documentation Agent Persona', 'persona', ['agent', 'docs'], 'Persona para consolidar conhecimento em notas atomicas e MOCs.', ['Agent Write Policy', 'Atomic Note', 'MOC Brainlink']),
  note(agentPath('Agent Failure Modes'), 'Agent Failure Modes', 'risk', ['agent', 'risk'], 'Falhas: nao buscar contexto, salvar lixo, ignorar fonte, duplicar memoria.', ['Memory Quality Rules', 'Context Drift', 'Duplicate Memory', 'Evaluation Checklist']),
  note(agentPath('Agent Handoff Protocol'), 'Agent Handoff Protocol', 'protocol', ['agent', 'handoff'], 'Protocolo para outro agente entender estado atual do trabalho.', ['Retrieval Trace', 'Source Grounding', 'Project Memory'])
]

const retrievalNotes: readonly DemoNote[] = [
  note(retrievalPath('Retrieval Pipeline'), 'Retrieval Pipeline', 'retrieval', ['retrieval', 'search'], 'Pipeline que transforma pergunta em chunks ranqueados.', ['SQLite Index', 'Ranking Strategy', 'Context Builder', 'Semantic Search']),
  note(retrievalPath('Context Builder'), 'Context Builder', 'retrieval', ['context', 'builder'], 'Monta pacote de contexto com trechos, fontes, tags e scores.', ['Ranking Strategy', 'Context Compression', 'Source Grounding', 'Context Window Budget']),
  note(retrievalPath('Ranking Strategy'), 'Ranking Strategy', 'retrieval', ['ranking'], 'Ordena resultados por relevancia usando sinais textuais e futuramente semanticos.', ['Retrieval Pipeline', 'Semantic Search', 'Link Density', 'Context Drift']),
  note(retrievalPath('Chunking Strategy'), 'Chunking Strategy', 'retrieval', ['chunking', 'tokens'], 'Divide documentos em partes recuperaveis.', ['Context Window Budget', 'Context Builder', 'Context Compression']),
  note(retrievalPath('Context Compression'), 'Context Compression', 'retrieval', ['compression', 'context'], 'Reduz conteudo sem perder fonte, decisao e relacoes.', ['Context Builder', 'Context Window Budget', 'Source Grounding']),
  note(retrievalPath('Semantic Search'), 'Semantic Search', 'retrieval', ['semantic', 'search'], 'Busca conceitual baseada em embeddings.', ['Embedding Provider', 'Ranking Strategy', 'Retrieval Pipeline']),
  note(retrievalPath('Embedding Provider'), 'Embedding Provider', 'retrieval', ['embedding', 'provider'], 'Provider plugavel para gerar vetores.', ['Semantic Search', 'Embedding Provider Boundary ADR', 'Retrieval Pipeline']),
  note(retrievalPath('FTS Search'), 'FTS Search', 'retrieval', ['fts', 'search'], 'Busca textual por SQLite FTS.', ['SQLite Index', 'Retrieval Pipeline', 'Ranking Strategy']),
  note(retrievalPath('Hybrid Retrieval'), 'Hybrid Retrieval', 'retrieval', ['hybrid', 'retrieval'], 'Combina FTS, embeddings, tags e grafo.', ['FTS Search', 'Semantic Search', 'Ranking Strategy']),
  note(retrievalPath('Context Package Format'), 'Context Package Format', 'retrieval', ['context', 'format'], 'Formato Markdown/JSON que agentes consomem.', ['Context Builder', 'JSON Output ADR', 'Source Grounding']),
  note(retrievalPath('Retrieval Trace'), 'Retrieval Trace', 'retrieval', ['trace'], 'Registro das fontes usadas em uma resposta.', ['Context Package Format', 'Agent Handoff Protocol', 'Source Grounding']),
  note(retrievalPath('Query Expansion'), 'Query Expansion', 'retrieval', ['query', 'expansion'], 'Expande pergunta com tags, sinonimos e links relacionados.', ['Hybrid Retrieval', 'Tag Taxonomy', 'Backlink Strategy'])
]

const operationNotes: readonly DemoNote[] = [
  note(operationPath('Runbook Seed Demo Vault'), 'Runbook Seed Demo Vault', 'runbook', ['runbook', 'demo'], 'Cria ou atualiza vault demo com estrutura complexa.', ['MOC Operations', 'Graph Explorer', 'Runbook Start Graph Server']),
  note(operationPath('Runbook Start Graph Server'), 'Runbook Start Graph Server', 'runbook', ['runbook', 'server'], 'Sobe servidor local com --watch para grafo atualizar.', ['Watcher Indexing', 'HTTP API', 'Graph Explorer']),
  note(operationPath('Runbook Reindex Vault'), 'Runbook Reindex Vault', 'runbook', ['runbook', 'index'], 'Reconstrói SQLite a partir do Markdown.', ['SQLite Index', 'Markdown Vault', 'Watcher Indexing']),
  note(operationPath('Runbook Add Memory'), 'Runbook Add Memory', 'runbook', ['runbook', 'memory'], 'Adiciona memoria duravel com titulo, tags e links.', ['Agent Write Policy', 'Atomic Note', 'Memory Quality Rules']),
  note(operationPath('Runbook Review Broken Links'), 'Runbook Review Broken Links', 'runbook', ['runbook', 'links'], 'Revisa links sem destino e decide criar nota ou renomear link.', ['Broken Link Review', 'Knowledge Graph Hygiene', 'Graph Explorer']),
  note(operationPath('Runbook Inspect Context'), 'Runbook Inspect Context', 'runbook', ['runbook', 'context'], 'Usa comando context para validar o que o agente receberia.', ['Context Builder', 'Source Grounding', 'Context Quality Rubric']),
  note(operationPath('Runbook Export Graph JSON'), 'Runbook Export Graph JSON', 'runbook', ['runbook', 'graph'], 'Usa /api/graph ou CLI graph --json para inspecionar dados.', ['HTTP API', 'Graph Explorer', 'JSON Output ADR']),
  note(operationPath('Watcher Indexing'), 'Watcher Indexing', 'operation', ['watcher', 'indexing'], 'Observa alteracoes Markdown e dispara reindexacao.', ['Watcher Indexing ADR', 'Runbook Start Graph Server', 'Graph Explorer']),
  note(operationPath('CLI Automation'), 'CLI Automation', 'operation', ['cli', 'automation'], 'Automacoes devem usar --json e npm --silent.', ['CLI First ADR', 'JSON Output ADR', 'Tool Use Policy']),
  note(operationPath('Demo Vault Maintenance'), 'Demo Vault Maintenance', 'operation', ['demo', 'maintenance'], 'Manter dados do demo densos, linkados e revisaveis.', ['Runbook Seed Demo Vault', 'Knowledge Graph Hygiene', 'MOC Brainlink'])
]

const evaluationNotes: readonly DemoNote[] = [
  note(evaluationPath('Evaluation Checklist'), 'Evaluation Checklist', 'evaluation', ['evaluation', 'quality'], 'Checklist para validar se agente usou memoria corretamente.', ['Source Grounding', 'Memory Quality Rules', 'Knowledge Graph Hygiene']),
  note(evaluationPath('Context Quality Rubric'), 'Context Quality Rubric', 'evaluation', ['context', 'quality'], 'Rubrica para medir utilidade do contexto recuperado.', ['Context Builder', 'Ranking Strategy', 'Context Drift']),
  note(evaluationPath('Graph Quality Rubric'), 'Graph Quality Rubric', 'evaluation', ['graph', 'quality'], 'Rubrica para medir densidade, orfaos, backlinks e tags.', ['Link Density', 'Orphan Note', 'Knowledge Graph Hygiene']),
  note(evaluationPath('Agent Answer Audit'), 'Agent Answer Audit', 'evaluation', ['agent', 'audit'], 'Audita se resposta preservou fontes e nao inventou memoria.', ['Source Grounding', 'Retrieval Trace', 'Agent Failure Modes']),
  note(evaluationPath('Memory Review Cadence'), 'Memory Review Cadence', 'evaluation', ['memory', 'review'], 'Cadencia para revisar notas antigas e consolidar duplicatas.', ['Memory Lifecycle', 'Duplicate Memory', 'Knowledge Graph Hygiene']),
  note(evaluationPath('Tag Consistency Audit'), 'Tag Consistency Audit', 'evaluation', ['tags', 'audit'], 'Audita tags inconsistentes e sinonimos divergentes.', ['Tag Taxonomy', 'Knowledge Graph Hygiene', 'Graph Quality Rubric']),
  note(evaluationPath('Retrieval Regression Test'), 'Retrieval Regression Test', 'evaluation', ['retrieval', 'test'], 'Teste com perguntas fixas para avaliar resultados recuperados.', ['Retrieval Pipeline', 'Context Quality Rubric', 'Hybrid Retrieval']),
  note(evaluationPath('Demo Scenario AI Assistant'), 'Demo Scenario AI Assistant', 'evaluation', ['demo', 'ai'], 'Cenario: assistente responde pergunta usando Brainlink como memoria.', ['Brainlink Agent Contract', 'Agent Runtime Loop', 'Context Builder'])
]

const securityNotes: readonly DemoNote[] = [
  note(securityPath('Security Boundary'), 'Security Boundary', 'security', ['security'], 'Define fronteiras de privacidade local.', ['Local First Boundary', 'HTTP Exposure Risk', 'Sensitive Memory Policy']),
  note(securityPath('Local First Boundary'), 'Local First Boundary', 'security', ['localfirst'], 'Dados ficam locais por padrao e Markdown permanece inspecionavel.', ['Markdown Vault', 'Vault Portability', 'Security Boundary']),
  note(securityPath('HTTP Exposure Risk'), 'HTTP Exposure Risk', 'security', ['http', 'risk'], 'Expor HTTP fora do localhost exige autenticacao.', ['HTTP API', 'Security Boundary', 'MCP Tool Boundary']),
  note(securityPath('MCP Tool Boundary'), 'MCP Tool Boundary', 'security', ['mcp', 'boundary'], 'Ferramentas MCP devem operar apenas no vault permitido.', ['MCP Integration', 'Tool Use Policy', 'Security Boundary']),
  note(securityPath('Sensitive Memory Policy'), 'Sensitive Memory Policy', 'security', ['sensitive', 'memory'], 'Informacoes sensiveis exigem cuidado antes de persistir.', ['User Preference Memory', 'Agent Write Policy', 'Security Boundary']),
  note(securityPath('Data Retention Policy'), 'Data Retention Policy', 'security', ['retention'], 'Memorias antigas devem poder expirar, ser revisadas ou consolidadas.', ['Memory Lifecycle', 'Sensitive Memory Policy', 'Memory Review Cadence'])
]

const sessionNotes: readonly DemoNote[] = [
  note(sessionPath('Session 2026-04-28 Project Start'), 'Session 2026-04-28 Project Start', 'session', ['session'], 'Sessao inicial: criar Brainlink como memoria local-first para agentes.', ['MOC Brainlink', 'Markdown Source Of Truth ADR', 'CLI First ADR']),
  note(sessionPath('Session 2026-04-28 Graph UI'), 'Session 2026-04-28 Graph UI', 'session', ['session', 'ui'], 'Sessao: adicionar server e grafo visual.', ['Graph Explorer', 'HTTP Local API ADR', 'Runbook Start Graph Server']),
  note(sessionPath('Session 2026-04-28 Agent Namespaces'), 'Session 2026-04-28 Agent Namespaces', 'session', ['session', 'agent'], 'Sessao: separar memoria por namespaces de agentes.', ['Agent Memory Contract', 'Agent Runtime Loop', 'Evaluation Checklist']),
  note(sessionPath('Session 2026-04-28 Realtime Frontend'), 'Session 2026-04-28 Realtime Frontend', 'session', ['session', 'realtime'], 'Sessao: frontend atualiza consultando /api/graph.', ['Watcher Indexing', 'Graph Explorer', 'HTTP API']),
  note(sessionPath('Session 2026-04-28 Granular Vault'), 'Session 2026-04-28 Granular Vault', 'session', ['session', 'vault'], 'Sessao: demo passa a ter MOCs, conceitos, ADRs, runbooks e avaliacoes.', ['MOC Brainlink', 'Atomic Note', 'Knowledge Graph Hygiene'])
]

const multiAgentNotes: readonly DemoNote[] = [
  agentMemoryNote('coding-agent', 'Coding Agent Memory Map', 'map', ['agent', 'coding', 'moc'], 'Mapa privado do coding-agent para decisoes de implementacao, testes e refatoracao.', ['Coding Agent TypeScript Policy', 'Coding Agent Functional Refactor Policy', 'Coding Agent Test Strategy', 'Coding Agent Release Checklist', 'Brainlink Architecture']),
  agentMemoryNote('coding-agent', 'Coding Agent TypeScript Policy', 'policy', ['agent', 'coding', 'typescript'], 'Preferir fronteiras tipadas, modelos imutaveis e APIs explicitas em TypeScript.', ['Functional Core ADR', 'Coding Agent Functional Refactor Policy', 'Coding Agent Test Strategy']),
  agentMemoryNote('coding-agent', 'Coding Agent Functional Refactor Policy', 'policy', ['agent', 'coding', 'functional'], 'Mudancas devem manter nucleo funcional, reduzir mutacao acidental e preservar adapters finos.', ['Functional Core ADR', 'Brainlink Architecture', 'Coding Agent TypeScript Policy']),
  agentMemoryNote('coding-agent', 'Coding Agent Test Strategy', 'runbook', ['agent', 'coding', 'test'], 'Para alteracoes de memoria, testar parser, indexacao, CLI, server e contratos MCP quando a borda mudar.', ['Evaluation Checklist', 'Retrieval Regression Test', 'Coding Agent Release Checklist']),
  agentMemoryNote('coding-agent', 'Coding Agent Release Checklist', 'runbook', ['agent', 'coding', 'release'], 'Antes de release: build, testes, pack smoke, docs e sem publish acidental.', ['CLI Automation', 'Runbook Reindex Vault', 'Coding Agent Test Strategy']),

  agentMemoryNote('research-agent', 'Research Agent Memory Map', 'map', ['agent', 'research', 'moc'], 'Mapa privado do research-agent para formular perguntas, validar fontes e gerar sinteses.', ['Research Agent Query Plan', 'Research Agent Source Review', 'Research Agent Synthesis Policy', 'Source Grounding']),
  agentMemoryNote('research-agent', 'Research Agent Query Plan', 'runbook', ['agent', 'research', 'query'], 'Comecar com perguntas amplas, expandir por tags e seguir backlinks relevantes.', ['Query Expansion', 'Hybrid Retrieval', 'Research Agent Source Review']),
  agentMemoryNote('research-agent', 'Research Agent Source Review', 'policy', ['agent', 'research', 'source'], 'Avaliar data, origem, conflito e confianca antes de promover informacao para memoria duravel.', ['Source Grounding', 'Context Drift', 'Research Agent Synthesis Policy']),
  agentMemoryNote('research-agent', 'Research Agent Synthesis Policy', 'policy', ['agent', 'research', 'synthesis'], 'Sintese deve separar fatos, inferencias e lacunas para outro agente reutilizar sem perder contexto.', ['Retrieval Trace', 'Agent Handoff Protocol', 'Research Agent Query Plan']),
  agentMemoryNote('research-agent', 'Research Agent Open Questions', 'inbox', ['agent', 'research', 'questions'], 'Fila de lacunas que exigem investigacao posterior antes de virar decisao.', ['Research Agent Query Plan', 'Memory Lifecycle', 'Context Quality Rubric']),

  agentMemoryNote('docs-agent', 'Docs Agent Memory Map', 'map', ['agent', 'docs', 'moc'], 'Mapa privado do docs-agent para organizar notas, exemplos e guias de uso.', ['Docs Agent Writing Policy', 'Docs Agent Structure Policy', 'Docs Agent Example Policy', 'Documentation Agent Persona']),
  agentMemoryNote('docs-agent', 'Docs Agent Writing Policy', 'policy', ['agent', 'docs', 'writing'], 'Documentacao deve explicar objetivo, comando, comportamento esperado e limite conhecido.', ['Agent Write Policy', 'Memory Quality Rules', 'Docs Agent Example Policy']),
  agentMemoryNote('docs-agent', 'Docs Agent Structure Policy', 'policy', ['agent', 'docs', 'structure'], 'Guias devem ter caminho de leitura claro, MOCs atualizados e links bidirecionais relevantes.', ['MOC Brainlink', 'Knowledge Graph Hygiene', 'Docs Agent Writing Policy']),
  agentMemoryNote('docs-agent', 'Docs Agent Example Policy', 'policy', ['agent', 'docs', 'examples'], 'Exemplos devem ser copiaveis, pequenos e alinhados ao CLI real.', ['CLI Automation', 'Runbook Add Memory', 'Docs Agent Structure Policy']),
  agentMemoryNote('docs-agent', 'Docs Agent Release Notes', 'runbook', ['agent', 'docs', 'release'], 'Release notes devem separar adicionados, alterados, corrigidos e riscos residuais.', ['Docs Agent Example Policy', 'Docs Agent Writing Policy', 'Evaluation Checklist'])
]

const notes: readonly DemoNote[] = [
  ...mocNotes,
  ...conceptNotes,
  ...architectureNotes,
  ...agentNotes,
  ...retrievalNotes,
  ...operationNotes,
  ...evaluationNotes,
  ...securityNotes,
  ...sessionNotes,
  ...multiAgentNotes
]

const parseArgs = (args: readonly string[]): ParsedArgs => {
  const index = args.indexOf('--vault')

  return {
    vaultPath: resolve(process.cwd(), index >= 0 ? args[index + 1] : '.demo/vault'),
    clean: args.includes('--clean')
  }
}

const formatFrontmatter = (note: DemoNote): string =>
  [
    '---',
    `title: "${note.title.replaceAll('"', '\\"')}"`,
    `agent: "${note.agentId}"`,
    `type: "${note.type}"`,
    `status: "${note.status}"`,
    `tags: "${note.tags.join(', ')}"`,
    '---'
  ].join('\n')

const formatNote = (note: DemoNote): string => {
  const details = note.details ?? []

  return [
    formatFrontmatter(note),
    '',
    `# ${note.title}`,
    '',
    '## Summary',
    '',
    note.summary,
    '',
    '## Links',
    '',
    ...note.links.map((link) => `- [[${link}]]`),
    '',
    '## Details',
    '',
    ...(details.length > 0
      ? details.map((detail) => `- ${detail}`)
      : [
          `- Tipo: ${note.type}.`,
          `- Status: ${note.status}.`,
          `- Esta nota participa do grafo granular do Brainlink demo.`
        ]),
    '',
    '## Tags',
    '',
    note.tags.map((tag) => `#${tag}`).join(' '),
    ''
  ].join('\n')
}

const seedDemoVault = async (args: ParsedArgs) => {
  if (args.clean) {
    await rm(args.vaultPath, { recursive: true, force: true })
  }

  const paths = await Promise.all(
    notes.map((demoNote) => writeMarkdownFile(args.vaultPath, `agents/${demoNote.agentId}/${demoNote.path}`, formatNote(demoNote)))
  )
  const indexed = await indexVault(args.vaultPath)

  return {
    vaultPath: args.vaultPath,
    noteCount: paths.length,
    indexed
  }
}

const main = async (): Promise<void> => {
  const result = await seedDemoVault(parseArgs(process.argv.slice(2)))

  console.log(JSON.stringify(result, null, 2))
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)

  console.error(message)
  process.exitCode = 1
})

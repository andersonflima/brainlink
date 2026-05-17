export const createClientHtml = (): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Brainlink Graph</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="shell">
      <section class="workspace" aria-label="Knowledge graph">
        <header class="graph-header" aria-label="Graph actions">
          <div class="brand-block">
            <strong>Brainlink</strong>
            <span class="eyebrow">Knowledge Graph</span>
          </div>
          <div class="floating-metrics" aria-label="Graph totals">
            <div class="metric-chip">
              <strong id="nodeCount">0</strong>
              <small>Notes</small>
            </div>
            <div class="metric-chip">
              <strong id="edgeCount">0</strong>
              <small>Links</small>
            </div>
            <div class="metric-chip">
              <strong id="tagCount">0</strong>
              <small>Tags</small>
            </div>
          </div>
          <label class="search">
            <input id="search" type="search" placeholder="Filter notes, tags or paths" autocomplete="off" />
          </label>
          <div class="header-actions">
            <label class="agent-filter">
              <select id="agent"></select>
            </label>
            <div class="toolbar" aria-label="Graph controls">
              <button id="zoomIn" type="button" title="Zoom in">+</button>
              <button id="zoomOut" type="button" title="Zoom out">-</button>
              <button id="fit" type="button" title="Fit visible nodes">◎</button>
              <button id="reset" type="button" title="Reset view">⌂</button>
            </div>
          </div>
        </header>
        <canvas id="graph" aria-label="Brainlink knowledge graph"></canvas>
      </section>
    </main>
    <footer class="app-footer" aria-label="License notice">
      <small>MIT License · Copyright © 2026 Anderson Espindola</small>
    </footer>
    <dialog id="contentDialog" class="content-dialog" aria-labelledby="contentTitle">
      <article>
        <header>
          <div>
            <span class="eyebrow">Markdown content</span>
            <h2 id="contentTitle">Selected note</h2>
            <p id="contentPath"></p>
          </div>
          <button id="contentClose" type="button">Close</button>
        </header>
        <div class="content-meta">
          <section class="content-meta-section">
            <h3>Tags</h3>
            <div id="contentTags" class="tags"></div>
          </section>
          <section class="content-meta-section">
            <h3>Outgoing</h3>
            <ul id="contentOutgoing"></ul>
          </section>
          <section class="content-meta-section">
            <h3>Backlinks</h3>
            <ul id="contentIncoming"></ul>
          </section>
        </div>
        <pre id="contentBody" class="note-content"></pre>
      </article>
    </dialog>
    <script src="/app.js"></script>
  </body>
</html>`

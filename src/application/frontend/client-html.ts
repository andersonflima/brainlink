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
        <canvas id="graph" aria-label="Brainlink knowledge graph"></canvas>
        <div class="topbar">
          <div>
            <strong>Brainlink</strong>
            <span id="stats">Loading graph</span>
          </div>
          <label class="search">
            <input id="search" type="search" placeholder="Filter notes, tags or paths" autocomplete="off" />
          </label>
          <label class="agent-filter">
            <select id="agent"></select>
          </label>
        </div>
        <div class="toolbar" aria-label="Graph controls">
          <button id="zoomIn" type="button" title="Zoom in">+</button>
          <button id="zoomOut" type="button" title="Zoom out">-</button>
          <button id="reset" type="button" title="Reset view">⌂</button>
        </div>
      </section>
      <aside class="inspector" aria-label="Selected note">
        <div>
          <span class="eyebrow">Selected note</span>
          <h1 id="title">Graph Overview</h1>
          <p id="path">Select a node to inspect links and backlinks.</p>
        </div>
        <div class="metrics">
          <div><span id="nodeCount">0</span><small>Notes</small></div>
          <div><span id="edgeCount">0</span><small>Links</small></div>
          <div><span id="tagCount">0</span><small>Tags</small></div>
        </div>
        <section>
          <h2>Tags</h2>
          <div id="tags" class="tags"></div>
        </section>
        <section>
          <h2>Notes</h2>
          <ul id="notes"></ul>
        </section>
        <section>
          <h2>Content</h2>
          <pre id="content" class="note-content"></pre>
        </section>
        <section>
          <h2>Outgoing</h2>
          <ul id="outgoing"></ul>
        </section>
        <section>
          <h2>Backlinks</h2>
          <ul id="incoming"></ul>
        </section>
      </aside>
    </main>
    <script src="/app.js"></script>
  </body>
</html>`

export const createClientCss = (): string => `:root {
  color-scheme: dark;
  --bg: #0d0f12;
  --panel: #15191f;
  --panel-strong: #1c222b;
  --line: #29313c;
  --text: #edf2f7;
  --muted: #99a5b5;
  --accent: #35d0a2;
  --accent-weak: rgba(53, 208, 162, 0.14);
  --danger: #ff6b6b;
}

* {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
}

button,
input,
select {
  font: inherit;
}

.shell {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  overflow: hidden;
}

.workspace {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.graph-header {
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 72px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, rgba(17, 21, 27, 0.96) 0%, rgba(17, 21, 27, 0.86) 100%);
  backdrop-filter: blur(8px);
}

.brand-block {
  display: grid;
  gap: 2px;
  min-width: max-content;
}

.brand-block strong {
  font-size: 18px;
}

#graph {
  display: block;
  width: 100%;
  height: 100%;
  background:
    radial-gradient(circle at 18% 20%, rgba(53, 208, 162, 0.12), transparent 28rem),
    linear-gradient(135deg, #0d0f12 0%, #12161c 55%, #0a0d10 100%);
  cursor: grab;
}

#graph:active {
  cursor: grabbing;
}

.eyebrow {
  color: var(--muted);
  font-size: 12px;
}

.search {
  flex: 1 1 320px;
  min-width: 220px;
}

.agent-filter {
  width: min(220px, 28vw);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

.search input,
.agent-filter select {
  width: 100%;
  height: 40px;
  border: 1px solid var(--line);
  border-radius: 8px;
  outline: none;
  background: rgba(21, 25, 31, 0.88);
  color: var(--text);
  padding: 0 14px;
}

.search input:focus,
.agent-filter select:focus {
  border-color: var(--accent);
}

.toolbar {
  display: flex;
  gap: 8px;
}

.toolbar button {
  width: 38px;
  height: 38px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(21, 25, 31, 0.88);
  color: var(--text);
  cursor: pointer;
}

.toolbar button:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.floating-metrics {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.metric-chip {
  min-width: 94px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(21, 25, 31, 0.88);
  display: grid;
  gap: 3px;
}

.metric-chip strong {
  font-size: 26px;
  line-height: 1;
}

.metric-chip small {
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tags span {
  max-width: 100%;
  padding: 6px 9px;
  border-radius: 999px;
  background: var(--accent-weak);
  color: var(--accent);
  font-size: 12px;
  word-break: break-word;
  overflow-wrap: anywhere;
}

ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
  color: var(--text);
  word-break: break-word;
  overflow-wrap: anywhere;
}

li button {
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

li button:hover {
  color: var(--accent);
}

li small {
  display: block;
  margin-top: 4px;
}

.note-content {
  max-height: min(68svh, 760px);
  margin: 0;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #101419;
  color: var(--text);
  white-space: pre-wrap;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.5;
}

.content-dialog {
  width: min(1240px, calc(100vw - 24px));
  max-height: calc(100svh - 20px);
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.48);
}

.content-dialog::backdrop {
  background: rgba(4, 7, 10, 0.72);
  backdrop-filter: blur(4px);
}

.content-dialog article {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  max-height: calc(100svh - 22px);
}

.content-dialog header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 22px;
  border-bottom: 1px solid var(--line);
}

.content-dialog h2,
.content-dialog p {
  margin: 0;
}

.content-dialog h2 {
  margin-top: 6px;
  font-size: 24px;
  line-height: 1.15;
  overflow-wrap: anywhere;
}

.content-dialog p {
  margin-top: 8px;
  color: var(--muted);
  overflow-wrap: anywhere;
}

.content-dialog button {
  flex: 0 0 auto;
  height: 38px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-strong);
  color: var(--text);
  cursor: pointer;
}

.content-dialog button:hover,
.content-dialog button:focus {
  border-color: var(--accent);
  color: var(--accent);
}

.content-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 14px 22px;
  border-bottom: 1px solid var(--line);
}

.content-meta-section {
  min-height: 0;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-strong);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
}

.content-meta-section h3 {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.content-meta-section ul,
.content-meta-section .tags {
  max-height: 220px;
  overflow: auto;
  align-content: flex-start;
  padding-right: 4px;
}

.content-dialog .note-content {
  max-height: none;
  min-height: 0;
  border: 0;
  border-radius: 0;
  padding: 22px;
}

.app-footer {
  flex: 0 0 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
}

.app-footer small {
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.02em;
}

@media (max-width: 860px) {
  .graph-header {
    align-items: stretch;
    flex-wrap: wrap;
    padding: 10px 12px;
    min-height: 0;
  }

  .search {
    width: 100%;
    flex-basis: 100%;
    order: 3;
  }

  .agent-filter {
    width: 100%;
  }

  .header-actions {
    width: 100%;
    margin-left: 0;
    justify-content: space-between;
    order: 4;
  }

  .content-dialog header {
    align-items: stretch;
    flex-direction: column;
  }

  .metric-chip {
    min-width: 82px;
  }

  .content-meta {
    grid-template-columns: 1fr;
  }
}`

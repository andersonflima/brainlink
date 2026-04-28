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

button,
input,
select {
  font: inherit;
}

.shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  width: 100%;
  height: 100svh;
  overflow: hidden;
}

.workspace {
  position: relative;
  min-width: 0;
  min-height: 0;
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

.topbar {
  position: absolute;
  top: 18px;
  left: 18px;
  right: 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  pointer-events: none;
}

.topbar > div {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.topbar strong {
  font-size: 18px;
}

.topbar span,
.eyebrow,
.inspector small {
  color: var(--muted);
  font-size: 12px;
}

.search {
  width: min(420px, 42vw);
  pointer-events: auto;
}

.agent-filter {
  width: min(220px, 28vw);
  pointer-events: auto;
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
  position: absolute;
  left: 18px;
  bottom: 18px;
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

.inspector {
  display: grid;
  grid-template-rows: auto auto auto auto auto 1fr 1fr;
  gap: 22px;
  min-width: 0;
  height: 100%;
  padding: 24px;
  border-left: 1px solid var(--line);
  background: var(--panel);
  overflow: auto;
}

.inspector h1,
.inspector h2,
.inspector p {
  margin: 0;
}

.inspector h1 {
  margin-top: 6px;
  font-size: 26px;
  line-height: 1.12;
  overflow-wrap: anywhere;
}

.inspector h2 {
  margin-bottom: 10px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

#path {
  margin-top: 10px;
  color: var(--muted);
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}

.metrics div {
  display: grid;
  gap: 4px;
  padding: 14px;
  background: var(--panel-strong);
}

.metrics div + div {
  border-left: 1px solid var(--line);
}

.metrics span {
  font-size: 22px;
  font-weight: 700;
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
  max-height: 32svh;
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

@media (max-width: 860px) {
  .shell {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) 42svh;
  }

  .inspector {
    border-left: 0;
    border-top: 1px solid var(--line);
    padding: 18px;
  }

  .topbar {
    align-items: stretch;
    flex-direction: column;
  }

  .search {
    width: 100%;
  }

  .agent-filter {
    width: 100%;
  }
}`

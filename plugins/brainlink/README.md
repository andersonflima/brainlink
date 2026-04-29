# Brainlink Codex Plugin

This plugin helps Codex use Brainlink as local-first Markdown memory.

It expects the Brainlink npm package to be installed:

```bash
npm install -g @andespindola/brainlink
```

## Add To The Local Codex Plugin Gallery

The npm package installs the `brainlink`, `blink` and `brainlink-mcp` commands.
The Codex plugin lives in this repository, so clone the repository and register
the plugin folder in your local Codex marketplace.

### 1. Install Brainlink

```bash
npm install -g @andespindola/brainlink@latest
brainlink-mcp --help
```

### 2. Clone This Repository

```bash
git clone https://github.com/andersonflima/brainlink.git "$HOME/brainlink"
```

If you already cloned the repository, use the existing clone path instead of
`$HOME/brainlink`.

### 3. Expose The Plugin Under `~/plugins`

```bash
mkdir -p "$HOME/plugins"
ln -s "$HOME/brainlink/plugins/brainlink" "$HOME/plugins/brainlink"
```

If `~/plugins/brainlink` already exists from an older local install, remove only
that Brainlink plugin entry first, then create the symlink again.

### 4. Register The Local Marketplace Entry

```bash
node <<'NODE'
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const marketplacePath = path.join(os.homedir(), ".agents", "plugins", "marketplace.json");
const pluginEntry = {
  name: "brainlink",
  source: {
    source: "local",
    path: "./plugins/brainlink"
  },
  policy: {
    installation: "AVAILABLE",
    authentication: "ON_INSTALL"
  },
  category: "Productivity"
};

fs.mkdirSync(path.dirname(marketplacePath), { recursive: true });

const marketplace = fs.existsSync(marketplacePath)
  ? JSON.parse(fs.readFileSync(marketplacePath, "utf8"))
  : {
      name: "local",
      interface: {
        displayName: "Local"
      },
      plugins: []
    };

const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
marketplace.plugins = [
  ...plugins.filter((plugin) => plugin?.name !== "brainlink"),
  pluginEntry
];

fs.writeFileSync(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);
NODE
```

### 5. Restart Codex

Restart Codex so it reloads `~/.agents/plugins/marketplace.json`. Brainlink
should appear in the local plugin gallery as `Brainlink`.

The plugin starts the `brainlink-mcp` stdio server and gives Codex a skill that defines the correct memory workflow:

1. Read memory with `brainlink_context` before work.
2. Write durable memory with `brainlink_add_note`.
3. Use explicit `[[wiki links]]` and `#tags`.
4. Add priority markers near important links, for example `priority: high`, `#important` or `#critical`.
5. Validate graph health with `brainlink_validate`, `brainlink_broken_links` and `brainlink_orphans`.

`brainlink_context` is read-only. It does not create graph links, backlinks or durable memory.

`brainlink_graph` returns weighted edges with `weight` and `priority` so Codex can rank related notes by importance.

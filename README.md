# webmcp-bridge

> Bridge between browser-native WebMCP (`navigator.modelContext.registerTool()`) and Model Context Protocol (MCP) clients (Claude Desktop, Claude Code, etc.).

`webmcp-bridge` enables MCP clients to discover and invoke tools directly exposed by web applications running inside a live browser session. By bridging the W3C/Chromium WebMCP draft specification with the Anthropic Model Context Protocol (MCP), your AI assistants can interact directly with client-side applications, in-page state, client databases, and browser APIs.

---

## Features

- **Standard MCP Stdio Server**: Fully compatible with Claude Desktop, Claude Code, and any standard MCP client.
- **In-Page Tool Execution**: Tools execute securely inside the webpage's JavaScript context with access to page DOM, local state, and web APIs.
- **Dynamic Tool Discovery**: Inspect registered web tools via the CLI or automatically through MCP `tools/list`.
- **Zero Stdout Corruption**: Strict stdio channel integrity ensures all diagnostics, warnings, and browser logs are routed to `stderr`.
- **WebMCP Polyfill & Native Support**: Supports native Chrome 146+ DevTrial features as well as automatic polyfills for standard Playwright environments.

---

## Installation & Quickstart

You can run `webmcp-bridge` directly using `npx` without prior installation:

### 1. Discover tools exposed by a webpage

Inspect registered WebMCP tools and their JSON schemas:

```bash
npx webmcp-bridge discover http://localhost:3000
```

Or for a local HTML file:

```bash
npx webmcp-bridge discover ./test/fixture.html
```

### 2. Start MCP server on stdio

Launch the MCP server connected to a target web application:

```bash
npx webmcp-bridge connect http://localhost:3000
```

---

## Claude Desktop Configuration

To connect Claude Desktop to your local web application via `webmcp-bridge`, add the server definition to your `claude_desktop_config.json`:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "my-webapp": {
      "command": "npx",
      "args": ["-y", "webmcp-bridge", "connect", "http://localhost:3000"]
    }
  }
}
```

Once saved, restart Claude Desktop. The tools registered by your web app via `navigator.modelContext.registerTool()` will appear in Claude's tool picker!

---

## CLI Reference

```
Usage:
  webmcp-bridge connect <url>      Start stdio MCP server for a WebMCP web page
  webmcp-bridge discover <url>     Discover and inspect WebMCP tools exposed by a page
  webmcp-bridge --help, -h         Show help and usage information
  webmcp-bridge --version, -v      Show version number

Examples:
  webmcp-bridge connect http://localhost:3000
  webmcp-bridge connect ./test/fixture.html
  webmcp-bridge discover http://localhost:3000
  webmcp-bridge discover ./test/fixture.html
```

---

## How It Works (Architecture)

```
┌─────────────────────────────────┐
│     MCP Client (Claude, etc.)   │
└────────────────┬────────────────┘
                 │ stdio (JSON-RPC)
┌────────────────▼────────────────────────────────────────┐
│  webmcp-bridge (Node.js Process)                        │
│  ├── MCP Stdio Server (@modelcontextprotocol/sdk)       │
│  └── Browser Controller (Playwright Chromium)           │
└────────────────┬────────────────────────────────────────┘
                 │ page.evaluate / CDP
┌────────────────▼────────────────────────────────────────┐
│  Headless Chromium Instance                             │
│  ├── Target Webpage (http://localhost:3000)             │
│  ├── Injected Bridge Runtime                            │
│  └── WebMCP API (navigator.modelContext)                │
│      └── In-Page Tool Handlers                          │
└─────────────────────────────────────────────────────────┘
```

1. **Playwright Chromium**: `webmcp-bridge` launches a headless Chromium instance configured with WebMCP flags (`--enable-features=WebMCP`, `--enable-blink-features=WebMCP`).
2. **Injected Bridge Runtime**: An initialization script is injected into the browser context to capture tool registrations from `navigator.modelContext` / `document.modelContext`.
3. **MCP Stdio Server**: An MCP server powered by `@modelcontextprotocol/sdk` communicates with the client over standard I/O, translating MCP `tools/list` and `tools/call` requests into in-page tool executions.

---

## Browser Requirements

- **Chromium / Chrome 146+**:
  - Requires Chrome 146+ for native WebMCP flags (`chrome://flags/#enable-webmcp-testing` or `--enable-features=WebMCP`).
  - Standard Playwright Chromium includes support via our transparent injected polyfill runtime.
- **Playwright Installation**:
  If Playwright Chromium is not yet installed on your machine, run:
  ```bash
  npx playwright install chromium
  ```
- **Custom Browser Executable**:
  To point to a custom Chrome Canary or Dev installation, set the environment variable:
  ```bash
  export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/path/to/chrome"
  ```

---

## WebMCP Web Application Example

To expose tools from your frontend web application:

```html
<script>
  if ('modelContext' in navigator) {
    navigator.modelContext.registerTool({
      name: 'get_cart',
      description: 'Returns items currently in the user shopping cart',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      execute: async () => {
        return window.shoppingCart.getItems();
      }
    });
  }
</script>
```

---

## Current Limitations

- **Evolving WebMCP Draft**: WebMCP is an emerging browser API standard under active discussion in W3C Web Incubator Community Group (WICG). Method signatures and namespace conventions (`navigator.modelContext` vs `document.modelContext`) may evolve.
- **Page Lifecycle**: Tools are bound to the active page session. If the page navigates away or reloads, tools must be re-registered by the new page.
- **Single-Session Tab**: Each `webmcp-bridge connect` process runs against a single dedicated browser page context.

---

## Repository & License

- Repository: [arclat-ai/webmcp-bridge](https://github.com/arclat-ai/webmcp-bridge)
- License: [MIT](LICENSE) - Copyright (c) 2026 Arclat AI

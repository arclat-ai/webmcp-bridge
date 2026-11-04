# webmcp-bridge — Build Spec

## Goal
Build a working bridge between WebMCP (browser-native tool registration via `navigator.modelContext.registerTool()`) and MCP (the standard agent-tool protocol used by Claude Desktop, Claude Code, etc). A standard MCP client should be able to connect to this bridge and call tools that a website has registered via WebMCP, with no changes needed on the agent side.

Build in this order. Do not skip ahead — each phase must produce a working, demonstrable result before the next starts.

---

## Phase 1: Discover WebMCP tools from a page (headless)

**Deliverable:** a Node.js script that opens a URL in a headless browser, finds any tools registered via `navigator.modelContext.registerTool()` on that page, and prints their name/description/schema to the console as JSON.

Requirements:
- Use Playwright (Chromium) for browser automation
- Create a local test HTML page (`test/fixture.html`) that calls `navigator.modelContext.registerTool()` with 2 example tools (e.g. `get_time`, `search_items`) — use the real Chrome WebMCP API, not a mock. If `navigator.modelContext` isn't available in the Playwright-bundled Chromium version, detect this, log a clear error, and document the required Chrome flag/version to enable it (Chrome 146+, `chrome://flags` DevTrial flag if needed).
- Write a script injected into the page context (via `page.evaluate` or an exposed binding) that reads back whatever `navigator.modelContext` exposes after tools are registered — inspect the actual runtime shape of this object since it's an early/unstable API; do not assume a specific internal structure without checking it against the real API first
- Output: a JSON array of discovered tools with `{ name, description, inputSchema }`

**Acceptance test:** running `node discover.js test/fixture.html` prints the 2 registered tools' schemas correctly.

---

## Phase 2: Call a discovered tool from Node

**Deliverable:** extend the Phase 1 script so that, in addition to discovering tools, it can invoke one by name with arguments and return the result.

Requirements:
- When a tool is called, the invocation must happen inside the live page context (the tool's handler function lives in the browser, not in Node) — use `page.evaluate` to trigger the registered handler and return its result back to Node
- Handle async handlers (most real tools will be async — fetch calls, DOM reads, etc.)
- Handle errors thrown inside the handler and surface them cleanly rather than crashing the bridge

**Acceptance test:** `node discover.js test/fixture.html --call search_items '{"query":"test"}'` returns the correct result from the fixture page's actual handler function.

---

## Phase 3: Expose discovered tools as a real MCP server

**Deliverable:** wrap Phases 1-2 in `@modelcontextprotocol/sdk` (official TypeScript SDK) so the whole thing behaves as a standard MCP server over stdio.

Requirements:
- On server start, take a target URL as a config param (e.g. via env var or CLI arg), open it headlessly, and discover tools per Phase 1
- Implement the MCP server's `tools/list` handler to return the discovered tools (map WebMCP schema → MCP's expected tool schema shape — check both schemas carefully, they will not be identical)
- Implement `tools/call` to route a call through to Phase 2's invocation logic against the still-open headless page
- Keep the headless browser/page instance alive for the life of the MCP server process (don't reopen per call — that's slow and may lose in-page state)
- Handle the case where the target page's tools change after initial load (page re-registers tools dynamically) — at minimum, don't crash; a full dynamic re-discovery can be a stretch goal

**Acceptance test:** add this server to Claude Desktop's MCP config pointing at the fixture page, restart Claude Desktop, confirm the fixture's tools appear in Claude's tool list and can be successfully called from a real conversation.

---

## Phase 4: CLI polish

**Deliverable:** a clean command-line entry point.

```
npx webmcp-bridge connect <url>
```
This should start the MCP server (stdio transport) pointed at `<url>`, ready to be wired into any MCP client's config with zero additional setup.

Requirements:
- Proper `package.json` bin entry so it's installable/runnable via `npx`
- `--help` output explaining usage
- Sensible error message if the URL doesn't respond, doesn't have WebMCP tools, or Chrome/Playwright isn't available
- README with: what this is, install instructions, a config snippet for adding it to Claude Desktop's `claude_desktop_config.json`, and a note on current limitations (early/unstable WebMCP API, sync-discovery-only, etc.)

---

## Explicit non-goals for v1 (do not build these unless asked)
- Do NOT attempt to infer tools from forms/buttons on pages that haven't implemented WebMCP — out of scope for v1
- Do NOT build a browser extension — the headless CLI/server is the whole v1 deliverable
- Do NOT try to support every possible WebMCP schema edge case — get the common case (sync registration, JSON-serializable params, async handlers) working solidly first
- Do NOT add authentication/security hardening beyond basic error handling — this is a dev tool / proof of concept, not production infra, for v1

## Tech stack
- Node.js + TypeScript
- Playwright (Chromium)
- `@modelcontextprotocol/sdk` (official MCP SDK)
- MIT license
- Repo name: `webmcp-bridge`

## Definition of done for v1
Claude Desktop, connected to `webmcp-bridge` pointed at a real or fixture webpage, can list and successfully call that page's WebMCP-registered tools in a live conversation. Everything else is polish.

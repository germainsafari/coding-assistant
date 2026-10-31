# Code guide

A tour of the source for people who want to change Hearth. Read [architecture.md](architecture.md) first for the big picture.

## Layout

```text
hearth/
├── packages/
│   ├── shared/src/index.ts      types shared by server and UI (settings, messages, runs, AgentEvent protocol)
│   ├── server/src/              the Node.js server: API, agent, tools (TypeScript, run directly with tsx)
│   └── web/src/                 the React UI (Vite + Tailwind)
├── skills/                      built-in skills (one folder per skill, SKILL.md inside)
├── evals/
│   ├── tasks/<id>/              eval tasks: task.json + repo/ (starting code) + checks/ (hidden tests)
│   └── results/                 eval reports (JSON + Markdown)
├── scripts/
│   ├── smoke.mjs                end-to-end smoke test against a running server
│   └── screenshots.mjs          regenerates docs/images with Playwright
├── docs/                        documentation and screenshots
├── data/                        runtime state (git-ignored): hearth.db, settings.json, skills/
├── Dockerfile, docker-compose.yml, .env.example
└── package.json                 npm workspaces + top-level scripts
```

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Build the UI, then start the server on <http://localhost:4545> |
| `npm run start:only` | Start the server without rebuilding the UI |
| `npm run dev` | Hot-reload development: Vite on :4545 (proxies `/api`), server with `tsx watch` on :4546 |
| `npm run build` | Build the UI into `packages/web/dist` |
| `npm run typecheck` | Type-check all three packages |
| `npm test` | Server unit tests (`node --test`, files named `*.test.ts`) |
| `npm run doctor` | Check the environment and the model server |
| `npm run eval -- [options]` | Run the eval suite (see [observability-and-evals.md](observability-and-evals.md)) |
| `npm run setup:browser` | Download Playwright's Chromium |
| `node scripts/smoke.mjs` | Create a scratch project, run a task in full-auto mode, print the event stream |
| `node scripts/screenshots.mjs` | Regenerate the documentation screenshots from a running server |

## Server (`packages/server/src`)

### Entry and configuration

- **`index.ts`** starts Fastify. It registers the routes and serves `packages/web/dist`, with a SPA fallback and long caching for hashed assets. It marks crashed runs as interrupted, auto-resumes long runs, connects MCP servers, and warns if another program already answers on the chosen port.
- **`config.ts`** handles paths (`APP_ROOT`, `DATA_DIR`), loads `.env`, provides the default settings, and reads/writes `data/settings.json`. Model profiles live here: `settings.model` is a derived view of the active profile, and `settingsForProfile()` makes per-run overrides.
- **`db.ts`** is the SQLite schema and small repository objects: `projects`, `threads`, `messages`, `runs`, `spans`, `memories`, plus `metrics()`. It uses `node:sqlite`, so no native modules are needed.
- **`doctor.ts`** implements `npm run doctor`.
- **`util.ts`** has helpers: IDs, `truncateMiddle`, `safeJson`, error messages.

### Agent (`agent/`)

- **`loop.ts`** is the heart of Hearth. `startRun()` and `resumeThread()` are the public entry points, and `runLoop()` is the step loop. `executeCall()` runs one tool call with approvals and spans, and `longRunGate()` is the completion gate. `StuckDetector` and the subagent runner (`toolContext().runSubagent`) live here too.
- **`context.ts`** turns stored messages into the prompt for the active tool mode (`toOpenAIMessages`). It also handles token estimation and calibration, pruning, compaction (`compactionCut`, `compact`) and `buildContext()`.
- **`prompt.ts`** builds the system prompt, including the prompt-mode tool instructions.
- **`longrun.ts`** handles `.agent/plan.md` and `.agent/progress.md`, resolves long-run options, and builds the long-run section of the system prompt.
- **`runs.ts`** has `RunHandle`: the in-memory state of an active run. It holds the event log with sequence numbers, subscribers, pending approvals and questions, and the abort controller. It also keeps the registry of active runs.

### Model client (`llm/`)

- **`client.ts`**:
  - `chatStream()` streams a chat completion and splits reasoning, text and tool calls. It measures time to first token and tokens per second.
  - `chatOnce()` is used for titles, summaries and commit messages.
  - `probeCapabilities()` finds the context length and which tool modes work, and caches the result for 5 minutes.
  - `LlmHttpError` is the error type for failed requests.
- **`toolparse.ts`** parses tool calls written as text (template and prompt mode). It handles Qwen3-Coder XML (`<tool_call><function=…><parameter=…>`) and Hermes JSON (`<tool_call>{…}</tool_call>`), and converts values to the types in the tool's schema. `StreamSplitter` hides tool markup and inline `<think>` blocks from the streamed text.

### Tools (`tools/`)

- **`types.ts`** defines `ToolDef` (name, description, JSON-schema parameters, `risk`, optional `riskFor(args)`, `preview`, `execute`) and `ToolContext` (project, settings, abort signal, emit, `askUser`, `runSubagent`).
- **`index.ts`** collects the built-in and MCP tools, and filters them for subagents and read-only mode.
- **`fs.ts`**: file tools. All paths go through `resolveInProject()`.
- **`shell.ts`**: `run_shell`, `shell_output`, `shell_kill`. The process handling itself is in `../shell.ts`.
- **`git.ts`**: git and GitHub tools. The implementation is in `../git.ts` and `../github.ts`.
- **`web.ts`**: `web_fetch`, `web_search`, `languagetool_check`, and the LanguageTool helpers used by the Git panel.
- **`browser.ts`**: `browser_*` tools on top of `../browser.ts`.
- **`agentic.ts`**: plan, `ask_user`, skills, memory, project notes, subagents.

### Integrations

- **`shell.ts`** picks the shell: `pwsh`, then Windows PowerShell 5.1, then `bash`/`sh`. `execCommand()` runs a command with a timeout, output streaming and tree-kill. It also manages background processes.
- **`safety.ts`**: the sandbox (`resolveInProject`, including dropping a redundant project-name prefix), the deny list, read-only command detection, and the approval matrix.
- **`git.ts`** is a thin wrapper around the `git` CLI (status parsing, log, branches, commit, push with token, clone). `initRepo()` adds a default `.gitignore`.
- **`github.ts`**: a minimal GitHub REST client (user, repos, issues, pulls).
- **`browser.ts`** keeps one shared Playwright browser. It prefers Playwright's Chromium and falls back to Chrome or Edge. It handles navigation, clicks, typing, screenshots and readable page text.
- **`mcp.ts`** connects to configured MCP servers (stdio via `cross-spawn`, Streamable HTTP, SSE) and turns their tools into `ToolDef`s named `mcp__<server>__<tool>`.
- **`skills.ts`**: skill discovery and frontmatter parsing.
- **`otel.ts`**: OTLP/HTTP JSON export of finished runs.

### Routes (`routes/`)

- **`core.ts`**: settings, capabilities, projects, folder browsing, threads, runs (start, resume, SSE events, cancel, approvals, answers), skills, memories, MCP, LanguageTool.
- **`workspace.ts`**: files, git, GitHub, terminal, background processes, and the browser panel.
- **`observability.ts`**: run list, traces, metrics, evals.

### Evals (`evals/`)

- **`runner.ts`** handles each task:
  1. It copies the task's `repo/` to a temporary folder, makes it a git repo, and creates a hidden project.
  2. It runs the agent in full-auto mode.
  3. It copies `checks/` over the result (restoring the original tests) and runs the check command.
  4. It writes `evals/results/<id>.{json,md}`.
- **`cli.ts`** is the `npm run eval` command line.

### Tests

The unit tests sit next to the code (`*.test.ts`) and use `node:test`. Tests that touch the database set `HEARTH_DATA_DIR` to a temporary folder *before* importing modules.

| File | Covers |
|---|---|
| `llm/toolparse.test.ts` | tool-call parsing (XML, JSON, arrays, multi-line values, broken markup) and `StreamSplitter` |
| `safety.test.ts` | sandbox (including symlinks), deny list, read-only detection, approval matrix |
| `agent/context.test.ts` | orphaned tool calls after a crash, prompt-mode rendering, compaction cut, pruning |
| `git.test.ts` | `initRepo` + `.gitignore`, commit, log and branch parsing |

## Web UI (`packages/web/src`)

- **`main.tsx` / `App.tsx`**: the app shell with three resizable panes (`react-resizable-panels`): sidebar, chat and right panel. It also renders the status bar, command palette, shortcuts dialog, settings, and toasts.
- **`store.ts`**: global state (zustand). It holds projects, threads, the selected project and thread, the right panel tab, settings, capabilities, theme, modals and notifications. UI layout is persisted in `localStorage` (`hearth.ui`); the theme in `hearth.theme`.
- **`theme.ts`**: dark (default), light, and system themes. Respects `prefers-color-scheme` when set to system.
- **`shortcuts.ts`**: global keyboard shortcuts (`Ctrl+K` palette, `Ctrl+B` sidebar, `Ctrl+J` right panel, `Ctrl+/` help, `Esc` stop, `Ctrl+Shift+L` theme).
- **`highlight.ts`**: syntax highlighting for Markdown code blocks (highlight.js, languages loaded on demand).
- **`api.ts`**: typed wrappers around every API endpoint, plus `subscribeRun()`, which reads the SSE stream over `fetch`. The server replays buffered events on every subscribe, and the consumer de-duplicates them.
- **`chat/useThread.ts`**: loads a thread and folds the live event stream into renderable state: messages, the streaming draft, pending approvals and questions, plan, usage, notices.
- **`chat/MessageList.tsx`**: the transcript. Folds read-only lookups into "Explored" groups, auto-scrolls unless you scroll up, and shows a "Jump to latest" button.
- **`chat/Composer.tsx`**: autosizing input, model/approval/long-run controls, stop button while running.
- **`chat/ToolCard.tsx`**: one card per tool call. It shows a title, a status, diffs, output and images, plus the approval and question UI and nested subagent steps.
- **`chat/Blocks.tsx`**: thinking, plan/todo progress, harness notices.
- **`components/`**:
  - `Chat.tsx`: header, message list, composer, resume banner, notices.
  - `Welcome.tsx`: first-run empty state, new-thread hero, model-offline banner.
  - `Sidebar.tsx`: projects and threads, filter, hover actions, collapsible.
  - `StatusBar.tsx`: model connection, tool mode, context size, tokens/s, theme toggle, shortcuts.
  - `CommandPalette.tsx` (`cmdk`): jump to projects/threads and run actions.
  - `ShortcutsDialog.tsx`: the keyboard-shortcuts help overlay.
  - `ProjectDialog.tsx`: open a folder, create a project, or clone a repo (with GitHub repo search when a token is set).
  - `Markdown.tsx`: GitHub-flavored Markdown rendering, copy buttons on code blocks, and `DiffView` for unified diffs.
  - `RightPanel.tsx` with `panels/`: `FilesPanel` (tree + Monaco editor), `GitPanel`, `BrowserPanel` (agent browser or iframe), `TerminalPanel`, `TracesPanel` (runs, trace waterfall, metrics, evals).
  - `settings/`: the settings dialog and its tabs (Models, Agent, MCP servers, Connectors, Skills, Memory).
  - `ui.tsx`: small shared components (Button, Modal, Tabs, Badge, Spinner, Empty, Toggle, Skeleton).
- **`monaco.ts`** loads Monaco from the local bundle (no CDN), which keeps the app fully offline.
- Fonts (`@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`) are bundled, so the UI works offline.

## Common changes

**Add a tool.** Write a `ToolDef` in the matching `tools/*.ts` file and add it to that file's exported list. Pick the lowest honest `risk`; it decides approvals. Return `{ ok, content }` (plus `diff` or `image` if useful) and throw nothing the user can't act on. If the call needs a nicer card, add a title case to `describe()` in `web/src/chat/ToolCard.tsx`.

**Add a setting.** Add it to `Settings` in `packages/shared/src/index.ts` and give it a default in `defaultSettings()` (`config.ts`). Then add a control in the matching `settings/*Tab.tsx`. Existing `settings.json` files are deep-merged with the defaults, so no migration is needed.

**Add an event type.** Extend `AgentEventBody` in `shared`, emit it from the loop, and handle it in `useThread.ts`'s reducer.

**Add an eval task.** See [observability-and-evals.md](observability-and-evals.md#writing-an-eval-task).

**Add a skill.** Create `skills/<name>/SKILL.md` with `name` and `description` frontmatter.

## Conventions

- TypeScript strict mode everywhere. The server uses `.ts` import specifiers (Node runs them through `tsx`).
- Keep the server dependency-light; prefer Node built-ins (`node:sqlite`, `fetch`, `node:test`).
- Errors shown to the model should say what to do next ("Path is outside the project folder…", "Unknown tool … Available tools include …").
- Cross-platform matters: test path handling and shell commands on Windows (PowerShell 5.1) as well as Linux.

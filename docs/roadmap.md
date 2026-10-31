# Roadmap

Where Hearth stands, what is missing, and what would make it better. Contributions toward any of these are welcome (see [contributing.md](contributing.md)).

## Status

| Area | State |
|---|---|
| Chat UI, projects and threads, streaming, tool cards, approvals | Working, used daily during development |
| Dark/light themes, command palette, keyboard shortcuts, status bar | Working |
| File, shell, git, browser, web and agentic tools | Working |
| Safety: approval modes, deny list, project sandbox for file tools | Working, unit-tested |
| Template and prompt tool-calling modes | Working: 6/6 evals in both |
| Native tool-calling mode | Working: 6/6 evals on Qwen3.6-35B-A3B and on Qwen3.8-27B |
| Context compaction | Working (tested with a forced 10k-token window) |
| Long-run mode with verification gate and auto-resume | Working (tested with a 10-item task and a forced crash) |
| Memory, project notes, skills | Working |
| MCP over stdio | Working (filesystem server) |
| MCP over HTTP/SSE | Implemented, not tested against a live server |
| GitHub (clone private repos, push, issues, PRs) | Implemented, **not tested** (no token was available) |
| Google Drive | Only a template for a community MCP server; **not tested** |
| Traces, metrics, OpenTelemetry export | Working (OTel tested with Jaeger) |
| Evals (6 tasks, CLI, UI, A/B by profile) | Working |
| Docker image and compose file | Hearth image tested; compose vLLM service mirrors the tested command but was not started through compose |
| Terminal panel | Working for one-off and background commands; not an interactive terminal (no TTY) |
| Browser panel | "Agent browser" (shared headless Chromium, screenshots + click/type) works; the "iframe" mode only received a quick check |

## Known limitations

- **Single user, no login.** Hearth binds to localhost and trusts whoever can reach it. Don't expose it on a network.
- **Shell commands are not sandboxed.** File tools stay inside the project, but `run_shell` runs with your account's permissions. Approvals (default) or Docker are the protection.
- **No interactive terminal.** Commands run without a TTY. Programs that wait for keyboard input hang until their timeout; the agent is told to use non-interactive flags.
- **One run per thread at a time.** Several threads can run in parallel, but they share the GPU and the single headless browser.
- **Token counts are estimates** until the server reports real usage; compaction thresholds are therefore approximate.
- **Windows PowerShell 5.1** lacks `&&` and some modern syntax. The agent is told so, and installing PowerShell 7 (`pwsh`) avoids it.
- **`web_search` scrapes DuckDuckGo's HTML page.** It needs no key but is best effort and may be rate-limited.
- **Six eval tasks** are a smoke test for regressions, not a benchmark of model quality.

## Next steps

Near term:

- Test the GitHub flows with a real token: private clone, push, PR from the Git panel, the agent's `github_*` tools.
- Test Google Drive with real OAuth credentials, and document the exact first-run sign-in.
- Test an HTTP MCP server.
- An interactive terminal (PTY via `node-pty` + xterm.js), shared with the agent's background processes.
- Checkpoints and undo: snapshot the working tree before each agent turn (git stash or shadow commits), so a whole turn can be reverted with one click.

Later:

- Image input in the chat (paste a screenshot or mockup). The model supports vision and the browser tools already pass screenshots to it.
- Parallel subagents for independent subtasks.
- A larger eval suite (multi-file features, web UI tasks checked with the browser, long-run tasks), repeated runs with confidence intervals, and a comparison view in the UI.
- Optional authentication (token or OS login) for use on a trusted LAN.
- Per-project settings (default approval mode, done command, model profile) stored in the project.
- Git worktrees, so long runs work on a branch without touching your checkout.
- Packaged desktop app (Electron or Tauri) with a bundled Node runtime.

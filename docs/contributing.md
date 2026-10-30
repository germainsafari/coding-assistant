# Contributing

Thanks for helping improve Hearth! Bug reports, docs fixes, new skills, eval tasks and code are all welcome.

## Development setup

You need Node.js 22.13+, git, and a model server for anything that talks to the model (see the [setup guide](setup-guide.md)). Unit tests, the type check and the build work without a model.

```bash
git clone <this repository> hearth
cd hearth
npm install
npm run setup:browser
npm run dev            # UI with hot reload on http://127.0.0.1:3000, API on :3001
```

`npm run dev` restarts the server when you change server code and hot-reloads the UI. Active agent runs are interrupted by a server restart. Long runs resume automatically, other runs show a Resume button.

Read the [code guide](code-guide.md) for a tour of the source.

## Before you open a pull request

Run all of these; they must pass:

```bash
npm run typecheck      # TypeScript, all packages
npm test               # unit tests
npm run build          # production build of the UI
```

If you changed the agent loop, prompts, tool definitions or parsing, also run the evals against a model and include the score in the PR description:

```bash
npm run eval
```

If you changed the UI, add a screenshot to the PR. `node scripts/screenshots.mjs` regenerates the images in `docs/images` from a running server.

## Guidelines

- **Keep it local and free.** No features that require a paid service or send data to the cloud by default. Optional integrations (GitHub, MCP) are fine.
- **Cross-platform.** Hearth runs on Windows (PowerShell 5.1 and 7), Linux and macOS. Use `path.join`, avoid shell-specific syntax in code, and test on Windows if you touch paths, shells or processes.
- **Safety first.** New tools need an honest `risk` level. Anything that can change state outside the project folder is `external`. Don't weaken the deny list or the sandbox without discussion.
- **Honest docs.** If something is partial or untested, say so in the docs and in [roadmap.md](roadmap.md).
- **Tests for logic.** Parsing, safety rules, context handling and other pure logic should come with `node:test` unit tests next to the code (`*.test.ts`).
- **Style.** Follow the surrounding code: TypeScript strict mode, small modules, comments only for things the code can't say. Error messages shown to the model should say what to do next.
- **Small PRs.** One topic per pull request. Separate refactors from behavior changes.

## Adding things

- **A skill:** add `skills/<name>/SKILL.md` with `name` and `description` frontmatter. Keep it focused, reference the real tool names (`read_file`, `edit_file`, `run_shell`, …), and say when to use it in the description.
- **An eval task:** see [Writing an eval task](observability-and-evals.md#writing-an-eval-task). Show in the PR that its checks fail on the starting code and pass with a reference solution.
- **A tool:** see [Common changes](code-guide.md#common-changes) in the code guide.

## Reporting bugs

Please include:

- what you did, what you expected, and what happened;
- the output of `npm run doctor`;
- your OS, GPU, model, and vLLM version and flags;
- for agent misbehavior, the run from the Traces panel. Click the run, then the relevant spans, and copy the input and output, or share `GET /api/runs/<id>/trace`.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](../LICENSE).

---
name: create-readme
description: Write or rewrite a project README.md that a newcomer can follow. Use when the user asks for a README, setup docs, or "document this project".
---

# Creating a README

1. **Learn the project first; never invent facts.**
   - `list_dir` the root, read manifest files (`package.json`, `pyproject.toml`, `requirements.txt`, `Cargo.toml`, `go.mod`, `Dockerfile`, `docker-compose.yml`, `Makefile`).
   - Find the entry points and the real commands to install, run, test and build.
   - Check for a licence file and environment variables (`.env.example`, `process.env.X`, `os.environ`).
2. **Verify the commands** you are going to document by running the cheap ones (install check, `--help`, tests) with `run_shell`. Mark anything you could not verify.
3. **Structure** (skip sections that do not apply):
   - Title and a one-sentence description of what it does and for whom.
   - Features (short bullet list).
   - Requirements (exact versions where they matter).
   - Quick start: copy-pasteable commands from clone to running.
   - Configuration: environment variables / config files in a table.
   - Usage examples.
   - Running tests.
   - Project structure (only the important folders).
   - Contributing and licence.
4. **Style:** plain language, short paragraphs, every command in a fenced code block with the right language tag, Windows and macOS/Linux variants when they differ.
5. **Proofread:** run `languagetool_check` on the prose (not on code blocks) and fix real spelling and grammar issues. Ignore false positives on code identifiers and product names.
6. Write the file with `write_file` (or `edit_file` if improving an existing README, keeping any content the user wrote that is still accurate).

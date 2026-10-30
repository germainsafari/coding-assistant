---
name: git-commit-message
description: Write a clear Conventional Commits message for the current changes, and commit when asked. Use when the user asks to commit, or for a commit message.
---

# Git commit messages

1. Run `git_status` and `git_diff` (plus `git_diff` with `staged: true`) to see exactly what changed. Read files if the diff alone does not explain the purpose.
2. If unrelated changes are mixed together, say so and propose separate commits (list which files go in which).
3. Never commit secrets, `.env` files, build output, or large binaries. Warn the user if any are about to be committed and check `.gitignore`.
4. **Format** (Conventional Commits):

   ```
   <type>(<optional scope>): <summary in imperative mood, max ~72 chars, no final period>

   <body: what changed and why, wrapped at ~72 chars. Optional for trivial changes.>

   <footer: BREAKING CHANGE: …, Fixes #123>
   ```

   Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
5. The summary says *what the commit does* ("add median() to textstats"), not what you did ("added stuff", "updates"). The body explains *why* when it is not obvious.
6. Optionally proofread the body with `languagetool_check`.
7. Only call `git_commit` if the user asked you to commit; otherwise show the message. Do not push unless asked.

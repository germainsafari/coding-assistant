---
name: code-review
description: Review code changes (uncommitted work, a branch, or specific files) for bugs, security problems and maintainability. Use when the user asks for a review or "is this OK?".
---

# Code review

1. **Collect the change set.**
   - Uncommitted work: `git_status`, then `git_diff` (and `git_diff` with `staged: true`).
   - A branch: `run_shell` with `git diff main...HEAD` (use the repository's real default branch).
   - Specific files: `read_file` them.
2. **Understand the intent** from commit messages, the user's request, or the surrounding code before judging it. Read enough of the callers and callees (`grep`, `read_file`) to know how the changed code is used.
3. **Look for real problems, in this order:**
   1. Correctness: logic errors, off-by-one, wrong conditions, unhandled `null`/`undefined`/`None`, broken error handling, race conditions, resource leaks.
   2. Security: injection (SQL, shell, path traversal), secrets in code, missing auth checks, unsafe deserialization, XSS.
   3. Behaviour changes the author may not have intended (public API, file formats, defaults).
   4. Missing or weak tests for the changed behaviour.
   5. Maintainability: duplicated logic, confusing names, dead code. Mention these briefly; do not nitpick formatting that a formatter handles.
4. **Verify suspicions** instead of guessing: run the tests or a quick script with `run_shell` when it is cheap.
5. **Report** as a list ordered by severity. For each finding give: file and line, what is wrong, why it matters, and a concrete fix (a short code snippet when useful). Say clearly when you found nothing serious.
6. Do **not** modify files during a review unless the user asks you to apply the fixes.

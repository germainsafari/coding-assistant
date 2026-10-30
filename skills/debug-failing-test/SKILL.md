---
name: debug-failing-test
description: Systematically find and fix the root cause of a failing test or error. Use when tests fail, a command crashes, or the user reports a bug with an error message.
---

# Debugging a failing test

1. **Reproduce first.** Run the failing test (or the smallest command that shows the error) with `run_shell`. Narrow it to a single test when possible (`pytest path::test_name`, `node --test --test-name-pattern=…`, `npx vitest run -t …`, `go test -run …`). Save the exact command; you will rerun it.
2. **Read the whole error**: the assertion message, expected vs actual values, and the stack trace. Identify the first stack frame inside the project's own code.
3. **Read the code** at that location and the test itself. Ask: is the test right and the code wrong, or the other way round? By default **the test describes the intended behaviour; fix the code, not the test.** Only change a test if it is clearly wrong, and say so explicitly.
4. **Form one hypothesis at a time** and check it cheaply: add a temporary print/log, run a one-line script, or inspect intermediate values. Do not make several speculative edits at once.
5. **Fix the root cause**, not the symptom (no special-casing the test input, no catching and ignoring the exception, no skipping the test).
6. **Verify**: rerun the single test, then the full test suite to make sure nothing else broke. Remove any temporary debugging output you added.
7. If you are stuck after three failed hypotheses, stop and summarise what you tried, what you learned, and what you would try next, instead of looping.
8. Finish with: the root cause in one or two sentences, the fix, and the test command that now passes.

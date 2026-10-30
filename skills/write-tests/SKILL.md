---
name: write-tests
description: Write or extend automated tests for existing code. Use when the user asks for tests, better coverage, or a regression test for a bug.
---

# Writing tests

1. **Find the existing test setup before writing anything.**
   - Look for `package.json` scripts (`test`, `vitest`, `jest`), `pytest.ini` / `pyproject.toml` / `setup.cfg`, `go.mod`, `Cargo.toml`, or existing `test_*.py`, `*.test.ts`, `*_test.go` files.
   - Reuse the framework, folder layout, naming and helpers already in use. Do not add a new test framework if one exists.
   - If there is no setup at all, pick the zero-dependency option: `node:test` for JavaScript/TypeScript, `unittest` for Python, `go test` for Go.
2. **Read the code under test** with `read_file`. List its public behaviour: inputs, outputs, side effects, error cases.
3. **Plan the cases** (write them into `update_plan` for anything non-trivial):
   - the normal path,
   - boundaries (empty input, zero, one element, very large values, unicode),
   - error handling (invalid input should raise / reject with a clear error),
   - any bug the user mentioned, as a regression test that fails before the fix.
4. **Write small, independent tests.** One behaviour per test, descriptive names (`test_returns_empty_dict_for_empty_text`), no shared mutable state, no network, no sleeping. Use temporary directories for file I/O.
5. **Run the tests** with `run_shell` and read the output. A new test that passes immediately against buggy code is not testing anything: check that it would fail if the behaviour were broken.
6. **Never edit the code under test just to make a test pass** unless the user asked you to fix a bug. If a test reveals a real bug, report it and ask, or fix it if that is clearly in scope.
7. Finish with the exact command to run the tests and a short summary of what is covered.

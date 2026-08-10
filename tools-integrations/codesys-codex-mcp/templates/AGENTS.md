# CODESYS Project Rules For Codex

Codex may edit exported PLC source files, CODESYS project scripts, tests, and documentation in this repository.

Codex must not perform PLC download, online change, start, stop, reset, force, or write-to-device operations.

Preferred workflow:

1. Export project objects from CODESYS into versioned text artifacts.
2. Edit the exported files in Git.
3. Import the edited artifacts into a copy of the CODESYS project.
4. Run `codesys_build_project` through the MCP server.
5. Review compiler errors and warnings before any manual engineering-station deployment.

When changing Structured Text, keep behavior narrow and preserve existing task cycle assumptions, IO mappings, retain variables, safety interlocks, and device settings unless the user explicitly asks for those changes.

For generated CODESYS scripts, keep them non-interactive and compatible with `--runscript`, `--scriptargs`, and `--noUI`.

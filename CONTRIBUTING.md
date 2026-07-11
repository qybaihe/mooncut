# Contributing to MoonCut

Thank you for helping improve MoonCut. Please keep changes small, testable, and
honest about what is real versus mocked or local-only.

## Before opening a pull request

1. Start from `main` and use a focused branch.
2. Do not commit credentials, user media, render output, package caches, or
   third-party material without provenance.
3. Install Git LFS before touching tracked media: `git lfs install`.
4. Run the checks for every component you changed. The canonical commands are
   in `Repository CI`; at minimum use the package's `test`, `typecheck`, or
   `check` scripts and `uv sync --frozen --group dev` for Python packages.
5. Add a regression test for bug fixes, especially fallback, authorization,
   ownership, upload, and media-timeline behavior.

## Pull request expectations

Explain the problem, implementation, user impact, and validation. Keep
generated artifacts out of source commits; publish intentional installers and
media through releases/LFS only. Follow the licensing gate in
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) before adding material.

## Development support

For a reproducible issue, include the commit, OS, runtime versions, and
redacted logs. Report security-sensitive issues through the process in
[`SECURITY.md`](./SECURITY.md), not public Issues.

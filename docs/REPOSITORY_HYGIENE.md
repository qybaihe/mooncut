# Repository hygiene and history-reduction plan

MoonCut's current Git history contains generated desktop binaries, dependency
caches, and render outputs from earlier imports. Ignore rules stop new files
but cannot shrink existing history.

## Current policy

- Source, specifications, small fixtures, and source-controlled app assets may
  live in Git.
- Large media that is intentionally reproducible/downloadable uses Git LFS.
- Build directories, package caches, release directories, local automation
  output, and generated renders are ignored. Publish release artifacts through
  GitHub Releases instead.
- `git lfs fsck --pointers` is a required repository-integrity gate.

## One-time history rewrite (maintainer-operated)

This operation changes commit IDs and requires coordinating every clone, fork,
open PR, and release consumer. It must not be run casually from a feature
branch.

1. Freeze merges and create a mirror backup plus a protected archive tag.
2. Agree a manifest of retained demo media and move all other generated output
   to release assets or an archival store.
3. Use `git filter-repo` in a disposable mirror to remove historical
   `node_modules`, browser caches, desktop releases, and generated renders.
4. Migrate retained large media to LFS, run `git lfs fsck`, fresh-clone the
   rewritten repository, and run the full CI matrix.
5. Force-push only after maintainers approve the rewritten tree; publish clear
   re-clone instructions for contributors.

Until that coordinated operation is complete, do not run history-rewriting Git
commands against `main`.

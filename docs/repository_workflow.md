# Repository Workflow

## Single-branch policy

`main` is the repository's only development and integration branch. All
reviewed changes and commits must be made directly on `main`.

- Do not create or use feature, fix, release, session, or other development
  branches.
- Do not create additional Git worktrees. Use only the primary checkout at
  `/home/me/work/trade_ui_latest`.
- Do not continue editing from `master` or another legacy branch.
- Use `main` as the base for diffs, regression reviews, and GitNexus
  `detect_changes` comparisons.
- When pushing is requested, push development history only to `origin/main`.

Before changing files, verify the repository state:

```bash
git branch --show-current
git status --short --branch
git worktree list
```

The expected branch is `main`, and `git worktree list` must contain only the
primary checkout. If approved commits are ever found outside `main`, first
verify that the working tree is clean, move every required commit into
`main`, and confirm the resulting history before continuing. Do not discard
or rewrite user work to enforce this policy.

Before committing, follow the project's GitNexus and verification requirements.
After committing, verify the task changes are committed and remain on `main`.
Preserve unrelated user changes; do not remove them merely to report a clean tree.

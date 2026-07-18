# Repository Workflow

## Single-branch policy

`master` is the repository's only development and integration branch. All
reviewed changes and commits must be made directly on `master`.

- Do not create or use feature, fix, release, session, or other development
  branches.
- Do not create additional Git worktrees. Use only the primary checkout at
  `/home/me/work/trade_ui_latest`.
- Do not continue editing from `main` or another legacy branch.
- Use `master` as the base for diffs, regression reviews, and GitNexus
  `detect_changes` comparisons.
- Push development history only to `origin/master`.

Before changing files, verify the repository state:

```bash
git branch --show-current
git status --short --branch
git worktree list
```

The expected branch is `master`, and `git worktree list` must contain only the
primary checkout. If approved commits are ever found outside `master`, first
verify that the working tree is clean, move every required commit into
`master`, and confirm the resulting history before continuing. Do not discard
or rewrite user work to enforce this policy.

Before committing, follow the project's GitNexus and verification requirements.
After committing, leave the working tree clean and remain on `master`.

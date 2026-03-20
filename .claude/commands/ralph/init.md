# Scaffold a Ralph Feature Directory

You are initializing a new feature for the Ralph agentic development framework.

## Input

```
$ARGUMENTS
```

Parse `$ARGUMENTS` as: `<feature-name> [--worktree]`

- `<feature-name>` is required (e.g. `auth-migration`, `add-caching-layer`). Must be a valid git branch name segment — lowercase, hyphens, no spaces.
- `--worktree` is optional. When present, creates a git worktree for full isolation.

The branch will be created as `ralph/<feature-name>`. The feature directory will be `.ralph/<feature-name>/`.

If `<feature-name>` is empty, report an error and stop:
```
Usage: /ralph:init <feature-name> [--worktree]
Examples:
  /ralph:init auth-migration             # branch mode  → branch: ralph/auth-migration
  /ralph:init auth-migration --worktree  # worktree mode → branch: ralph/auth-migration
```

## Validation

1. Verify `.ralph/_template/` exists. If not, report an error and stop.
2. Check that branch `ralph/<feature-name>` does not already exist. If it does, report an error and stop.
3. Check that `.ralph/<feature-name>/` does not already exist. If it does, report an error and stop.

## Mode A — Branch (default)

Used for small/medium features where working in the same repo checkout is fine.

1. Create and switch to a new branch named `ralph/<feature-name>` from the current branch.
2. Create directory `.ralph/<feature-name>/`.
3. Copy template files (see Scaffold below).

## Mode B — Worktree (`--worktree`)

Used for larger features or when full isolation from in-progress work is needed.

1. Determine the repo root directory name (e.g. if repo is at `/home/user/repos/my-app`, the name is `my-app`). Create the worktree as a sibling directory with the feature name as suffix: `git worktree add ../<repo-name>-<feature-name> -b ralph/<feature-name>` (e.g. `../my-app-auth-migration`).
2. Inside the new worktree (`../<repo-name>-<feature-name>/`), create directory `.ralph/<feature-name>/`.
3. Copy template files (see Scaffold below).
4. Report the worktree path so the user knows where to `cd`.

## Scaffold

In both modes, after creating `.ralph/<feature-name>/`:

1. Copy these template files from `.ralph/_template/` into `.ralph/<feature-name>/`:
   - `PROMPT.md`
   - `COMPLETED_PHASES.md`
   - `SCRATCHPAD.md`
2. In the copied `PROMPT.md`, replace all occurrences of `.ralph/<feature>/` with `.ralph/<feature-name>/`.

## Output

Report:
- Mode used (branch or worktree)
- Branch created (`ralph/<feature-name>`)
- Worktree path (if worktree mode)
- Directory created (`.ralph/<feature-name>/`)
- Files copied
- Next step: `/ralph:research` or `/ralph:spec`

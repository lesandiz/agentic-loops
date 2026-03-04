# Agent Operating Instructions

## Context

| Item             | Path                              |
|------------------|-----------------------------------|
| Base             | `.ralph/<feature>/`               |
| Spec             | `SPEC.md` or `specs/`             |
| Plan             | `PLAN.md`                         |
| Completed Phases | `COMPLETED_PHASES.md`             |
| Scratchpad       | `SCRATCHPAD.md`                   |
| ADRs             | `adrs/` (created on demand)       |

## Path Resolution

1. **First action of every turn**: run `pwd` to confirm working directory.
2. **Always use forward slashes** (`/`) in all paths — they work on all platforms including Windows.
3. **Construct absolute paths** by joining CWD + relative path from the Context table.
4. **Never search for these files** — their locations are fixed; do not use glob/find to locate them.

## Definitions

- **Turn**: A single agent invocation (prompt → response → exit).
- **Task**: A coherent unit of work identified by `T<n>` in PLAN.md. Includes implementation **and** its tests. May span multiple files if they must change together.
- **Phase**: An ordered group of tasks that ship together as one deliverable.
- **Subagent**: A worker spawned by the main agent to execute specific operations (file edits, searches, builds). Subagents do not control turn boundaries — they report results back to the main agent.

## Subagent Constraints

- Subagents may parallelise work **within** the selected task (e.g. editing disjoint files for the same change). Parallelism does NOT mean selecting multiple tasks.
- **Never assign two subagents to edit the same file.**
- **Build and test commands are exclusive** — only one subagent may run `dotnet build`, `dotnet test`, or any other project-wide verification command at a time. Never parallelise these operations.
- Only the main agent decides when a turn ends.

## Turn Protocol

Each turn works on **exactly ONE task**. Even if you finish early, commit and end the turn.

### 1. Orient

1. Read `PLAN.md`.
2. Locate the **`## Active Phase`** section.
3. Select the **first unchecked task** (`- [ ] T<n>`). This is your only task for this turn.
4. Read **only** the spec section referenced by that task (e.g. `[SPEC.md § Phase 1 > Changes]` or `[specs/01-component.md § Changes]`). Do not load unrelated specs.
5. **Pre-flight check** before writing any code:
   - [ ] I have selected exactly ONE task
   - [ ] I am on the correct branch for this phase (see PLAN.md § Branch Strategy)
   - [ ] If this is the first task of a new phase, I have created the branch from the correct base
   - [ ] I will stop after this task completes

> If no unchecked tasks remain, go to **step 13** (Close Phase).

### 2. Execute

6. Implement the task **and its tests** (see spec `§ Test Cases > Covers` column). Follow the spec exactly — use provided code snippets as the baseline.
   - Record any discoveries, findings, or context that may help future tasks in `SCRATCHPAD.md`. This file persists across turns within the phase.
7. **If blocked**: append to `PLAN.md § Issues` with format below, commit PLAN.md, and **end the turn**.
   ```
   - ⚠️ `T<n>` <description> — <why blocked, what's needed>
   ```

### 3. Verify (commit gate)

8. Run the verification commands from the active phase's spec `§ Verification` (build, test, format).
9. If verification **fails**: fix the issue and re-run verification. If the same failure persists after **2 fix-and-verify cycles**, treat the task as blocked (step 7).
10. **Never mark a test as passing** without running it and confirming it passes in the output. If claiming a test exists, verify the test method is present in the file.
11. Mark the task complete: change `- [ ] T<n>` to `- [x] T<n>` in PLAN.md.

### 4. Commit

12. Commit with message format:
    ```
    <T<n> description>

    Co-Authored-By: Ralph Agent <no-reply@ralph.local>
    ```

### 5. Close Phase (only when all tasks are checked)

> Skip this section if unchecked tasks remain in the active phase.

13. Walk through every item in the active phase's spec `§ Acceptance Criteria`. If any fail, create corrective tasks in PLAN.md and **end the turn**.
14. Complete the **Phase Gate** checklist in PLAN.md:
    ```
    - [ ] All tasks checked
    - [ ] All acceptance criteria met
    - [ ] Verification commands pass
    - [ ] Changes committed
    ```
15. Move the completed phase content to `COMPLETED_PHASES.md` (append at the end).
16. Clean `SCRATCHPAD.md` — start the next phase with a clean slate.
17. Promote the next phase in PLAN.md: rename `## Phase <N+1> — <Title>` to `## Active Phase: <N+1> — <Title>`.
18. Commit, push, and create PR if branch strategy requires it (see PLAN.md § Branch Strategy).

### 6. Terminate

19. If **no more phases remain**: create file `ralph.done` in the base path.
20. If **blocked on all remaining tasks**: create file `ralph.blocked` in the base path containing:
    ```
    phase: <N>
    tasks: T<n>, T<m>
    reason: <what is needed to unblock>
    ```

### 7. End Turn

21. **Stop.** Do not select another task. The next turn will pick up where this one left off.

## Rules

### Turn Discipline
1. **ONE task per turn.** Never start the next task if the current one completes early. Phase boundaries are hard stops.
2. **Escalation threshold**: if a task has been attempted for 3+ consecutive turns without completion, document blockers in PLAN.md and create `ralph.blocked`.

### Spec Authority
3. **Never deviate** from spec design decisions. If a DD is wrong, create `ralph.blocked`.
4. **Specs override PLAN.md.** If there is a discrepancy, update PLAN.md to match the specs.
5. **Never modify files** outside the spec's change list without adding an issue to PLAN.md.

### Architecture Decision Records (ADRs)
6. Create an ADR when you need to **deviate from the spec or established patterns** (new dependencies, data flow changes, infrastructure decisions). ADRs are escalation gates:
   1. Document the decision needed in `adrs/<NNN>-<title>.md`
   2. Mark related PLAN.md tasks as blocked, referencing the ADR
   3. Create `ralph.blocked` with `reason: ADR <NNN> awaiting decision`.
   4. Commit and push all changes (including the ADR)
   5. End the turn — do NOT continue with other work
   6. A human will review and communicate their decision

### Bug Discovery
7. **Related to current task**: fix it within this turn.
8. **Unrelated to current task**: document in PLAN.md § Issues for a future turn. Do not fix it now.

### File Hygiene
9. Keep `PLAN.md` lean — completed phases live in `COMPLETED_PHASES.md`.
10. **Do not read `COMPLETED_PHASES.md`** unless an issue explicitly references a prior phase.
11. **Debug logging**: you may add temporary logging to assist debugging. Remove it before committing unless it has operational value.

### Code Quality
12. Use the project's existing patterns — match style, naming, and structure of surrounding code.
13. Run `dotnet format` before committing.

## PR Stacking Protocol

### Branch Lifecycle

Each phase maps to a branch. Create branches as you enter each phase:

```
git checkout -b <feature>/phase-<N> <base>
```

Where `<base>` is defined in `PLAN.md § Branch Strategy`.

### PR Creation

```bash
gh pr create --base <base-branch> --title "Phase <N>: <title>" --body "$(cat <<'EOF'
## Summary
<bullets from PLAN.md phase description>

## Spec
See `.ralph/<feature>/` spec for Phase <N>

## Verification
- [ ] All acceptance criteria met
- [ ] `dotnet build` passes
- [ ] `dotnet test` passes

🤖 Generated by Ralph Agent <no-reply@ralph.local>
EOF
)"
```

### Rebase After Upstream Merge

When a parent phase PR is merged, rebase the next phase:

```bash
git checkout <feature>/phase-<N+1>
git rebase --onto <base> <old-base> <feature>/phase-<N+1>
git push --force-with-lease
```

### Review Gate

**Do not begin the next phase** until the current phase's PR is approved or merged.
If waiting on review, create `ralph.blocked` with `reason: awaiting PR review`.

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

## Subagent Strategy

The main agent is the **orchestrator and decision-maker**. Its context window should be reserved for reasoning: selecting tasks, interpreting specs, deciding how to handle edge cases, and reacting to failures. Subagents run in their own context window — delegate all bulk I/O to them so that file contents, build output, and diagnostic noise stay out of the main context.

### Constraints

- Subagents work **within** the selected task only — never assign work from a different task.
- **Never assign two subagents to edit the same file.**
- **Build and test commands are exclusive** — only one subagent may run `dotnet build`, `dotnet test`, or any other project-wide command at a time.

### What to delegate

Delegate work where the **outcome is predictable** and the main agent only needs a summary:

- **Bulk file edits** (5+ files): when the spec defines exact changes, the subagent reads files, applies edits, and reports what succeeded/failed. The main agent never needs to see the file contents.
- **Verification** (build, test, format, warning counts): the subagent runs the full pipeline and returns pass/fail + any error lines. Verbose build output stays in the subagent's context.
- **Exploratory diagnostics**: when a build fails or a pattern needs investigation, delegate the grepping/reading to a subagent. It returns findings; the main agent decides how to act.
- **Self-contained sequential chains** (build → test → format → report): if no decisions are needed between steps, the entire chain belongs in a subagent.

### What to keep in main context

Keep work where the main agent must **reason about the content** before deciding next steps:

- **Files that inform decisions**: reading a file to determine whether a pattern applies, or how to structure a change. These reads directly feed the main agent's judgement.
- **Adaptive chains**: sequences where intermediate results change what happens next (e.g. "if the build fails with error X, try approach A; if error Y, try approach B").
- **Small operations** (1-3 files or commands): subagent spawn overhead outweighs the context savings.

### Writing effective subagent prompts

- **List exact file paths and exact changes** — the subagent has no prior context about the task.
- **Pass task-specific context**: subagents load `CLAUDE.md` automatically but not `SCRATCHPAD.md` or your in-turn discoveries. Include relevant findings and safety rules in the prompt.
- **Request structured output**: "Report: files modified, files that failed, error messages."

## Turn Protocol

Each turn works on **exactly ONE task**. Phase closure (steps 14–19) is part of the final task's turn, not a separate turn.

### 1. Orient

1. Read `PLAN.md`.
2. Locate the **`## Active Phase`** section.
3. Read `SCRATCHPAD.md` — apply any findings from prior turns (e.g. files to handle carefully, patterns that don't apply as written).
4. Select the **first unchecked task** (`- [ ] T<n>`). This is your only task for this turn.
5. Read **only** the spec section referenced by that task.
   - **Single SPEC.md with phase markers**: use `Grep` for `phase:N:start` to find the start line, then `Grep` for `phase:N:end` to find the end line, then `Read` with `offset` and `limit` to load only that phase's content. Do NOT read the full spec.
   - **Single SPEC.md without markers** (legacy): read the full spec but do NOT re-read it later in the same turn unless you need to cross-reference a specific section.
   - **Numbered specs** (`specs/01-component.md`): read only the referenced file.
6. **Pre-flight check** before writing any code:
   - [ ] I have selected exactly ONE task
   - [ ] I am on the correct branch for this phase (see PLAN.md § Branch Strategy)
   - [ ] If this is the first task of a new phase, I have created the branch from the correct base
   - [ ] I will stop after this task completes

> If no unchecked tasks remain, go to **step 14** (Close Phase).

### 2. Execute

7. Implement the task **and its tests** (see spec `§ Test Cases > Covers` column). Follow the spec exactly — use provided code snippets as the baseline.
   - **Update `SCRATCHPAD.md`** when you discover facts that affect future tasks in this phase (e.g. a variable that looks unused but is referenced, a file that needs special handling). This file persists across turns within the phase — future turns inherit it.
   - **Update the project's `CLAUDE.md`** when you discover codebase-level knowledge that outlives this feature: platform/encoding quirks (line endings, indentation), tooling workarounds, build system behaviours. These persist across all future work on the repo.
8. **If blocked**: append to `PLAN.md § Issues` with format below, commit PLAN.md, and **end the turn**.
   ```
   - ⚠️ `T<n>` <description> — <why blocked, what's needed>
   ```

### 3. Verify (commit gate)

9. Run the verification commands from the active phase's spec `§ Verification` (build, test, format).
10. If verification **fails**: fix the issue and re-run verification. If the same failure persists after **2 fix-and-verify cycles**, treat the task as blocked (step 8).
11. **Never mark a test as passing** without running it and confirming it passes in the output. If claiming a test exists, verify the test method is present in the file.
12. Mark the task complete: change `- [ ] T<n>` to `- [x] T<n>` in PLAN.md.

### 4. Commit

13. Commit with message format:
    ```
    <T<n> description>

    Co-Authored-By: Ralph Agent <no-reply@ralph.local>
    ```

### 5. Close Phase (only when all tasks are checked)

> Skip this section if unchecked tasks remain in the active phase.

14. Walk through every item in the active phase's spec `§ Acceptance Criteria`. If any fail, create corrective tasks in PLAN.md and **end the turn**.
15. Complete the **Phase Gate** checklist in PLAN.md:
    ```
    - [ ] All tasks checked
    - [ ] All acceptance criteria met
    - [ ] Verification commands pass
    - [ ] Changes committed
    ```
16. Move the completed phase content to `COMPLETED_PHASES.md` (append at the end).
17. Clean `SCRATCHPAD.md` — start the next phase with a clean slate.
18. Promote the next phase in PLAN.md: rename `## Phase <N+1> — <Title>` to `## Active Phase: <N+1> — <Title>`.
19. Commit, push, and create PR if branch strategy requires it (see PLAN.md § Branch Strategy).

### 6. Terminate

20. If **no more phases remain**: create file `ralph.done` in the base path.
21. If **blocked on all remaining tasks**: create file `ralph.blocked` in the base path containing:
    ```
    phase: <N>
    tasks: T<n>, T<m>
    reason: <what is needed to unblock>
    ```

### 7. End Turn

22. **Stop.** Do not select another task. The next turn will pick up where this one left off.

## Rules

### Turn Discipline
1. **ONE task per turn.** Never start the next task if the current one completes early.
2. **Phase closure is part of the final task's turn.** When the last task in a phase completes, proceed immediately to Close Phase (step 14) within the same turn — do not end the turn and defer closure to the next iteration.
3. **Escalation threshold**: if a task has been attempted for 3+ consecutive turns without completion, document blockers in PLAN.md and create `ralph.blocked`.

### Spec Authority
4. **Never deviate** from spec design decisions. If a DD is wrong, create `ralph.blocked`.
5. **Specs override PLAN.md.** If there is a discrepancy, update PLAN.md to match the specs.
6. **Never modify files** outside the spec's change list without adding an issue to PLAN.md.

### Architecture Decision Records (ADRs)
7. Create an ADR when you need to **deviate from the spec or established patterns** (new dependencies, data flow changes, infrastructure decisions). ADRs are escalation gates:
   1. Document the decision needed in `adrs/<NNN>-<title>.md`
   2. Mark related PLAN.md tasks as blocked, referencing the ADR
   3. Create `ralph.blocked` with `reason: ADR <NNN> awaiting decision`.
   4. Commit and push all changes (including the ADR)
   5. End the turn — do NOT continue with other work
   6. A human will review and communicate their decision

### Bug Discovery
8. **Related to current task**: fix it within this turn.
9. **Unrelated to current task**: document in PLAN.md § Issues for a future turn. Do not fix it now.

### File Hygiene
10. Keep `PLAN.md` lean — completed phases live in `COMPLETED_PHASES.md`.
11. **Do not read `COMPLETED_PHASES.md`** unless an issue explicitly references a prior phase.
12. **Debug logging**: you may add temporary logging to assist debugging. Remove it before committing unless it has operational value.

### Code Quality
13. Use the project's existing patterns — match style, naming, and structure of surrounding code.
14. Run `dotnet format` before committing.

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

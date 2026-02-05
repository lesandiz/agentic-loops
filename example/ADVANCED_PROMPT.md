# Agent Prompt

## Critical Paths

**Base Path**: `.agent/feature-name/`

| File       | Relative Path                     |
| ---------- | --------------------------------- |
| PLAN.md    | `.agent/feature-name/PLAN.md`     |
| Specs      | `.agent/feature-name/specs/`      |
| ADRs       | `.agent/feature-name/adrs/`       |
| Scratchpad | `.agent/feature-name/scratchpad/` |
| Archive    | `.agent/feature-name/archive/`    |

### Path Resolution Rules

1. **First action of every turn**: Run `pwd` to confirm working directory
2. **Always use forward slashes** (`/`) in all paths - they work on all platforms including Windows
3. **Construct absolute paths** by joining CWD + relative path from the table above
4. **Never search for these files** - their locations are fixed; do not use glob/find to locate them

---

## Definitions

**Turn**: The complete cycle of selecting and working on ONE item from PLAN.md until the **main agent** decides to:
- ✅ Complete (tests pass, committed, pushed)
- ❌ Fail (document blocker, stop)
- ⏸️ Escalate (3+ attempts without resolution, or blocked awaiting human decision)

**Main Agent**: The orchestrator. Owns the turn. Delegates to subagents. Only the main agent decides when a turn ends.

**Turn Scope Constraints**:
- ONE item per turn (e.g., "Task 4.3 - Add unit tests")
- NEVER start work on the next item if the current item completes early
- If you finish early, commit, push, update PLAN.md, and **end the turn**
- Phase boundaries are hard stops—completing Phase 4 does NOT mean starting Phase 5

**Subagents**: Workers spawned by the main agent to execute specific tasks (file edits, searches, builds). Subagents do NOT control turn boundaries—they report results back to the main agent.

---

## Workflow

### Prerequisites
0. Study these files before starting (see **Critical Paths** for exact locations):
   - `.agent/feature-name/specs/`
   - `.agent/feature-name/PLAN.md`

### Execution Steps

1. **Select ONE Item**: Pick the SINGLE highest-priority incomplete item from PLAN.md. Work ONLY on this item until completion, failure, or escalation. **Never work on multiple items or cross phase boundaries in a single turn.** If no actionable items remain, summarise status and stop.

   **Before writing any code, verify:**
   - [ ] I have selected exactly ONE item
   - [ ] This item is in the same phase as any previous work this turn
   - [ ] I will stop after this item completes, even if time remains

   > **Parallelism scope**: Subagents may parallelise work *within* the selected item (e.g., editing disjoint files for the same task). Parallelism does NOT mean selecting multiple items. Never assign two subagents to edit the same file.

2. **Test Strategically**: After implementing functionality or resolving problems, run tests for the affected code. If functionality is missing, add it as per the specifications.

3. **Track Issues**: When you discover an issue, immediately update PLAN.md with your findings using a subagent. When the issue is resolved, update PLAN.md and remove the item using a subagent.

4. **Commit & Push**: When all tests pass (full suite), use subagents to update PLAN.md with your progress and commit all changes with `git add -A && git commit` with a message that describes the changes. After the commit, do a `git push` to push changes to the remote repository.

5. **Failure Protocol**: When tests fail repeatedly, summarise and record the issue in PLAN.md. Mark it as the single most important thing to resolve in the next turn, then stop this turn.

6. **Debug Logging**: You may add temporary logging to assist debugging (see CLAUDE.md for log file locations and interpretation). Remove debug logging before final commit unless operationally valuable.

7. **Keep PLAN.md Current**: ALWAYS keep PLAN.md up to date with your learnings using a subagent. Especially after wrapping up/finishing your turn.

8. **Update CLAUDE.md**: When you learn something new about how to run the app or send a request to a handler, update CLAUDE.md using a subagent (keep it brief). For example, if you run commands multiple times before learning the correct command, that file should be updated.

9. **Bug Discovery**: When you discover a bug, document it in PLAN.md. If related to the current work, resolve it using subagents. If unrelated, record it in PLAN.md as the next priority for the following turn.

10. **PLAN.md Size Management**: When PLAN.md grows above 300 lines, clean out completed items using a subagent.

11. **Specs Authority**: If there is a discrepancy between PLAN.md and the specs, always update PLAN.md to match the specs.

12. **Architecture Decision Records (ADRs)**: Create an ADR when you encounter a blocker requiring deviation from established patterns (new dependencies, data flow changes, infrastructure components).

    > **ADRs are escalation gates:**
    > 1. Document the decision needed in `.agent/feature-name/adrs/`
    > 2. Mark related PLAN.md items as **BLOCKED - awaiting ADR review**
    > 3. Commit and push all changes (including the ADR)
    > 4. End the turn - do NOT continue with other work
    > 5. A human will review and communicate their decision

13. **CLAUDE.md Protection**: DO NOT place status report updates into CLAUDE.md.

14. **Escalation**: If an item has been worked on for 3+ consecutive turns without completion, summarise and escalate by documenting blockers in PLAN.md and finish your turn.

15. **Scratchpad**: Use `.agent/feature-name/scratchpad/` directory for temporary files during your turn.

    > **Scratchpad rules:**
    > - If anything is worth preserving for future turns, summarise it in PLAN.md
    > - **Clean up all scratchpad files before ending your turn**
    > - **NEVER commit or push scratchpad files**

---

## PLAN.md Update Rules

> **IMPORTANT:** Follow these rules when updating PLAN.md to prevent incorrect status tracking.

### 🚨 MANDATORY: Line Count Check (DO THIS FIRST)

**Before making ANY updates to the plan:**
1. Check line count: `wc -l .agent/feature-name/PLAN.md`
2. If **above 300 lines**: STOP and archive completed phases before proceeding
   - Move completed phase details to `.agent/feature-name/archive/completed_phases.md`
   - Keep only phase title + "✅ COMPLETE" summary in this file
   - Then continue with your update

**Current line count must stay under 300 lines.**

---

### Verification Rules

1. **NEVER mark a test as passing** without running `dotnet test` and confirming it passes in the output
2. **NEVER mark a test as complete** without verifying the test method exists in the file (search for the method name)
3. **When updating test counts**, run the actual tests first and use the summary line (e.g., `Passed: 103, Failed: 13`)
4. **Cross-reference test existence**: If claiming a test exists, verify with `grep "[Test]" <file> | grep "<MethodName>"`
5. **Include verification evidence**: When making significant updates, note the command run and key output (e.g., "Verified via `dotnet test` - 103 passed")

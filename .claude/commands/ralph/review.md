# Review a Ralph SPEC.md for Quality

You are a spec reviewer for the Ralph agentic development framework. Your job is to find gaps, ambiguities, and contradictions BEFORE the spec is used to generate a plan and drive autonomous execution.

## Detect Feature

1. Run `git branch --show-current` to get the current branch name.
2. Strip the `ralph/` prefix to get `<feature-name>` (e.g. `ralph/auth-migration` → `auth-migration`). If the branch doesn't start with `ralph/`, report an error:
   ```
   Not on a ralph branch. Run /ralph:init <feature-name> first.
   ```
3. Read `.ralph/<feature-name>/SPEC.md`. If it doesn't exist, report an error and stop.
4. Read `.ralph/_template/SPEC.md` for the expected structure.

## Review Checklist

Evaluate the spec against each category below. For each, report **PASS** or **FAIL** with specific line references and quotes for failures.

### 1. Structure Completeness

Every phase MUST have ALL of these sections:
- [ ] Changes table (Action | File | Change)
- [ ] Code snippets (for non-trivial implementations)
- [ ] Acceptance Criteria (binary pass/fail)
- [ ] Test Cases table (Test Project | Test Class | Method | Asserts | Covers)
- [ ] Verification commands

### 2. Changes Table Coverage

- [ ] Every file mentioned in Code snippets appears in the Changes table
- [ ] Every file mentioned in Test Cases `Covers` column exists in the Changes table
- [ ] No files referenced in the prose/context that are missing from the Changes table
- [ ] Actions are specific (Create/Modify/Delete) — no ambiguous actions

### 3. Acceptance Criteria Quality

Flag any criterion that contains:
- [ ] Subjective language: "works correctly", "handles edge cases", "is performant", "as expected"
- [ ] Unmeasurable terms: "properly", "appropriately", "reasonable", "clean"
- [ ] Missing verification method: criteria must be testable by running a command or inspecting output

### 4. Implementation Precision

Flag any instance of:
- [ ] Open choices: "choose an appropriate", "consider using", "pick a suitable", "use a reasonable"
- [ ] Unspecified names: class names, method names, or variable names left as `<placeholder>` or described generically
- [ ] Missing code snippets for complex logic (more than simple CRUD or config changes)
- [ ] Vague change descriptions in the Changes table: "update as needed", "adjust accordingly"

### 5. Test Coverage Mapping

- [ ] Every row in the Changes table has at least one Test Cases entry with matching `Covers` value
- [ ] Test assertions are specific (not just "returns expected result")
- [ ] Test method names follow a consistent convention (e.g. `Method_When_Then`)

### 6. Phase Coherence

- [ ] Phases that modify the same files are sequential (not split as independent)
- [ ] No circular dependencies between phases
- [ ] Each phase has a clear, single-sentence Goal
- [ ] Phase ordering makes sense (dependencies before dependents)

### 7. Design Decision Consistency

- [ ] Design Decisions are numbered (DD-1, DD-2, ...)
- [ ] Changes don't contradict Design Decisions
- [ ] No conflicting decisions (e.g. DD-1 says "use middleware" but Changes show a filter)
- [ ] Scope section exists with explicit In Scope / Out of Scope

### 8. Verification Commands

- [ ] Every phase has runnable verification commands
- [ ] Commands reference real project paths (not placeholders)
- [ ] Build and test commands cover all modified projects

## Output Format

```
# Spec Review: <feature-name>

## Summary
- Total checks: <N>
- Passed: <N>
- Failed: <N>
- Verdict: READY FOR PLAN / NEEDS REVISION

## Results

### 1. Structure Completeness — PASS/FAIL
<details if failed>

### 2. Changes Table Coverage — PASS/FAIL
<details if failed>

... (all 8 categories)

## Action Items
1. <specific fix needed, with line reference>
2. <specific fix needed, with line reference>
...
```

## Rules

- Be strict. A spec that passes review will drive autonomous execution with no human in the loop.
- When in doubt, flag it. False positives are cheap; false negatives cause agent deviation.
- Do NOT fix the spec yourself. Only report findings. The user will run `/ralph:spec` to apply fixes.
- If `$ARGUMENTS` is provided, treat it as focus areas to pay extra attention to (e.g. "focus on phase 2 test coverage").

```
$ARGUMENTS
```

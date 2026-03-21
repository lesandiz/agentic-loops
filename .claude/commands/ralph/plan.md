# Generate a Ralph PLAN.md from a Finalized Spec

You are generating an implementation plan from a reviewed, finalized spec. The plan drives autonomous agent execution — each task will be picked up by a fresh agent invocation with no memory of prior turns.

## Detect Feature

1. Run `git branch --show-current` to get the current branch name.
2. Strip the `ralph/` prefix to get `<feature-name>` (e.g. `ralph/auth-migration` → `auth-migration`). If the branch doesn't start with `ralph/`, report an error and stop.
3. Read `.ralph/<feature-name>/SPEC.md`. If it doesn't exist, report an error and stop.
4. Read `.ralph/_template/PLAN.md` to understand the structural template.

## Pre-flight Quality Gate

Before generating, run a quick pass/fail scan of the spec. This is NOT a full review — it catches obvious issues so users who forgot `/ralph:review` don't generate a plan from a broken spec.

### Checks (all must pass to proceed)

1. **Structure**: every phase has all required sections (Changes table, Acceptance Criteria, Test Cases, Verification) and is wrapped in `<!-- phase:N:start/end -->` markers
2. **Vague language**: no acceptance criteria containing "works correctly", "handles edge cases", "as expected", "properly", "appropriately"
3. **Open choices**: no Changes table entries with "choose appropriate", "consider using", "as needed", "adjust accordingly"
4. **Test coverage**: every Changes table row has at least one matching `Covers` entry in Test Cases

### If any check fails

Report the failures in this format and **stop** — do NOT generate the plan:

```
Pre-flight failed. Run /ralph:review for the full report.

- FAIL: Structure — Phase 2 missing Test Cases section
- FAIL: Vague language — Phase 1 Acceptance Criteria line 3: "handles edge cases properly"
```

## Pre-implementation Gate

After the quality gate passes, validate the spec against project-level architectural principles.

1. Read `CLAUDE.md` (project root) and any `CLAUDE.md` files in parent directories.
2. Identify all architectural rules, conventions, and constraints defined there (e.g. required patterns, forbidden approaches, naming conventions, dependency rules, test requirements).
3. Check each spec Design Decision and Changes table entry against these principles.

### If conflicts are found

Report each conflict and **stop** — do NOT generate the plan:

```
Pre-implementation gate failed. Spec conflicts with project principles.

- CONFLICT: DD-2 uses service locator pattern — CLAUDE.md requires constructor injection
- CONFLICT: Phase 1 adds dependency on Newtonsoft.Json — CLAUDE.md mandates System.Text.Json
```

The user should resolve conflicts via `/ralph:spec` before retrying.

### If no conflicts

Proceed to plan generation.

## Generation Rules

### Task Derivation

- Each phase in the spec becomes a phase in the plan
- Each row in the Changes table (plus its corresponding Test Cases) becomes one or more tasks
- **One task per logical change**, not per file. If changing a DTO property requires updating 5 consumers, that's one task.
- **Each task includes its own tests.** Reference both Changes and Test Cases sections: `[SPEC.md § Phase N > Changes + Test Cases]`
- **Verification is a commit gate**, not a separate task — don't create "run tests" tasks.
- Combine trivial changes (e.g. multiple single-line config edits) into one task.
- If a task would touch more than ~8 files, consider splitting into smaller coherent steps.

### Task IDs

- Sequential across all phases: `T1`, `T2`, ... `T<n>`
- IDs are stable — never renumber

### Branch Strategy

- **5-15 tasks total**: single PR — delete the Branch Strategy section from the output, AND delete the `## PR Stacking Protocol` section from `.ralph/<feature-name>/PROMPT.md`
- **15+ tasks total**: stacked PRs — one branch per phase, each based on the previous

### Task Descriptions

- Specific enough that an agent can act on them without ambiguity
- Include the spec section reference: `[SPEC.md § Phase N > Changes + Test Cases]`
- Mention key files/classes that will be touched

## Output

Write the generated plan to `.ralph/<feature-name>/PLAN.md`.

After writing, provide a summary:
- Total phases and tasks
- Branch strategy chosen (single PR vs stacked)
- Any concerns about task granularity

If `$ARGUMENTS` is provided, treat it as additional guidance for plan generation (e.g. "keep tasks small", "prioritize phase 2").

```
$ARGUMENTS
```

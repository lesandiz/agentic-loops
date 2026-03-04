# Generate a Ralph PLAN.md

You are generating an implementation plan from an existing spec. The plan drives autonomous agent execution — each task will be picked up by a fresh agent invocation with no memory of prior turns.

## Inputs

1. **Read `.ralph/_template/PLAN.md`** — this is the structural template your output must follow exactly.
2. **Read the spec** — `SPEC.md` (or `specs/` directory) in `.ralph/<feature>` folder.

## Instructions

Derive tasks from the spec. Each phase in the spec becomes a phase in the plan. Each row in the Changes table (plus its corresponding Test Cases) becomes one or more tasks.

### Task ID Convention

- Sequential across all phases: `T1`, `T2`, ... `T<n>`
- IDs are stable — never renumber

### Task Granularity

- **One task per logical change**, not per file. If changing a DTO property requires updating 5 consumers, that's one task.
- **Each task includes its own tests.** Reference both the Changes and Test Cases sections: `[SPEC.md § Phase N > Changes + Test Cases]`
- **Verification is a commit gate**, not a separate task — don't create "run tests" tasks.
- Combine trivial changes (e.g. multiple single-line config edits) into one task.
- If a task would touch more than ~8 files, consider splitting into smaller coherent steps.

### Branch Strategy

- **5-15 tasks total**: single PR — delete the Branch Strategy section
- **15+ tasks total**: stacked PRs — one branch per phase, each based on the previous

## Output

Return only the PLAN.md content in a single markdown code block. Use task descriptions specific enough that an agent can act on them without ambiguity. Save the file to `.ralph/<feature>/PLAN.md`.

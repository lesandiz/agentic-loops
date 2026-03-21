# Ralph — Spec-Driven Agentic Development

## How It Works

```
Human writes specs with the assistance of an agent → Agent generates plan → Agent iterates autonomously → Human reviews PRs
```

The agent operates in a loop: read plan, pick next task, execute, verify, commit, repeat. Each turn is a fresh invocation with no memory — all state lives in the files.

## Quick Start

1. **Init**: `/ralph:init my-feature` — scaffolds branch, directory, and template files
2. **Research** (optional): `/ralph:research description of what to build` — explores codebase, outputs research docs
3. **Generate spec**: `/ralph:spec description of what to build` — generates SPEC.md from research + codebase
4. **Iterate on spec**: `/ralph:spec refine — add error handling, split phase 2...`
5. **Review spec**: `/ralph:review` — validates quality, flags gaps
6. **Generate plan**: `/ralph:plan` — validates spec, derives tasks, auto-configures PROMPT.md
7. **Run the loop**: See https://github.com/lesandiz/agentic-loops

## File Purposes

| File                  | Purpose                       | Who Writes                       | When Updated                      |
| --------------------- | ----------------------------- | -------------------------------- | --------------------------------- |
| `SPEC.md` or `specs/` | What to build and how         | Human via `/ralph:spec`          | Iterated until solid              |
| `PLAN.md`             | Active tasks and progress     | `/ralph:plan`, then agent        | Every turn                        |
| `COMPLETED_PHASES.md` | Completed phase history       | Agent                            | When a phase closes               |
| `PROMPT.md`           | Agent operating instructions  | `/ralph:init` + `/ralph:plan`    | Auto-configured                   |
| `SCRATCHPAD.md`       | Agent working memory          | Agent                            | Cleared when a phase closes       |
| `adrs/`               | Architecture decision records | Agent                            | When deviating from spec/patterns |


## Scaling Rules

### When to Split Specs

The decision to use a single `SPEC.md` vs numbered `specs/` is driven by **phase independence**, not size alone.

| Phases are...           | Use               | Why                                                                                   |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| Sequential / cumulative | Single `SPEC.md` with phase markers | Agent uses `<!-- phase:N:start/end -->` markers for offset reads — avoids loading completed phases |
| Independent components  | Numbered `specs/` | Agent loads only the spec relevant to the active phase — less context, less confusion |

A 5-phase feature where each phase modifies the same class sequentially belongs in one file. A 3-phase feature touching 3 unrelated components should be split.

### Size Guidelines

| Feature Size | Indicators                           | Phases      | PR Strategy |
| ------------ | ------------------------------------ | ----------- | ----------- |
| **Patch**    | 1–2 files, CVE fix, config change    | 1–2 tasks   | Single PR   |
| **Small**    | 3–10 files, focused feature          | 5–15 tasks  | Single PR   |
| **Medium**   | 10–30 files, cross-cutting change    | 15–30 tasks | Stacked PRs |
| **Large**    | 30+ files, multi-component migration | 30+ tasks   | Stacked PRs |

### Numbered Specs Layout

```
.ralph/<feature>/
├── PROMPT.md
├── PLAN.md
├── COMPLETED_PHASES.md
├── SCRATCHPAD.md
└── specs/
    ├── README.md          # Index with reading order and phase-to-spec mapping
    ├── 01-<component>.md  # Self-contained: changes, acceptance criteria, tests, verification
    ├── 02-<component>.md
    └── 03-<component>.md
```

Each numbered spec MUST be self-contained — include its own Changes table, Acceptance Criteria, Test Cases, and Verification section. Plan task references use `[specs/01-<component>.md § Changes]`.

The agent should only read the spec referenced by the active phase's tasks — not all specs.

## Writing Good Specs

**The spec is the most important file.** Time invested here directly reduces agent deviation.

### Do

- Be exhaustive in the Changes table — list every file, every modification
- Include copy-paste-ready code snippets for non-trivial implementations
- Make acceptance criteria binary (pass/fail) — no subjective language
- Document design decisions with rationale — the agent needs to know *why*
- Include verification commands that the agent can run autonomously

### Don't

- Leave implementation choices to the agent ("choose an appropriate pattern")
- Use vague acceptance criteria ("works correctly", "handles edge cases")
- Omit files from the Changes table (agent will modify unexpected files)
- Skip code snippets for complex logic (agent will hallucinate patterns)

## Writing Good Plans

Plans are derived from specs. Each phase in the spec becomes a phase in the plan, and each row in the Changes table (plus test cases) becomes a task.

### Task ID Convention

Tasks are numbered sequentially across all phases: `T1`, `T2`, ... `T<n>`. IDs are stable — never renumber. If tasks are added mid-execution, continue from the highest existing ID.

### Task Granularity

A task should represent a **coherent, cohesive changeset** — the smallest unit of work that serves a single purpose and leaves the codebase in a buildable, consistent state. This may span multiple files.

- **One task per logical change**, not per file. If changing a DTO property requires updating 5 consumers, that's one task.
- **Each task includes its own tests.** Tests ship with the change they verify, not as a separate task. The spec's Test Cases `Covers` column maps tests to changes.
- Verification (build + test) runs as a **commit gate** after every task — it is not a separate task.
- Combine trivial changes (e.g. multiple single-line config edits) into one task.
- If a task touches more than ~8 files, consider whether it can be broken into smaller coherent steps.

## PROMPT.md Customisation

PROMPT.md is auto-configured by `/ralph:init` (base path) and `/ralph:plan` (PR stacking). Manual customisation is only needed for:

| Section | When to Customise                          |
| ------- | ------------------------------------------ |
| Rules   | Add feature-specific constraints if needed |

## Signals

### `ralph.done`

Created by the agent when all phases are complete and all phase gates pass. Content is empty — existence is the signal.

### `ralph.blocked`

Created when the agent cannot proceed. Structured content:

```
phase: <N>
tasks: T<n>, T<m>
reason: <what is needed to unblock>
```

Human reads the file, resolves the issue (updates spec, answers question, approves PR), deletes `ralph.blocked`, and restarts the loop.

# Ralph — Spec-Driven Agentic Development

## How It Works

Agent writes specs with human input and steering → Agent generates plan → Agent iterates autonomously over the plan → Human reviews PRs

The agent operates autonomously in a loop: read plan, pick next task, execute, verify, commit, repeat. Each turn is a fresh invocation with no memory — all state lives in the files.

## Quick Start

Open Claude Code and use the slash commands:

```bash
/ralph:init my-feature                # scaffold branch + feature directory
/ralph:research migrate auth to JWT   # (optional) explore codebase, output research docs
/ralph:spec migrate auth to JWT       # generate SPEC.md
/ralph:spec add token refresh logic   # iterate on spec
/ralph:review                         # validate spec quality
/ralph:plan                           # generate PLAN.md from spec
```

Then run the agent loop to execute the plan autonomously. See https://github.com/lesandiz/agentic-loops

## File Purposes

| File                  | Purpose                      | Who Writes                               | When Updated                |
| --------------------- | ---------------------------- | ---------------------------------------- | --------------------------- |
| `SPEC.md`             | What to build and how        | Agent with human input via `/ralph:spec` | Iterated until solid        |
| `PLAN.md`             | Active tasks and progress    | Agent via `/ralph:plan`                  | Every turn                  |
| `PROMPT.md`           | Agent operating instructions | Agent via `/ralph:init` + `/ralph:plan`  | Auto-configured             |
| `COMPLETED_PHASES.md` | Completed phase history      | Agent in loop                            | When a phase closes         |
| `SCRATCHPAD.md`       | Agent working memory         | Agent in loop                            | Cleared when a phase closes |


### Ralph Feature Directory Layout

After running `/ralph:init` command, this is how the ralph feature directory looks like:

```
.ralph/<feature>/
├── PROMPT.md
├── PLAN.md
├── COMPLETED_PHASES.md
├── SCRATCHPAD.md
└── SPEC.md
```

## What Good Specs Look Like

**The spec is the most important file.** Time invested here directly reduces agent deviation.

The `/ralph:spec` command allows you to create an initial specs draft and also iterate and refine them.
The `/ralph:review` command validates the specs against quality criteria, before generating the plan. The verification includes:

- **Structure and phases coherence**: Every phase must be well structured and self-contained
- **Changes Table Coverage**: Required changes are precisely described and related to actual files, existing or new
- **Design Decisions**: All design decisions must be documented with rationale
- **Acceptance Criteria and Verification**: Unambiguous mechanism to validate correctness of changes must be provided, with binary outcome (pass/fail)

## Signals

Whenever the agent running in the loop completes the plan or finds a blocker, it creates a signal file and stops the loop, to avoid wasting iterations that won't make any progress.

### `ralph.done`

Created by the agent when all phases are complete and all phase gates pass. Content is empty — existence is the signal.

### `ralph.blocked`

Created when the agent cannot proceed. Structured content:

```
phase: <N>
tasks: T<n>, T<m>
reason: <what is needed to unblock>
```

A human must unblock the agent by manually updating specs, answering questions, or approving architecture decisions created by the agent.
Once the path is clear, manually delete `ralph.blocked`, and kick off the loop again.

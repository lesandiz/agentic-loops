# Agentic Loops

Run AI agents in a loop with Claude or GitHub Copilot, enabling autonomous iteration and continuous task execution.

This is the accompaning repo for the article [The Human On the Loop: A Practical Guide to Agentic Engineering](https://dotnetting.net/2026/02/the-human-on-the-loop-a-practical-guide-to-agentic-engineering/).

> **⚠️ WARNING: USE AT YOUR OWN RISK**
>
> This code is provided **as-is** for educational and experimental purposes only. Agentic loops allow AI agents to run autonomously with access to system tools, file operations, and command execution.
>
> **DO NOT USE** this code unless you:
> - Fully understand the code and what it does
> - Understand the implications of autonomous agent execution
> - Are aware of the potential risks (file modifications, command execution, resource consumption, costs)
> - Have reviewed and tested the code in a safe environment
>
> The authors assume no responsibility for any damages, data loss, unexpected costs, or other issues arising from the use of this software.

## Demo

<video src="https://github.com/user-attachments/assets/4c854fbb-c167-44a6-b1be-acbf2de762cd" controls autoplay loop muted width="100%"></video>

### Try it yourself

```bash
git clone https://github.com/lesandiz/agentic-loops.git
cd agentic-loops
npm install
npx tsx ralph-loop-claude-dashboard.ts --iterations=3 --port=3333 --prompt=SIMPLE_PROMPT.md --cwd=example/ --max-cost=0.50 --model=claude-haiku-4-5@20251001
```

Then open `http://localhost:3333` in your browser to see the live dashboard.

## Overview

The main implementation is **`ralph-loop-claude-dashboard.ts`** — built on the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk), it runs Claude agents in a loop with full terminal output and optionally serves a live HTTP dashboard for real-time monitoring, mid-iteration steering, runtime model switching, and cost budget management. The dashboard is a bonus — the loop runs and logs to the terminal regardless of whether you open the browser.

Two additional CLI scripts are included for simpler use cases or alternative backends:

- **`ralph-loop-claude.ts`** — Claude Agent SDK, terminal only (no HTTP server)
- **`ralph-loop-copilot.ts`** — GitHub Copilot SDK, terminal only (no HTTP server)

## Features

- 🌐 **Live HTTP Dashboard** — Real-time SSE updates in a browser UI
- 🛑 **Stop Control** — Stop the loop from the dashboard header
- 🎯 **Mid-iteration & Between-iteration Steering** — Inject prompts while the agent is running or between iterations
- 🔄 **Runtime Model Switching** — Switch between haiku/sonnet/opus presets without restarting
- 💰 **Cost Budget Management** — Set a max cost and auto-stop when the budget is reached
- 📊 **Per-iteration Token & Cost Charting** — Visualize token usage and cost across iterations
- 🔁 **Iterative Execution** — Run agents in a loop with configurable iterations and delays
- 🔧 **Tool Call & Subagent Tracking** — Monitor every tool execution and subagent spawn
- 📝 **File Logging** — Write logs to a file for post-run analysis

## Installation

```bash
npm install
```

## Usage (Dashboard)

```bash
# Basic usage
npm run ralph:dashboard

# Full example with all options
npx tsx ralph-loop-claude-dashboard.ts \
  --iterations=10 \
  --delay=5000 \
  --model=claude-sonnet-4-6@default \
  --prompt=PROMPT.md \
  --cwd=example/ \
  --port=3333 \
  --host=127.0.0.1 \
  --max-cost=1.00 \
  --verbose \
  --log=run.log
```

The loop runs in the terminal with full console output. The HTTP server starts alongside it — open the printed URL in your browser if you want the dashboard UI, but it's not required for the loop to work.

## Dashboard Controls

- **Stop** — Stop button in the header bar to halt the loop
- **Steering textarea** — Send prompts to the agent mid-iteration (interrupts and injects) or between iterations (prepended to the next prompt)
- **Model switching** — Change the Claude model at runtime; takes effect on the next iteration
- **Log filtering** — Filter logs by category: all, tools, agent, steering, system, errors
- **Budget indicator** — Shows current spend vs. configured max cost

## Command Line Options

| Option           | Description                           | Default                        |
| ---------------- | ------------------------------------- | ------------------------------ |
| `--iterations=N` | Maximum number of iterations          | 5                              |
| `--delay=N`      | Delay between iterations (ms)         | 5000                           |
| `--model=NAME`   | AI model to use                       | `claude-sonnet-4-6@default`    |
| `--prompt=FILE`  | Prompt file path                      | PROMPT.md                      |
| `--cwd=DIR`      | Working directory for tools & prompt  | (current directory)            |
| `--port=N`       | Dashboard HTTP port                   | 3333                           |
| `--host=ADDR`    | Dashboard bind address                | 127.0.0.1                      |
| `--max-cost=N`   | Stop loop when cost exceeds N USD     | (unlimited)                    |
| `--verbose, -v`  | Enable verbose output                 | false                          |
| `--log=FILE`     | Write logs to file                    | (console only)                 |
| `--help, -h`     | Show help message                     | -                              |

## Available Models

### Claude (via Vertex AI)
- `claude-sonnet-4-6@default` (default)
- `claude-opus-4-6@default`
- `claude-haiku-4-5@20251001`

## Signal Files

The loop checks for signal files in the prompt file's directory before each iteration:

- **`ralph.done`** — If present, the loop stops gracefully (agent signals task completion)
- **`ralph.blocked`** — If present, the loop stops gracefully (agent signals it is blocked)

These work across all three implementations (dashboard, Claude CLI, Copilot CLI).

## Custom Instructions

The Claude implementations (dashboard and CLI) use `settingSources: ["project", "user"]` which delegates instruction file loading to the Claude Agent SDK. The SDK automatically discovers and loads configuration files from standard locations, though the exact paths depend on the SDK's internal behavior.

## CLI Scripts (Claude & Copilot)

Two lightweight CLI alternatives run agents in a loop with terminal output only — no dashboard, no steering, no model switching.

### Claude CLI

```bash
npm run ralph:claude

npx tsx ralph-loop-claude.ts --iterations=10 --delay=2000 --verbose
npx tsx ralph-loop-claude.ts --model=claude-opus-4-6@default --log=run.log --cwd=example/
```

Supports the same core options as the dashboard (`--iterations`, `--delay`, `--model`, `--prompt`, `--cwd`, `--verbose`, `--log`) minus dashboard-specific ones (`--port`, `--host`, `--max-cost`).

### Copilot CLI

```bash
npm run ralph:copilot

npx tsx ralph-loop-copilot.ts --iterations=10 --delay=2000 --verbose
npx tsx ralph-loop-copilot.ts --model=gpt-5.2-codex --log=run.log --no-streaming
```

Additional Copilot-specific option:

| Option           | Description                  | Default |
| ---------------- | ---------------------------- | ------- |
| `--no-streaming` | Disable streaming mode       | -       |

#### Copilot Models

- `claude-sonnet-4.5` (default)
- `gpt-5.2-codex`
- `gpt-5.2`
- `gpt-5-mini`
- `claude-haiku-4.5`
- `claude-opus-4.5`
- `gemini-3-pro-preview`

#### Copilot Custom Instructions

The Copilot implementation explicitly loads instruction files from:

**User-level:**
- `~/.github/copilot-instructions.md`
- `~/.copilot/instructions.md`
- `~/.claude/CLAUDE.md`

**Project-level:**
- `.github/copilot-instructions.md`
- `COPILOT.md`
- `CLAUDE.md`

### Subagent Support

Both implementations support spawning isolated subagents with independent context windows. The Copilot version includes a custom `subagent` tool:

```typescript
// Subagents automatically summarize results and keep parent context clean
{
  task: "Research the latest TypeScript features",
  agent_type: "research",
  max_words: 200
}
```

Claude Code natively supports subagents and it doesn't require an explicit implementation to handle them.

## Development

The codebase is written in TypeScript and uses:
- `@anthropic-ai/claude-agent-sdk` for Claude integration (dashboard + CLI)
- `@github/copilot-sdk` for Copilot integration
- `dotenv` for environment configuration
- `zod` for schema validation

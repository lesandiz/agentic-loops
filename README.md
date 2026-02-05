# Agentic Loops

Run AI agents in a loop with Claude or GitHub Copilot, enabling autonomous iteration and continuous task execution.

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

## Overview

This repository provides two implementations of the "Ralph Loop" pattern - a technique for running AI agents in repeated iterations with comprehensive monitoring, token tracking, and subagent spawning capabilities.

### Implementations

- **`ralph-loop-claude.ts`** - Uses the Claude Agent SDK (Anthropic)
- **`ralph-loop-copilot.ts`** - Uses the GitHub Copilot SDK

Both implementations provide similar functionality but connect to different AI backends, allowing you to choose the best agent and models for your use case.

## Features

- 🔄 **Iterative Execution** - Run agents in a loop with configurable iterations and delays
- 📊 **Detailed Statistics** - Track tool calls, subagents, token usage, and execution time
- 🤖 **Subagent Spawning** - Delegate tasks to isolated subagents with independent context windows
- 📝 **Comprehensive Logging** - Console and file logging with timestamps and progress tracking
- 🎯 **Smart Tool Tracking** - Detailed monitoring of all tool executions with formatted output
- 💾 **Token Optimization** - Automatic token usage tracking and cache monitoring
- 🔧 **Custom Instructions** - Load user and project-level instructions from multiple locations

## Installation

```bash
npm install
```

## Usage

### Claude Agent SDK

```bash
# Basic usage
npm run ralph:claude

# With options
npx tsx ralph-loop-claude.ts --iterations=10 --delay=2000 --verbose
npx tsx ralph-loop-claude.ts --model=claude-opus-4-5@20251101 --log=run.log
```

### GitHub Copilot SDK

```bash
# Basic usage
npm run ralph:copilot

# With options
npx tsx ralph-loop-copilot.ts --iterations=10 --delay=2000 --verbose
npx tsx ralph-loop-copilot.ts --model=gpt-5.2-codex --log=run.log
```

## Command Line Options

| Option           | Description                           | Default                    |
| ---------------- | ------------------------------------- | -------------------------- |
| `--iterations=N` | Maximum number of iterations          | 5                          |
| `--delay=N`      | Delay between iterations (ms)         | 1000                       |
| `--model=NAME`   | AI model to use                       | (varies by implementation) |
| `--prompt=FILE`  | Prompt file path                      | PROMPT.md                  |
| `--verbose, -v`  | Enable verbose output                 | false                      |
| `--log=FILE`     | Write logs to file                    | (console only)             |
| `--no-streaming` | Disable streaming mode (Copilot only) | -                          |
| `--help, -h`     | Show help message                     | -                          |

## Available Models

### Claude (via Vertex AI)
- `claude-sonnet-4-5@20250929` (default)
- `claude-opus-4-5@20251101`
- `claude-haiku-4-5@20251001`

### Copilot
- `claude-sonnet-4.5` (default)
- `gpt-5.2-codex`
- `gpt-5.2`
- `gpt-5-mini`
- `claude-haiku-4.5`
- `claude-opus-4.5`
- `gemini-3-pro-preview`

## Custom Instructions

### Copilot Implementation

The Copilot implementation explicitly loads instruction files from:

**User-level:**
- `~/.github/copilot-instructions.md`
- `~/.copilot/instructions.md`
- `~/.claude/CLAUDE.md`

**Project-level:**
- `.github/copilot-instructions.md`
- `COPILOT.md`
- `CLAUDE.md`

### Claude Implementation

The Claude implementation uses `settingSources: ["project", "user"]` which delegates instruction file loading to the Claude Agent SDK. The SDK automatically discovers and loads configuration files from standard locations, though the exact paths depend on the SDK's internal behavior.

## Subagent Support

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
- `@anthropic-ai/claude-agent-sdk` for Claude integration
- `@github/copilot-sdk` for Copilot integration
- `dotenv` for environment configuration
- `zod` for schema validation

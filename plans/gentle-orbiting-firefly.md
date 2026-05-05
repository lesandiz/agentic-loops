# Modernize ralph-loop-copilot.ts for Copilot SDK v0.3.0

## Context

The Copilot SDK has evolved from v0.1.19 to v0.3.0 (public preview, April 2026), adding native subagent delegation, automatic config discovery, expanded event types, and new model support. The current `ralph-loop-copilot.ts` manually implements features that are now built into the SDK — particularly instruction loading and subagent isolation. These changes reduce ~150 lines of custom infrastructure by leveraging SDK capabilities.

## Files to modify

- `package.json` — SDK version bump
- `ralph-loop-copilot.ts` — all functional changes

---

## Step 1: Upgrade SDK version

**Commit: "Upgrade @github/copilot-sdk to ^0.3.0"**

- `package.json`: Change `"@github/copilot-sdk": "^0.1.19"` → `"^0.3.0"`
- Run `npm install`
- Verify: `npx tsx ralph-loop-copilot.ts --help` still prints usage

---

## Step 2: Replace loadInstructions() with enableConfigDiscovery

**Commit: "Replace manual instruction loading with SDK config discovery"**

Remove:
- `import * as os from "os"` (line 6, only used by loadInstructions for `os.homedir()`)
- `loadInstructions()` function (lines 417-460)
- `const customInstructions = loadInstructions(cfg.cwd)` (line 480)
- The `systemMessage` conditional spread in `createSession()` (lines 519-524)

Add:
- `enableConfigDiscovery: true` to `createSession()` options

Net: -47 lines, +1 line

---

## Step 3: Remove custom subagent infrastructure, add native subagent events

**Commit: "Replace custom subagent system with native SDK delegation"**

This is an atomic swap — remove old and add new in one commit so subagent stats tracking is never broken.

Remove:
- `defineTool` from `@github/copilot-sdk` import (line 3)
- `import { z } from "zod"` (line 7)
- `SubagentResult` interface (lines 29-34)
- `SubagentInfo` interface (lines 46-52) — keep this, still needed for stats
- `SUBAGENT_TOOLS` constant and comment block (lines 54-68)
- `isSubagentTool()` function (lines 196-199)
- `extractSubagentInfo()` function (lines 202-221)
- `spawnSubagent()` function (lines 228-316)
- `createSubagentTool()` function (lines 321-358)
- `const subagentTool = createSubagentTool(...)` in ralphLoop (line 493)
- `tools: [subagentTool]` from createSession options (line 518)
- Subagent detection logic in `tool.execution_start` handler (lines 574, 580-587) — no longer needed since native events handle this
- Subagent completion tracking in `tool.execution_complete` handler (lines 617-619)
- `activeToolExecutions` map and its `isSubagent` tracking (line 527, 574-575, etc.)
- `SubagentResult` interface (lines 29-34)
- Subagent-related entries in `formatToolContext()` (the `task`/`subagent` case, lines 167-173)
- `isSubagentTool` import from SUBAGENT_TOOLS

Add native event handlers inside `session.on()`:
```typescript
case "subagent.spawned":
  stats.subagentsSpawned++;
  const spawnedAgent = {
    id: (eventData?.agentId as string) || `subagent-${Date.now()}`,
    type: (eventData?.agentType as string) || "unknown",
    description: (eventData?.description as string) || "unnamed",
    startTime: Date.now(),
    toolCalls: 0,
  };
  stats.activeSubagents.set(spawnedAgent.id, spawnedAgent);
  log("📦", `Subagent spawned [${spawnedAgent.type}]: ${truncate(spawnedAgent.description, 80)}`);
  break;

case "subagent.completed":
  stats.subagentsCompleted++;
  const completedAgentId = eventData?.agentId as string;
  log("📦", `Subagent completed: ${completedAgentId || "unknown"}`);
  break;

case "subagent.failed":
  const failedAgentId = eventData?.agentId as string;
  const failReason = (eventData?.error as string) || "unknown";
  log("❌", `Subagent failed [${failedAgentId}]: ${failReason}`);
  break;

case "subagent.selected":
  const selectedAgent = (eventData?.agentName as string) || "unknown";
  logVerbose("📦", `Subagent selected: ${selectedAgent}`, cfg.verbose!);
  break;
```

Simplify `tool.execution_start` handler — remove subagent detection, keep only standard tool logging. Simplify `tool.execution_complete` — remove subagent completion check. Remove or simplify `activeToolExecutions` map (no `isSubagent` field needed).

Also remove `zod` from `package.json` dependencies (only used by subagent tool definition).

Net: ~-135 lines, +25 lines

---

## Step 4: Expand event handling for new SDK event types

**Commit: "Add reasoning, progress, and shutdown event handlers"**

Add new event handlers:

```typescript
// Reasoning events (verbose only)
case "assistant.reasoning_start":
  logVerbose("🧠", "Reasoning started", cfg.verbose!);
  break;
case "assistant.reasoning_delta":
  if (cfg.verbose && eventData?.deltaContent) {
    process.stdout.write(eventData.deltaContent as string);
  }
  break;
case "assistant.reasoning_complete":
  logVerbose("🧠", "Reasoning complete", cfg.verbose!);
  break;

// Tool progress (verbose only)
case "tool.execution_progress":
  if (cfg.verbose && eventData?.progress) {
    logVerbose("🔧", `Progress: ${eventData.progress}`, cfg.verbose!);
  }
  break;

// Session shutdown with aggregate metrics
case "session.shutdown":
  if (eventData) {
    const apiTime = eventData.cumulativeApiTimeMs;
    const modelBreakdown = eventData.perModelBreakdown;
    if (apiTime) log("📊", `Session API time: ${apiTime}ms`);
    logVerbose("📊", `Shutdown data: ${JSON.stringify(eventData)}`, cfg.verbose!);
  }
  break;
```

Also: check if `session.compaction_start` has been renamed to `session.compaction` in v0.3.0 — handle both for backwards compatibility if needed.

Net: +25 lines

---

## Step 5: Update model list and defaults

**Commit: "Update default model and available model list"**

- Change `DEFAULT_CONFIG.model` from `"claude-sonnet-4.5"` to `"claude-sonnet-4.6"`
- Update help text model list:
  ```
  Models (via Copilot):
    claude-sonnet-4.6     (default)
    claude-opus-4.6
    claude-haiku-4.5
    gpt-5
    gemini-3.1-pro
    gemini-3-flash
  ```
- Update the comment at the top that lists models (line 691-692 area)

---

## Verification

After all steps, verify:
1. `npx tsx ralph-loop-copilot.ts --help` prints updated usage with new models
2. TypeScript compiles without errors
3. The file runs against a real prompt (manual test with `--iterations=1`)

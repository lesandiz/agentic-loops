// https://github.com/github/awesome-copilot/blob/main/instructions/copilot-sdk-nodejs.instructions.md

import { CopilotClient, type SessionEvent, approveAll } from "@github/copilot-sdk";
import * as fs from "fs";
import * as path from "path";

interface RalphLoopConfig {
  maxIterations: number;
  delayMs: number;
  promptFile?: string;
  model?: string;
  verbose?: boolean;
  logFile?: string;
  streaming?: boolean;
  cwd?: string;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface RunStats {
  toolCalls: Record<string, number>;
  subagentsSpawned: number;
  subagentsCompleted: number;
  compactions: number;
  iterations: number;
  startTime: number;
  tokens: TokenUsage;
  activeSubagents: Map<string, SubagentInfo>;
}

interface SubagentInfo {
  id: string;
  type: string;
  description: string;
  startTime: number;
  toolCalls: number;
}

const DEFAULT_CONFIG: RalphLoopConfig = {
  maxIterations: 5,
  delayMs: 1000,
  promptFile: "PROMPT.md",
  model: "claude-sonnet-4.6",
  verbose: false,
  logFile: undefined,
  streaming: true,
  cwd: undefined,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Logging utilities
let logFileStream: fs.WriteStream | null = null;

function initLogFile(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  logFileStream = fs.createWriteStream(filePath, { flags: "a" });
  logFileStream.write(`\n--- Log started: ${new Date().toISOString()} ---\n`);
}

function closeLogFile(): void {
  if (logFileStream) {
    logFileStream.end();
    logFileStream = null;
  }
}

function log(prefix: string, msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[${ts}][${currentIteration}] ${prefix} ${msg}`;
  console.log(line);
  if (logFileStream) {
    logFileStream.write(line + "\n");
  }
}

function logVerbose(prefix: string, msg: string, verbose: boolean): void {
  if (verbose) {
    log(prefix, msg);
  } else if (logFileStream) {
    const ts = new Date().toISOString().slice(11, 23);
    logFileStream.write(`[${ts}] ${prefix} ${msg}\n`);
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}

function basename(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

function formatToolContext(toolName: string, args: Record<string, unknown> | undefined): string {
  if (!args) return "";

  const name = toolName.toLowerCase();

  // File path extraction (various field names)
  const filePath = args.file_path || args.filePath || args.path || args.file;
  if (filePath && (name === "read" || name === "view" || name === "write" || name === "edit" || name === "multiedit")) {
    return ` → ${basename(String(filePath))}`;
  }

  // Command execution
  const command = args.command || args.cmd || args.script;
  if (command && (name === "bash" || name === "powershell" || name === "shell" || name === "exec" || name === "run")) {
    return ` → ${truncate(String(command), 80)}`;
  }

  // Pattern-based tools
  if (args.pattern && (name === "glob" || name === "find")) {
    return ` → ${String(args.pattern)}`;
  }
  if (args.pattern && (name === "grep" || name === "search" || name === "ripgrep")) {
    return ` → "${truncate(String(args.pattern), 80)}"`;
  }

  // Web tools
  if (args.url && (name === "webfetch" || name === "fetch" || name === "http")) {
    return ` → ${truncate(String(args.url), 80)}`;
  }
  if (args.query && (name === "websearch" || name === "search")) {
    return ` → "${truncate(String(args.query), 80)}"`;
  }

  // Notebook
  const notebookPath = args.notebook_path || args.notebookPath;
  if (notebookPath && name.includes("notebook")) {
    return ` → ${basename(String(notebookPath))}`;
  }

  return "";
}

function initStats(): RunStats {
  return {
    toolCalls: {},
    subagentsSpawned: 0,
    subagentsCompleted: 0,
    compactions: 0,
    iterations: 0,
    startTime: Date.now(),
    tokens: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    activeSubagents: new Map(),
  };
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((n) => n.toString().padStart(2, "0"))
    .join(":");
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function printStats(stats: RunStats): void {
  const elapsed = formatElapsed(Date.now() - stats.startTime);

  log("📊", "=== Run Statistics ===");
  log("📊", `Total iterations: ${stats.iterations}`);
  log("📊", `Subagents: ${stats.subagentsCompleted}/${stats.subagentsSpawned} completed`);
  log("📊", `Context compactions: ${stats.compactions}`);
  log("📊", `Elapsed time: ${elapsed}`);

  log("📊", "Token usage (all sessions):");
  log("📊", `  Input tokens:  ${formatNumber(stats.tokens.inputTokens)}`);
  log("📊", `  Output tokens: ${formatNumber(stats.tokens.outputTokens)}`);
  log("📊", `  Total tokens:  ${formatNumber(stats.tokens.totalTokens || stats.tokens.inputTokens + stats.tokens.outputTokens)}`);
  if (stats.tokens.cacheReadTokens > 0 || stats.tokens.cacheWriteTokens > 0) {
    log("📊", `  Cache read:    ${formatNumber(stats.tokens.cacheReadTokens)}`);
    log("📊", `  Cache write:   ${formatNumber(stats.tokens.cacheWriteTokens)}`);
  }

  if (stats.subagentsSpawned > 0) {
    log("📊", "Subagent summary:");
    const agentTypes: Record<string, number> = {};
    for (const [, info] of stats.activeSubagents) {
      agentTypes[info.type] = (agentTypes[info.type] || 0) + 1;
    }
    for (const [type, count] of Object.entries(agentTypes)) {
      log("📊", `  ${type}: ${count}`);
    }
  }

  log("📊", "Tool usage:");
  const sorted = Object.entries(stats.toolCalls).sort((a, b) => b[1] - a[1]);
  for (const [tool, count] of sorted) {
    log("📊", `  ${tool}: ${count}`);
  }
}

function readPrompt(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf-8").trim();
}


async function ralphLoop(config: Partial<RalphLoopConfig> = {}): Promise<void> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const promptPath = cfg.cwd
    ? path.resolve(cfg.cwd, cfg.promptFile!)
    : cfg.promptFile!;
  const prompt = readPrompt(promptPath);
  const stats = initStats();

  if (cfg.logFile) {
    initLogFile(cfg.logFile);
  }

  log("🚀", `Starting ralph loop: max ${cfg.maxIterations} iterations, ${cfg.delayMs}ms delay`);
  log("🤖", `Model: ${cfg.model}`);
  if (cfg.cwd) log("📂", `Working directory: ${cfg.cwd}`);
  log("📝", `Prompt: ${promptPath}`);

  if (cfg.verbose) log("🔍", "Verbose mode enabled");
  if (cfg.logFile) log("🪵", `Logging to: ${cfg.logFile}`);

  const client = new CopilotClient({
    ...(cfg.cwd && { cwd: cfg.cwd }),
  });

  try {
    await client.start();
    log("✅", "Copilot client started");

    const promptDir = path.dirname(path.resolve(promptPath));

    for (let i = 0; i < cfg.maxIterations; i++) {
      // Check for stop signals at the start of each iteration
      const doneFile = path.join(promptDir, "ralph.done");
      const blockedFile = path.join(promptDir, "ralph.blocked");

      if (fs.existsSync(doneFile)) {
        log("🏁", `Found ${doneFile} - stopping loop`);
        break;
      }
      if (fs.existsSync(blockedFile)) {
        log("🚫", `Found ${blockedFile} - stopping loop`);
        break;
      }

      stats.iterations++;
      currentIteration = i + 1;
      log("🔄", `=== Iteration ${i + 1}/${cfg.maxIterations} ===`);

      const session = await client.createSession({
        model: cfg.model,
        streaming: cfg.streaming,
        enableConfigDiscovery: true,
        onPermissionRequest: approveAll,
      });

      const activeToolExecutions = new Map<string, string>();

      const iterationComplete = new Promise<void>((resolve, reject) => {
        session.on((event: SessionEvent) => {
          const eventData = (event as { data?: Record<string, unknown> }).data;

          switch (event.type) {
            // Streaming events
            case "assistant.message.delta":
              if (cfg.verbose && eventData?.deltaContent) {
                process.stdout.write(eventData.deltaContent as string);
              }
              break;

            // Final assistant message
            case "assistant.message":
              if (eventData?.content) {
                log("💬", eventData.content as string);
              }
              break;

            // Token usage event (emitted after each API call)
            case "assistant.usage":
              if (eventData) {
                const input = (eventData.inputTokens as number) || 0;
                const output = (eventData.outputTokens as number) || 0;
                const cacheRead = (eventData.cacheReadTokens as number) || 0;
                const cacheWrite = (eventData.cacheWriteTokens as number) || 0;

                stats.tokens.inputTokens += input;
                stats.tokens.outputTokens += output;
                stats.tokens.cacheReadTokens += cacheRead;
                stats.tokens.cacheWriteTokens += cacheWrite;
                stats.tokens.totalTokens += input + output;

                logVerbose("📈", `Tokens: in=${input} out=${output} cache_r=${cacheRead} cache_w=${cacheWrite}`, cfg.verbose!);
              }
              break;

            // Tool execution started
            case "tool.execution_start": {
              const toolName = eventData?.toolName as string;
              const toolId = eventData?.toolCallId as string;
              const toolArgs = eventData?.arguments as Record<string, unknown> || {};

              if (toolId) {
                activeToolExecutions.set(toolId, toolName);
              }

              if (toolName) {
                stats.toolCalls[toolName] = (stats.toolCalls[toolName] || 0) + 1;
                const context = formatToolContext(toolName, toolArgs);
                log("🔧", `${toolName}${context}`);
                logVerbose("🔧", `${toolName} args: ${truncate(JSON.stringify(toolArgs), 200)}`, cfg.verbose!);
              }
              break;
            }

            // Tool execution partial result (streaming output)
            case "tool.execution_partial_result":
              if (cfg.verbose && eventData?.partialOutput) {
                process.stdout.write(eventData.partialOutput as string);
              }
              break;

            // Tool execution completed
            case "tool.execution_complete": {
              const completedToolId = eventData?.toolCallId as string;
              const completedToolName = completedToolId ? activeToolExecutions.get(completedToolId) : null;

              if (completedToolName) {
                const telemetry = eventData?.toolTelemetry as Record<string, unknown> | undefined;
                const duration = telemetry?.durationMs || telemetry?.duration;
                const elapsed = duration ? ` (${duration}ms)` : "";
                const success = eventData?.success !== false;
                const successIcon = success ? "✓" : "✗";
                logVerbose("🔧", `${completedToolName} ${successIcon}${elapsed}`, cfg.verbose!);
                activeToolExecutions.delete(completedToolId);
              }
              break;
            }

            // Native subagent events
            case "subagent.spawned": {
              stats.subagentsSpawned++;
              const spawnedAgent: SubagentInfo = {
                id: (eventData?.agentId as string) || `subagent-${Date.now()}`,
                type: (eventData?.agentType as string) || "unknown",
                description: (eventData?.description as string) || "unnamed",
                startTime: Date.now(),
                toolCalls: 0,
              };
              stats.activeSubagents.set(spawnedAgent.id, spawnedAgent);
              log("📦", `Subagent spawned [${spawnedAgent.type}]: ${truncate(spawnedAgent.description, 80)}`);
              break;
            }

            case "subagent.completed": {
              stats.subagentsCompleted++;
              const completedAgentId = eventData?.agentId as string;
              log("📦", `Subagent completed: ${completedAgentId || "unknown"}`);
              break;
            }

            case "subagent.failed": {
              const failedAgentId = eventData?.agentId as string;
              const failReason = (eventData?.error as string) || "unknown";
              log("❌", `Subagent failed [${failedAgentId}]: ${failReason}`);
              break;
            }

            case "subagent.selected":
              logVerbose("📦", `Subagent selected: ${(eventData?.agentName as string) || "unknown"}`, cfg.verbose!);
              break;

            // Context compaction started (infinite sessions)
            case "session.compaction_start":
              stats.compactions++;
              log("⚠️", `Context compaction #${stats.compactions} started`);
              break;

            // Session completed
            case "session.idle":
              log("✅", `Completed: iteration ${currentIteration}`);
              resolve();
              break;

            case "session.error":
              // Error occurred
              log("❌", `Error: ${eventData?.message || "Unknown error"}`);
              reject(new Error(eventData?.message as string || "Session error"));
              break;

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
                if (apiTime) log("📊", `Session API time: ${apiTime}ms`);
                logVerbose("📊", `Shutdown data: ${JSON.stringify(eventData)}`, cfg.verbose!);
              }
              break;

            default:
              logVerbose("❓", `Unhandled: ${event.type} | ${JSON.stringify(eventData || {})}`, cfg.verbose!);
              break;
          }
        });
      });

      // Send the prompt
      await session.send({ prompt });

      // Wait for completion
      await iterationComplete;

      // Cleanup session
      await session.destroy();

      if (i < cfg.maxIterations - 1) {
        log("⏳", `Waiting ${cfg.delayMs}ms before next iteration...`);
        await sleep(cfg.delayMs);
      }
    }
  } finally {
    await client.stop();
    log("🛑", "Copilot client stopped");
  }

  log("🏁", "=== Ralph loop complete ===");
  printStats(stats);
  closeLogFile();
}

// CLI usage: npx tsx ralph-loop-copilot.ts [options]
//   --iterations=N    Max iterations (default: 5)
//   --delay=N         Delay between iterations in ms (default: 1000)
//   --model=NAME      Model to use (default: claude-sonnet-4.6)
//   --prompt=FILE     Prompt file path (default: PROMPT.md, relative to --cwd if set)
//   --cwd=DIR         Working directory for Copilot tools and prompt file
//   --verbose         Enable verbose output
//   --log=FILE        Write logs to file
//   --no-streaming    Disable streaming mode
//
// Available models (via Copilot):
// - claude-sonnet-4.6 (default)
// - claude-opus-4.6
// - claude-haiku-4.5
// - gpt-5
// - gemini-3.1-pro
// - gemini-3-flash

function parseArgs(args: string[]): Partial<RalphLoopConfig> {
  const config: Partial<RalphLoopConfig> = {};

  for (const arg of args) {
    if (arg.startsWith("--iterations=")) {
      config.maxIterations = parseInt(arg.split("=")[1]);
    } else if (arg.startsWith("--delay=")) {
      config.delayMs = parseInt(arg.split("=")[1]);
    } else if (arg.startsWith("--model=")) {
      config.model = arg.split("=")[1];
    } else if (arg === "--verbose" || arg === "-v") {
      config.verbose = true;
    } else if (arg.startsWith("--log=")) {
      config.logFile = arg.split("=")[1];
    } else if (arg.startsWith("--prompt=")) {
      config.promptFile = arg.split("=")[1];
    } else if (arg.startsWith("--cwd=")) {
      config.cwd = arg.split("=")[1];
    } else if (arg === "--no-streaming") {
      config.streaming = false;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
ralph-loop-copilot - Run GitHub Copilot agents in a loop

Usage: npx tsx ralph-loop-copilot.ts [options]

Options:
  --iterations=N    Max iterations (default: 5)
  --delay=N         Delay between iterations in ms (default: 1000)
  --model=NAME      Model to use (default: claude-sonnet-4.6)
  --prompt=FILE     Prompt file path (default: PROMPT.md, relative to --cwd if set)
  --cwd=DIR         Working directory for Copilot tools and prompt file
  --verbose, -v     Enable verbose output (show full tool inputs)
  --log=FILE        Write logs to file in addition to console
  --no-streaming    Disable streaming mode
  --help, -h        Show this help message

Models (via Copilot):
  claude-sonnet-4.6     (default)
  claude-opus-4.6
  claude-haiku-4.5
  gpt-5
  gemini-3.1-pro
  gemini-3-flash
`);
      process.exit(0);
    }
  }

  return config;
}

let currentIteration = 0;
const config = parseArgs(process.argv.slice(2));
ralphLoop(config);

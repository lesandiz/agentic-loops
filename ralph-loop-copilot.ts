// https://github.com/github/awesome-copilot/blob/main/instructions/copilot-sdk-nodejs.instructions.md

import { CopilotClient, type SessionEvent, defineTool } from "@github/copilot-sdk";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { z } from "zod";

interface RalphLoopConfig {
  maxIterations: number;
  delayMs: number;
  promptFile?: string;
  model?: string;
  verbose?: boolean;
  logFile?: string;
  streaming?: boolean;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface SubagentResult {
  success: boolean;
  summary: string;
  toolCalls: Record<string, number>;
  durationMs: number;
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

// Tool names that spawn subagents or delegate work
// Note: Copilot CLI doesn't spawn local subagents like Claude's "Task" tool
// - "delegate" / "coding_agent": Creates async coding agent on GitHub (opens PR)
// - "agent" / "invoke_agent": Invokes custom agent personas
// - "Task": Claude SDK compatibility (won't appear in Copilot)
const SUBAGENT_TOOLS = [
  "Task",          // Claude SDK
  "delegate",      // Copilot /delegate command
  "coding_agent",  // Copilot coding agent
  "agent",         // Copilot /agent command
  "invoke_agent",  // Custom agent invocation
  "spawn_agent",   // Generic
  "run_agent",     // Generic
  "subagent",      // Our custom subagent tool
];

const DEFAULT_CONFIG: RalphLoopConfig = {
  maxIterations: 5,
  delayMs: 1000,
  promptFile: "PROMPT.md",
  model: "claude-sonnet-4.5",
  verbose: false,
  logFile: undefined,
  streaming: true,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Logging utilities
let logFileStream: fs.WriteStream | null = null;

function initLogFile(filePath: string): void {
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

  // Task/subagent description
  if (name === "task" || name === "subagent") {
    const desc = args.description || args.prompt || args.task;
    if (desc) {
      return ` → ${truncate(String(desc), 80)}`;
    }
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

function isSubagentTool(toolName: string): boolean {
  return SUBAGENT_TOOLS.some(t =>
    toolName.toLowerCase().includes(t.toLowerCase())
  );
}

function extractSubagentInfo(toolName: string, args: Record<string, unknown>): SubagentInfo {
  // Handle both direct fields and nested 'arguments' structure
  const id = (args.toolCallId as string) || (args.id as string) || `subagent-${Date.now()}`;
  const agentType = (args.subagent_type as string) ||
    (args.agent_type as string) ||
    (args.type as string) ||
    toolName;
  const description = (args.description as string) ||
    (args.prompt as string)?.slice(0, 80) ||
    (args.task as string)?.slice(0, 80) ||
    "unnamed";

  return {
    id,
    type: agentType,
    description,
    startTime: Date.now(),
    toolCalls: 0,
  };
}

/**
 * Spawn an isolated subagent with its own context window.
 * Only the summary is returned to the parent, keeping parent context clean.
 * Tokens are automatically accumulated in the shared stats.tokens counter.
 */
async function spawnSubagent(
  client: CopilotClient,
  task: string,
  agentType: string,
  model: string,
  verbose: boolean,
  stats: RunStats
): Promise<SubagentResult> {
  const startTime = Date.now();
  const subToolCalls: Record<string, number> = {};
  let lastMessage = "";
  let sessionTokens = 0;

  log("🔀", `[Subagent:${agentType}] Starting isolated session`);
  logVerbose("🔀", `[Subagent:${agentType}] Task: ${task}`, verbose);

  const subSession = await client.createSession({
    model,
    streaming: false, // Subagents don't stream to reduce noise
  });

  const result = await new Promise<SubagentResult>((resolve) => {
    subSession.on((event: SessionEvent) => {
      const eventData = (event as { data?: Record<string, unknown> }).data;

      switch (event.type) {
        case "assistant.message":
          lastMessage = (eventData?.content as string) || "";
          break;

        case "assistant.usage":
          if (eventData) {
            const input = (eventData.inputTokens as number) || 0;
            const output = (eventData.outputTokens as number) || 0;
            const cacheRead = (eventData.cacheReadTokens as number) || 0;
            const cacheWrite = (eventData.cacheWriteTokens as number) || 0;

            // Accumulate directly to shared stats
            stats.tokens.inputTokens += input;
            stats.tokens.outputTokens += output;
            stats.tokens.cacheReadTokens += cacheRead;
            stats.tokens.cacheWriteTokens += cacheWrite;
            stats.tokens.totalTokens += input + output;

            sessionTokens += input + output;
          }
          break;

        case "tool.execution_start":
          const toolName = eventData?.toolName as string;
          if (toolName) {
            subToolCalls[toolName] = (subToolCalls[toolName] || 0) + 1;
            logVerbose("🔀", `[Subagent:${agentType}] Tool: ${toolName}`, verbose);
          }
          break;

        case "session.idle":
          const durationMs = Date.now() - startTime;
          log("🔀", `[Subagent:${agentType}] Complete (${durationMs}ms, ${sessionTokens} tokens)`);
          resolve({
            success: true,
            summary: lastMessage,
            toolCalls: subToolCalls,
            durationMs,
          });
          break;

        case "session.error":
          const errorMsg = (eventData?.message as string) || "Unknown error";
          log("❌", `[Subagent:${agentType}] Error: ${errorMsg}`);
          resolve({
            success: false,
            summary: `Error: ${errorMsg}`,
            toolCalls: subToolCalls,
            durationMs: Date.now() - startTime,
          });
          break;
      }
    });

    // Send the task to the subagent
    subSession.send({ prompt: task });
  });

  // Clean up isolated session
  await subSession.destroy();

  return result;
}

/**
 * Create the subagent tool using defineTool with handler.
 */
function createSubagentTool(
  client: CopilotClient,
  stats: RunStats,
  model: string,
  verbose: boolean
) {
  return defineTool("subagent", {
    description: `Spawn a subagent with its own context window to perform a task. The subagent runs independently and only returns a summary, keeping the main context clean. Use this for research, exploration, or delegating subtasks.`,
    parameters: z.object({
      task: z.string().describe("The task for the subagent to perform"),
      agent_type: z.string().optional().describe("Type of agent: 'research', 'code', 'explore', 'general'"),
      max_words: z.number().optional().describe("Maximum words in the summary (default: 200)"),
    }),
    handler: async ({ task, agent_type = "general", max_words = 200 }) => {
      // Note: subagentsSpawned is incremented in the event handler when tool.execution_start fires

      // Construct prompt with summarization instruction
      const subagentPrompt = `${task}

IMPORTANT: When complete, provide a concise summary of your findings and any key results.
Keep your final response under ${max_words} words, focusing on actionable information.`;

      const result = await spawnSubagent(client, subagentPrompt, agent_type, model, verbose, stats);

      // Track subagent tool calls in main stats (prefixed)
      for (const [tool, count] of Object.entries(result.toolCalls)) {
        const key = `subagent:${tool}`;
        stats.toolCalls[key] = (stats.toolCalls[key] || 0) + count;
      }

      // Note: subagentsCompleted is tracked via tool.execution_complete event

      return result.success
        ? result.summary
        : `Subagent failed: ${result.summary}`;
    },
  });
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

function loadInstructions(): string {
  const instructions: string[] = [];

  // User-level instruction files
  const userPaths = [
    path.join(os.homedir(), ".github", "copilot-instructions.md"),
    path.join(os.homedir(), ".copilot", "instructions.md"),
    path.join(os.homedir(), ".claude", "CLAUDE.md"),
  ];

  // Project-level instruction files
  const projectPaths = [
    path.join(process.cwd(), ".github", "copilot-instructions.md"),
    path.join(process.cwd(), "COPILOT.md"),
    path.join(process.cwd(), "CLAUDE.md"),
  ];

  // Load user instructions (first match wins)
  for (const p of userPaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf-8").trim();
      if (content) {
        instructions.push(`# User Instructions (${path.basename(p)})\n\n${content}`);
        log("📋", `Loaded user instructions: ${p}`);
        break;
      }
    }
  }

  // Load project instructions (first match wins)
  for (const p of projectPaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf-8").trim();
      if (content) {
        instructions.push(`# Project Instructions (${path.basename(p)})\n\n${content}`);
        log("📋", `Loaded project instructions: ${p}`);
        break;
      }
    }
  }

  return instructions.join("\n\n---\n\n");
}

async function ralphLoop(config: Partial<RalphLoopConfig> = {}): Promise<void> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const prompt = readPrompt(cfg.promptFile!);
  const stats = initStats();

  if (cfg.logFile) {
    initLogFile(cfg.logFile);
  }

  log("🚀", `Starting ralph loop: max ${cfg.maxIterations} iterations, ${cfg.delayMs}ms delay`);
  log("🤖", `Model: ${cfg.model}`);
  log("📝", `Prompt File: ${cfg.promptFile}`);

  // Load instruction files
  const customInstructions = loadInstructions();
  if (cfg.verbose) log("🔍", "Verbose mode enabled");
  if (cfg.logFile) log("📁", `Logging to: ${cfg.logFile}`);

  const client = new CopilotClient();

  try {
    await client.start();
    log("✅", "Copilot client started");

    // Create the subagent tool with handler
    const subagentTool = createSubagentTool(client, stats, cfg.model!, cfg.verbose!);

    for (let i = 0; i < cfg.maxIterations; i++) {
      stats.iterations++;
      currentIteration = i + 1;
      log("🔄", `\n=== Iteration ${i + 1}/${cfg.maxIterations} ===`);

      const session = await client.createSession({
        model: cfg.model,
        streaming: cfg.streaming,
        tools: [subagentTool],
        ...(customInstructions && {
          systemMessage: {
            mode: "append" as const,
            content: customInstructions,
          },
        }),
      });

      const activeToolExecutions = new Map<string, { name: string; isSubagent: boolean }>();

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
            case "tool.execution_start":
              const toolName = eventData?.toolName as string;
              const toolId = eventData?.toolCallId as string;
              const toolArgs = eventData?.arguments as Record<string, unknown> || {};
              const isSubagent = isSubagentTool(toolName);

              if (toolId) {
                activeToolExecutions.set(toolId, { name: toolName, isSubagent });
              }

              if (toolName) {
                stats.toolCalls[toolName] = (stats.toolCalls[toolName] || 0) + 1;

                // Check if this is a subagent-spawning tool
                if (isSubagent) {
                  stats.subagentsSpawned++;
                  const subagentInfo = extractSubagentInfo(toolName, toolArgs);
                  stats.activeSubagents.set(subagentInfo.id, subagentInfo);

                  log("📦", `Spawning subagent [${subagentInfo.type}]: ${truncate(subagentInfo.description, 80)}`);
                  logVerbose("📦", `Full args: ${JSON.stringify(toolArgs)}`, cfg.verbose!);
                } else {
                  const context = formatToolContext(toolName, toolArgs);
                  log("🔧", `${toolName}${context}`);
                  logVerbose("🔧", `${toolName} args: ${truncate(JSON.stringify(toolArgs), 200)}`, cfg.verbose!);
                }
              }
              break;

            // Tool execution partial result (streaming output)
            case "tool.execution_partial_result":
              if (cfg.verbose && eventData?.partialOutput) {
                process.stdout.write(eventData.partialOutput as string);
              }
              break;

            // Tool execution completed
            case "tool.execution_complete":
              const completedToolId = eventData?.toolCallId as string;
              const toolExecution = completedToolId ? activeToolExecutions.get(completedToolId) : null;

              if (toolExecution) {
                const telemetry = eventData?.toolTelemetry as Record<string, unknown> | undefined;
                const duration = telemetry?.durationMs || telemetry?.duration;
                const elapsed = duration ? ` (${duration}ms)` : "";
                const success = eventData?.success !== false;
                const successIcon = success ? "✓" : "✗";
                logVerbose("🔧", `${toolExecution.name} ${successIcon}${elapsed}`, cfg.verbose!);

                // Track subagent completion
                if (toolExecution.isSubagent && success) {
                  stats.subagentsCompleted++;
                }

                activeToolExecutions.delete(completedToolId);
              }
              break;

            // Context compaction started (infinite sessions)
            case "session.compaction_start":
              stats.compactions++;
              log("⚠️", `Context compaction #${stats.compactions} started`);
              break;

            // Session completed
            case "session.idle":
              log("✅", "Iteration complete");
              resolve();
              break;

            case "session.error":
              // Error occurred
              log("❌", `Error: ${eventData?.message || "Unknown error"}`);
              reject(new Error(eventData?.message as string || "Session error"));
              break;

            default:
              // Print unhandled events
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

  log("🏁", "\n=== Ralph loop complete ===");
  printStats(stats);
  closeLogFile();
}

// CLI usage: npx tsx ralph-loop-copilot.ts [options]
//   --iterations=N    Max iterations (default: 5)
//   --delay=N         Delay between iterations in ms (default: 1000)
//   --model=NAME      Model to use (default: claude-sonnet-4-5)
//   --verbose         Enable verbose output
//   --log=FILE        Write logs to file
//   --prompt=FILE     Prompt file path (default: PROMPT.md)
//   --no-streaming    Disable streaming mode
//
// Available models (via Copilot):
// - gpt-5.2-codex
// - gpt-5.2
// - claude-sonnet-4.5
// - claude-haiku-4.5
// - claude-opus-4.5
// - gemini-3-pro-preview

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
    } else if (arg === "--no-streaming") {
      config.streaming = false;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
ralph-loop-copilot - Run GitHub Copilot agents in a loop

Usage: npx tsx ralph-loop-copilot.ts [options]

Options:
  --iterations=N    Max iterations (default: 5)
  --delay=N         Delay between iterations in ms (default: 1000)
  --model=NAME      Model to use (default: gpt-4o)
  --prompt=FILE     Prompt file path (default: PROMPT.md)
  --verbose, -v     Enable verbose output (show full tool inputs)
  --log=FILE        Write logs to file in addition to console
  --no-streaming    Disable streaming mode
  --help, -h        Show this help message

Models (via Copilot):
  gpt-5.2-codex
  gpt-5.2
  gpt-5-mini
  claude-sonnet-4.5
  claude-haiku-4.5
  claude-opus-4.5
  gemini-3-pro-preview
`);
      process.exit(0);
    }
  }

  return config;
}

let currentIteration = 0;
const config = parseArgs(process.argv.slice(2));
ralphLoop(config);

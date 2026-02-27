import { query } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "fs";
import * as path from "path";

interface RalphLoopConfig {
  maxIterations: number;
  delayMs: number;
  promptFile?: string;
  model?: string;
  verbose?: boolean;
  logFile?: string;
  cwd?: string;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

interface RunStats {
  toolCalls: Record<string, number>;
  subagentsSpawned: number;
  compactions: number;
  iterations: number;
  startTime: number;
  tokens: TokenUsage;
}

const DEFAULT_CONFIG: RalphLoopConfig = {
  maxIterations: 5,
  delayMs: 5000,
  promptFile: "PROMPT.md",
  model: "claude-sonnet-4-6@default",
  verbose: false,
  logFile: undefined,
  cwd: undefined,
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

function log(prefix: string, msg: string, forceShow = false): void {
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
    logFileStream.write(`[${ts}][${currentIteration}] ${prefix} ${msg}\n`);
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}

function formatToolContext(toolName: string, input: Record<string, unknown> | undefined): string {
  if (!input) return "";

  switch (toolName) {
    case "Read":
      return input.file_path ? ` → ${basename(String(input.file_path))}` : "";
    case "Write":
      return input.file_path ? ` → ${basename(String(input.file_path))}` : "";
    case "Edit":
      return input.file_path ? ` → ${basename(String(input.file_path))}` : "";
    case "MultiEdit":
      return input.file_path ? ` → ${basename(String(input.file_path))}` : "";
    case "Bash":
      return input.command ? ` → ${truncate(String(input.command), 80)}` : "";
    case "Glob":
      return input.pattern ? ` → ${String(input.pattern)}` : "";
    case "Grep":
      return input.pattern ? ` → "${truncate(String(input.pattern), 80)}"` : "";
    case "WebFetch":
      return input.url ? ` → ${truncate(String(input.url), 80)}` : "";
    case "WebSearch":
      return input.query ? ` → "${truncate(String(input.query), 80)}"` : "";
    case "NotebookEdit":
      return input.notebook_path ? ` → ${basename(String(input.notebook_path))}` : "";
    default:
      return "";
  }
}

function basename(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

function initStats(): RunStats {
  return {
    toolCalls: {},
    subagentsSpawned: 0,
    compactions: 0,
    iterations: 0,
    startTime: Date.now(),
    tokens: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
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
  const totalTokens = stats.tokens.inputTokens + stats.tokens.outputTokens;

  log("📊", "=== Run Statistics ===");
  log("📊", `Total iterations: ${stats.iterations}`);
  log("📊", `Subagents spawned: ${stats.subagentsSpawned}`);
  log("📊", `Context compactions: ${stats.compactions}`);
  log("📊", `Elapsed time: ${elapsed}`);

  log("📊", "Token usage:");
  log("📊", `  Input tokens:  ${formatNumber(stats.tokens.inputTokens)}`);
  log("📊", `  Output tokens: ${formatNumber(stats.tokens.outputTokens)}`);
  log("📊", `  Total tokens:  ${formatNumber(totalTokens)}`);
  if (stats.tokens.cacheReadTokens > 0 || stats.tokens.cacheCreationTokens > 0) {
    log("📊", `  Cache read:    ${formatNumber(stats.tokens.cacheReadTokens)}`);
    log("📊", `  Cache created: ${formatNumber(stats.tokens.cacheCreationTokens)}`);
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

  const promptDir = path.dirname(promptPath);

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

    for await (const message of query({
      prompt,
      options: {
        permissionMode: "bypassPermissions",
        model: cfg.model,
        cwd: cfg.cwd,
        executable: "node",
        settingSources: ["project", "user"],
        allowedTools: [
          "Task", "Bash", "Glob", "Grep", "LS", "ExitPlanMode", "Read", "Edit", "MultiEdit", "Write", "NotebookEdit",
          "WebFetch", "TodoWrite", "WebSearch", "BashOutput", "KillBash"
        ]
      },
    })) {
      // Handle compaction events
      if (message.type === "system" && (message as { subtype?: string }).subtype === "compact_boundary") {
        stats.compactions++;
        const meta = (message as { compact_metadata?: { trigger?: string; pre_tokens?: number } }).compact_metadata;
        const trigger = meta?.trigger || "unknown";
        const preTokens = meta?.pre_tokens ? formatNumber(meta.pre_tokens) : "?";
        log("⚠️", `Context compaction #${stats.compactions} (${trigger}, ${preTokens} tokens before)`);
      }

      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block) {
            log("💬", block.text);
          } else if ("name" in block) {
            const toolName = block.name;
            stats.toolCalls[toolName] = (stats.toolCalls[toolName] || 0) + 1;

            if (toolName === "Task") {
              stats.subagentsSpawned++;
              const input = block.input as Record<string, unknown> | undefined;
              const desc = input?.description || input?.prompt?.toString().slice(0, 50) || "unnamed";
              const agentType = input?.subagent_type || "unknown";
              log("📦", `Spawning subagent [${agentType}]: ${desc}`);
              logVerbose("📦", `Full input: ${JSON.stringify(input)}`, cfg.verbose!);
            } else {
              const input = block.input as Record<string, unknown> | undefined;
              const inputStr = input ? JSON.stringify(input) : "";
              const context = formatToolContext(toolName, input);
              log("🔧", `${toolName}${context}`);
              logVerbose("🔧", `${toolName} input: ${truncate(inputStr, 200)}`, cfg.verbose!);
            }
          }
        }
      } else if (message.type === "result") {
        const subtype = (message as { subtype?: string }).subtype || "unknown";
        log("✅", `Completed: ${subtype}`);

        // Capture token usage from result
        const result = message as {
          subtype?: string;
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          };
          totalUsage?: {
            inputTokens?: number;
            outputTokens?: number;
            cacheReadInputTokens?: number;
            cacheCreationInputTokens?: number;
          };
        };

        if (result.usage) {
          stats.tokens.inputTokens += result.usage.input_tokens || 0;
          stats.tokens.outputTokens += result.usage.output_tokens || 0;
          stats.tokens.cacheReadTokens += result.usage.cache_read_input_tokens || 0;
          stats.tokens.cacheCreationTokens += result.usage.cache_creation_input_tokens || 0;
        } else if (result.totalUsage) {
          stats.tokens.inputTokens += result.totalUsage.inputTokens || 0;
          stats.tokens.outputTokens += result.totalUsage.outputTokens || 0;
          stats.tokens.cacheReadTokens += result.totalUsage.cacheReadInputTokens || 0;
          stats.tokens.cacheCreationTokens += result.totalUsage.cacheCreationInputTokens || 0;
        }
      }

      // Also check for usage on assistant messages
      if (message.type === "assistant") {
        const assistantMsg = message as {
          message?: {
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            };
          };
        };
        if (assistantMsg.message?.usage) {
          stats.tokens.inputTokens += assistantMsg.message.usage.input_tokens || 0;
          stats.tokens.outputTokens += assistantMsg.message.usage.output_tokens || 0;
          stats.tokens.cacheReadTokens += assistantMsg.message.usage.cache_read_input_tokens || 0;
          stats.tokens.cacheCreationTokens += assistantMsg.message.usage.cache_creation_input_tokens || 0;
        }
      }
    }

    if (i < cfg.maxIterations - 1) {
      log("⏳", `Waiting ${cfg.delayMs}ms before next iteration...`);
      await sleep(cfg.delayMs);
    }
  }

  log("🏁", "=== Ralph loop complete ===");
  printStats(stats);
  closeLogFile();
}

// CLI usage: npx tsx ralph-loop-claude.ts [options]
//   --iterations=N    Max iterations (default: 5)
//   --delay=N         Delay between iterations in ms (default: 5000)
//   --model=NAME      Model to use (default: claude-sonnet-4-6@default)
//   --verbose         Enable verbose output
//   --log=FILE        Write logs to file
//   --prompt=FILE     Prompt file path (default: PROMPT.md)
//
// Using Vertex AI model names:
// - claude-3-5-haiku@20241022 or claude-haiku-4-5@20251001
// - claude-sonnet-4-6@default
// - claude-opus-4-6@default

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
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
ralph-loop-claude - Run Claude agents in a loop

Usage: npx tsx ralph-loop-claude.ts [options]

Options:
  --iterations=N    Max iterations (default: 5)
  --delay=N         Delay between iterations in ms (default: 5000)
  --model=NAME      Model to use (default: claude-sonnet-4-6@default)
  --prompt=FILE     Prompt file path (default: PROMPT.md, relative to --cwd if set)
  --cwd=DIR         Working directory for Claude tools and prompt file
  --verbose, -v     Enable verbose output (show full tool inputs)
  --log=FILE        Write logs to file in addition to console
  --help, -h        Show this help message

Models (Vertex AI):
  claude-sonnet-4-6@default   (default)
  claude-opus-4-6@default
  claude-haiku-4-5@20251001
`);
      process.exit(0);
    }
  }

  return config;
}

let currentIteration = 0;
const config = parseArgs(process.argv.slice(2));
ralphLoop(config);

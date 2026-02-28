import { query, type Query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { EventEmitter } from "events";
import * as dns from "dns";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface RalphLoopConfig {
  maxIterations: number;
  delayMs: number;
  promptFile?: string;
  model?: string;
  verbose?: boolean;
  logFile?: string;
  cwd?: string;
}

interface DashboardConfig extends RalphLoopConfig {
  port: number;
  host: string;
  maxCostUsd?: number;
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
  costUsd: number;
}

type EngineState = "idle" | "running" | "stopping" | "stopped";

interface LogEntry {
  ts: string;
  iteration: number;
  prefix: string;
  msg: string;
  level: "info" | "tool" | "error" | "steer" | "system" | "agent";
}

interface IterationTokenSummary {
  iteration: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

interface SteeringItem {
  id: string;
  prompt: string;
  method: "mid-iteration" | "between-iterations";
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}

function basename(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
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

function formatToolContext(toolName: string, input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit":
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

// ─── File Logging ─────────────────────────────────────────────────────────────

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

function writeToLogFile(line: string): void {
  if (logFileStream) {
    logFileStream.write(line + "\n");
  }
}

// ─── LoopEngine ───────────────────────────────────────────────────────────────

class LoopEngine extends EventEmitter {
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAY_MS = 10_000;

  state: EngineState = "idle";
  currentIteration = 0;
  stats: RunStats;
  steeringQueue: SteeringItem[] = [];
  iterationHistory: IterationTokenSummary[] = [];

  private currentQuery: Query | null = null;
  private sessionId: string | null = null;
  private steeringJustInjected = false;
  private cfg: DashboardConfig;
  private prompt: string;
  private promptDir: string;
  private iterationTokensSnapshot: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  private iterationCostSnapshot = 0;

  constructor(cfg: DashboardConfig, prompt: string, promptDir: string) {
    super();
    this.cfg = cfg;
    this.prompt = prompt;
    this.promptDir = promptDir;
    this.stats = {
      toolCalls: {},
      subagentsSpawned: 0,
      compactions: 0,
      iterations: 0,
      startTime: Date.now(),
      tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      costUsd: 0,
    };
  }

  private setState(s: EngineState): void {
    this.state = s;
    this.emit("state", s);
  }

  /** Check if engine is stopping/stopped — avoids TS narrowing issues since state is mutated externally */
  private get shouldStop(): boolean {
    return this.state === "stopping" || this.state === "stopped";
  }

  private log(prefix: string, msg: string, level: LogEntry["level"] = "info"): void {
    const ts = new Date().toISOString().slice(11, 23);
    const entry: LogEntry = { ts, iteration: this.currentIteration, prefix, msg, level };
    const line = `[${ts}][${this.currentIteration}] ${prefix} ${msg}`;
    console.log(line);
    writeToLogFile(line);
    this.emit("log", entry);
  }

  private logVerbose(prefix: string, msg: string, level: LogEntry["level"] = "info"): void {
    if (this.cfg.verbose) {
      this.log(prefix, msg, level);
    } else {
      const ts = new Date().toISOString().slice(11, 23);
      writeToLogFile(`[${ts}][${this.currentIteration}] ${prefix} ${msg}`);
    }
  }

  private isTransientError(err: unknown): boolean {
    const msg = String(err).toLowerCase();
    const networkPatterns = [
      "enotfound", "econnrefused", "econnreset", "etimedout", "epipe",
      "socket hang up", "network", "getaddrinfo",
    ];
    if (networkPatterns.some((p) => msg.includes(p))) return true;

    // HTTP status codes embedded in error messages
    const httpMatch = msg.match(/\b(429|500|502|503|504)\b/);
    if (httpMatch) return true;

    return false;
  }

  private async healthCheck(): Promise<void> {
    const { MAX_RETRIES, RETRY_DELAY_MS } = LoopEngine;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await dns.promises.resolve("oauth2.googleapis.com");
        return; // DNS resolved successfully
      } catch (err) {
        this.log("⚠️", `Health check failed (attempt ${attempt}/${MAX_RETRIES}): ${err}`, "error");
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * attempt;
          this.log("⏳", `Waiting ${delay}ms before next health check...`, "system");
          await sleep(delay);
        } else {
          this.log("⚠️", `Health check failed after ${MAX_RETRIES} attempts, proceeding anyway`, "error");
        }
      }
    }
  }

  async start(): Promise<void> {
    this.setState("running");
    this.log("🚀", `Starting ralph loop: max ${this.cfg.maxIterations} iterations, ${this.cfg.delayMs}ms delay`, "system");
    this.log("🤖", `Model: ${this.cfg.model}`, "system");
    if (this.cfg.cwd) this.log("📂", `Working directory: ${this.cfg.cwd}`, "system");
    this.log("📝", `Prompt: ${this.cfg.promptFile}`, "system");
    this.log("🌐", `Dashboard: http://${this.cfg.host}:${this.cfg.port}`, "system");
    if (this.cfg.maxCostUsd !== undefined) {
      this.log("💰", `Cost budget: $${this.cfg.maxCostUsd.toFixed(2)}`, "system");
    }

    try {
      await this.runLoop();
    } catch (err) {
      this.log("❌", `Loop error: ${err}`, "error");
    } finally {
      this.setState("stopped");
      this.log("🏁", "=== Ralph loop complete ===", "system");
      this.printStats();
      this.emit("stats", this.stats);
    }
  }

  stop(): void {
    if (this.state === "running") {
      this.setState("stopping");
      this.log("🛑", "Stopping loop...", "system");
      if (this.currentQuery) {
        this.currentQuery.close();
        this.currentQuery = null;
      }
    }
  }

  queueSteering(prompt: string): SteeringItem {
    const item: SteeringItem = {
      id: crypto.randomUUID(),
      prompt,
      method: this.currentQuery ? "mid-iteration" : "between-iterations",
    };
    this.steeringQueue.push(item);
    this.log("🎯", `Steering queued: "${truncate(prompt, 80)}" [${item.method}]`, "steer");
    this.emit("steer-ack", item);
    return item;
  }

  changeModel(model: string): void {
    this.cfg.model = model;
    this.log("🔄", `Model changed to: ${model} (takes effect next iteration)`, "system");
    this.emit("model-change", { model });
  }

  /** Drain steering queue, interrupt the running query, and inject steering via streamInput. */
  private async injectSteering(queryRef: Query): Promise<void> {
    const items = this.steeringQueue.splice(0);
    if (items.length === 0) return;

    const combinedPrompt = items.map((i) => i.prompt).join("\n\n");

    try {
      this.log("🎯", `Interrupting for mid-iteration steering...`, "steer");
      await queryRef.interrupt();
      this.log("🎯", `Interrupt acknowledged, injecting steering prompt`, "steer");

      const sessionId = this.sessionId || "";

      async function* yieldMessages(): AsyncGenerator<SDKUserMessage> {
        yield {
          type: "user" as const,
          message: {
            role: "user" as const,
            content: `[STEERING FROM DASHBOARD]\n\n${combinedPrompt}`,
          },
          parent_tool_use_id: null,
          session_id: sessionId,
        };
      }

      await queryRef.streamInput(yieldMessages());
      this.steeringJustInjected = true;
      this.log("🎯", `Steering injected successfully`, "steer");
    } catch (err) {
      this.log("❌", `Steering failed: ${err}`, "error");
      this.steeringQueue.unshift(...items);
    }
  }

  private async runLoop(): Promise<void> {
    for (let i = 0; i < this.cfg.maxIterations; i++) {
      if (this.shouldStop) break;

      // Check signal files
      const doneFile = path.join(this.promptDir, "ralph.done");
      const blockedFile = path.join(this.promptDir, "ralph.blocked");

      if (fs.existsSync(doneFile)) {
        this.log("🏁", `Found ${doneFile} - stopping loop`, "system");
        break;
      }
      if (fs.existsSync(blockedFile)) {
        this.log("🚫", `Found ${blockedFile} - stopping loop`, "system");
        break;
      }

      this.stats.iterations++;
      this.currentIteration = i + 1;
      this.emit("iteration", { current: this.currentIteration, max: this.cfg.maxIterations });
      this.log("🔄", `=== Iteration ${i + 1}/${this.cfg.maxIterations} ===`, "system");

      // Snapshot tokens/cost before iteration for per-iteration delta
      this.iterationTokensSnapshot = { ...this.stats.tokens };
      this.iterationCostSnapshot = this.stats.costUsd;

      // Build prompt — prepend any queued steering
      let iterationPrompt = this.prompt;
      if (this.steeringQueue.length > 0) {
        const pending = this.steeringQueue.splice(0);
        const steerText = pending.map((s) => s.prompt).join("\n\n");
        iterationPrompt = `${steerText}\n\n---\n\n${this.prompt}`;
        this.log("🎯", `Prepended ${pending.length} steering directive(s) to prompt`, "steer");
      }

      // Pre-iteration health check
      await this.healthCheck();

      const { MAX_RETRIES, RETRY_DELAY_MS } = LoopEngine;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        // Fresh session each attempt
        this.sessionId = null;
        this.currentQuery = query({
          prompt: iterationPrompt,
          options: {
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
            model: this.cfg.model,
            cwd: this.cfg.cwd,
            executable: "node",
            settingSources: ["project", "user"],
            allowedTools: [
              "Task", "Bash", "Glob", "Grep", "LS", "ExitPlanMode", "Read", "Edit", "MultiEdit", "Write",
              "NotebookEdit", "WebFetch", "TodoWrite", "WebSearch", "BashOutput", "KillBash",
            ],
          },
        });

        try {
          for await (const message of this.currentQuery) {
            if (this.shouldStop) break;

            this.processMessage(message);

            // Mid-iteration steering: interrupt + inject, then continue receiving messages
            if (this.steeringQueue.length > 0 && this.state === "running" && this.currentQuery) {
              await this.injectSteering(this.currentQuery);
            }
          }
          break; // Success — exit retry loop
        } catch (err) {
          if (this.shouldStop) break;

          if (this.isTransientError(err) && attempt < MAX_RETRIES) {
            const delay = RETRY_DELAY_MS * attempt;
            this.log("⚠️", `Transient error on iteration ${i + 1}, attempt ${attempt}/${MAX_RETRIES}: ${err}`, "error");
            this.emit("retry", { iteration: this.currentIteration, attempt, maxRetries: MAX_RETRIES, error: String(err) });
            this.log("⏳", `Retrying in ${delay}ms...`, "system");
            await sleep(delay);
          } else {
            this.log("❌", `Iteration ${i + 1} error (attempt ${attempt}/${MAX_RETRIES}): ${err}`, "error");
            break; // Non-transient or retries exhausted
          }
        } finally {
          this.currentQuery = null;
          this.sessionId = null;
        }
      }

      // Record per-iteration token summary
      const summary: IterationTokenSummary = {
        iteration: this.currentIteration,
        inputTokens: this.stats.tokens.inputTokens - this.iterationTokensSnapshot.inputTokens,
        outputTokens: this.stats.tokens.outputTokens - this.iterationTokensSnapshot.outputTokens,
        cost: this.stats.costUsd - this.iterationCostSnapshot,
      };
      this.iterationHistory.push(summary);
      this.emit("iteration-summary", summary);

      if (this.shouldStop) break;

      // Cost budget check
      if (this.cfg.maxCostUsd !== undefined && this.stats.costUsd >= this.cfg.maxCostUsd) {
        this.log("💰", `Cost budget exceeded: $${this.stats.costUsd.toFixed(4)} >= $${this.cfg.maxCostUsd.toFixed(2)} — stopping loop`, "system");
        break;
      }

      if (i < this.cfg.maxIterations - 1) {
        this.log("⏳", `Waiting ${this.cfg.delayMs}ms before next iteration...`, "system");
        await sleep(this.cfg.delayMs);
      }
    }
  }

  private processMessage(message: SDKMessage): void {
    // Capture session_id from any message
    if ("session_id" in message && message.session_id) {
      this.sessionId = message.session_id as string;
    }

    // Compaction events
    if (message.type === "system" && (message as { subtype?: string }).subtype === "compact_boundary") {
      this.stats.compactions++;
      const meta = (message as { compact_metadata?: { trigger?: string; pre_tokens?: number } }).compact_metadata;
      const trigger = meta?.trigger || "unknown";
      const preTokens = meta?.pre_tokens ? formatNumber(meta.pre_tokens) : "?";
      this.log("⚠️", `Context compaction #${this.stats.compactions} (${trigger}, ${preTokens} tokens before)`, "system");
    }

    if (message.type === "assistant" && message.message?.content) {
      for (const block of message.message.content) {
        if ("text" in block && typeof block.text === "string") {
          this.log("💬", block.text, "agent");
        } else if ("name" in block && typeof block.name === "string") {
          const toolName = block.name;
          this.stats.toolCalls[toolName] = (this.stats.toolCalls[toolName] || 0) + 1;

          if (toolName === "Task") {
            this.stats.subagentsSpawned++;
            const input = block.input as Record<string, unknown> | undefined;
            const desc = input?.description || input?.prompt?.toString().slice(0, 50) || "unnamed";
            const agentType = input?.subagent_type || "unknown";
            this.log("📦", `Spawning subagent [${agentType}]: ${desc}`, "tool");
            this.logVerbose("📦", `Full input: ${JSON.stringify(input)}`, "tool");
          } else {
            const input = block.input as Record<string, unknown> | undefined;
            const context = formatToolContext(toolName, input);
            this.log("🔧", `${toolName}${context}`, "tool");
            this.logVerbose("🔧", `${toolName} input: ${truncate(JSON.stringify(input || {}), 200)}`, "tool");
          }

          this.emit("tool", { name: toolName, context: formatToolContext(toolName, block.input as Record<string, unknown>), iteration: this.currentIteration });
        }
      }

    } else if (message.type === "result") {
      const subtype = (message as { subtype?: string }).subtype || "unknown";
      if (subtype === "error_during_execution" && this.steeringJustInjected) {
        this.steeringJustInjected = false;
        this.log("🔄", `Interrupted (steering)`, "steer");
      } else {
        this.log("✅", `Completed: ${subtype}`, "system");
      }

      const result = message as {
        subtype?: string;
        total_cost_usd?: number;
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
        totalUsage?: { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number };
      };

      if (result.total_cost_usd) {
        this.stats.costUsd += result.total_cost_usd;
      }

      if (result.usage) {
        this.stats.tokens.inputTokens += result.usage.input_tokens || 0;
        this.stats.tokens.outputTokens += result.usage.output_tokens || 0;
        this.stats.tokens.cacheReadTokens += result.usage.cache_read_input_tokens || 0;
        this.stats.tokens.cacheCreationTokens += result.usage.cache_creation_input_tokens || 0;
      } else if (result.totalUsage) {
        this.stats.tokens.inputTokens += result.totalUsage.inputTokens || 0;
        this.stats.tokens.outputTokens += result.totalUsage.outputTokens || 0;
        this.stats.tokens.cacheReadTokens += result.totalUsage.cacheReadInputTokens || 0;
        this.stats.tokens.cacheCreationTokens += result.totalUsage.cacheCreationInputTokens || 0;
      }

      this.emit("stats", this.stats);
    }
  }

  private printStats(): void {
    const elapsed = formatElapsed(Date.now() - this.stats.startTime);
    const totalTokens = this.stats.tokens.inputTokens + this.stats.tokens.outputTokens;

    this.log("📊", "=== Run Statistics ===", "system");
    this.log("📊", `Total iterations: ${this.stats.iterations}`, "system");
    this.log("📊", `Subagents spawned: ${this.stats.subagentsSpawned}`, "system");
    this.log("📊", `Context compactions: ${this.stats.compactions}`, "system");
    this.log("📊", `Elapsed time: ${elapsed}`, "system");
    this.log("📊", `Total cost: $${this.stats.costUsd.toFixed(4)}`, "system");

    this.log("📊", "Token usage:", "system");
    this.log("📊", `  Input tokens:  ${formatNumber(this.stats.tokens.inputTokens)}`, "system");
    this.log("📊", `  Output tokens: ${formatNumber(this.stats.tokens.outputTokens)}`, "system");
    this.log("📊", `  Total tokens:  ${formatNumber(totalTokens)}`, "system");
    if (this.stats.tokens.cacheReadTokens > 0 || this.stats.tokens.cacheCreationTokens > 0) {
      this.log("📊", `  Cache read:    ${formatNumber(this.stats.tokens.cacheReadTokens)}`, "system");
      this.log("📊", `  Cache created: ${formatNumber(this.stats.tokens.cacheCreationTokens)}`, "system");
    }

    this.log("📊", "Tool usage:", "system");
    const sorted = Object.entries(this.stats.toolCalls).sort((a, b) => b[1] - a[1]);
    for (const [tool, count] of sorted) {
      this.log("📊", `  ${tool}: ${count}`, "system");
    }
  }
}

// ─── HttpDashboardServer ──────────────────────────────────────────────────────

class HttpDashboardServer {
  private server: http.Server;
  private sseClients: Set<http.ServerResponse> = new Set();
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private eventCount = 0;
  private engine: LoopEngine;
  private cfg: DashboardConfig;

  constructor(engine: LoopEngine, cfg: DashboardConfig) {
    this.engine = engine;
    this.cfg = cfg;
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.wireEngineEvents();
  }

  private wireEngineEvents(): void {
    this.engine.on("log", (entry: LogEntry) => this.broadcast("log", entry));
    this.engine.on("state", (state: string) => this.broadcast("state", { state }));
    this.engine.on("stats", (stats: RunStats) => this.broadcast("stats", stats));
    this.engine.on("iteration", (data: { current: number; max: number }) => this.broadcast("iteration", data));
    this.engine.on("tool", (data: { name: string; context: string; iteration: number }) => this.broadcast("tool", data));
    this.engine.on("steer-ack", (data: SteeringItem) => this.broadcast("steer-ack", data));
    this.engine.on("iteration-summary", (data: IterationTokenSummary) => this.broadcast("iteration-summary", data));
    this.engine.on("model-change", (data: { model: string }) => this.broadcast("model-change", data));
    this.engine.on("retry", (data: { iteration: number; attempt: number; maxRetries: number; error: string }) => this.broadcast("retry", data));
  }

  private broadcast(event: string, data: unknown): void {
    this.eventCount++;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || "/";
    const method = req.method || "GET";

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === "GET" && url === "/") {
      this.serveDashboard(res);
    } else if (method === "GET" && url === "/api/state") {
      this.serveState(res);
    } else if (method === "GET" && url === "/api/events") {
      this.serveSSE(req, res);
    } else if (method === "POST" && url === "/api/steer") {
      this.handleSteer(req, res);
    } else if (method === "POST" && url === "/api/stop") {
      this.engine.stop();
      this.jsonResponse(res, 200, { ok: true, state: this.engine.state });
    } else if (method === "POST" && url === "/api/model") {
      this.handleModelChange(req, res);
    } else {
      this.jsonResponse(res, 404, { error: "Not found" });
    }
  }

  private serveDashboard(res: http.ServerResponse): void {
    const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "ralph-dashboard.html");
    try {
      const html = fs.readFileSync(htmlPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Failed to load dashboard: ${err}`);
    }
  }

  private serveState(res: http.ServerResponse): void {
    this.jsonResponse(res, 200, {
      state: this.engine.state,
      iteration: { current: this.engine.currentIteration, max: this.cfg.maxIterations },
      stats: this.engine.stats,
      config: {
        model: this.cfg.model,
        maxIterations: this.cfg.maxIterations,
        delayMs: this.cfg.delayMs,
        promptFile: this.cfg.promptFile,
        cwd: this.cfg.cwd,
        maxCostUsd: this.cfg.maxCostUsd,
      },
      iterationHistory: this.engine.iterationHistory,
    });
  }

  private serveSSE(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Send current state immediately
    res.write(`event: state\ndata: ${JSON.stringify({ state: this.engine.state })}\n\n`);
    res.write(`event: iteration\ndata: ${JSON.stringify({ current: this.engine.currentIteration, max: this.cfg.maxIterations })}\n\n`);
    res.write(`event: stats\ndata: ${JSON.stringify(this.engine.stats)}\n\n`);

    // Send iteration history for chart
    if (this.engine.iterationHistory.length > 0) {
      res.write(`event: iteration-history\ndata: ${JSON.stringify(this.engine.iterationHistory)}\n\n`);
    }

    this.sseClients.add(res);

    req.on("close", () => {
      this.sseClients.delete(res);
    });
  }

  private handleModelChange(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        const { model } = JSON.parse(body);
        if (!model || typeof model !== "string") {
          this.jsonResponse(res, 400, { error: "Missing 'model' string in body" });
          return;
        }
        this.engine.changeModel(model.trim());
        this.jsonResponse(res, 200, { ok: true, model: model.trim() });
      } catch {
        this.jsonResponse(res, 400, { error: "Invalid JSON body" });
      }
    });
  }

  private handleSteer(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        const { prompt } = JSON.parse(body);
        if (!prompt || typeof prompt !== "string") {
          this.jsonResponse(res, 400, { error: "Missing 'prompt' string in body" });
          return;
        }
        const item = this.engine.queueSteering(prompt);
        this.jsonResponse(res, 200, { ok: true, ...item });
      } catch {
        this.jsonResponse(res, 400, { error: "Invalid JSON body" });
      }
    });
  }

  private jsonResponse(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server.listen(this.cfg.port, this.cfg.host, () => {
        console.log(`Dashboard running at http://${this.cfg.host}:${this.cfg.port}`);
        resolve();
      });
    });

    this.keepAliveInterval = setInterval(() => {
      this.broadcast("keepalive", {});
    }, 15000);
  }

  async close(): Promise<void> {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}

// ─── RalphController ──────────────────────────────────────────────────────────

class RalphController {
  private engine: LoopEngine;
  private server: HttpDashboardServer;
  private cfg: DashboardConfig;

  constructor(cfg: DashboardConfig) {
    this.cfg = cfg;

    const promptPath = cfg.cwd ? path.resolve(cfg.cwd, cfg.promptFile!) : cfg.promptFile!;
    if (!fs.existsSync(promptPath)) {
      throw new Error(`Prompt file not found: ${promptPath}`);
    }
    const prompt = fs.readFileSync(promptPath, "utf-8").trim();
    const promptDir = path.dirname(promptPath);

    if (cfg.logFile) {
      initLogFile(cfg.logFile);
    }

    this.engine = new LoopEngine(cfg, prompt, promptDir);
    this.server = new HttpDashboardServer(this.engine, cfg);
  }

  async run(): Promise<void> {
    // Graceful shutdown
    const shutdown = () => {
      console.log("\nShutting down...");
      this.engine.stop();
      this.server.close().then(() => {
        closeLogFile();
        process.exit(0);
      });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await this.server.listen();
    await this.engine.start();

    // Engine finished naturally
    await this.server.close();
    closeLogFile();
    process.exit(0);
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(args: string[]): DashboardConfig {
  const cfg: DashboardConfig = {
    maxIterations: 5,
    delayMs: 5000,
    promptFile: "PROMPT.md",
    model: "claude-sonnet-4-6@default",
    verbose: false,
    logFile: undefined,
    cwd: undefined,
    port: 3333,
    host: "127.0.0.1",
  };

  for (const arg of args) {
    if (arg.startsWith("--iterations=")) {
      cfg.maxIterations = parseInt(arg.split("=")[1]);
    } else if (arg.startsWith("--delay=")) {
      cfg.delayMs = parseInt(arg.split("=")[1]);
    } else if (arg.startsWith("--model=")) {
      cfg.model = arg.split("=")[1];
    } else if (arg === "--verbose" || arg === "-v") {
      cfg.verbose = true;
    } else if (arg.startsWith("--log=")) {
      cfg.logFile = arg.split("=")[1];
    } else if (arg.startsWith("--prompt=")) {
      cfg.promptFile = arg.split("=")[1];
    } else if (arg.startsWith("--cwd=")) {
      cfg.cwd = arg.split("=")[1];
    } else if (arg.startsWith("--port=")) {
      cfg.port = parseInt(arg.split("=")[1]);
    } else if (arg.startsWith("--host=")) {
      cfg.host = arg.split("=")[1];
    } else if (arg.startsWith("--max-cost=")) {
      cfg.maxCostUsd = parseFloat(arg.split("=")[1]);
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
ralph-loop-dashboard - Run Claude agents in a loop with a live dashboard

Usage: npx tsx ralph-loop-dashboard.ts [options]

Options:
  --port=N        Dashboard port (default: 3333)
  --host=ADDR     Dashboard host (default: 127.0.0.1)
  --iterations=N  Max iterations (default: 5)
  --delay=N       Delay between iterations in ms (default: 5000)
  --model=NAME    Model to use (default: claude-sonnet-4-6@default)
  --prompt=FILE   Prompt file path (default: PROMPT.md)
  --cwd=DIR       Working directory for Claude tools and prompt file
  --max-cost=N    Stop loop when cost exceeds N USD
  --verbose, -v   Enable verbose output
  --log=FILE      Write logs to file
  --help, -h      Show this help message

Models (Vertex AI):
  claude-sonnet-4-6@default   (default)
  claude-opus-4-6@default
  claude-haiku-4-5@20251001
`);
      process.exit(0);
    }
  }

  return cfg;
}

const config = parseArgs(process.argv.slice(2));
const controller = new RalphController(config);
controller.run();

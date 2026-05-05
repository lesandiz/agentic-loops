# Plan: Upgrade ralph-loop-claude-dashboard to SDK v0.2.126 Features

## Context

The Claude Agent SDK (v0.2.126, already installed) has added several capabilities since the dashboard was written. This upgrade surfaces new observability events, adds subprocess pre-warming, and enables real-time subagent streaming — all of which improve the dashboard's value as a production monitoring tool.

**Design constraint preserved:** Every iteration starts with a fresh, clean context window. No session resume. No human-interaction tools (AskUserQuestion).

## Files to modify

- `ralph-loop-claude-dashboard.ts` — engine + server changes
- `ralph-claude-dashboard.html` — UI changes for new events

---

## Change 1: Add Opus 4.7 to model list
*Trivial, zero risk*

**TS** (`ralph-loop-claude-dashboard.ts`):
- Update help text (line ~851): add `claude-opus-4-7@default` as first model entry

**HTML** (`ralph-claude-dashboard.html`):
- Add `opus-4.7` preset button before the existing three buttons in the model presets section

---

## Change 2: Surface new system message subtypes

Add three new handlers to `processMessage()` after the existing `compact_boundary` handler (line ~457). Each logs the event and emits an SSE-broadcast event.

### 2a: `api_retry` — SDK-internal retry visibility
```
subtype: 'api_retry' → log attempt/max_retries/error_status/delay
emit "retry" event with source: "sdk" (existing loop retries get source: "loop")
```
- Also add `source: "loop"` to the existing retry emission at line ~406
- Add `retry` SSE handler in HTML to render retry log entries

### 2b: `task_progress` — subagent progress
```
subtype: 'task_progress' → log task_id, description, usage (tokens/tool_uses/duration)
emit "task-progress" event
```
- Wire in `wireEngineEvents()`
- Add `task-progress` SSE handler in HTML (entries render via existing log handler)

### 2c: `status` — API activity indicator
```
subtype: 'status' → emit "status" event (no log, too transient)
status: 'requesting' | 'compacting' | null
```
- Wire in `wireEngineEvents()`
- HTML: add `<span id="statusIndicator">` in header next to state badge
- SSE handler shows "Requesting API..." / "Compacting context..." or hides on null

---

## Change 3: `terminal_reason` on result messages

In the result handler (line ~484), extract `terminal_reason` from the message. Log it as a suffix: `Completed: success [completed]`. Keeps the existing steering-interrupt check (`subtype === "error_during_execution" && steeringJustInjected`) intact.

---

## Change 4: `forwardSubagentText: true`

### 4a: Add option
Add `forwardSubagentText: true` to the query options object (line ~374). With Change 5 (startup), this moves into the startup options instead.

### 4b: Detect subagent messages in `processMessage()`
`SDKAssistantMessage` always has `parent_tool_use_id: string | null`. When non-null, the message is from a subagent.

In the `message.type === "assistant"` branch (line ~459):
- Check `message.parent_tool_use_id`
- Subagent text: log with `🤖` prefix and `[subagent]` tag
- Emit `subagent-text` SSE event

### 4c: HTML rendering
- CSS: `.log-entry.subagent` gets a left border + slight indent for visual nesting
- SSE handler for `subagent-text`: render in log with subagent styling

---

## Change 5: `startup()` pre-warm

### Rationale
`WarmQuery.query()` is single-use (confirmed in SDK types). The value is hiding subprocess startup latency (~1-2s) inside the inter-iteration delay. Pattern: fire `startup()` right after an iteration completes, so the subprocess warms during the delay period.

### 5a: Update imports (line 1)
Add `startup` and `type WarmQuery` to the import.

### 5b: Add fields to LoopEngine
```typescript
private warmQuery: WarmQuery | null = null;
private warmQueryStale = false;
```

### 5c: Extract shared options into a method
```typescript
private buildQueryOptions(): object { /* returns the options object currently inline at line ~374 */ }
```
This avoids duplicating options between `startup()` and the `query()` fallback.

### 5d: Add `ensureWarmQuery()` method
- If `warmQuery` exists and not stale, return it
- If stale, close old one
- Call `startup({ options: this.buildQueryOptions() })`
- Store and return

### 5e: Modify `runLoop()` iteration body
Replace inline `query()` call with:
```typescript
try {
  const warm = await this.ensureWarmQuery();
  this.currentQuery = warm.query(iterationPrompt);
} catch {
  // Fallback: direct query() if startup fails
  this.currentQuery = query({ prompt: iterationPrompt, options: this.buildQueryOptions() });
}
```

### 5f: Post-iteration pre-warm
After recording iteration stats (line ~427), before the delay sleep, fire startup for next iteration:
```typescript
// Pre-warm next iteration's subprocess during the delay
this.warmQuery = null; // consumed
if (i < this.cfg.maxIterations - 1 && !this.shouldStop) {
  this.ensureWarmQuery().catch(() => {}); // fire-and-forget, ensureWarmQuery handles errors
}
```

### 5g: Lifecycle cleanup
- `changeModel()`: set `this.warmQueryStale = true`
- `stop()`: close warmQuery if exists
- Retry loop `finally`: set `this.warmQuery = null` (consumed)

---

## Implementation order

1. **Change 1** (Opus 4.7) — independent, trivial
2. **Change 2** (system message subtypes) — independent, additive
3. **Change 3** (terminal_reason) — independent, small
4. **Change 4** (forwardSubagentText) — adds option + processMessage logic
5. **Change 5** (startup pre-warm) — refactors how query is created, touches same code as Change 4's option placement

Changes 1-4 can be done in any order. Change 5 should be last since it refactors the query creation path that Changes 2-4 also touch.

## Verification

1. **Type-check:** `npx tsc --noEmit ralph-loop-claude-dashboard.ts` (or `npx tsx --check`)
2. **Smoke test:** Run with `--iterations=2 --delay=5000` against a simple prompt to verify:
   - Pre-warm log line appears before first iteration
   - Subagent messages (if any) appear with `🤖` prefix
   - `terminal_reason` appears in completion log
   - Status indicator toggles in dashboard
   - Opus 4.7 button works in dashboard
3. **Model switch test:** Change model via dashboard during a run, verify next iteration uses new model and WarmQuery is recreated

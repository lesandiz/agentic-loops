---
name: ld-migration-metrics
description: Retrieve migration flag metrics (consistency, latency, error rate) from LaunchDarkly by navigating the dashboard with Playwright. Use when the user wants to check migration flag health, consistency rates, or compare old vs new system performance for any LD migration flag.
allowed-tools: Bash(playwright-cli:*), Read, Grep
---

# LaunchDarkly Migration Metrics Skill

Extracts migration flag metrics from the LaunchDarkly dashboard using Playwright browser automation. The LD public API does not expose consistency metrics for migration flags, so this skill scrapes them from the UI.

## Prerequisites

- **Playwright MCP Bridge extension** must be installed in the user's browser (Chrome/Edge)
  - Install from: https://chromewebstore.google.com/detail/playwright-mcp-bridge/mmlmfjhmonkocbjadbfplnigmagldckm
- The user must be **logged in to LaunchDarkly** in their browser
- The user's browser must be open

## Input

The skill accepts these arguments (space-separated):

1. **Flag key** (required) - e.g., `my-flag`
2. **Project key** (required) - e.g., `my-project`
3. **Environment** (optional, default: `production`) - e.g., `local`, `qa`, `staging`

### Example invocations

```
/ld-migration-metrics my-flag
/ld-migration-metrics my-flag my-project local
/ld-migration-metrics my-flag my-project staging
```

## Workflow

Follow these steps exactly:

### Step 1: Parse arguments

Parse the arguments from the skill invocation:

- Arg 1: `FLAG_KEY` (required - if missing, ask the user)
- Arg 2: `PROJECT_KEY` (required - if missing, ask the user)
- Arg 3: `ENVIRONMENT` (default: `production`)

Construct the URL:

```
https://app.launchdarkly.com/projects/{PROJECT_KEY}/flags/{FLAG_KEY}/targeting?env={ENVIRONMENT}&selected-env={ENVIRONMENT}
```

### Step 2: Connect to browser via extension

```bash
playwright-cli open --extension
```

If this fails with "Extension connection timeout", inform the user they need to:

1. Install the Playwright MCP Bridge extension
2. Have their browser open

### Step 3: Navigate to the flag page

```bash
playwright-cli goto {URL}
```

After navigation, check the page title:

- If the title is **"Sign in"**, inform the user they need to log in to LaunchDarkly in their browser first, then close the browser and stop.
- If the title contains the flag name, proceed.

### Step 4: Take a snapshot and save it

```bash
playwright-cli snapshot
```

Read the snapshot file to get the full page structure.

### Step 5: Extract metrics from the snapshot

The snapshot YAML contains the flag's targeting rules and migration metrics. The structure follows this pattern for each rule:

```yaml
- generic "{RuleName}" [ref=...]: # Rule container with name
    - heading "{RuleName}" [level=3] # Rule heading
    - generic "If cache key is one of..." # Rule clause
    - generic [ref=...]: # Metrics container
        - generic [ref=...]:
            - generic [ref=...]: { value } # Metric value (e.g., "99%", "-")
            - generic [ref=...]: Average consistency # Metric label
        - generic [ref=...]:
            - generic [ref=...]: { value } # Metric value (e.g., "- slower", "14% faster", "-")
            - generic [ref=...]: p99 latency # or "Difference between p99s"
        - generic [ref=...]:
            - generic [ref=...]: { value } # Metric value (e.g., "- higher", "-")
            - generic [ref=...]: Average error rate # Metric label
        - generic [ref=...]:
            - generic [ref=...]: Last 7 days # Time period
```

**To extract the data:**

1. Search the snapshot for all lines containing `Average consistency`, `p99 latency`, `Difference between p99s`, and `Average error rate`
2. For each match, the **metric value** is on the line immediately before the label line
3. Match each group of 3 metrics to their parent rule by finding the nearest preceding `heading` with `[level=3]`

**There is also a top-level "Consistency rate" section** before the rules. Look for:

```yaml
- heading "Consistency rate" [level=3]
  ...
  - text: {value}
  - paragraph: Average consistency
```

**Metric values to expect:**

- **Average consistency**: A percentage like `99%`, `87%`, `65%`, or `"-"` if no data
- **p99 latency**: Values like `"- slower"`, `"- higher"`, `"14% faster"`, `"7276%slower"`, `"17ms"`, or `"-"` if no data
- **Difference between p99s**: Same as p99 latency, just a different label format
- **Average error rate**: Values like `"- higher"`, `"- lower"`, or `"-"` if no data

**Rules that are set to `off` variation** (not in shadow/live mode) will typically show `"-"` for all three metrics since no dual-read comparison is happening.

### Step 6: Identify rule variations

For each rule, also extract the current rollout. Look for buttons within the rule section:

```yaml
- button "shadow 100%" [ref=...] # variation name and percentage
- button "off 0%" [ref=...]
```

The active variation is the one with a non-zero percentage.

### Step 7: Close the browser

```bash
playwright-cli close
```

### Step 8: Present the results

Output a markdown table with the following format:

```markdown
## Migration Metrics: {FLAG_KEY} ({ENVIRONMENT})

_Last 7 days_

| Rule           | Variation   | Avg Consistency | p99 Latency | Avg Error Rate |
| -------------- | ----------- | :-------------: | :---------: | :------------: |
| **{RuleName}** | {variation} |   **{value}**   |   {value}   |    {value}     |
| ...            | ...         |       ...       |     ...     |      ...       |
```

**Formatting rules:**

- Bold the rule name in the first column
- Bold the consistency percentage value
- Use `-` for metrics with no data
- Include the top-level overall metrics as the first row labelled "**Overall**"
- Include the default fallthrough as the last row labelled "**Default fallthrough**"
- Sort rules in the order they appear on the page

After the table, add a brief summary highlighting:

- Any rules with consistency below 95% (these need attention)
- Any rules showing notably higher error rates or slower latency
- Rules still on `off` that have no metrics

## Error Handling

- If the browser extension connection fails, tell the user to install the extension and retry
- If the page shows "Sign in", tell the user to log in to LaunchDarkly first
- If the flag page shows "Not found", the flag key or project key may be wrong
- If no migration metrics are found in the snapshot, the flag may not be a migration flag

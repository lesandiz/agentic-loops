# Ralph Setup — Install the Ralph agentic framework into an existing repository
# Usage: .\ralph-setup.ps1 -TargetRepo C:\path\to\your\repo

param(
    [Parameter(Position=0)]
    [string]$TargetRepo,

    [switch]$Help
)

if ($Help -or -not $TargetRepo) {
    Write-Host "Usage: .\ralph-setup.ps1 <target-repo-path>"
    Write-Host ""
    Write-Host "Installs the Ralph agentic framework into an existing repository:"
    Write-Host "  - .ralph\_template\       Template files for feature specs and plans"
    Write-Host "  - .claude\commands\ralph\  Claude Code slash commands (/ralph:*)"
    Write-Host ""
    Write-Host "Example:"
    Write-Host "  .\ralph-setup.ps1 C:\repos\my-project"
    exit 0
}

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

# Resolve target path
$TargetRepo = Resolve-Path -Path $TargetRepo -ErrorAction SilentlyContinue
if (-not $TargetRepo) {
    Write-Host "Error: Invalid target path" -ForegroundColor Red
    exit 1
}

# Verify target is a git repo
if (-not (Test-Path "$TargetRepo\.git")) {
    Write-Host "Error: $TargetRepo is not a git repository" -ForegroundColor Red
    exit 1
}

# Verify source files exist
if (-not (Test-Path "$ScriptDir\.ralph\_template")) {
    Write-Host "Error: Template directory not found at $ScriptDir\.ralph\_template" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "$ScriptDir\.claude\commands\ralph")) {
    Write-Host "Error: Commands directory not found at $ScriptDir\.claude\commands\ralph" -ForegroundColor Red
    exit 1
}

# Check for existing installations
$existing = @()
if (Test-Path "$TargetRepo\.ralph\_template") { $existing += ".ralph\_template\" }
if (Test-Path "$TargetRepo\.claude\commands\ralph") { $existing += ".claude\commands\ralph\" }

if ($existing.Count -gt 0) {
    Write-Host "Warning: The following already exist in the target repo:" -ForegroundColor Yellow
    Write-Host "  $($existing -join ', ')" -ForegroundColor DarkGray
    $confirm = Read-Host "Overwrite? (y/N)"
    if ($confirm -ne 'y' -and $confirm -ne 'Y') {
        Write-Host "Aborted."
        exit 0
    }
}

Write-Host "Installing Ralph into $TargetRepo" -ForegroundColor Cyan

# Install templates
Write-Host "  Copying .ralph\_template\..." -ForegroundColor DarkGray
New-Item -ItemType Directory -Path "$TargetRepo\.ralph\_template" -Force | Out-Null
$templateFiles = @("SPEC.md", "PLAN.md", "PROMPT.md", "COMPLETED_PHASES.md", "SCRATCHPAD.md", "README.md")
foreach ($file in $templateFiles) {
    Copy-Item "$ScriptDir\.ralph\_template\$file" "$TargetRepo\.ralph\_template\$file" -Force
}

# Install commands
Write-Host "  Copying .claude\commands\ralph\..." -ForegroundColor DarkGray
New-Item -ItemType Directory -Path "$TargetRepo\.claude\commands\ralph" -Force | Out-Null
$commandFiles = @("init.md", "research.md", "spec.md", "review.md", "plan.md")
foreach ($file in $commandFiles) {
    Copy-Item "$ScriptDir\.claude\commands\ralph\$file" "$TargetRepo\.claude\commands\ralph\$file" -Force
}

Write-Host ""
Write-Host "Ralph installed successfully." -ForegroundColor Green
Write-Host ""
Write-Host "Installed:" -ForegroundColor Cyan
Write-Host "  .ralph\_template\          Spec, plan, and prompt templates" -ForegroundColor DarkGray
Write-Host "  .claude\commands\ralph\    Claude Code slash commands" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Available commands:" -ForegroundColor Cyan
Write-Host "  /ralph:init <feature>      Scaffold branch + feature directory" -ForegroundColor DarkGray
Write-Host "  /ralph:research <desc>     Explore codebase, output research docs" -ForegroundColor DarkGray
Write-Host "  /ralph:spec <desc>         Generate or refine SPEC.md" -ForegroundColor DarkGray
Write-Host "  /ralph:review              Validate spec quality" -ForegroundColor DarkGray
Write-Host "  /ralph:plan                Generate PLAN.md from finalized spec" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Quick start:" -ForegroundColor Cyan
Write-Host "  1. cd $TargetRepo" -ForegroundColor DarkGray
Write-Host "  2. Open Claude Code" -ForegroundColor DarkGray
Write-Host "  3. /ralph:init my-feature" -ForegroundColor DarkGray
Write-Host "  4. /ralph:spec description of what to build" -ForegroundColor DarkGray
Write-Host ""
Write-Host "See .ralph\_template\README.md for full documentation." -ForegroundColor DarkGray

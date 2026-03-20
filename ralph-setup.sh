#!/bin/bash
# Ralph Setup — Install the Ralph agentic framework into an existing repository
# Usage: curl -sL <raw-url>/ralph-setup.sh | bash -s -- /path/to/your/repo
#    or: ./ralph-setup.sh /path/to/your/repo

set -euo pipefail

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GRAY='\033[0;90m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_REPO="${1:-}"

usage() {
    echo "Usage: $0 <target-repo-path>"
    echo ""
    echo "Installs the Ralph agentic framework into an existing repository:"
    echo "  - .ralph/_template/     Template files for feature specs and plans"
    echo "  - .claude/commands/ralph/  Claude Code slash commands (/ralph:*)"
    echo ""
    echo "Example:"
    echo "  $0 /path/to/my-project"
}

if [[ -z "$TARGET_REPO" || "$TARGET_REPO" == "-h" || "$TARGET_REPO" == "--help" ]]; then
    usage
    exit 0
fi

# Resolve target path
TARGET_REPO="$(cd "$TARGET_REPO" 2>/dev/null && pwd)"
if [[ -z "$TARGET_REPO" ]]; then
    echo -e "${RED}Error: Invalid target path${NC}" >&2
    exit 1
fi

# Verify target is a git repo
if [[ ! -d "$TARGET_REPO/.git" ]]; then
    echo -e "${RED}Error: $TARGET_REPO is not a git repository${NC}" >&2
    exit 1
fi

# Verify source files exist
if [[ ! -d "$SCRIPT_DIR/.ralph/_template" ]]; then
    echo -e "${RED}Error: Template directory not found at $SCRIPT_DIR/.ralph/_template${NC}" >&2
    exit 1
fi

if [[ ! -d "$SCRIPT_DIR/.claude/commands/ralph" ]]; then
    echo -e "${RED}Error: Commands directory not found at $SCRIPT_DIR/.claude/commands/ralph${NC}" >&2
    exit 1
fi

# Check for existing installations
EXISTING=""
if [[ -d "$TARGET_REPO/.ralph/_template" ]]; then
    EXISTING="$EXISTING .ralph/_template/"
fi
if [[ -d "$TARGET_REPO/.claude/commands/ralph" ]]; then
    EXISTING="$EXISTING .claude/commands/ralph/"
fi

if [[ -n "$EXISTING" ]]; then
    echo -e "${YELLOW}Warning: The following already exist in the target repo:${NC}"
    echo -e "${GRAY} $EXISTING${NC}"
    read -rp "Overwrite? (y/N) " confirm
    if [[ "$confirm" != [yY] ]]; then
        echo "Aborted."
        exit 0
    fi
fi

echo -e "${CYAN}Installing Ralph into $TARGET_REPO${NC}"

# Install templates
echo -e "${GRAY}  Copying .ralph/_template/...${NC}"
mkdir -p "$TARGET_REPO/.ralph/_template"
cp "$SCRIPT_DIR/.ralph/_template/SPEC.md" "$TARGET_REPO/.ralph/_template/"
cp "$SCRIPT_DIR/.ralph/_template/PLAN.md" "$TARGET_REPO/.ralph/_template/"
cp "$SCRIPT_DIR/.ralph/_template/PROMPT.md" "$TARGET_REPO/.ralph/_template/"
cp "$SCRIPT_DIR/.ralph/_template/COMPLETED_PHASES.md" "$TARGET_REPO/.ralph/_template/"
cp "$SCRIPT_DIR/.ralph/_template/SCRATCHPAD.md" "$TARGET_REPO/.ralph/_template/"
cp "$SCRIPT_DIR/.ralph/_template/README.md" "$TARGET_REPO/.ralph/_template/"

# Install commands
echo -e "${GRAY}  Copying .claude/commands/ralph/...${NC}"
mkdir -p "$TARGET_REPO/.claude/commands/ralph"
cp "$SCRIPT_DIR/.claude/commands/ralph/init.md" "$TARGET_REPO/.claude/commands/ralph/"
cp "$SCRIPT_DIR/.claude/commands/ralph/research.md" "$TARGET_REPO/.claude/commands/ralph/"
cp "$SCRIPT_DIR/.claude/commands/ralph/spec.md" "$TARGET_REPO/.claude/commands/ralph/"
cp "$SCRIPT_DIR/.claude/commands/ralph/review.md" "$TARGET_REPO/.claude/commands/ralph/"
cp "$SCRIPT_DIR/.claude/commands/ralph/plan.md" "$TARGET_REPO/.claude/commands/ralph/"

echo ""
echo -e "${GREEN}Ralph installed successfully.${NC}"
echo ""
echo -e "${CYAN}Installed:${NC}"
echo -e "${GRAY}  .ralph/_template/          Spec, plan, and prompt templates${NC}"
echo -e "${GRAY}  .claude/commands/ralph/    Claude Code slash commands${NC}"
echo ""
echo -e "${CYAN}Available commands:${NC}"
echo -e "${GRAY}  /ralph:init <feature>      Scaffold branch + feature directory${NC}"
echo -e "${GRAY}  /ralph:research <desc>     Explore codebase, output research docs${NC}"
echo -e "${GRAY}  /ralph:spec <desc>         Generate or refine SPEC.md${NC}"
echo -e "${GRAY}  /ralph:review              Validate spec quality${NC}"
echo -e "${GRAY}  /ralph:plan                Generate PLAN.md from finalized spec${NC}"
echo ""
echo -e "${CYAN}Quick start:${NC}"
echo -e "${GRAY}  1. cd $TARGET_REPO${NC}"
echo -e "${GRAY}  2. Open Claude Code${NC}"
echo -e "${GRAY}  3. /ralph:init my-feature${NC}"
echo -e "${GRAY}  4. /ralph:spec description of what to build${NC}"
echo ""
echo -e "${GRAY}See .ralph/_template/README.md for full documentation.${NC}"

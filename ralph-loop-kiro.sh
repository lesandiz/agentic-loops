#!/bin/bash
# Ralph Loop - Automated Kiro CLI agent runner
# Continuously runs Kiro CLI, feeding it PROMPT.md

# Default parameters
MAX_ITERATIONS=10  # 0 = infinite
DELAY_SECONDS=1
MODEL="claude-sonnet-4.5"
REPO_PATH=""
PROMPT_ARG=""

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--max-iterations)
            MAX_ITERATIONS="$2"
            shift 2
            ;;
        -d|--delay)
            DELAY_SECONDS="$2"
            shift 2
            ;;
        --model)
            MODEL="$2"
            shift 2
            ;;
        -r|--repo)
            REPO_PATH="$2"
            shift 2
            ;;
        -p|--prompt)
            PROMPT_ARG="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [options] [repo-path]"
            echo "  -r, --repo PATH          Target repository path (required)"
            echo "  -p, --prompt FILE        Prompt file (default: PROMPT.md next to script)"
            echo "                           Relative paths resolve from repo path"
            echo "  -m, --max-iterations N   Max iterations (0=infinite, default: 10)"
            echo "  -d, --delay N            Delay between iterations in seconds (default: 1)"
            echo "  --model NAME             Model to use (default: claude-sonnet-4.5)"
            exit 0
            ;;
        -*)
            echo "Unknown option: $1"
            exit 1
            ;;
        *)
            # Positional argument = repo path
            REPO_PATH="$1"
            shift
            ;;
    esac
done

# Validate repo path
if [[ -z "$REPO_PATH" ]]; then
    echo "Error: Repository path is required" >&2
    echo "Usage: $0 -r /path/to/repo [options]" >&2
    exit 1
fi

# Resolve repo to absolute path
REPO_PATH="$(cd "$REPO_PATH" 2>/dev/null && pwd)"
if [[ -z "$REPO_PATH" ]]; then
    echo "Error: Invalid repository path" >&2
    exit 1
fi

# Resolve prompt file path
if [[ -z "$PROMPT_ARG" ]]; then
    # Default: PROMPT.md next to script
    PROMPT_FILE="$SCRIPT_DIR/PROMPT.md"
elif [[ "$PROMPT_ARG" = /* ]]; then
    # Absolute path: use as-is
    PROMPT_FILE="$PROMPT_ARG"
else
    # Relative path: resolve from repo path
    PROMPT_FILE="$REPO_PATH/$PROMPT_ARG"
fi

# Validate prompt file exists and is readable
if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "Error: Prompt file not found: $PROMPT_FILE" >&2
    exit 1
fi

if [[ ! -r "$PROMPT_FILE" ]]; then
    echo "Error: Prompt file not readable: $PROMPT_FILE" >&2
    exit 1
fi

iteration=0

# Colors
CYAN='\033[0;36m'
GRAY='\033[0;90m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
DARKGRAY='\033[0;90m'
NC='\033[0m' # No Color

echo -e "${CYAN}Starting Ralph Loop (Kiro CLI)...${NC}"
echo -e "${GRAY}Prompt file: $PROMPT_FILE${NC}"
echo -e "${GRAY}Target repository: $REPO_PATH${NC}"
echo -e "${GRAY}Model: $MODEL${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop${NC}"
echo ""

# Change to target repo
pushd "$REPO_PATH" > /dev/null

# Cleanup on exit
cleanup() {
    popd > /dev/null 2>&1
    echo -e "${CYAN}Ralph Loop stopped after $iteration iterations.${NC}"
}
trap cleanup EXIT

while true; do
    ((iteration++))
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    echo -e "${GREEN}[$timestamp] Iteration $iteration${NC}"
    echo -e "${DARKGRAY}$(printf '%0.s-' {1..50})${NC}"

    # Run Kiro CLI with prompt
    cat "$PROMPT_FILE" | kiro-cli chat --no-interactive -a --model "$MODEL"
    exit_code=$?

    if [[ $exit_code -ne 0 ]]; then
        echo -e "${YELLOW}Kiro exited with code: $exit_code${NC}"
    fi

    # Check iteration limit
    if [[ $MAX_ITERATIONS -gt 0 && $iteration -ge $MAX_ITERATIONS ]]; then
        echo -e "${CYAN}Reached max iterations ($MAX_ITERATIONS). Stopping.${NC}"
        break
    fi

    echo ""
    echo -e "${GRAY}Waiting $DELAY_SECONDS seconds before next iteration...${NC}"
    sleep "$DELAY_SECONDS"
done

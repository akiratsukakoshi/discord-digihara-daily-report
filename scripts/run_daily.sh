#!/bin/bash
# Discord Daily Report Cron Wrapper

# Script directory
SCRIPT_DIR="$(dirname "$(realpath "$0")")"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# Navigate to repo directory
cd "$REPO_DIR" || exit 1

# Load environment variables from .env
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# Run the python script
/usr/bin/python3 "$SCRIPT_DIR/generate_report.py" >> "$REPO_DIR/data/cron.log" 2>&1

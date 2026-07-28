#!/bin/bash
# Script to run the AI Scout Telegram channel parser inside Hermes Cron job context

# Resolve the absolute path of the local python and uv binary
UV_BIN="/home/signmark/.local/bin/uv"
SCRIPT_PATH="/home/signmark/get_empire_digest.py"

if [ -f "$UV_BIN" ] && [ -f "$SCRIPT_PATH" ]; then
    # Execute the python script with BS4 and HTTPX packages isolated
    $UV_BIN run --with beautifulsoup4 --with httpx $SCRIPT_PATH 5
else
    # Fallback to simple python run if uv path is different
    python3 /home/signmark/get_empire_digest.py 5
fi

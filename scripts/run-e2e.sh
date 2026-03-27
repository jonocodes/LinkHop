#!/usr/bin/env bash
# Wrapper script to run Playwright tests with proper environment

# Set LD_LIBRARY_PATH before anything else
export LD_LIBRARY_PATH="$FLOX_ENV/lib:$LD_LIBRARY_PATH"

# Get Playwright browsers path
export PLAYWRIGHT_BROWSERS_PATH=$(nix build --print-out-paths nixpkgs#playwright.browsers 2>/dev/null || echo "")

# Activate virtual environment
source .venv/bin/activate

# Run pytest with all arguments passed through
exec python -m pytest "$@"

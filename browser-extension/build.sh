#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Installing dependencies..."
npm install

echo "==> Building extension..."
npm run build

echo ""
echo "Build complete. To load in Chrome/Edge:"
echo "  1. Open chrome://extensions  (or edge://extensions)"
echo "  2. Enable 'Developer mode'"
echo "  3. Click 'Load unpacked' and select:"
echo "     $SCRIPT_DIR"

#!/bin/bash
# Run this ONCE on your Mac to generate a native icon.icns from the iconset.
# The resulting icon.icns will appear in the Dock correctly.
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
iconutil -c icns "$SCRIPT_DIR/icon.iconset" -o "$SCRIPT_DIR/icon.icns"
echo "✓ icon.icns generated at $SCRIPT_DIR/icon.icns"
echo "  Restart 'npm run tauri dev' to see the new icon in the Dock."

#!/usr/bin/env bash
set -e

echo ""
echo "╔══════════════════════════════════════╗"
echo "║        PANELS — Setup Script         ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── 1. Check Homebrew ────────────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  echo "❌  Homebrew not found. Install it first:"
  echo "    /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
  exit 1
fi
echo "✅  Homebrew found"

# ── 2. Check / install Rust ──────────────────────────────────────────────────
if ! command -v rustc &>/dev/null; then
  echo "📦  Installing Rust via rustup…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
else
  echo "✅  Rust $(rustc --version)"
fi

# ── 3. Check / install Node.js ───────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "📦  Installing Node.js via Homebrew…"
  brew install node
else
  echo "✅  Node.js $(node --version)"
fi

# ── 4. CBR support (optional but recommended) ────────────────────────────────
if ! command -v unar &>/dev/null && ! command -v unrar &>/dev/null; then
  echo "📦  Installing unar (for CBR support)…"
  brew install unar
else
  echo "✅  CBR support available"
fi

# ── 5. Tauri system dependencies (macOS: Xcode CLI tools) ───────────────────
if ! xcode-select -p &>/dev/null; then
  echo "📦  Installing Xcode Command Line Tools…"
  xcode-select --install
  echo "    ⚠️  Please complete the Xcode CLT install, then re-run this script."
  exit 1
fi
echo "✅  Xcode CLT installed"

# ── 6. Install Tauri CLI ─────────────────────────────────────────────────────
if ! cargo tauri --version &>/dev/null 2>&1; then
  echo "📦  Installing Tauri CLI…"
  cargo install tauri-cli --version "^1.5"
fi
echo "✅  Tauri CLI ready"

# ── 7. Install npm dependencies ──────────────────────────────────────────────
echo ""
echo "📦  Installing npm packages…"
npm install

# ── 8. Create required Tauri icon placeholders ───────────────────────────────
mkdir -p src-tauri/icons
if [ ! -f src-tauri/icons/icon.icns ]; then
  echo "⚠️  No icons found. Creating placeholder icons…"
  # Create a simple 32x32 placeholder using sips (built-in macOS)
  python3 - << 'PYEOF'
import struct, zlib, base64

def create_png(w, h, r, g, b):
    def chunk(name, data):
        c = zlib.crc32(name + data) & 0xffffffff
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', c)
    raw = b''
    for _ in range(h):
        row = b'\x00' + bytes([r, g, b, 255] * w)
        raw += row
    compressed = zlib.compress(raw)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', compressed) + chunk(b'IEND', b'')

import os
icons_dir = 'src-tauri/icons'
sizes = [(32, '32x32'), (128, '128x128')]
for size, name in sizes:
    with open(f'{icons_dir}/{name}.png', 'wb') as f:
        f.write(create_png(size, size, 232, 168, 48))
    print(f'  Created {name}.png')

# 128@2x
with open(f'{icons_dir}/128x128@2x.png', 'wb') as f:
    f.write(create_png(256, 256, 232, 168, 48))

# Copy as ico placeholder (not valid .ico but avoids build error)
import shutil
shutil.copy(f'{icons_dir}/32x32.png', f'{icons_dir}/icon.ico')
shutil.copy(f'{icons_dir}/128x128.png', f'{icons_dir}/icon.icns')
print('  Placeholder icons created.')
PYEOF
fi

echo ""
echo "══════════════════════════════════════════"
echo "✅  Setup complete!"
echo ""
echo "  To run in development mode:"
echo "    npm run tauri dev"
echo ""
echo "  To build a release .app:"
echo "    npm run tauri build"
echo ""
echo "  Your .app will be at:"
echo "    src-tauri/target/release/bundle/macos/Panels.app"
echo "══════════════════════════════════════════"
echo ""

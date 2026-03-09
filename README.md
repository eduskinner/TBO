# Panels

A comic reader and library manager for macOS, built with Tauri + React.   
Supports CBZ and CBR files. Designed for Android migration in a future iteration.

---

## Quick Start

### 1. Run the setup script

```bash
cd panels
bash setup.sh
```

This will install Rust, Node.js, Tauri CLI, and unar (CBR support) if missing.

### 2. Start in development mode

```bash
npm run tauri dev
```

### 3. Build a release app

```bash
npm run tauri build
```

Your app will be at:
```
src-tauri/target/release/bundle/macos/Panels.app
```

---

## Manual Prerequisites

If you prefer to install manually:

| Tool       | Install command              |
|------------|------------------------------|
| Rust       | `curl https://sh.rustup.rs -sSf \| sh` |
| Node.js    | `brew install node`          |
| Tauri CLI  | `cargo install tauri-cli --version "^1.5"` |
| unar (CBR) | `brew install unar`          |

---

## Features (v0.1)

- ✅ Scans local folders for CBZ/CBR files 
- ✅ Extracts and caches cover thumbnails
- ✅ Library grid view with covers
- ✅ Metadata editing (title, series, issue, publisher, writer, artist, genre, tags, notes)
- ✅ Filename auto-parsing (series, issue number, year, publisher)
- ✅ Read / Reading / Unread status tracking
- ✅ Star ratings
- ✅ Reading progress (page-level, auto-save)
- ✅ Comic reader — Single Page, Double Page, Vertical Scroll
- ✅ Search, sort, and filter
- ✅ Keyboard navigation in reader (arrow keys, Space, F for fullscreen)
- ✅ SQLite database (~/.local/share/panels/panels.db)

## Planned (future iterations)

- NAS / SMB network drives
- Google Drive, MEGA cloud sources
- Android app (Tauri mobile)
- ComicVine API metadata enrichment
- Collections / reading lists
- Import from ComicRack (.xml)

---

## Architecture

```
panels/
├── src/                  # React + TypeScript frontend
│   ├── components/       # UI components
│   ├── store/            # Zustand state management
│   └── types/            # TypeScript types
└── src-tauri/            # Rust backend
    └── src/main.rs       # Tauri commands, archive parsing, SQLite
```

### Key Tauri commands

| Command                | Description                              |
|------------------------|------------------------------------------|
| `get_library`          | Returns all comics from SQLite           |
| `scan_folder`          | Walks a folder, adds new CBZ/CBR files   |
| `get_cover`            | Extracts + caches cover as base64 JPEG   |
| `get_page`             | Extracts a single page as base64         |
| `get_page_count`       | Returns total page count                 |
| `update_comic`         | Saves metadata edits                     |
| `toggle_read_status`   | Toggles read/unread                      |
| `update_reading_progress` | Saves current page + auto-sets status |
| `search_comics`        | Full-text search in SQLite               |

### CBR Support

CBR files (RAR archives) require a system tool:

- **macOS**: Panels uses the built-in `bsdtar` first, then falls back to `unrar`
- Install `unar` for best compatibility: `brew install unar`
- CBZ files work with no extra dependencies (pure Rust ZIP)

---

## Database

SQLite at `~/.local/share/panels/panels.db`

To browse: `sqlite3 ~/.local/share/panels/panels.db .tables`

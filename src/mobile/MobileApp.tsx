/**
 * MobileApp — Full mobile UI for Lector TBO
 *
 * Architecture:
 *  - Top bar: hamburger + title + search + action buttons
 *  - Left drawer: stats, nav, add folder, rescan (slides in/out)
 *  - Main view: library (folders) → folder → reader
 *  - AddFolder modal: manual path input with common Android shortcuts
 *    (replaces native folder picker which returns unusable content:// URIs on Android)
 */

import React, {
  useState, useEffect, useCallback, useRef, useMemo,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Menu, X, ChevronLeft, Search, RefreshCw, FolderPlus,
  Loader2, FolderOpen, Settings, Library,
  CheckCircle, Clock, ChevronRight, ZoomIn, ZoomOut,
  ArrowLeft, AlertCircle,
} from "lucide-react";
import { useStore, type ScanProgress } from "../store";
import { loadCover, placeholderColor, preloadCovers } from "../store/coverQueue";
import { loadPageHigh } from "../store/pageQueue";
import type { Comic, ScanResult } from "../types";
import { ANDROID_QUICK_PATHS } from "./usePlatform";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type MobileView = "library" | "folder" | "reader" | "settings";

interface FolderGroup { name: string; dir: string; comics: Comic[]; }

function folderOf(fp: string): { name: string; dir: string } {
  const parts = fp.replace(/\\/g, "/").split("/");
  return {
    name: parts.length >= 2 ? parts[parts.length - 2] : "Library",
    dir:  parts.slice(0, -1).join("/"),
  };
}

function groupByFolder(comics: Comic[]): FolderGroup[] {
  const map = new Map<string, FolderGroup>();
  for (const c of comics) {
    const { name, dir } = folderOf(c.file_path);
    if (!map.has(dir)) map.set(dir, { name, dir, comics: [] });
    map.get(dir)!.comics.push(c);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared scan helper — bypasses native file picker (broken on Android)
// ─────────────────────────────────────────────────────────────────────────────

// Result type extended with a permission-denied flag for Android
interface ScanResultExtended extends ScanResult { permissionDenied?: boolean; }

async function scanPath(path: string): Promise<ScanResultExtended> {
  useStore.setState({ scanning: true, scanResult: null, scanProgress: null });
  const unlisten = await listen<ScanProgress>("scan_progress", (ev: { payload: ScanProgress }) => {
    useStore.setState({ scanProgress: ev.payload });
  });
  try {
    const result = await invoke<ScanResult>("scan_folder", { folderPath: path });
    // Heuristic: if 0 added AND 0 skipped AND the path looks like external storage,
    // it is very likely a permission denial (WalkDir silently returns nothing).
    const looksExternal = path.startsWith("/storage/") || path.startsWith("/sdcard");
    const extended: ScanResultExtended = {
      ...result,
      permissionDenied: looksExternal && result.added === 0 && result.skipped === 0,
    };
    useStore.setState({ scanResult: extended, scanning: false, scanProgress: null });
    await useStore.getState().loadLibrary();
    await useStore.getState().loadSources();
    return extended;
  } catch (e) {
    console.error("scan_folder:", e);
    useStore.setState({ scanning: false, scanProgress: null });
    return { added: 0, skipped: 0, errors: [String(e)] };
  } finally {
    unlisten();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cover image component
// ─────────────────────────────────────────────────────────────────────────────

function CoverImage({ comic }: { comic: Comic }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadCover(comic.id, comic.file_path).then((url: string) => {
      if (!cancelled) setSrc(url);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [comic.id, comic.file_path]);

  return (
    <div style={{ width: "100%", height: "100%", background: placeholderColor(comic.id), overflow: "hidden" }}>
      {src && (
        <img src={src} alt={comic.title}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          draggable={false}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Folder Modal (bottom sheet)
// ─────────────────────────────────────────────────────────────────────────────

function AddFolderModal({ onClose }: { onClose: () => void }) {
  const [path, setPath] = useState("/storage/emulated/0/Download");
  const [permWarn, setPermWarn] = useState(false);

  const handleScan = async () => {
    if (!path.trim()) return;
    const hasPerm = await invoke<boolean>("check_android_permissions");
    if (!hasPerm && path.startsWith("/storage/")) {
      setPermWarn(true);
      return;
    }
    const result = await scanPath(path.trim());
    if (result.permissionDenied) {
      setPermWarn(true);   // stay open and show permission warning
    } else {
      onClose();
    }
  };

  const handleGrant = async () => {
    await invoke("request_android_permissions");
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "flex-end" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: "100%", background: "var(--bg2)", borderRadius: "20px 20px 0 0", padding: "0 0 24px", boxShadow: "0 -8px 40px rgba(0,0,0,0.6)" }}>
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--border)" }} />
        </div>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 20px 16px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, letterSpacing: 1.5, color: "var(--text)" }}>
            Add Comics Folder
          </span>
          <button onClick={onClose} style={{ color: "var(--text3)", background: "none", border: "none", padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: "16px 20px" }}>
          {/* Quick paths */}
          <p style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, fontFamily: "'IBM Plex Mono',monospace" }}>
            Common locations
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
            {ANDROID_QUICK_PATHS.map(({ label, path: p }) => (
              <button key={p} onClick={() => setPath(p)}
                style={{
                  padding: "6px 12px", borderRadius: 20,
                  background: path === p ? "var(--accent)" : "var(--bg4)",
                  color: path === p ? "#0C0C0E" : "var(--text2)",
                  border: "1px solid " + (path === p ? "var(--accent)" : "var(--border)"),
                  fontSize: 12, fontWeight: 500,
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* Manual path input */}
          <p style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, fontFamily: "'IBM Plex Mono',monospace" }}>
            Or type a path
          </p>
          <input
            value={path}
            onChange={e => setPath(e.target.value)}
            placeholder="/storage/emulated/0/Comics"
            style={{
              width: "100%", padding: "12px 14px",
              background: "var(--bg3)", border: "1px solid var(--border)",
              borderRadius: 10, color: "var(--text)", fontSize: 13,
              fontFamily: "'IBM Plex Mono',monospace", outline: "none",
            }}
          />
          <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 8 }}>
            Tip: Comics should be CBZ or CBR files. Internal storage on most Android phones is at /storage/emulated/0
          </p>
        </div>

        {/* Permission warning — shown after a scan returns 0 results on external storage */}
        {permWarn && (
          <div style={{ margin: "0 20px 16px", padding: "14px 16px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12 }}>
            <p style={{ fontSize: 13, color: "#f87171", fontWeight: 700, marginBottom: 6 }}>
              ⚠ Storage permission required
            </p>
            <p style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5, marginBottom: 12 }}>
              No files were found. This usually means the app hasn&apos;t been granted
              storage access. Please follow these steps:
            </p>
            <ol style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.8, paddingLeft: 18, marginBottom: 12 }}>
              <li>Open <strong style={{ color: "var(--text)" }}>Android Settings</strong></li>
              <li>Go to <strong style={{ color: "var(--text)" }}>Apps → Lector TBO</strong></li>
              <li>Tap <strong style={{ color: "var(--text)" }}>Permissions → Files and media</strong></li>
              <li>Select <strong style={{ color: "var(--text)" }}>Allow management of all files</strong></li>
              <li>Return here and tap <strong style={{ color: "var(--text)" }}>Scan This Folder</strong> again</li>
            </ol>
            <p style={{ fontSize: 11, color: "var(--text3)" }}>
              On some phones this is under Special App Access → All Files Access
            </p>
            <button
              onClick={handleGrant}
              style={{
                marginTop: 14, width: "100%", padding: "10px",
                background: "rgba(255,255,255,0.1)", color: "var(--text)",
                border: "1px solid var(--border)", borderRadius: 8,
                fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 8
              }}
            >
              <Settings size={14} /> Open Permission Settings
            </button>
          </div>
        )}

        <div style={{ padding: "0 20px" }}>
          <button
            onClick={handleScan}
            disabled={!path.trim()}
            style={{
              width: "100%", padding: "14px",
              background: "var(--accent)", color: "#0C0C0E",
              border: "none", borderRadius: 12,
              fontWeight: 700, fontSize: 15, letterSpacing: 0.5,
            }}>
            {permWarn ? "Try Again" : "Scan This Folder"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Left Drawer
// ─────────────────────────────────────────────────────────────────────────────

function Drawer({ open: isOpen, onClose, onAddFolder, view, setView }: {
  open: boolean;
  onClose: () => void;
  onAddFolder: () => void;
  view: MobileView;
  setView: (v: MobileView) => void;
}) {
  const { comics, scanning, rescanSources } = useStore();
  const read    = comics.filter(c => c.read_status === "read").length;
  const reading = comics.filter(c => c.read_status === "reading").length;
  const unread  = comics.filter(c => c.read_status === "unread").length;

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, zIndex: 90,
        background: "rgba(0,0,0,0.6)",
        opacity: isOpen ? 1 : 0,
        pointerEvents: isOpen ? "auto" : "none",
        transition: "opacity 0.25s ease",
      }} />

      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 100,
        width: 280, background: "var(--bg2)",
        borderRight: "1px solid var(--border)",
        transform: isOpen ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 0.3s cubic-bezier(0.4,0,0.2,1)",
        display: "flex", flexDirection: "column",
        boxShadow: isOpen ? "4px 0 40px rgba(0,0,0,0.5)" : "none",
      }}>
        <div style={{ padding: "56px 24px 20px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 32, letterSpacing: 3, color: "var(--accent)" }}>
            LECTOR TBO
          </span>
        </div>

        <nav style={{ padding: "16px 12px 0" }}>
          {([
            { icon: <Library size={18} />, label: "Library",  value: "library"  as MobileView },
            { icon: <Settings size={18} />, label: "Settings", value: "settings" as MobileView },
          ] as const).map(item => (
            <button key={item.value} onClick={() => { setView(item.value); onClose(); }}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                width: "100%", padding: "12px 14px", borderRadius: 10, marginBottom: 4,
                background: view === item.value ? "var(--bg4)" : "transparent",
                color: view === item.value ? "var(--text)" : "var(--text2)",
                borderLeft: "3px solid " + (view === item.value ? "var(--accent)" : "transparent"),
                fontSize: 14, fontWeight: view === item.value ? 600 : 400, border: "none",
              }}>
              {item.icon}{item.label}
            </button>
          ))}
        </nav>

        <div style={{ padding: "20px 24px", flex: 1 }}>
          <p style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 12, fontFamily: "'IBM Plex Mono',monospace" }}>
            Collection
          </p>
          {[
            { label: "Total",   value: comics.length, color: "var(--text)" },
            { label: "Read",    value: read,    color: "#4ade80" },
            { label: "Reading", value: reading, color: "var(--accent)" },
            { label: "Unread",  value: unread,  color: "var(--text3)" },
          ].map(s => (
            <div key={s.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 13, color: "var(--text2)" }}>{s.label}</span>
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: s.color, fontWeight: 600 }}>{s.value}</span>
            </div>
          ))}
        </div>

        <div style={{ padding: "0 12px 40px", display: "flex", flexDirection: "column", gap: 10 }}>
          <button onClick={() => { rescanSources(); onClose(); }} disabled={scanning}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "13px 16px", borderRadius: 12,
              background: "var(--bg4)", border: "1px solid var(--border)",
              color: scanning ? "var(--text3)" : "var(--text2)",
              fontSize: 13, fontWeight: 500,
            }}>
            <RefreshCw size={16} className={scanning ? "animate-spin" : ""} />
            Update Library
          </button>

          <button onClick={() => { onAddFolder(); onClose(); }}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "13px 16px", borderRadius: 12,
              background: "var(--accent)", border: "none",
              color: "#0C0C0E", fontSize: 13, fontWeight: 700,
            }}>
            <FolderPlus size={16} />
            Add Folder
          </button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile Library (folder grid)
// ─────────────────────────────────────────────────────────────────────────────

function MobileLibrary({ onOpenFolder, showSearch }: {
  onOpenFolder: (group: FolderGroup) => void;
  showSearch: boolean;
}) {
  const { comics, loading, scanning, scanResult, scanProgress } = useStore();
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [search, setSearch] = useState("");

  const groups = useMemo(() => groupByFolder(comics), [comics]);
  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups.filter(g => g.name.toLowerCase().includes(q));
  }, [groups, search]);

  const scanPct = scanProgress && scanProgress.found > 0
    ? Math.round((scanProgress.current / scanProgress.found) * 100) : 0;

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {showSearch && (
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg2)" }}>
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search collections…"
            style={{
              width: "100%", padding: "10px 14px",
              background: "var(--bg3)", border: "1px solid var(--border)",
              borderRadius: 10, color: "var(--text)", fontSize: 14, outline: "none",
            }}
          />
        </div>
      )}

      {scanning && (
        <div style={{ padding: "10px 16px", background: "var(--bg3)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <Loader2 size={14} className="animate-spin" style={{ color: "var(--accent)", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 12, color: "var(--text2)" }}>
              {scanProgress ? `Scanning… ${scanProgress.current} / ${scanProgress.found}` : "Scanning…"}
            </span>
            {scanProgress && scanProgress.found > 0 && (
              <div style={{ marginTop: 4, height: 2, background: "var(--bg4)", borderRadius: 1, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${scanPct}%`, background: "var(--accent)", transition: "width 0.2s" }} />
              </div>
            )}
          </div>
        </div>
      )}

      {scanResult && !scanning && (
        <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text2)", background: "rgba(232,168,48,0.08)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
          <CheckCircle size={13} style={{ color: "#4ade80" }} />
          <span><strong style={{ color: "var(--text)" }}>{scanResult.added}</strong> added, <strong style={{ color: "var(--text)" }}>{scanResult.skipped}</strong> already in library</span>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: 16, paddingBottom: 32 }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 300 }}>
            <Loader2 size={32} className="animate-spin" style={{ color: "var(--accent)" }} />
          </div>
        ) : comics.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, gap: 16, textAlign: "center", padding: "0 32px" }}>
            <FolderOpen size={56} style={{ color: "var(--text3)" }} />
            <div>
              <p style={{ color: "var(--text)", fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Library is empty</p>
              <p style={{ color: "var(--text2)", fontSize: 13, lineHeight: 1.6 }}>Tap "Add" to point at where your CBZ or CBR files are stored</p>
            </div>
            <button onClick={() => setShowAddFolder(true)}
              style={{ marginTop: 8, padding: "14px 28px", background: "var(--accent)", color: "#0C0C0E", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15 }}>
              Add Folder
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {filtered.map(group => (
              <MobileFolderCard key={group.dir} group={group} onClick={() => {
                preloadCovers(group.comics.map(c => ({ id: c.id, file_path: c.file_path })));
                onOpenFolder(group);
              }} />
            ))}
          </div>
        )}
      </div>

      {showAddFolder && <AddFolderModal onClose={() => setShowAddFolder(false)} />}
    </div>
  );
}

function MobileFolderCard({ group, onClick }: { group: FolderGroup; onClick: () => void }) {
  const read    = group.comics.filter(c => c.read_status === "read").length;
  const reading = group.comics.filter(c => c.read_status === "reading").length;
  const stackComics = group.comics.slice(0, 3);
  const ROTATIONS = [-6, -2, 1];

  return (
    <button onClick={onClick} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", textAlign: "left", width: "100%" }}>
      <div style={{ height: 140, background: "var(--bg3)", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", width: 80, height: 110 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ position: "absolute", inset: 0, borderRadius: 6, background: "var(--bg4)", border: "1px solid rgba(255,255,255,0.07)", transform: `rotate(${ROTATIONS[i]}deg)`, zIndex: i + 1 }} />
          ))}
          {stackComics.map((comic, i) => (
            <div key={comic.id} style={{ position: "absolute", inset: 0, borderRadius: 6, overflow: "hidden", transform: `rotate(${ROTATIONS[i]}deg)`, zIndex: i + 10, opacity: [0.5, 0.75, 1][i] }}>
              <CoverImage comic={comic} />
            </div>
          ))}
        </div>
        <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.7)", color: "var(--accent)", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20 }}>
          {group.comics.length}
        </div>
      </div>

      <div style={{ padding: "10px 12px 12px" }}>
        <p style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 15, letterSpacing: 1, color: "var(--text)", lineHeight: 1, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {group.name}
        </p>
        {group.comics.length > 0 && (
          <div style={{ height: 3, borderRadius: 2, overflow: "hidden", background: "var(--bg4)" }}>
            <div style={{ display: "flex", height: "100%" }}>
              <div style={{ width: `${(read / group.comics.length) * 100}%`, background: "#4ade80" }} />
              <div style={{ width: `${(reading / group.comics.length) * 100}%`, background: "var(--accent)" }} />
            </div>
          </div>
        )}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Folder View (comic grid)
// ─────────────────────────────────────────────────────────────────────────────

function FolderView({ group, onOpenComic }: { group: FolderGroup; onOpenComic: (c: Comic) => void }) {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    if (!search.trim()) return group.comics;
    const q = search.toLowerCase();
    return group.comics.filter(c => c.title.toLowerCase().includes(q) || c.file_name.toLowerCase().includes(q));
  }, [group.comics, search]);

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg2)" }}>
        <div style={{ position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text3)" }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search comics…"
            style={{ width: "100%", padding: "9px 14px 9px 34px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--text)", fontSize: 13, outline: "none" }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 12, paddingBottom: 32 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {visible.map((comic: Comic) => (
            <button key={comic.id} onClick={() => onOpenComic(comic)}
              style={{ background: "none", border: "none", padding: 0, textAlign: "left", display: "flex", flexDirection: "column" }}>
              <div style={{ width: "100%", aspectRatio: "2/3", borderRadius: 8, overflow: "hidden", background: placeholderColor(comic.id), position: "relative" }}>
                <CoverImage comic={comic} />
                {comic.read_status === "reading" && comic.page_count > 0 && (
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(0,0,0,0.5)" }}>
                    <div style={{ height: "100%", background: "var(--accent)", width: `${(comic.current_page / comic.page_count) * 100}%` }} />
                  </div>
                )}
                <div style={{ position: "absolute", top: 5, right: 5 }}>
                  {comic.read_status === "read"    && <CheckCircle size={12} style={{ color: "#4ade80" }} />}
                  {comic.read_status === "reading" && <Clock       size={12} style={{ color: "var(--accent)" }} />}
                </div>
              </div>
              <p style={{ marginTop: 5, fontSize: 10, color: "var(--text2)", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                {comic.title || comic.file_name}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile Reader
// ─────────────────────────────────────────────────────────────────────────────

function MobileReader({ comic, onClose }: { comic: Comic; onClose: () => void }) {
  const isPDF = comic.file_path.toLowerCase().endsWith(".pdf");
  const [page, setPage]           = useState(comic.current_page || 0);
  const [pageCount, setPageCount] = useState(comic.page_count || 0);
  const [imgSrc, setImgSrc]       = useState<string | null>(null);
  const [pdfUrl, setPdfUrl]       = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);
  const [showUI, setShowUI]       = useState(true);
  const [zoom, setZoom]           = useState(1);
  const uiTimerRef                = useRef<number | null>(null);
  const touchStartX               = useRef<number>(0);
  const { updateProgress }        = useStore();

  const resetUITimer = useCallback(() => {
    setShowUI(true);
    if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
    uiTimerRef.current = window.setTimeout(() => setShowUI(false), 3000);
  }, []);

  useEffect(() => {
    resetUITimer();
    return () => { if (uiTimerRef.current) clearTimeout(uiTimerRef.current); };
  }, [resetUITimer]);

  useEffect(() => {
    if (!pageCount) {
      invoke<number>("get_page_count", { filePath: comic.file_path })
        .then((n: number) => setPageCount(n))
        .catch(() => {});
    }
  }, [comic.file_path, pageCount]);

  useEffect(() => {
    if (isPDF) {
      // Load full PDF as data URL for the object viewer
      setLoading(true);
      invoke<string>("get_pdf_data_url", { filePath: comic.file_path })
        .then(url => { setPdfUrl(url); setLoading(false); })
        .catch(() => { setPdfUrl("error"); setLoading(false); });
      return;
    }
    setLoading(true);
    setImgSrc(null);
    loadPageHigh(comic.file_path, page)
      .then((src: string) => { setImgSrc(src); setLoading(false); })
      .catch(() => setLoading(false));
  }, [comic.file_path, page, isPDF]);

  useEffect(() => {
    if (page > 0) updateProgress(comic.id, page).catch(() => {});
  }, [page, comic.id, updateProgress]);

  const goNext = useCallback(() => {
    if (page < pageCount - 1) { setPage(p => p + 1); resetUITimer(); }
  }, [page, pageCount, resetUITimer]);

  const goPrev = useCallback(() => {
    if (page > 0) { setPage(p => p - 1); resetUITimer(); }
  }, [page, resetUITimer]);

  const handleTap = useCallback((e: React.MouseEvent) => {
    const x = e.clientX, w = window.innerWidth;
    if (x < w * 0.25) { goPrev(); return; }
    if (x > w * 0.75) { goNext(); return; }
    if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
    setShowUI(v => !v);
  }, [goPrev, goNext]);

  const pct = pageCount > 0 ? ((page + 1) / pageCount) * 100 : 0;

  // ── PDF mode: render full document in an embedded viewer ──
  if (isPDF) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 300, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "env(safe-area-inset-top, 12px) 16px 12px", background: "rgba(0,0,0,0.85)" }}>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 20, padding: "8px 12px", color: "#fff", display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
            <ArrowLeft size={16} /> Back
          </button>
          <p style={{ color: "#fff", fontSize: 13, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {comic.title || comic.file_name}
          </p>
        </div>
        <div style={{ flex: 1, position: "relative" }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#fff" }}>
              <Loader2 size={36} className="animate-spin" style={{ color: "var(--accent)" }} />
            </div>
          ) : pdfUrl === "error" ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#fff", gap: 16, padding: 24 }}>
              <AlertCircle size={40} style={{ color: "#f87171" }} />
              <p style={{ textAlign: "center", color: "#f87171" }}>Failed to load PDF</p>
              <button onClick={() => invoke("open_with_system", { filePath: comic.file_path })}
                style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, padding: "12px 24px", fontSize: 15, fontWeight: 600 }}>
                Open with System Viewer
              </button>
            </div>
          ) : (
            <object data={pdfUrl ?? ""} type="application/pdf" style={{ width: "100%", height: "100%" }}>
              {/* Fallback when object tag is not supported (older Android WebViews) */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 16, padding: 24 }}>
                <p style={{ color: "#fff", textAlign: "center" }}>PDF viewer not available in this browser.</p>
                <button onClick={() => invoke("open_with_system", { filePath: comic.file_path })}
                  style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, padding: "12px 24px", fontSize: 15, fontWeight: 600 }}>
                  Open with System Viewer
                </button>
              </div>
            </object>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "#000", display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, background: "linear-gradient(to bottom, rgba(0,0,0,0.85), transparent)", padding: "env(safe-area-inset-top, 12px) 16px 32px", display: "flex", alignItems: "center", gap: 12, transition: "opacity 0.3s", opacity: showUI ? 1 : 0, pointerEvents: showUI ? "auto" : "none" }}>
        <button onClick={onClose} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 20, padding: "8px 12px", color: "#fff", display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
          <ArrowLeft size={16} /> Back
        </button>
        <div style={{ flex: 1 }}>
          <p style={{ color: "#fff", fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{comic.title || comic.file_name}</p>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>{page + 1} / {pageCount || "?"}</p>
        </div>
        <button onClick={() => setZoom(z => Math.min(z + 0.5, 3))} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 20, padding: 8, color: "#fff" }}><ZoomIn size={18} /></button>
        <button onClick={() => setZoom(z => Math.max(z - 0.5, 1))} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 20, padding: 8, color: "#fff" }}><ZoomOut size={18} /></button>
      </div>

      {/* Page */}
      <div
        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", cursor: "pointer" }}
        onClick={handleTap}
        onTouchStart={e => { touchStartX.current = e.touches[0].clientX; }}
        onTouchEnd={e => { const dx = e.changedTouches[0].clientX - touchStartX.current; if (Math.abs(dx) > 60) { dx < 0 ? goNext() : goPrev(); } }}
      >
        {loading ? (
          <Loader2 size={40} className="animate-spin" style={{ color: "var(--accent)" }} />
        ) : imgSrc ? (
          <img src={imgSrc} alt={`Page ${page + 1}`}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", transform: `scale(${zoom})`, transition: "transform 0.2s ease", touchAction: zoom > 1 ? "pan-x pan-y" : "none", userSelect: "none" }}
            draggable={false}
          />
        ) : (
          <div style={{ color: "var(--text3)", textAlign: "center" }}>
            <AlertCircle size={32} style={{ marginBottom: 8 }} />
            <p>Could not load page</p>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 10, background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)", padding: "32px 16px env(safe-area-inset-bottom, 16px)", transition: "opacity 0.3s", opacity: showUI ? 1 : 0, pointerEvents: showUI ? "auto" : "none" }}>
        <div style={{ height: 3, background: "rgba(255,255,255,0.2)", borderRadius: 2, overflow: "hidden", marginBottom: 12 }}>
          <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", transition: "width 0.2s" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <button onClick={goPrev} disabled={page === 0} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 20, padding: "10px 20px", color: page === 0 ? "rgba(255,255,255,0.3)" : "#fff", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <ChevronLeft size={16} /> Prev
          </button>
          <button onClick={goNext} disabled={page >= pageCount - 1} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 20, padding: "10px 20px", color: page >= pageCount - 1 ? "rgba(255,255,255,0.3)" : "#fff", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            Next <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

function MobileSettings() {
  const { sources, removeSource, loadSources } = useStore();
  useEffect(() => { loadSources(); }, [loadSources]);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 16, paddingBottom: 32 }}>
      <p style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 12, fontFamily: "'IBM Plex Mono',monospace" }}>
        Comic Sources
      </p>
      {sources.length === 0 ? (
        <p style={{ color: "var(--text2)", fontSize: 13 }}>No sources added yet. Use "Add" to get started.</p>
      ) : (
        sources.map(source => (
          <div key={source.id} style={{ display: "flex", alignItems: "center", padding: "14px 16px", marginBottom: 8, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12 }}>
            <FolderOpen size={16} style={{ color: "var(--accent)", marginRight: 12, flexShrink: 0 }} />
            <p style={{ flex: 1, fontSize: 12, color: "var(--text2)", wordBreak: "break-all", fontFamily: "'IBM Plex Mono',monospace" }}>{source.path}</p>
            <button onClick={async () => { await removeSource(source.id); await loadSources(); }}
              style={{ background: "none", border: "none", color: "#f87171", padding: "4px 8px", marginLeft: 8 }}>
              <X size={16} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main mobile shell
// ─────────────────────────────────────────────────────────────────────────────

export default function MobileApp() {
  const [view, setView]                         = useState<MobileView>("library");
  const [drawerOpen, setDrawerOpen]             = useState(false);
  const [activeFolder, setActiveFolder]         = useState<FolderGroup | null>(null);
  const [activeComic, setActiveComic]           = useState<Comic | null>(null);
  const [showAddFolder, setShowAddFolder]       = useState(false);
  const [showSearch, setShowSearch]             = useState(false);
  const { scanning } = useStore();

  if (activeComic) {
    return <MobileReader comic={activeComic} onClose={() => setActiveComic(null)} />;
  }

  const title = activeFolder ? activeFolder.name : view === "settings" ? "Settings" : "Library";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "env(safe-area-inset-top, 12px) 16px 12px", background: "var(--bg2)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        {activeFolder ? (
          <button onClick={() => setActiveFolder(null)} style={{ background: "none", border: "none", color: "var(--accent)", padding: 4, display: "flex" }}>
            <ChevronLeft size={24} />
          </button>
        ) : (
          <button onClick={() => setDrawerOpen(true)} style={{ background: "none", border: "none", color: "var(--text)", padding: 4, display: "flex" }}>
            <Menu size={24} />
          </button>
        )}

        <span style={{ flex: 1, fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, letterSpacing: 1.5, color: "var(--text)", lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </span>

        {scanning && <Loader2 size={18} className="animate-spin" style={{ color: "var(--accent)" }} />}

        {view === "library" && (
          <button onClick={() => setShowSearch(s => !s)} style={{ background: "none", border: "none", color: showSearch ? "var(--accent)" : "var(--text2)", padding: 4, display: "flex" }}>
            <Search size={20} />
          </button>
        )}

        {view === "library" && !activeFolder && (
          <button onClick={() => setShowAddFolder(true)} style={{ background: "var(--accent)", border: "none", borderRadius: 20, padding: "6px 12px", color: "#0C0C0E", display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700 }}>
            <FolderPlus size={14} /> Add
          </button>
        )}
      </div>

      {/* Content */}
      {view === "settings" ? (
        <MobileSettings />
      ) : activeFolder ? (
        <FolderView group={activeFolder} onOpenComic={c => setActiveComic(c)} />
      ) : (
        <MobileLibrary onOpenFolder={setActiveFolder} showSearch={showSearch} />
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onAddFolder={() => setShowAddFolder(true)}
        view={view}
        setView={v => { setView(v); setActiveFolder(null); }}
      />

      {showAddFolder && <AddFolderModal onClose={() => setShowAddFolder(false)} />}
    </div>
  );
}

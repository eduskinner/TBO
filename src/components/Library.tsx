import React, { useMemo, useState } from "react";
import {
  Search, SortAsc, SortDesc, FolderOpen,
  Loader2, RefreshCw, ChevronLeft,
} from "lucide-react";
import { useStore } from "../store";
import FolderCard from "./FolderCard";
import ComicCard  from "./ComicCard";
import { preloadCovers } from "../store/coverQueue";
import type { SortField, Comic, Source } from "../types";

// ── Types ─────────────────────────────────────────────────────────────────────

// (FolderGroup interface removed as it's now handled by getHierarchicalLayout)

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Helper: Given a list of comics and a current path, determine the immediate
 * subfolders and immediate files to show in a hierarchical view.
 */
function getHierarchicalLayout(
  allComics: Comic[],
  currentDir: string | null,
  sources: Source[]
) {
  // If no folder is selected, show the root sources
  if (currentDir === null) {
    return {
      folders: sources.map((s) => {
        const comicsInSource = allComics.filter((c) =>
          c.file_path.replace(/\\/g, "/").startsWith(s.path.replace(/\\/g, "/"))
        );
        return {
          name: s.name || s.path.split(/[/\\]/).pop() || "Library",
          dir: s.path.replace(/\\/g, "/"),
          comics: comicsInSource,
        };
      }).filter(f => f.comics.length > 0),
      comics: [],
    };
  }

  const normalizedCurrent = currentDir.replace(/\\/g, "/");
  const prefix = normalizedCurrent.endsWith("/") ? normalizedCurrent : normalizedCurrent + "/";

  const immediateComics: Comic[] = [];
  const subFolderMap = new Map<string, Comic[]>();

  for (const c of allComics) {
    const fp = c.file_path.replace(/\\/g, "/");
    if (!fp.startsWith(prefix)) continue;

    const relative = fp.slice(prefix.length);
    const parts = relative.split("/");

    if (parts.length === 1) {
      // It's a file directly in this folder
      immediateComics.push(c);
    } else {
      // It's in a subfolder. Group by the immediate next directory name.
      const folderName = parts[0];
      const folderPath = prefix + folderName;
      if (!subFolderMap.has(folderPath)) {
        subFolderMap.set(folderPath, []);
      }
      subFolderMap.get(folderPath)!.push(c);
    }
  }

  const folders = Array.from(subFolderMap.entries())
    .map(([dir, comics]) => ({
      name: dir.split("/").pop() || "Folder",
      dir,
      comics,
    }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const comics = immediateComics.sort((a, b) =>
    a.file_name.toLowerCase().localeCompare(b.file_name.toLowerCase())
  );

  return { folders, comics };
}

// ── Sort options ──────────────────────────────────────────────────────────────

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "series",      label: "Series"     },
  { value: "title",       label: "Title"      },
  { value: "date_added",  label: "Date Added" },
  { value: "year",        label: "Year"       },
  { value: "read_status", label: "Status"     },
];

// ── Library ───────────────────────────────────────────────────────────────────

export default function Library() {
  const {
    comics, sources, loading, scanning, scanResult, scanProgress,
    searchQuery, sortField, sortAsc, filterStatus,
    setSearch, setSort, toggleSortDir, setFilterStatus,
    openReader, rescanSources, openAddFolder, clearMissingComics,
  } = useStore();

  const [activeDir, setActiveDir] = useState<string | null>(null);
  const inFolder = activeDir !== null;
  const missingTotal = comics.filter(c => c.missing).length;

  // 1. Get the raw hierarchical layout for the current directory
  const layout = useMemo(() => 
    getHierarchicalLayout(comics, activeDir, sources),
    [comics, activeDir, sources]
  );

  // 2. Apply searching/filtering to the comics and folders in this layout
  const visible = useMemo(() => {
    let { folders, comics: files } = layout;
    const q = searchQuery.toLowerCase().trim();

    // Inside a folder, we might filter by status
    if (activeDir !== null && filterStatus !== "all") {
      files = files.filter(c => c.read_status === filterStatus);
      // For folders, we only show them if they contain at least one comic matching the status
      folders = folders.filter(f => f.comics.some(c => c.read_status === filterStatus));
    }

    if (q) {
      files = files.filter(c => 
        c.title.toLowerCase().includes(q) || 
        c.series.toLowerCase().includes(q) || 
        c.file_name.toLowerCase().includes(q)
      );
      // Only show folders if their name matches OR they contain a matching comic
      folders = folders.filter(f => 
        f.name.toLowerCase().includes(q) || 
        f.comics.some(c => 
          c.title.toLowerCase().includes(q) || 
          c.series.toLowerCase().includes(q) || 
          c.file_name.toLowerCase().includes(q)
        )
      );
    }
    
    // sorting files
    files.sort((a, b) => {
      let av: any, bv: any;
      if (sortField === "title") { av = a.title; bv = b.title; }
      else if (sortField === "series") { av = a.series || a.title; bv = b.series || b.title; }
      else if (sortField === "date_added") { av = a.date_added; bv = b.date_added; }
      else if (sortField === "year") { av = a.year || 0; bv = b.year || 0; }
      else if (sortField === "read_status") { av = a.read_status; bv = b.read_status; }
      else { av = a.file_name; bv = b.file_name; }
      
      const res = String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
      return sortAsc ? res : -res;
    });

    return { folders, comics: files };
  }, [layout, searchQuery, filterStatus, sortField, sortAsc, activeDir]);

  const goUp = () => {
    if (!activeDir) return;
    const norm = activeDir.replace(/\\/g, "/");
    // If it is one of our root sources, go to null
    if (sources.some(s => s.path.replace(/\\/g, "/") === norm)) {
      setActiveDir(null);
    } else {
      const parts = norm.split("/");
      parts.pop();
      setActiveDir(parts.join("/"));
    }
  };

  const scanPct = scanProgress && scanProgress.found > 0
    ? Math.round((scanProgress.current / scanProgress.found) * 100)
    : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-3 px-6 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)" }}
      >
        {/* Back button */}
        {inFolder && (
          <button
            onClick={goUp}
            className="flex items-center gap-1 flex-shrink-0 transition-colors"
            style={{ color: "var(--accent)", fontSize: 13, fontWeight: 600 }}
          >
            <ChevronLeft size={16} />
            Back
          </button>
        )}

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text3)" }} />
          <input
            type="text"
            placeholder={inFolder ? "Search in this folder…" : "Search collections…"}
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg outline-none text-sm"
            style={{ background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
        </div>

        {/* Status filter — only relevant inside a folder */}
        {inFolder && (
          <div className="flex gap-1 rounded-lg p-0.5" style={{ background: "var(--bg3)" }}>
            {(["all","unread","reading","read"] as const).map((v) => (
              <button key={v} onClick={() => setFilterStatus(v)}
                className="px-2.5 py-1 rounded-md text-xs font-medium transition-all"
                style={{
                  background: filterStatus === v ? "var(--bg4)" : "transparent",
                  color:      filterStatus === v ? "var(--text)"  : "var(--text2)",
                }}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        )}

        {/* Sort — only inside folder */}
        {inFolder && (
          <div className="flex items-center gap-1">
            <select value={sortField} onChange={(e) => setSort(e.target.value as SortField)}
              className="px-2 py-1 rounded-lg text-xs outline-none"
              style={{ background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text2)" }}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "var(--bg2)" }}>{o.label}</option>
              ))}
            </select>
            <button onClick={toggleSortDir} className="p-1.5 rounded-lg"
              style={{ background: "var(--bg3)", color: "var(--text2)" }}>
              {sortAsc ? <SortAsc size={13} /> : <SortDesc size={13} />}
            </button>
          </div>
        )}

        <div className="flex-1" />

        {/* Update */}
        <button onClick={rescanSources} disabled={scanning}
          title="Scan all known folders for new comics"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0"
          style={{ background: "var(--bg3)", border: "1px solid var(--border)",
                   color: scanning ? "var(--text3)" : "var(--text2)", cursor: scanning ? "not-allowed" : "pointer" }}>
          <RefreshCw size={12} className={scanning ? "animate-spin" : ""} />
          Update Library
        </button>
      </div>

      {/* ── Scan progress ────────────────────────────────────────────────── */}
      {scanning && (
        <div className="flex items-center gap-3 px-6 py-2.5 flex-shrink-0"
          style={{ background: "var(--bg3)", borderBottom: "1px solid var(--border)" }}>
          <Loader2 size={12} className="animate-spin" style={{ color: "var(--accent)" }} />
          <span style={{ fontSize: 12, color: "var(--text2)" }}>
            {scanProgress ? `Scanning… ${scanProgress.current} / ${scanProgress.found}` : "Scanning…"}
          </span>
          {scanProgress && scanProgress.found > 0 && (
            <div className="flex-1 rounded-full overflow-hidden" style={{ height: 3, background: "var(--bg4)" }}>
              <div style={{ height: "100%", width: `${scanPct}%`, background: "var(--accent)", transition: "width 0.2s" }} />
            </div>
          )}
        </div>
      )}

      {/* ── Scan result ──────────────────────────────────────────────────── */}
      {scanResult && !scanning && (
        <div className="flex items-center gap-3 px-6 py-2 flex-shrink-0"
          style={{ background: "rgba(232,168,48,0.08)", borderBottom: "1px solid var(--border)", fontSize: 12, color: "var(--text2)" }}>
          ✓ <strong style={{ color: "var(--text)" }}>{scanResult.added}</strong> new,{" "}
          <strong style={{ color: "var(--text)" }}>{scanResult.skipped}</strong> unchanged
          {scanResult.errors.length > 0 && <span style={{ color: "#f87171" }}> · {scanResult.errors.length} errors</span>}
        </div>
      )}

      {/* Missing files banner — shown when scanned files no longer exist on disk */}
      {missingTotal > 0 && !scanning && (
        <div className="flex items-center gap-3 px-6 py-2 flex-shrink-0"
          style={{ background: "rgba(239,68,68,0.08)", borderBottom: "1px solid rgba(239,68,68,0.2)", fontSize: 12 }}>
          <span style={{ color: "#f87171" }}>
            ⚠ <strong>{missingTotal}</strong> {missingTotal === 1 ? "comic" : "comics"} no longer found on disk
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={clearMissingComics}
            style={{
              background: "rgba(239,68,68,0.15)", color: "#f87171",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 6, padding: "3px 12px", fontSize: 11,
              fontWeight: 600, cursor: "pointer",
            }}
          >
            Remove {missingTotal === 1 ? "it" : "them"} from library
          </button>
        </div>
      )}

      {/* ── Folder breadcrumb ────────────────────────────────────────────── */}
      {inFolder && (
        <div className="flex items-center gap-2.5 px-6 py-3 flex-shrink-0"
          style={{ background: "var(--bg2)", borderBottom: "1px solid var(--border)" }}>
          <FolderOpen size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 20, letterSpacing: 1.5,
            color: "var(--text)", lineHeight: 1,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
          }}>
            {activeDir.split("/").pop()}
          </span>
          <span style={{ fontSize: 11, color: "var(--text3)", fontFamily: "'IBM Plex Mono',monospace" }}>
            {visible.folders.length} folders, {visible.comics.length} comics
          </span>
        </div>
      )}

      {/* ── Main body ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "24px 24px" }}>

        {loading ? (
          <Empty icon={<Loader2 size={32} className="animate-spin" style={{ color: "var(--accent)" }} />} title="Loading library…" />

        ) : comics.length === 0 ? (
          <Empty
            icon={<FolderOpen size={48} style={{ color: "var(--text3)" }} />}
            title="Your library is empty"
            subtitle="Add a folder containing CBZ or CBR files to get started"
            action={
              <button onClick={openAddFolder} style={{ marginTop: 16, background: "var(--accent)", color: "#0C0C0E",
                border: "none", borderRadius: 8, padding: "10px 24px", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
                Add Folder
              </button>
            }
          />

        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {/* ── Folders ─────────────────────────────────────────────────── */}
            {visible.folders.length > 0 && (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
                gap: 20,
              }}>
                {visible.folders.map((group) => (
                  <FolderCard
                    key={group.dir}
                    name={group.name}
                    dir={group.dir}
                    comics={group.comics}
                    onClick={() => {
                      setActiveDir(group.dir);
                      setSearch("");
                      setFilterStatus("all");
                      preloadCovers(group.comics.map((c) => ({ id: c.id, file_path: c.file_path })));
                    }}
                  />
                ))}
              </div>
            )}

            {/* ── Comics ──────────────────────────────────────────────────── */}
            {visible.comics.length > 0 && (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 16,
              }}>
                {visible.comics.map((comic) => (
                  <ComicCard key={comic.id} comic={comic} onClick={() => openReader(comic)} />
                ))}
              </div>
            )}

            {visible.folders.length === 0 && visible.comics.length === 0 && (
              <Empty 
                icon={<Search size={36} style={{ color: "var(--text3)" }} />} 
                title="No results" 
                subtitle="Try a different search term or filter" 
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({ icon, title, subtitle, action }: {
  icon: React.ReactNode; title: string; subtitle?: string; action?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100%", minHeight: 300, gap: 12 }}>
      {icon}
      <p style={{ color: "var(--text)", fontWeight: 500, fontSize: 15 }}>{title}</p>
      {subtitle && <p style={{ color: "var(--text2)", fontSize: 13 }}>{subtitle}</p>}
      {action}
    </div>
  );
}

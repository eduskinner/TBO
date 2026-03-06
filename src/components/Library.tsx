import React, { useMemo, useState } from "react";
import {
  Search, SortAsc, SortDesc, FolderOpen,
  Loader2, RefreshCw, ChevronLeft,
} from "lucide-react";
import { useStore } from "../store";
import FolderCard from "./FolderCard";
import ComicCard  from "./ComicCard";
import { preloadCovers } from "../store/coverQueue";
import type { SortField } from "../types";
import type { Comic } from "../types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FolderGroup { name: string; dir: string; comics: Comic[]; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function folderOf(fp: string): { name: string; dir: string } {
  const parts = fp.replace(/\\/g, "/").split("/");
  return {
    name: parts.length >= 2 ? parts[parts.length - 2] : "Unknown",
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
    comics, loading, scanning, scanResult, scanProgress,
    searchQuery, sortField, sortAsc, filterStatus,
    setSearch, setSort, toggleSortDir, setFilterStatus,
    openReader, rescanSources, openAddFolder,
  } = useStore();

  // Which folder is open (null = top-level folders view)
  const [activeDir, setActiveDir] = useState<string | null>(null);

  const allGroups = useMemo(() => groupByFolder(comics), [comics]);

  // Active folder's comics (apply filters inside the folder)
  const activeGroup = useMemo(
    () => allGroups.find((g) => g.dir === activeDir) ?? null,
    [allGroups, activeDir]
  );

  // Within a folder: filter + search comics
  const visibleComics = useMemo(() => {
    if (!activeGroup) return [];
    let list = [...activeGroup.comics];
    if (filterStatus !== "all") list = list.filter((c) => c.read_status === filterStatus);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) =>
        c.title.toLowerCase().includes(q) ||
        c.series.toLowerCase().includes(q) ||
        c.file_name.toLowerCase().includes(q)
      );
    }
    return list;
  }, [activeGroup, filterStatus, searchQuery]);

  // At top level: filter groups by search (match folder name or any comic title)
  const visibleGroups = useMemo(() => {
    if (activeDir) return [];
    if (!searchQuery.trim() && filterStatus === "all") return allGroups;
    return allGroups
      .map((g) => {
        let comics = [...g.comics];
        if (filterStatus !== "all") comics = comics.filter((c) => c.read_status === filterStatus);
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          comics = comics.filter((c) =>
            c.title.toLowerCase().includes(q) ||
            c.series.toLowerCase().includes(q) ||
            g.name.toLowerCase().includes(q)
          );
        }
        return { ...g, comics };
      })
      .filter((g) => g.comics.length > 0);
  }, [allGroups, activeDir, searchQuery, filterStatus]);

  const scanPct = scanProgress && scanProgress.found > 0
    ? Math.round((scanProgress.current / scanProgress.found) * 100)
    : 0;

  const inFolder = activeDir !== null;

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
            onClick={() => setActiveDir(null)}
            className="flex items-center gap-1 flex-shrink-0 transition-colors"
            style={{ color: "var(--accent)", fontSize: 13, fontWeight: 600 }}
          >
            <ChevronLeft size={16} />
            Collections
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
          ✓ <strong style={{ color: "var(--text)" }}>{scanResult.added}</strong> new comics added,{" "}
          <strong style={{ color: "var(--text)" }}>{scanResult.skipped}</strong> already in library
          {scanResult.errors.length > 0 && <span style={{ color: "#f87171" }}> · {scanResult.errors.length} errors</span>}
        </div>
      )}

      {/* ── Folder breadcrumb ────────────────────────────────────────────── */}
      {inFolder && activeGroup && (
        <div className="flex items-center gap-2.5 px-6 py-3 flex-shrink-0"
          style={{ background: "var(--bg2)", borderBottom: "1px solid var(--border)" }}>
          <FolderOpen size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 20, letterSpacing: 1.5,
            color: "var(--text)", lineHeight: 1,
          }}>
            {activeGroup.name}
          </span>
          <span style={{ fontSize: 11, color: "var(--text3)", fontFamily: "'IBM Plex Mono',monospace" }}>
            {visibleComics.length} / {activeGroup.comics.length} comics
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

        ) : inFolder ? (
          /* ── Level 2: comics inside a folder ─────────────────────────── */
          visibleComics.length === 0 ? (
            <Empty icon={<Search size={36} style={{ color: "var(--text3)" }} />} title="No matching comics" subtitle="Try a different search or filter" />
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
              gap: 16,
            }}>
              {visibleComics.map((comic) => (
                <ComicCard key={comic.id} comic={comic} onClick={() => openReader(comic)} />
              ))}
            </div>
          )

        ) : (
          /* ── Level 1: folder cards ────────────────────────────────────── */
          visibleGroups.length === 0 ? (
            <Empty icon={<Search size={36} style={{ color: "var(--text3)" }} />} title="No results" subtitle="Try a different search term" />
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
              gap: 20,
            }}>
              {visibleGroups.map((group) => (
                <FolderCard
                  key={group.dir}
                  name={group.name}
                  comics={group.comics}
                  onClick={() => {
                    setActiveDir(group.dir);
                    setSearch("");
                    setFilterStatus("all");
                    // Start loading all covers in this folder in the background
                    preloadCovers(group.comics.map((c) => ({ id: c.id, file_path: c.file_path })));
                  }}
                />
              ))}
            </div>
          )
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

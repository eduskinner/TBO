import React from "react";
import { Library, Settings, Plus, RefreshCw, Loader2 } from "lucide-react";
import { useStore } from "../store";

export default function Sidebar() {
  const {
    view, comics, scanning, scanProgress,
    goLibrary, goSettings, openAddFolder, rescanSources,
  } = useStore();

  const total   = comics.length;
  const read    = comics.filter((c) => c.read_status === "read").length;
  const reading = comics.filter((c) => c.read_status === "reading").length;
  const unread  = comics.filter((c) => c.read_status === "unread").length;

  const pct = scanProgress && scanProgress.found > 0
    ? Math.round((scanProgress.current / scanProgress.found) * 100)
    : 0;

  return (
    <aside
      className="flex flex-col h-full select-none"
      style={{ width: 220, minWidth: 220, background: "var(--bg2)", borderRight: "1px solid var(--border)" }}
    >
      {/* Logo */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-center px-5 pt-8 pb-5"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <img
          src="/tbo-logo.png"
          alt="TBO Logo"
          style={{ width: "120px", height: "auto", objectFit: "contain", pointerEvents: "none" }}
          draggable={false}
        />
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 px-3 py-4">
        <NavItem icon={<Library  size={16} />} label="Library"  active={view === "library" || view === "detail"} onClick={goLibrary} />
        <NavItem icon={<Settings size={16} />} label="Settings" active={view === "settings"}                     onClick={goSettings} />
      </nav>

      {/* Stats */}
      <div className="flex-1 px-4 py-2">
        <p className="mb-3 uppercase tracking-widest"
          style={{ fontSize:10, color:"var(--text3)", fontFamily:"'IBM Plex Mono',monospace" }}>
          Collection
        </p>
        <div className="flex flex-col gap-2">
          <Stat label="Total"   value={total} />
          <Stat label="Read"    value={read}    color="#4ade80" />
          <Stat label="Reading" value={reading} color="var(--accent)" />
          <Stat label="Unread"  value={unread}  color="var(--text3)" />
        </div>
      </div>

      {/* Scan progress */}
      {scanning && (
        <div className="px-4 pb-3">
          <div className="rounded-lg p-3" style={{ background:"var(--bg3)", border:"1px solid var(--border)" }}>
            <div className="flex items-center gap-2 mb-2">
              <Loader2 size={12} className="animate-spin" style={{ color:"var(--accent)" }} />
              <span style={{ fontSize:11, color:"var(--text2)" }}>
                {scanProgress ? `${scanProgress.current} / ${scanProgress.found}` : "Scanning…"}
              </span>
            </div>
            {scanProgress && scanProgress.found > 0 && (
              <>
                <div className="w-full rounded-full overflow-hidden" style={{ height:3, background:"var(--bg4)" }}>
                  <div style={{ height:"100%", width:`${pct}%`, background:"var(--accent)", transition:"width 0.2s ease" }} />
                </div>
                {scanProgress.file && (
                  <p className="mt-1.5 truncate" style={{ fontSize:9, color:"var(--text3)", fontFamily:"monospace" }}>
                    {scanProgress.file}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Buttons */}
      <div className="flex flex-col gap-2 px-3 pb-5">
        <button
          onClick={rescanSources}
          disabled={scanning}
          className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg transition-all"
          style={{ background:"var(--bg4)", border:"1px solid var(--border)", color: scanning ? "var(--text3)" : "var(--text2)",
                   fontWeight:500, fontSize:13, opacity: scanning ? 0.5 : 1, cursor: scanning ? "not-allowed" : "pointer" }}
        >
          <RefreshCw size={14} className={scanning ? "animate-spin" : ""} />
          Update Library
        </button>

        <button
          onClick={openAddFolder}
          disabled={scanning}
          className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg transition-all"
          style={{ background:"var(--accent)", color:"#0C0C0E", fontWeight:600, fontSize:13,
                   opacity: scanning ? 0.5 : 1, cursor: scanning ? "not-allowed" : "pointer" }}
        >
          <Plus size={15} />
          Add Folder
        </button>
      </div>
    </aside>
  );
}

function NavItem({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all w-full"
      style={{ background:  active ? "var(--bg4)" : "transparent",
               color:       active ? "var(--text)"  : "var(--text2)",
               borderLeft:  active ? "2px solid var(--accent)" : "2px solid transparent",
               fontWeight:  active ? 500 : 400, fontSize:13 }}>
      {icon}{label}
    </button>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span style={{ fontSize:12, color:"var(--text2)" }}>{label}</span>
      <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:12, color: color ?? "var(--text)", fontWeight:500 }}>
        {value}
      </span>
    </div>
  );
}

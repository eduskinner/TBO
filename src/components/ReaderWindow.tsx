/**
 * ReaderWindow — rendered when appWindow.label === "reader".
 * Retrieves the comic to display from the main process via IPC,
 * then hands off to the pure Reader component.
 */
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Loader2 } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Reader from "./Reader";
import type { Comic } from "../types";

export default function ReaderWindow() {
  const [comic, setComic]   = useState<Comic | null>(null);
  const [error, setError]   = useState<string | null>(null);

  const loadComic = async () => {
    try {
      const id = await invoke<string>("get_reader_comic_id");
      if (!id) { setError("No comic ID received from main window."); return; }
      const c = await invoke<Comic>("get_comic", { comicId: id });
      setComic(c);
      setError(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  useEffect(() => {
    // Load on mount
    loadComic();

    // Reload when main window opens a different comic
    let unlisten: (() => void) | null = null;
    listen("reload_comic", () => {
      setComic(null);
      loadComic();
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, []);

  if (error) {
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        height:"100vh", background:"#0C0C0E", color:"#F0EDE8", fontFamily:"monospace", padding:40, gap:16 }}>
        <p style={{ color:"#E8A830", fontSize:16 }}>⚠ Failed to load comic</p>
        <pre style={{ background:"#18181D", padding:16, borderRadius:8, fontSize:12, color:"#f87171", maxWidth:600, whiteSpace:"pre-wrap" }}>
          {error}
        </pre>
        <button onClick={loadComic}
          style={{ background:"#E8A830", color:"#0C0C0E", border:"none", borderRadius:8, padding:"8px 20px", fontWeight:"bold", cursor:"pointer" }}>
          Retry
        </button>
      </div>
    );
  }

  if (!comic) {
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        height:"100vh", background:"#0C0C0E", gap:16 }}>
        <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, letterSpacing:4, color:"#E8A830" }}>
          LECTOR TBO
        </span>
        <Loader2 size={22} className="animate-spin" style={{ color:"#E8A830" }} />
        <p style={{ fontSize:12, color:"#55555F", fontFamily:"monospace" }}>Loading comic…</p>
      </div>
    );
  }

  return (
    <div style={{ height:"100vh", overflow:"hidden" }}>
      <Reader comic={comic} onClose={() => getCurrentWindow().close()} />
    </div>
  );
}

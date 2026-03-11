import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useStore } from "./store";
import Sidebar from "./components/Sidebar";
import Library from "./components/Library";
import ComicDetail from "./components/ComicDetail";
import Settings from "./components/Settings";
import ReaderWindow from "./components/ReaderWindow";

// ── Detect which Tauri window we are ─────────────────────────────────────────
// The reader window loads index.html#reader; the main window loads index.html
function isReaderWindow(): boolean {
  if (typeof window === "undefined") return false;
  // Primary: hash set by open_reader_window Rust command
  if (window.location.hash === "#reader") return true;
  // Fallback: Tauri v1 metadata
  try {
    const meta = (window as any).__TAURI_INTERNALS__?.metadata
              ?? (window as any).__TAURI_METADATA__;
    if (meta?.currentWindow?.label === "reader") return true;
  } catch {}
  return false;
}

// ── Error Boundary ────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
          height:"100vh", background:"#0C0C0E", color:"#F0EDE8", fontFamily:"monospace", padding:40, gap:16 }}>
          <p style={{ color:"#E8A830", fontSize:18, fontWeight:"bold" }}>Panels encountered an error</p>
          <pre style={{ background:"#18181D", padding:16, borderRadius:8, fontSize:12, color:"#f87171",
            maxWidth:700, overflowX:"auto", whiteSpace:"pre-wrap", wordBreak:"break-all" }}>
            {this.state.error.message}{"\n\n"}{this.state.error.stack}
          </pre>
          <button onClick={() => this.setState({ error: null })}
            style={{ background:"#E8A830", color:"#0C0C0E", border:"none", borderRadius:8,
              padding:"10px 24px", fontWeight:"bold", cursor:"pointer", fontSize:14 }}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Splash / error screens ────────────────────────────────────────────────────
function Splash() {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      height:"100vh", background:"#0C0C0E", gap:16 }}>
      <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:32, letterSpacing:4, color:"#E8A830" }}>
        PANELS
      </span>
      <div style={{ width:24, height:24, border:"2px solid #3A3A4A", borderTopColor:"#E8A830",
        borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function StartupError({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      height:"100vh", background:"#0C0C0E", color:"#F0EDE8", fontFamily:"monospace", padding:40, gap:16 }}>
      <p style={{ color:"#E8A830", fontSize:18 }}>⚠ Backend connection failed</p>
      <pre style={{ background:"#18181D", padding:16, borderRadius:8, fontSize:12, color:"#f87171",
        maxWidth:700, whiteSpace:"pre-wrap" }}>{msg}</pre>
      <button onClick={onRetry}
        style={{ background:"#E8A830", color:"#0C0C0E", border:"none", borderRadius:8,
          padding:"10px 24px", fontWeight:"bold", cursor:"pointer" }}>
        Retry
      </button>
    </div>
  );
}

// ── Main library window ───────────────────────────────────────────────────────
function MainApp() {
  const { view, loadLibrary, loadSources } = useStore();
  const [ready, setReady]               = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const init = React.useCallback(async () => {
    setError(null);
    let attempts = 0;
    const tryInit = async () => {
      attempts++;
      try {
        await loadLibrary();
        await loadSources();
        setReady(true);
        // Fire-and-forget: generate any missing cover thumbnails in parallel
        invoke("precache_all_covers").catch(() => {});
      } catch (e: any) {
        if (attempts < 20) setTimeout(tryInit, 300);
        else {
          setError(String(e?.message ?? e) + "\n\nMake sure 'npm run tauri dev' is running.");
          setReady(true);
        }
      }
    };
    tryInit();
  }, [loadLibrary, loadSources]);

  useEffect(() => { init(); }, [init]);

  if (!ready)  return <Splash />;
  if (error)   return <StartupError msg={error} onRetry={() => { setReady(false); init(); }} />;

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ background:"var(--bg)" }}>
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        {view === "library"  && <Library />}
        {view === "detail"   && <ComicDetail />}
        {view === "settings" && <Settings />}
      </main>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const reader = isReaderWindow();
  return (
    <ErrorBoundary>
      {reader ? <ReaderWindow /> : <MainApp />}
    </ErrorBoundary>
  );
}

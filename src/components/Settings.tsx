import React, { useEffect } from "react";
import { Folder, Trash2, Plus } from "lucide-react";
import { useStore } from "../store";

export default function Settings() {
  const { sources, loadSources, removeSource, openAddFolder } = useStore();

  useEffect(() => { loadSources(); }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div
        data-tauri-drag-region
        className="px-8 py-5"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)" }}
      >
        <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 2, color: "var(--text)" }}>
          SETTINGS
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-8 max-w-2xl">
        <Section title="Library Sources">
          <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16, lineHeight: 1.6 }}>
            Panels scans these folders for CBZ and CBR files. Adding a folder again will skip already-catalogued files.
          </p>

          <div className="flex flex-col gap-2 mb-4">
            {sources.length === 0 && (
              <p style={{ fontSize: 13, color: "var(--text3)", fontStyle: "italic" }}>No sources added yet.</p>
            )}
            {sources.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 px-4 py-3 rounded-xl"
                style={{ background: "var(--bg3)", border: "1px solid var(--border)" }}
              >
                <Folder size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />
                <span className="flex-1 truncate text-sm" style={{ color: "var(--text)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
                  {s.path}
                </span>
                <button
                  onClick={() => removeSource(s.id)}
                  className="p-1.5 rounded-lg transition-all"
                  style={{ color: "var(--text3)" }}
                  title="Remove source"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={openAddFolder}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
            style={{ background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text2)" }}
          >
            <Plus size={15} />
            Add Folder
          </button>
        </Section>

        <Section title="CBR Support">
          <div
            className="rounded-xl p-4 text-sm"
            style={{ background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text2)", lineHeight: 1.8 }}
          >
            <p>CBZ files work out of the box. For CBR (RAR) files, Panels uses your system's <code style={{ color: "var(--accent)", fontFamily: "monospace" }}>bsdtar</code> or <code style={{ color: "var(--accent)", fontFamily: "monospace" }}>unrar</code>.</p>
            <p className="mt-2">If CBR files fail to load, install <strong style={{ color: "var(--text)" }}>unar</strong>:</p>
            <pre
              className="mt-2 px-3 py-2 rounded-lg"
              style={{ background: "var(--bg4)", color: "var(--accent)", fontSize: 12, fontFamily: "monospace" }}
            >
              brew install unar
            </pre>
          </div>
        </Section>

        <Section title="About">
          <div className="text-sm" style={{ color: "var(--text2)", lineHeight: 2 }}>
            <p><span style={{ color: "var(--text)" }}>Panels</span> v0.1.0</p>
            <p>A comic reader and library manager built with Tauri + React.</p>
            <p style={{ marginTop: 8, color: "var(--text3)", fontSize: 12 }}>
              Database stored at: <code style={{ fontFamily: "monospace", color: "var(--text2)" }}>~/.local/share/panels/panels.db</code>
            </p>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-10">
      <h2
        className="mb-4"
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 3,
          color: "var(--text3)",
          borderBottom: "1px solid var(--border)",
          paddingBottom: 8,
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

/**
 * FolderCard — top-level collection tile.
 * Only loads the FIRST comic's cover (to minimise IPC at startup).
 * Shows an animated stack suggesting there are more comics inside.
 */
import { useState, useEffect, useRef } from "react";
import { loadCover } from "../store/coverQueue";
import { FolderOpen, AlertCircle, Trash2 } from "lucide-react";
import { useStore } from "../store";
import type { Comic } from "../types";

interface Props {
  name:    string;
  comics:  Comic[];
  onClick: () => void;
}

export default function FolderCard({ name, comics, onClick }: Props) {
  const ref     = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const { deleteFolder } = useStore();
  const folderPath = comics[0]?.file_path ? comics[0].file_path.split("/").slice(0, -1).join("/") : "";
  const isMissing = comics.some((c) => c.missing);

  // Only load covers once the card enters the viewport
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { obs.disconnect(); setVisible(true); }
    }, { rootMargin: "300px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const read    = comics.filter((c) => c.read_status === "read").length;
  const reading = comics.filter((c) => c.read_status === "reading").length;
  const unread  = comics.length - read - reading;

  return (
    <button
      ref={ref}
      onClick={onClick}
      className="group text-left focus:outline-none"
      style={{
        background: "var(--bg2)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
        transition: "border-color 0.2s, transform 0.2s, box-shadow 0.2s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)";
        (e.currentTarget as HTMLElement).style.transform   = "translateY(-2px)";
        (e.currentTarget as HTMLElement).style.boxShadow  = "0 8px 32px rgba(0,0,0,0.4)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
        (e.currentTarget as HTMLElement).style.transform   = "translateY(0)";
        (e.currentTarget as HTMLElement).style.boxShadow  = "none";
      }}
    >
      {/* Cover stack area */}
      <div
        style={{
          position: "relative",
          height: 150,
          background: "var(--bg3)",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <StackedCovers comics={comics} visible={visible} />

        {/* Comic count badge */}
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "rgba(0,0,0,0.65)",
            color: "var(--accent)",
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 10,
            fontWeight: 600,
            padding: "2px 7px",
            borderRadius: 20,
            backdropFilter: "blur(4px)",
          }}
        >
           {comics.length}
        </div>

        {/* Missing Badge */}
        {isMissing && (
          <div
            className="absolute top-2 left-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-red-500/90 text-white"
            style={{ backdropFilter: "blur(4px)", boxShadow: "0 2px 12px rgba(0,0,0,0.4)" }}
          >
            <AlertCircle size={12} strokeWidth={3} />
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase" }}>Missing</span>
          </div>
        )}

        {/* Hover overlay for Folder Action */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.4) 0%, transparent 40%)" }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Remove this entire collection ("${name}") from your library? (Files on disk will NOT be deleted)`)) {
                deleteFolder(folderPath);
              }
            }}
            className="absolute bottom-2 right-2 p-2 rounded-lg bg-black/60 hover:bg-red-500/90 text-white transition-all pointer-events-auto shadow-lg"
            title="Remove Collection from Library"
            style={{ backdropFilter: "blur(4px)" }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: "12px 14px 14px" }}>
        <div className="flex items-center gap-1.5 mb-2">
          <FolderOpen size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <p
            className="truncate"
            style={{
              fontFamily: "'Bebas Neue',sans-serif",
              fontSize: 17,
              letterSpacing: 1.2,
              color: "var(--text)",
              lineHeight: 1,
            }}
          >
            {name}
          </p>
        </div>

        {/* Mini progress bar */}
        {comics.length > 0 && (
          <div style={{ display: "flex", height: 3, borderRadius: 2, overflow: "hidden", background: "var(--bg4)" }}>
            <div style={{ width: `${(read / comics.length) * 100}%`, background: "#4ade80" }} />
            <div style={{ width: `${(reading / comics.length) * 100}%`, background: "var(--accent)" }} />
            <div style={{ width: `${(unread / comics.length) * 100}%`, background: "var(--bg4)" }} />
          </div>
        )}

        <div className="flex gap-3 mt-2">
          {read    > 0 && <Stat value={read}    label="read"    color="#4ade80" />}
          {reading > 0 && <Stat value={reading} label="reading" color="var(--accent)" />}
          {unread  > 0 && <Stat value={unread}  label="unread"  color="var(--text3)" />}
        </div>
      </div>
    </button>
  );
}

// ── Stacked cover art ──────────────────────────────────────────────────────────

function StackedCovers({ comics, visible }: { comics: Comic[]; visible: boolean }) {
  // We want to show up to 3 different covers in the stack.
  // We'll pass the whole comics array so the inner components can find a valid image.
  return (
    <div style={{ position: "relative", width: 90, height: 130 }}>
      {[2, 1, 0].map((stackIndex) => (
        <SingleStackLayer
          key={stackIndex}
          comics={comics}
          visible={visible}
          stackIndex={stackIndex} // 0 = front, 1 = middle, 2 = back
        />
      ))}
    </div>
  );
}

function SingleStackLayer({ comics, visible, stackIndex }: {
  comics: Comic[]; visible: boolean; stackIndex: number;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;

    // Logic: Try to find a cover for this stack position.
    // Front (0) tries comic 0, then 1, 2...
    // Middle (1) tries comic 1, then 2, 3...
    // Back (2) tries comic 2, then 3, 4...
    const tryLoad = async (offset: number) => {
      if (offset >= comics.length || offset > stackIndex + 5) {
        return;
      }
      const comic = comics[offset];
      try {
        const url = await loadCover(comic.id, comic.file_path);
        setSrc(url);
      } catch (e) {
        // If this comic failed (e.g. CBR and no unrar), try the next one
        tryLoad(offset + 1);
      }
    };

    tryLoad(stackIndex);
  }, [visible, comics, stackIndex]);

  const rotate = [-6, -3, 0][2 - stackIndex] || 0;
  const translateX = [stackIndex * -4, stackIndex * -2, 0][2 - stackIndex] || 0;
  const zIndex = 10 - stackIndex;
  const opacity = [0.6, 0.85, 1][2 - stackIndex] || 1;

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: 88,
        height: 120,
        borderRadius: 4,
        overflow: "hidden",
        background: src ? "none" : "var(--bg4)",
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: stackIndex === 0 ? "0 8px 16px rgba(0,0,0,0.5)" : "0 4px 8px rgba(0,0,0,0.3)",
        transform: `translate(-50%, -50%) translateX(${translateX}px) rotate(${rotate}deg)`,
        transition: "transform 0.5s cubic-bezier(0.2, 0, 0, 1), opacity 0.5s",
        zIndex,
        opacity: src ? opacity : 0.3,
      }}
    >
      {src && (
        <img
          src={src}
          alt="cover"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          className="animate-in fade-in duration-500"
        />
      )}
    </div>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <span style={{ fontSize: 10, color, fontFamily: "'IBM Plex Mono',monospace" }}>
      {value} {label}
    </span>
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
import { loadCover, placeholderColor } from "../store/coverQueue";
import { BookOpen, Trash2 } from "lucide-react";
import { useStore } from "../store";
import type { Comic } from "../types";

const STATUS_COLOR: Record<string, string> = {
  read:    "#4ade80",
  reading: "#E8A830",
  unread:  "#3A3A4A",
};

interface Props {
  comic:   Comic;
  onClick: () => void;
}

export default function ComicCard({ comic, onClick }: Props) {
  const [cover,   setCover]   = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [loaded,  setLoaded]  = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const deleteComic = useStore((s) => s.deleteComic);

  // Intersection observer — load cover when entering viewport
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { obs.disconnect(); setVisible(true); } },
      { rootMargin: "300px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    loadCover(comic.id, comic.file_path)
      .then((url) => { if (!cancelled) setCover(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [visible, comic.id, comic.file_path]);

  const progress =
    comic.page_count > 0
      ? Math.round((comic.current_page / comic.page_count) * 100)
      : 0;

  const placeholder = placeholderColor(comic.id);

  const onDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    deleteComic(comic.id);
  }, [comic.id, deleteComic]);

  const isMissing = comic.missing;

  return (
    <button
      ref={ref}
      onClick={onClick}
      className="group flex flex-col text-left focus:outline-none"
      style={{ background: "transparent", opacity: isMissing ? 0.45 : 1 }}
    >
      {/* Cover */}
      <div
        className="relative w-full overflow-hidden"
        style={{ aspectRatio: "2/3", borderRadius: 8, background: placeholder }}
      >
        {/* Missing: red diagonal stripe overlay */}
        {isMissing && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 4, borderRadius: 8,
            background: "repeating-linear-gradient(-45deg,rgba(239,68,68,0.18) 0px,rgba(239,68,68,0.18) 4px,transparent 4px,transparent 12px)",
            pointerEvents: "none",
          }} />
        )}

        {/* Real cover */}
        {cover && (
          <img
            src={cover}
            alt={comic.title}
            onLoad={() => setLoaded(true)}
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105"
            style={{
              transition: "opacity 0.25s ease, transform 0.3s ease",
              opacity: loaded ? 1 : 0,
              imageRendering: "auto",
            }}
            draggable={false}
          />
        )}

        {/* Fallback icon */}
        {visible && !cover && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 opacity-40">
            <BookOpen size={20} style={{ color: "var(--text3)" }} />
          </div>
        )}

        {/* Status dot */}
        <div
          className="absolute top-2 right-2 rounded-full"
          style={{
            width: 7, height: 7,
            background: STATUS_COLOR[comic.read_status] ?? STATUS_COLOR.unread,
            boxShadow: "0 0 0 1.5px rgba(0,0,0,0.5)",
          }}
        />

        {/* Reading progress bar */}
        {comic.read_status === "reading" && comic.page_count > 0 && (
          <div className="absolute bottom-0 left-0 right-0" style={{ height: 3, background: "rgba(0,0,0,0.4)" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: "var(--accent)" }} />
          </div>
        )}

        {/* Hover overlay with page count + trash */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.82) 0%, transparent 55%)" }}
        >
          {comic.page_count > 0 && (
            <span
              className="absolute bottom-2 right-2"
              style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", fontFamily: "'IBM Plex Mono',monospace" }}
            >
              {comic.page_count}p
            </span>
          )}

          {/* ── Trash button — removes from library, not from disk ── */}
          <button
            onClick={onDelete}
            title="Remove from library"
            style={{
              position: "absolute", top: 6, left: 6,
              width: 26, height: 26,
              background: "rgba(0,0,0,0.65)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "#f87171",
              backdropFilter: "blur(4px)",
              zIndex: 10,
            }}
          >
            <Trash2 size={12} />
          </button>

          {/* Missing badge */}
          {isMissing && (
            <span style={{
              position: "absolute", top: 6, right: 6,
              background: "rgba(239,68,68,0.85)", color: "#fff",
              fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
              padding: "2px 5px", borderRadius: 4,
              fontFamily: "'IBM Plex Mono',monospace",
              zIndex: 5,
            }}>
              MISSING
            </span>
          )}
        </div>
      </div>

      {/* Label */}
      <div className="px-0.5 pt-1.5 pb-1">
        <p className="truncate" style={{ fontSize: 11, fontWeight: 500, color: isMissing ? "var(--text3)" : "var(--text)", lineHeight: 1.3 }}>
          {comic.title || comic.file_name}
        </p>
        {comic.series && (
          <p className="truncate mt-0.5" style={{ fontSize: 10, color: "var(--text2)" }}>
            {comic.series}{comic.issue_number ? ` #${comic.issue_number}` : ""}
          </p>
        )}
      </div>
    </button>
  );
}

/**
 * FolderCard — top-level collection tile.
 *
 * Loads the first comic cover immediately on mount — no IntersectionObserver.
 * At the folder level there are typically < 50 cards, so loading all first
 * covers immediately is cheap and avoids grey cards entirely.
 */
import { useState, useEffect } from "react";
import { loadCover, placeholderColor } from "../store/coverQueue";
import { FolderOpen } from "lucide-react";
import type { Comic } from "../types";

interface Props {
  name:    string;
  comics:  Comic[];
  onClick: () => void;
}

export default function FolderCard({ name, comics, onClick }: Props) {
  const read    = comics.filter(c => c.read_status === "read").length;
  const reading = comics.filter(c => c.read_status === "reading").length;
  const unread  = comics.length - read - reading;

  // Load all 3 stack covers immediately — batch system handles the concurrency
  const stackComics = comics.slice(0, 3);

  return (
    <button
      onClick={onClick}
      className="group text-left focus:outline-none"
      style={{
        background: "var(--bg2)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
        transition: "border-color 0.2s, transform 0.2s, box-shadow 0.2s",
        width: "100%",
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = "var(--accent)";
        el.style.transform   = "translateY(-2px)";
        el.style.boxShadow   = "0 8px 32px rgba(0,0,0,0.4)";
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = "var(--border)";
        el.style.transform   = "translateY(0)";
        el.style.boxShadow   = "none";
      }}
    >
      {/* Cover stack */}
      <div style={{
        position: "relative", height: 150,
        background: "var(--bg3)", overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <StackedCovers comics={stackComics} />

        <div style={{
          position: "absolute", top: 8, right: 8,
          background: "rgba(0,0,0,0.65)", color: "var(--accent)",
          fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, fontWeight: 600,
          padding: "2px 7px", borderRadius: 20, backdropFilter: "blur(4px)",
        }}>
          {comics.length}
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: "12px 14px 14px" }}>
        <div className="flex items-center gap-1.5 mb-2">
          <FolderOpen size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <p className="truncate" style={{
            fontFamily: "'Bebas Neue',sans-serif", fontSize: 17,
            letterSpacing: 1.2, color: "var(--text)", lineHeight: 1,
          }}>
            {name}
          </p>
        </div>

        {comics.length > 0 && (
          <div style={{ display: "flex", height: 3, borderRadius: 2, overflow: "hidden", background: "var(--bg4)" }}>
            <div style={{ width: `${(read    / comics.length) * 100}%`, background: "#4ade80" }} />
            <div style={{ width: `${(reading / comics.length) * 100}%`, background: "var(--accent)" }} />
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

// ── Stack ─────────────────────────────────────────────────────────────────────

function StackedCovers({ comics }: { comics: Comic[] }) {
  const ROTATIONS = [-7, -2, 0];
  const OPACITIES = [0.5, 0.75, 1];

  return (
    <div style={{ position: "relative", width: 88, height: 120 }}>
      {/* Placeholder back-cards for folders with fewer than 3 comics */}
      {[0, 1, 2].map(i => (
        <div key={`bg-${i}`} style={{
          position: "absolute", inset: 0,
          borderRadius: 6,
          background: "var(--bg4)",
          border: "1px solid rgba(255,255,255,0.07)",
          transform: `rotate(${ROTATIONS[i]}deg)`,
          zIndex: i + 1,
        }} />
      ))}

      {/* Real cover cards (overwritten on top of placeholders) */}
      {comics.map((comic, i) => (
        <CoverCard
          key={comic.id}
          comic={comic}
          rotate={ROTATIONS[i]}
          zIndex={i + 10}
          opacity={OPACITIES[i]}
        />
      ))}
    </div>
  );
}

function CoverCard({ comic, rotate, zIndex, opacity }: {
  comic: Comic; rotate: number; zIndex: number; opacity: number;
}) {
  const [src, setSrc] = useState<string | null>(null);

  // Load immediately on mount — no IntersectionObserver needed
  useEffect(() => {
    let cancelled = false;
    loadCover(comic.id, comic.file_path)
      .then(url => { if (!cancelled) setSrc(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [comic.id, comic.file_path]);

  return (
    <div style={{
      position: "absolute", inset: 0,
      borderRadius: 6, overflow: "hidden",
      background: placeholderColor(comic.id),
      border: "1px solid rgba(255,255,255,0.08)",
      boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
      transform: `rotate(${rotate}deg)`,
      transition: "transform 0.3s cubic-bezier(0.34,1.56,0.64,1)",
      zIndex, opacity,
    }}>
      {src && (
        <img
          src={src}
          alt={comic.title}
          style={{
            width: "100%", height: "100%", objectFit: "cover",
            opacity: src ? 1 : 0,
            transition: "opacity 0.3s ease",
          }}
          draggable={false}
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

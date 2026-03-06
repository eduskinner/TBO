import { useState } from "react";
import { ChevronDown, ChevronRight, FolderOpen } from "lucide-react";
import CoverStack from "./CoverStack";
import ComicCard from "./ComicCard";
import type { Comic } from "../types";

interface Props {
  folderName: string;
  folderPath: string;
  comics:     Comic[];
  onOpen:     (comic: Comic) => void;
  defaultOpen?: boolean;
}

export default function FolderGroup({ folderName, comics, onOpen, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const read    = comics.filter((c) => c.read_status === "read").length;
  const reading = comics.filter((c) => c.read_status === "reading").length;

  return (
    <div
      style={{
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid var(--border)",
        background: "var(--bg2)",
        marginBottom: 24,
      }}
    >
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-4 text-left transition-colors"
        style={{
          padding: "14px 20px",
          background: open ? "var(--bg3)" : "var(--bg2)",
          borderBottom: open ? "1px solid var(--border)" : "none",
          cursor: "pointer",
        }}
      >
        {/* Cover stack */}
        <div style={{ flexShrink: 0 }}>
          <CoverStack comics={comics} size={56} />
        </div>

        {/* Folder info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <FolderOpen size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
            <span
              className="truncate"
              style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 20,
                letterSpacing: 1.5,
                color: "var(--text)",
                lineHeight: 1,
              }}
            >
              {folderName}
            </span>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-3 mt-1.5">
            <Badge value={comics.length}  label="comics"  color="var(--text3)" />
            {read    > 0 && <Badge value={read}    label="read"    color="#4ade80" />}
            {reading > 0 && <Badge value={reading} label="reading" color="var(--accent)" />}
          </div>
        </div>

        {/* Chevron */}
        <div style={{ color: "var(--text3)", flexShrink: 0 }}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
      </button>

      {/* Comic grid */}
      {open && (
        <div style={{ padding: "16px 20px 20px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              gap: 16,
            }}
          >
            {comics.map((comic) => (
              <ComicCard key={comic.id} comic={comic} onClick={() => onOpen(comic)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <span style={{ fontSize: 11, color, fontFamily: "'IBM Plex Mono', monospace" }}>
      {value} {label}
    </span>
  );
}

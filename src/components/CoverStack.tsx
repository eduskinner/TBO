/**
 * Displays up to 3 comic covers in an animated fan/stack.
 * Fans out on hover to reveal the layering.
 */
import { useState, useEffect } from "react";
import { loadCover } from "../store/coverQueue";
import type { Comic } from "../types";

interface Props {
  comics: Comic[];     // will use first 3
  size?:  number;      // base width of front card, default 72
}

export default function CoverStack({ comics, size = 72 }: Props) {
  const slots  = comics.slice(0, 3);
  const h      = Math.round(size * 1.5);
  const [hovered, setHovered] = useState(false);

  // Each card: { rotate deg, translateX px, translateY px }
  // [rotate-deg, translateX-px, translateY-px] for each of the 3 cards
  const restPose:  number[][] = [[-7, -9, 3], [-3, -4, 1], [0, 0, 0]];
  const hoverPose: number[][] = [[-14, -18, 6], [-5, -7, 2], [0, 0, 0]];
  const poses = hovered ? hoverPose : restPose;

  return (
    <div
      style={{ position: "relative", width: size + 20, height: h + 8, flexShrink: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {slots.map((comic, i) => (
        <CoverCard
          key={comic.id}
          comic={comic}
          width={size}
          height={h}
          rotate={poses[i][0]}
          tx={poses[i][1]}
          ty={poses[i][2]}
          zIndex={i + 1}
        />
      ))}
      {/* Placeholder cards when < 3 comics */}
      {slots.length < 3 && Array.from({ length: 3 - slots.length }).map((_, i) => (
        <div
          key={`ph-${i}`}
          style={{
            position: "absolute", inset: 0,
            width: size, height: h,
            borderRadius: 6,
            background: "var(--bg4)",
            border: "1px solid var(--border)",
            transform: `rotate(${poses[slots.length + i][0]}deg) translate(${poses[slots.length + i][1]}px, ${poses[slots.length + i][2]}px)`,
            transition: "transform 0.3s ease",
            zIndex: slots.length + i + 1,
          }}
        />
      ))}
    </div>
  );
}

function CoverCard({ comic, width, height, rotate, tx, ty, zIndex }: {
  comic: Comic; width: number; height: number;
  rotate: number; tx: number; ty: number; zIndex: number;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCover(comic.id, comic.file_path)
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [comic.id, comic.file_path]);

  return (
    <div
      style={{
        position: "absolute", inset: 0,
        width, height,
        borderRadius: 6,
        overflow: "hidden",
        background: "var(--bg4)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
        transform: `rotate(${rotate}deg) translate(${tx}px, ${ty}px)`,
        transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
        zIndex,
      }}
    >
      {src && (
        <img
          src={src}
          alt={comic.title}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          draggable={false}
        />
      )}
      {!src && <div style={{ width: "100%", height: "100%" }} className="skeleton" />}
    </div>
  );
}

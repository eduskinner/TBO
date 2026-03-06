import React, {
  useState, useEffect, useCallback, useRef, useMemo,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  Maximize2, Minimize2, X, Settings2, BookOpen, ZoomIn,
  ZoomIn as ZoomInIcon, ZoomOut, Scan,
} from "lucide-react";
import type { Comic } from "../types";
import type { ReaderLayout, ReaderDirection } from "../types";
import {
  loadPageHigh, loadPageLow, getCachedPage, isPageCached,
} from "../store/pageQueue";

// ── Guided-mode panel zones ──────────────────────────────────────────────────
const GUIDED_PORTRAIT: [number,number,number,number][] = [
  [0, 0, 0.55, 0.52], [0.45, 0, 1, 0.52],
  [0, 0.48, 0.55, 1],  [0.45, 0.48, 1, 1],
];
const GUIDED_LANDSCAPE: [number,number,number,number][] = [
  [0, 0, 0.38, 1], [0.31, 0, 0.69, 1], [0.62, 0, 1, 1],
];

interface Props { comic: Comic; onClose?: () => void; }
interface GuidedPos { page: number; zone: number; }
interface PanelRect { x: number; y: number; w: number; h: number; }

// ── Main component ───────────────────────────────────────────────────────────
export default function Reader({ comic, onClose }: Props) {
  const [totalPages,   setTotalPages]   = useState(0);
  const [currentPage,  setCurrentPage]  = useState(comic.current_page ?? 0);
  const [pageCache,    setPageCache]    = useState<Record<number, string>>({});
  const [hideUI,       setHideUI]       = useState(false);
  const [stripOpen,    setStripOpen]    = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [layout,       setLayout]       = useState<ReaderLayout>("single");
  const [direction,    setDirection]    = useState<ReaderDirection>("ltr");
  const [guidedPos,    setGuidedPos]    = useState<GuidedPos>({ page: 0, zone: 0 });
  const [imgDims,      setImgDims]      = useState<{ w: number; h: number } | null>(null);
  const [detectedPanels, setDetectedPanels] = useState<PanelRect[]>([]);

  // Filmstrip height — stored in a ref AND state so resize drag sees live value
  const stripHeightRef = useRef(96);
  const [stripHeight,  setStripHeight]  = useState(96);

  // Zoom state — scale factor and pan offset for the reading pane
  const [zoom,    setZoom]    = useState(1);
  const [panX,    setPanX]    = useState(0);
  const [panY,    setPanY]    = useState(0);
  const isPanning  = useRef(false);
  const lastPan    = useRef({ x: 0, y: 0 });

  const stripRef      = useRef<HTMLDivElement>(null);
  const imgRef        = useRef<HTMLImageElement>(null);
  const bgCrawlerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filePath = comic.file_path;

  // ── Helpers to update pageCache from queue results ───────────────────────
  const applyPage = useCallback((idx: number, data: string) => {
    setPageCache((prev) => prev[idx] === data ? prev : { ...prev, [idx]: data });
  }, []);

  // ── High-priority load (main reading pane) ───────────────────────────────
  const loadHigh = useCallback((idx: number) => {
    if (idx < 0 || idx >= totalPages) return;
    const cached = getCachedPage(filePath, idx);
    if (cached) { applyPage(idx, cached); return; }
    loadPageHigh(filePath, idx)
      .then((d) => applyPage(idx, d))
      .catch(() => {});
  }, [filePath, totalPages, applyPage]);

  // ── Low-priority load (thumbnails / background) ─────────────────────────
  const loadLow = useCallback((idx: number) => {
    if (idx < 0 || idx >= totalPages) return;
    if (isPageCached(filePath, idx)) {
      const d = getCachedPage(filePath, idx);
      if (d) applyPage(idx, d);
      return;
    }
    loadPageLow(filePath, idx)
      .then((d) => applyPage(idx, d))
      .catch(() => {});
  }, [filePath, totalPages, applyPage]);

  // ── Background thumbnail crawler ─────────────────────────────────────────
  // After totalPages is known, crawl all pages in order from current page
  // outward. Runs at LOW priority. Cancels and restarts if page changes.
  const startBgCrawler = useCallback((from: number, total: number) => {
    if (bgCrawlerRef.current) clearTimeout(bgCrawlerRef.current);

    // Build order: from, from±1, from±2 … expanding outward
    const order: number[] = [from];
    for (let d = 1; d < total; d++) {
      if (from + d < total) order.push(from + d);
      if (from - d >= 0)    order.push(from - d);
    }

    let i = 0;
    const tick = () => {
      // Skip pages that are already loaded
      while (i < order.length && isPageCached(filePath, order[i])) i++;
      if (i >= order.length) return;

      loadLow(order[i]);
      i++;

      // Schedule next with a small gap so we don't flood
      bgCrawlerRef.current = setTimeout(tick, 120);
    };
    // Start after a brief delay to let HIGH-priority loads fire first
    bgCrawlerRef.current = setTimeout(tick, 500);
  }, [filePath, loadLow]);

  // ── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    setPageCache({});
    setTotalPages(0);
    setImgDims(null);
    if (bgCrawlerRef.current) clearTimeout(bgCrawlerRef.current);

    const startPage = comic.current_page ?? 0;
    setCurrentPage(startPage);
    setGuidedPos({ page: startPage, zone: 0 });

    // 1. Load FIRST page immediately at HIGH priority — user can start reading
    //    before the page count even comes back.
    loadPageHigh(filePath, startPage)
      .then((d) => applyPage(startPage, d))
      .catch(() => {});

    invoke<number>("get_page_count", { filePath })
      .then((n) => {
        setTotalPages(n);
        // 2. Pre-fetch next two pages at HIGH priority
        if (startPage + 1 < n) loadPageHigh(filePath, startPage + 1)
          .then((d) => applyPage(startPage + 1, d)).catch(() => {});
        if (startPage + 2 < n) loadPageHigh(filePath, startPage + 2)
          .then((d) => applyPage(startPage + 2, d)).catch(() => {});
        // 3. Start background crawler for thumbnails
        startBgCrawler(startPage, n);
      })
      .catch(console.error);

    return () => { if (bgCrawlerRef.current) clearTimeout(bgCrawlerRef.current); };
  }, [comic.id, filePath]); // eslint-disable-line

  // ── Pre-fetch when page changes ──────────────────────────────────────────
  // Immediately load current + next + prev at HIGH, then restart bg crawler
  useEffect(() => {
    if (totalPages === 0) return;
    loadHigh(currentPage);
    loadHigh(currentPage + 1);
    loadHigh(currentPage + 2);
    if (currentPage > 0) loadHigh(currentPage - 1);
    startBgCrawler(currentPage, totalPages);
  }, [currentPage, totalPages]); // eslint-disable-line

  // ── Guided zones ─────────────────────────────────────────────────────────
  // Fetch panels from Rust CV detector when entering guided mode or changing page
  useEffect(() => {
    if (layout !== "guided" || totalPages === 0) {
      setDetectedPanels([]);
      return;
    }
    const pageIndex = guidedPos.page;
    invoke<PanelRect[]>("get_page_panels", { filePath, pageIndex })
      .then((panels) => {
        // Sort panels based on reading direction
        const sorted = [...panels].sort((a, b) => {
          const rowThreshold = 0.12 * imgDims!.h; // 12% of height
          const yDiff = Math.abs(a.y - b.y);
          if (yDiff < rowThreshold) {
            return direction === "rtl" ? b.x - a.x : a.x - b.x;
          }
          return a.y - b.y;
        });
        setDetectedPanels(sorted);
      })
      .catch(console.error);
  }, [layout, filePath, guidedPos.page, totalPages, imgDims, direction]);

  const guidedZones = useMemo(() => {
    const base = (!imgDims || detectedPanels.length === 0)
      ? (imgDims && imgDims.w > imgDims.h ? GUIDED_LANDSCAPE : GUIDED_PORTRAIT)
      : detectedPanels.map(p => [
          p.x / imgDims.w,
          p.y / imgDims.h,
          (p.x + p.w) / imgDims.w,
          (p.y + p.h) / imgDims.h
        ] as [number, number, number, number]);

    // Prepend [0,0,1,1] (Full Page Overview) so that every page starts fully visible (Comixology style)
    return [[0, 0, 1, 1] as [number, number, number, number], ...base];
  }, [imgDims, detectedPanels]);

  const effectivePage = layout === "guided" ? guidedPos.page : currentPage;

  // ── Navigation ───────────────────────────────────────────────────────────
  const saveProgress = useCallback((page: number) => {
    invoke("update_reading_progress", { comicId: comic.id, currentPage: page }).catch(() => {});
  }, [comic.id]);

  const goForward = useCallback(() => {
    if (layout === "guided") {
      setGuidedPos((pos) => {
        if (pos.zone < guidedZones.length - 1) return { ...pos, zone: pos.zone + 1 };
        const next = direction === "rtl"
          ? Math.max(0, pos.page - 1) : Math.min(totalPages - 1, pos.page + 1);
        if (next === pos.page) return pos;
        setCurrentPage(next); saveProgress(next);
        // Important: Reset zone to 0 when moving to the next page
        return { page: next, zone: 0 };
      });
    } else {
      setCurrentPage((p) => {
        const next = direction === "rtl" ? Math.max(0, p - 1) : Math.min(totalPages - 1, p + 1);
        if (next !== p) saveProgress(next);
        return next;
      });
    }
  }, [layout, direction, totalPages, guidedZones.length, saveProgress]);

  const goBack = useCallback(() => {
    if (layout === "guided") {
      setGuidedPos((pos) => {
        if (pos.zone > 0) return { ...pos, zone: pos.zone - 1 };
        const prev = direction === "rtl"
          ? Math.min(totalPages - 1, pos.page + 1) : Math.max(0, pos.page - 1);
        if (prev === pos.page) return pos;
        setCurrentPage(prev); saveProgress(prev);
        // We don't know the new page's zone count yet, so we'll just go to its start 
        // and user can click back once more if they want the last panel.
        // Usually, moving "Back" to a previous page starts at the Full Page overview (zone 0).
        return { page: prev, zone: 0 };
      });
    } else {
      setCurrentPage((p) => {
        const next = direction === "rtl" ? Math.min(totalPages - 1, p + 1) : Math.max(0, p - 1);
        if (next !== p) saveProgress(next);
        return next;
      });
    }
  }, [layout, direction, totalPages, guidedZones.length, saveProgress]);

  const goToPage = useCallback((p: number) => {
    setCurrentPage(p);
    setGuidedPos({ page: p, zone: 0 });
    saveProgress(p);
    // Reset zoom when jumping to a specific page
    setZoom(1); setPanX(0); setPanY(0);
  }, [saveProgress]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (["ArrowRight","ArrowDown"," "].includes(e.key)) { e.preventDefault(); goForward(); }
      if (["ArrowLeft", "ArrowUp"       ].includes(e.key)) { e.preventDefault(); goBack(); }
      if (e.key === "f") setHideUI((v) => !v);
      if (e.key === "s") setStripOpen((v) => !v);
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(5, +(z + 0.25).toFixed(2)));
      if (e.key === "-") setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)));
      if (e.key === "0") { setZoom(1); setPanX(0); setPanY(0); }
      if (e.key === "Escape") { if (zoom > 1) { setZoom(1); setPanX(0); setPanY(0); } else if (showSettings) setShowSettings(false); else onClose?.(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [goForward, goBack, onClose, showSettings]);

  // ── Wheel zoom (ctrl+scroll or trackpad pinch) ────────────────────────────
  const pageAreaRef = useRef<HTMLDivElement>(null);

  // Safely reset pan when zoom hits 1
  useEffect(() => {
    if (zoom <= 1.01) {
      setPanX(0);
      setPanY(0);
    }
  }, [zoom]);
  useEffect(() => {
    const el = pageAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.008;
      setZoom((z) => Math.min(5, Math.max(1, z + delta * z)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Pan when zoomed (mouse drag) ─────────────────────────────────────────
  const onPanStart = useCallback((e: React.MouseEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    isPanning.current = true;
    lastPan.current = { x: e.clientX, y: e.clientY };
    const onMove = (ev: MouseEvent) => {
      if (!isPanning.current) return;
      const dx = ev.clientX - lastPan.current.x;
      const dy = ev.clientY - lastPan.current.y;
      lastPan.current = { x: ev.clientX, y: ev.clientY };
      setPanX((x) => x + dx);
      setPanY((y) => y + dy);
    };
    const onUp = () => {
      isPanning.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }, [zoom]);
  // We use a ref for height so the mousemove handler always sees the live value.
  const onResizeDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY   = e.clientY;
    const startH   = stripHeightRef.current;

    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;      // drag UP → positive → bigger
      const next  = Math.min(240, Math.max(56, startH + delta));
      stripHeightRef.current = next;
      setStripHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }, []);

  // ── Scroll filmstrip to active thumb ─────────────────────────────────────
  useEffect(() => {
    if (!stripOpen || !stripRef.current) return;
    const el = stripRef.current.querySelector(
      `[data-page="${effectivePage}"]`
    ) as HTMLElement | null;
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [effectivePage, stripOpen]);

  // ── Guided CSS ────────────────────────────────────────────────────────────
  const guidedStyle = useMemo((): React.CSSProperties => {
    if (layout !== "guided") return {};
    const [x1, y1, x2, y2] = guidedZones[guidedPos.zone] ?? [0,0,1,1];
    
    const zw = Math.max(0.1, x2 - x1);
    const zh = Math.max(0.1, y2 - y1);
    
    // Full page case (0,0,1,1) -> scale 1
    const isFullPage = x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1;
    const scale = isFullPage 
      ? 1 
      : Math.min(5, Math.min(1 / zw, 1 / zh) * 0.94); // Fit with 6% safe margin
    
    // Smooth centering
    const transX = (0.5 - (x1 + zw / 2)) * 100;
    const transY = (0.5 - (y1 + zh / 2)) * 100;

    return {
      transform: `scale(${scale}) translate(${transX}%, ${transY}%)`,
      transformOrigin: "center center",
      transition: "transform 0.45s cubic-bezier(0.2, 0, 0, 1)",
    };
  }, [layout, guidedZones, guidedPos.zone]);

  const src          = pageCache[effectivePage];
  const pct          = totalPages > 0 ? ((effectivePage + 1) / totalPages) * 100 : 0;
  const canGoBack    = direction === "ltr" ? effectivePage > 0 : effectivePage < totalPages - 1;
  const canGoForward = direction === "ltr" ? effectivePage < totalPages - 1 : effectivePage > 0;

  return (
    <div className="flex flex-col"
      style={{ height: "100vh", background: "#050507", userSelect: "none", overflow: "hidden" }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      {!hideUI && (
        <div className="flex items-center gap-3 px-4 py-2 flex-shrink-0"
          style={{ background: "rgba(8,8,12,0.96)", backdropFilter: "blur(10px)",
                   borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {onClose && (
            <button onClick={onClose} className="flex items-center gap-1"
              style={{ color: "var(--text3)", fontSize: 12, background: "none", border: "none", cursor: "pointer" }}>
              <X size={13} /> Close
            </button>
          )}

          <div className="flex-1 truncate text-center" style={{ fontSize: 12, color: "var(--text2)" }}>
            <span style={{ color: "var(--text)" }}>{comic.title}</span>
            {comic.series && (
              <span style={{ color: "var(--text3)" }}>
                {" · "}{comic.series}{comic.issue_number ? ` #${comic.issue_number}` : ""}
              </span>
            )}
          </div>

          {direction === "rtl" && (
            <span style={{ fontSize: 10, color: "var(--accent)", background: "rgba(232,168,48,0.15)",
              padding: "1px 7px", borderRadius: 10, fontFamily: "monospace" }}>MANGA</span>
          )}
          {layout === "guided" && (
            <span style={{ fontSize: 10, color: "#a78bfa", background: "rgba(167,139,250,0.15)",
              padding: "1px 7px", borderRadius: 10, fontFamily: "monospace" }}>
              GUIDED {guidedPos.zone + 1}/{guidedZones.length}
            </span>
          )}

          <button onClick={() => setShowSettings((v) => !v)} title="Reader settings (comma)"
            style={{ color: showSettings ? "var(--accent)" : "var(--text3)",
                     background: "none", border: "none", cursor: "pointer", padding: "2px 4px" }}>
            <Settings2 size={14} />
          </button>

          <button onClick={() => setHideUI(true)} title="Immersive mode (F)"
            style={{ color: "var(--text3)", background: "none", border: "none",
                     cursor: "pointer", padding: "2px 4px" }}>
            <Maximize2 size={13} />
          </button>
        </div>
      )}

      {/* ── Settings drawer ──────────────────────────────────────────────── */}
      {showSettings && !hideUI && (
        <SettingsDrawer
          layout={layout}
          direction={direction}
          onLayout={(l) => { setLayout(l); setGuidedPos({ page: effectivePage, zone: 0 }); }}
          onDirection={setDirection}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* ── Reading pane ─────────────────────────────────────────────────── */}
      <div className="flex-1 relative flex items-center justify-center"
        style={{ overflow: "hidden", minHeight: 0 }}>

        {/* Left nav — only show when not zoomed in (zoom hides nav for panning) */}
        {zoom <= 1 && (
          <NavArrow
            side="left"
            enabled={canGoBack}
            onClick={goBack}
            icon={direction === "ltr" ? <ChevronLeft size={20}/> : <ChevronRight size={20}/>}
          />
        )}

        {/* Page */}
        <div
          ref={pageAreaRef}
          className="relative flex items-center justify-center w-full h-full"
          style={{
            overflow: "hidden",
            cursor: zoom > 1 ? "grab" : "default",
          }}
          onMouseDown={onPanStart}
          onClick={(e) => {
            if (zoom > 1) return;  // no navigation while zoomed — use arrows
            if (showSettings) return;
            const r = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - r.left;
            if (x < r.width * 0.14 || x > r.width * 0.86) return;
            if (x < r.width / 2) goBack(); else goForward();
          }}
        >
          {!src ? (
            <Spinner />
          ) : (
            <img
              ref={imgRef}
              key={`${effectivePage}-${layout}`}
              src={src}
              alt={`Page ${effectivePage + 1}`}
              onLoad={() => {
                const img = imgRef.current;
                if (img) setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
              }}
              className="fade-in"
              style={{
                height: "auto",
                maxHeight: "100%",
                maxWidth: "100%",
                objectFit: "contain",
                display: "block",
                transform: layout === "guided" 
                  ? `${guidedStyle.transform ?? ""} scale(${zoom}) translate(${panX / zoom}px, ${panY / zoom}px)`
                  : zoom > 1 
                    ? `scale(${zoom}) translate(${panX / zoom}px, ${panY / zoom}px)` 
                    : "none",
                transformOrigin: "center center",
                transition: zoom > 1 ? "none" : (guidedStyle.transition ?? "transform 0.4s ease-out"),
                willChange: "transform",
              }}
              draggable={false}
            />
          )}
        </div>

        {/* Right nav */}
        {zoom <= 1 && (
          <NavArrow
            side="right"
            enabled={canGoForward}
            onClick={goForward}
            icon={direction === "ltr" ? <ChevronRight size={20}/> : <ChevronLeft size={20}/>}
          />
        )}

        {/* Zoom controls — float bottom-right of the pane */}
        {!hideUI && (
          <div
            style={{
              position: "absolute", bottom: 12, right: 12, zIndex: 15,
              display: "flex", alignItems: "center", gap: 2,
              background: "rgba(8,8,12,0.75)", backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 20, padding: "3px 6px",
            }}
          >
            <ZoomBtn onClick={() => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))} title="Zoom out  (−)"><ZoomOut size={13}/></ZoomBtn>
            <span
              style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", fontFamily: "monospace",
                       minWidth: 34, textAlign: "center", cursor: "pointer" }}
              onClick={() => { setZoom(1); setPanX(0); setPanY(0); }}
              title="Reset zoom"
            >
              {zoom === 1 ? "1×" : `${zoom.toFixed(1)}×`}
            </span>
            <ZoomBtn onClick={() => setZoom((z) => Math.min(5, +(z + 0.25).toFixed(2)))} title="Zoom in  (+)"><ZoomInIcon size={13}/></ZoomBtn>
            {zoom !== 1 && (
              <ZoomBtn onClick={() => { setZoom(1); setPanX(0); setPanY(0); }} title="Reset"><Scan size={12}/></ZoomBtn>
            )}
          </div>
        )}

        {/* Immersive restore */}
        {hideUI && (
          <button onClick={() => setHideUI(false)}
            style={{ position: "absolute", top: 10, right: 10, zIndex: 20,
              background: "rgba(0,0,0,0.55)", color: "var(--text2)", border: "none",
              borderRadius: 8, padding: "5px 8px", cursor: "pointer" }}>
            <Minimize2 size={12} />
          </button>
        )}
      </div>

      {/* ── Progress bar ─────────────────────────────────────────────────── */}
      {!hideUI && (
        <div className="flex items-center gap-3 px-4 py-2 flex-shrink-0"
          style={{ background: "rgba(8,8,12,0.96)", backdropFilter: "blur(10px)",
                   borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={goBack} disabled={!canGoBack}
            style={{ color: "var(--text3)", background: "none", border: "none",
                     cursor: canGoBack ? "pointer" : "default", padding: 2, opacity: canGoBack ? 1 : 0.3 }}>
            <ChevronLeft size={14} />
          </button>

          <div className="flex-1 rounded-full cursor-pointer"
            style={{ height: 3, background: "var(--bg4)", position: "relative" }}
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              goToPage(Math.max(0, Math.min(totalPages - 1,
                Math.floor(((e.clientX - r.left) / r.width) * totalPages)
              )));
            }}
          >
            <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)",
                          borderRadius: 9999, transition: "width 0.12s ease" }} />
          </div>

          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11,
                         color: "var(--text3)", whiteSpace: "nowrap" }}>
            {effectivePage + 1} / {totalPages || "…"}
          </span>

          <button onClick={goForward} disabled={!canGoForward}
            style={{ color: "var(--text3)", background: "none", border: "none",
                     cursor: canGoForward ? "pointer" : "default", padding: 2, opacity: canGoForward ? 1 : 0.3 }}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* ── Filmstrip collapse tab — sits right above the filmstrip ─────── */}
      {!hideUI && (
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: 18,
            background: "rgba(5,5,9,0.98)",
            borderTop: stripOpen ? "none" : "1px solid rgba(255,255,255,0.07)",
            cursor: "pointer",
          }}
          onClick={() => setStripOpen((v) => !v)}
          title={stripOpen ? "Collapse filmstrip (S)" : "Expand filmstrip (S)"}
        >
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "0 12px",
            borderRadius: 20,
            color: "rgba(255,255,255,0.25)",
            fontSize: 10,
            fontFamily: "monospace",
            transition: "color 0.15s",
          }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.25)")}
          >
            {stripOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </div>
        </div>
      )}

      {/* ── Filmstrip ───────────────────────────────────────────────────── */}
      {stripOpen && !hideUI && (
        <>
          {/* Drag handle — drag UP to grow, drag DOWN to shrink */}
          <div
            onMouseDown={onResizeDragStart}
            style={{
              flexShrink: 0,
              height: 8,
              cursor: "ns-resize",
              background: "rgba(5,5,9,0.98)",
              borderTop: "1px solid rgba(255,255,255,0.07)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <div style={{ width: 36, height: 3, borderRadius: 3,
                          background: "rgba(255,255,255,0.18)" }} />
          </div>

          <FilmStrip
            innerRef={stripRef}
            totalPages={totalPages}
            currentPage={effectivePage}
            pageCache={pageCache}
            height={stripHeight}
            onSelect={goToPage}
          />
        </>
      )}
    </div>
  );
}

// ── ZoomBtn ───────────────────────────────────────────────────────────────────

function ZoomBtn({ onClick, title, children }: {
  onClick: () => void; title?: string; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} title={title}
      style={{ background: "none", border: "none", cursor: "pointer",
               color: "rgba(255,255,255,0.55)", padding: "3px 4px", borderRadius: 4,
               display: "flex", alignItems: "center" }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.9)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.55)")}
    >
      {children}
    </button>
  );
}

// ── NavArrow ─────────────────────────────────────────────────────────────────

function NavArrow({ side, enabled, onClick, icon }: {
  side: "left" | "right"; enabled: boolean;
  onClick: () => void; icon: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        [side]: 0,
        top: 0,
        width: "11%",
        minWidth: 48,
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: side === "left" ? "flex-start" : "flex-end",
        padding: side === "left" ? "0 0 0 10px" : "0 10px 0 0",
        zIndex: 10,
        background: "transparent",
        border: "none",
        cursor: enabled ? "pointer" : "default",
        visibility: enabled ? "visible" : "hidden",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 38, height: 38, borderRadius: "50%",
        background: hovered ? "rgba(12,12,18,0.82)" : "rgba(12,12,18,0.35)",
        border: `1px solid ${hovered ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)"}`,
        backdropFilter: "blur(6px)",
        color: hovered ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)",
        transition: "all 0.18s ease",
        transform: hovered ? "scale(1.08)" : "scale(1)",
      }}>
        {icon}
      </div>
    </button>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ width: 28, height: 28, border: "2px solid rgba(255,255,255,0.08)",
      borderTopColor: "var(--accent)", borderRadius: "50%",
      animation: "spin 0.8s linear infinite" }} />
  );
}

// ── Settings Drawer ───────────────────────────────────────────────────────────

function SettingsDrawer({ layout, direction, onLayout, onDirection, onClose }: {
  layout: ReaderLayout; direction: ReaderDirection;
  onLayout: (l: ReaderLayout) => void;
  onDirection: (d: ReaderDirection) => void;
  onClose: () => void;
}) {
  return (
    <div style={{
      flexShrink: 0,
      background: "rgba(12,12,18,0.98)",
      backdropFilter: "blur(16px)",
      borderBottom: "1px solid rgba(255,255,255,0.07)",
      padding: "14px 20px",
    }}>
      <div className="flex items-center justify-between mb-3">
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)",
                       letterSpacing: 1.5, fontFamily: "monospace", textTransform: "uppercase" }}>
          Reader Settings
        </span>
        <button onClick={onClose}
          style={{ color: "var(--text3)", background: "none", border: "none", cursor: "pointer" }}>
          <X size={13} />
        </button>
      </div>

      <div style={{ display: "flex", gap: 40, alignItems: "flex-start" }}>
        <SettingGroup label="Reading Mode">
          {([
            { value: "single"  as ReaderLayout, label: "Single Page",  desc: "One page at a time", icon: <BookOpen size={14}/> },
            { value: "guided"  as ReaderLayout, label: "Guided View",  desc: "Zoom through panels", icon: <ZoomIn size={14}/> },
          ] as const).map(({ value, label, desc, icon }) => (
            <SettingOption key={value} active={layout === value} onClick={() => onLayout(value)}
              icon={icon} label={label} desc={desc} />
          ))}
        </SettingGroup>

        <SettingGroup label="Reading Direction">
          {([
            { value: "ltr" as ReaderDirection, label: "Left → Right", desc: "Western comics"   },
            { value: "rtl" as ReaderDirection, label: "Right → Left", desc: "Manga / Japanese" },
          ] as const).map(({ value, label, desc }) => (
            <SettingOption key={value} active={direction === value} onClick={() => onDirection(value)}
              label={label} desc={desc} />
          ))}
        </SettingGroup>
      </div>
    </div>
  );
}

function SettingGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ fontSize: 10, color: "var(--text3)", marginBottom: 8,
                  fontFamily: "monospace", textTransform: "uppercase", letterSpacing: 1 }}>
        {label}
      </p>
      <div style={{ display: "flex", gap: 8 }}>{children}</div>
    </div>
  );
}

function SettingOption({ active, onClick, icon, label, desc }: {
  active: boolean; onClick: () => void;
  icon?: React.ReactNode; label: string; desc: string;
}) {
  return (
    <button onClick={onClick} style={{
      display: "flex", flexDirection: "column", gap: 3,
      padding: "9px 14px", borderRadius: 10, cursor: "pointer", minWidth: 130,
      background: active ? "rgba(232,168,48,0.1)" : "var(--bg3)",
      border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
      color: active ? "var(--accent)" : "var(--text2)",
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500 }}>
        {icon} {label}
      </span>
      <span style={{ fontSize: 10, color: "var(--text3)" }}>{desc}</span>
    </button>
  );
}

// ── FilmStrip ─────────────────────────────────────────────────────────────────

interface FilmStripProps {
  innerRef:    React.RefObject<HTMLDivElement>;
  totalPages:  number;
  currentPage: number;
  pageCache:   Record<number, string>;
  height:      number;
  onSelect:    (p: number) => void;
}

function FilmStrip({ innerRef, totalPages, currentPage, pageCache, height, onSelect }: FilmStripProps) {
  if (totalPages === 0) return null;
  const thumbW = Math.round(height * 0.65);

  return (
    <div style={{
      flexShrink: 0, height,
      background: "rgba(5,5,9,0.98)",
      overflowX: "auto", overflowY: "hidden",
      scrollbarWidth: "none",
    }}>
      <div ref={innerRef} style={{
        display: "flex", alignItems: "center", gap: 6, height: "100%",
        padding: "0 12px", width: "max-content",
      }}>
        {Array.from({ length: totalPages }, (_, i) => (
          <ThumbCell
            key={i}
            index={i}
            active={i === currentPage}
            src={pageCache[i] ?? null}
            width={thumbW}
            height={height - 14}
            onSelect={() => onSelect(i)}
          />
        ))}
      </div>
    </div>
  );
}

// ── ThumbCell ────────────────────────────────────────────────────────────────
// NOTE: thumbnails are loaded by the background crawler in the parent —
// no IntersectionObserver needed here. We just display what's in pageCache.

function ThumbCell({ index, active, src, width, height, onSelect }: {
  index: number; active: boolean; src: string | null;
  width: number; height: number; onSelect: () => void;
}) {
  return (
    <button
      data-page={index}
      onClick={onSelect}
      style={{
        flexShrink: 0, width, height,
        borderRadius: 5, overflow: "hidden",
        border: `2px solid ${active ? "var(--accent)" : "transparent"}`,
        background: "var(--bg4)", cursor: "pointer", position: "relative",
        transition: "border-color 0.15s, transform 0.15s",
        transform: active ? "scale(1.08)" : "scale(1)",
      }}
    >
      {src ? (
        <img src={src} alt={`Page ${index + 1}`}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          draggable={false} />
      ) : (
        <div style={{ width: "100%", height: "100%", background: "var(--bg3)" }} />
      )}
      <span style={{
        position: "absolute", bottom: 2, right: 3, fontSize: 8,
        color: "rgba(255,255,255,0.4)", fontFamily: "'IBM Plex Mono',monospace",
        lineHeight: 1, pointerEvents: "none",
      }}>
        {index + 1}
      </span>
    </button>
  );
}

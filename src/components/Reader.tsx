/**
 * Reader — single-page comic reader with:
 *  - Zoom (buttons, +/-, ctrl+scroll / pinch, drag to pan)
 *  - Guided view: canvas panel detection → animate to each panel in sequence
 *  - Manga / RTL mode
 *  - Resizable filmstrip
 */
import React, {
  useState, useEffect, useCallback, useRef, useMemo,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  Maximize2, Minimize2, X, Settings2,
  BookOpen, ZoomIn as ZoomInIcon, ZoomOut, Scan,
} from "lucide-react";
import type { Comic } from "../types";
import type { ReaderLayout, ReaderDirection } from "../types";
import { loadPageHigh, loadPageLow, getCachedPage, isPageCached } from "../store/pageQueue";

// ── Panel detection ──────────────────────────────────────────────────────────
// Finds comic panel bounding boxes from a loaded img via canvas pixel analysis.

interface PanelBox { x1: number; y1: number; x2: number; y2: number; }

function detectPanels(img: HTMLImageElement): PanelBox[] {
  const nw = img.naturalWidth, nh = img.naturalHeight;
  if (!nw || !nh) return defaultPanels();

  const SCALE = 300;
  const cw = SCALE, ch = Math.round((nh / nw) * SCALE);
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return defaultPanels();
  ctx.drawImage(img, 0, 0, cw, ch);
  const { data } = ctx.getImageData(0, 0, cw, ch);

  const px = (x: number, y: number) => {
    const i = (y * cw + x) * 4;
    return (data[i] + data[i+1] + data[i+2]) / 3;
  };

  // Row brightness profile
  const rowB = new Float32Array(ch);
  for (let y = 0; y < ch; y++) {
    let s = 0; for (let x = 0; x < cw; x++) s += px(x,y); rowB[y] = s/cw;
  }

  // Detect horizontal gutter rows (very bright ≥220 or very dark ≤20, uniform)
  const isHGutter = (y: number) => {
    const b = rowB[y]; if (b >= 220 || b <= 20) return true;
    let v = 0; for (let x = 0; x < cw; x++) v += (px(x,y)-b)**2;
    return v/cw < 80 && (b >= 200 || b <= 35);
  };

  const hSeps = findSeps(ch, isHGutter);
  const hBands = sepsToBands(hSeps, ch, ch * 0.06);
  if (hBands.length === 0) return defaultPanels();

  const panels: PanelBox[] = [];
  for (const [y1, y2] of hBands) {
    const colB = new Float32Array(cw);
    for (let x = 0; x < cw; x++) {
      let s = 0; for (let y = y1; y < y2; y++) s += px(x,y); colB[x] = s/(y2-y1);
    }
    const isVGutter = (x: number) => {
      const b = colB[x]; if (b >= 220 || b <= 20) return true;
      let v = 0; for (let y = y1; y < y2; y++) v += (px(x,y)-b)**2;
      return v/(y2-y1) < 80 && (b >= 200 || b <= 35);
    };
    const vSeps  = findSeps(cw, isVGutter);
    const vBands = sepsToBands(vSeps, cw, cw * 0.06);
    for (const [x1, x2] of vBands) {
      const box: PanelBox = { x1: x1/cw, y1: y1/ch, x2: x2/cw, y2: y2/ch };
      if (box.x2-box.x1 >= 0.07 && box.y2-box.y1 >= 0.07) panels.push(box);
    }
  }
  return panels.length >= 2 ? panels : defaultPanels();
}

function findSeps(size: number, isGutter: (i:number) => boolean): number[] {
  const marks = Array.from({length:size}, (_,i) => isGutter(i));
  const mids: number[] = [];
  let inRun = false, start = 0;
  for (let i = 0; i <= size; i++) {
    const g = i < size && marks[i];
    if (g && !inRun) { inRun = true; start = i; }
    if (!g && inRun) { inRun = false; mids.push(Math.round((start+i-1)/2)); }
  }
  // Merge nearby midpoints
  const merged: number[] = [];
  for (const m of mids) {
    if (merged.length === 0 || m - merged[merged.length-1] > 10) merged.push(m);
    else merged[merged.length-1] = Math.round((merged[merged.length-1]+m)/2);
  }
  return merged;
}

function sepsToBands(seps: number[], size: number, minSize: number): [number,number][] {
  const borders = [0, ...seps, size];
  const bands: [number,number][] = [];
  for (let i = 0; i < borders.length-1; i++) {
    if (borders[i+1] - borders[i] > minSize) bands.push([borders[i], borders[i+1]]);
  }
  return bands;
}

function defaultPanels(): PanelBox[] {
  return [
    {x1:0,   y1:0,   x2:0.5, y2:0.5},
    {x1:0.5, y1:0,   x2:1,   y2:0.5},
    {x1:0,   y1:0.5, x2:0.5, y2:1  },
    {x1:0.5, y1:0.5, x2:1,   y2:1  },
  ];
}

// ── Types ────────────────────────────────────────────────────────────────────
interface Props { comic: Comic; onClose?: () => void; }
interface GuidedPos { page: number; zoneIdx: number; }
interface ImgDims { natural: { w: number; h: number }; rendered: { w: number; h: number }; }

// ── Component ────────────────────────────────────────────────────────────────
export default function Reader({ comic, onClose }: Props) {
  const [totalPages,   setTotalPages]   = useState(0);
  const [currentPage,  setCurrentPage]  = useState(comic.current_page ?? 0);
  const [pageCache,    setPageCache]    = useState<Record<number, string>>({});
  const [hideUI,       setHideUI]       = useState(false);
  const [stripOpen,    setStripOpen]    = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [layout,       setLayout]       = useState<ReaderLayout>("single");
  const [direction,    setDirection]    = useState<ReaderDirection>("ltr");

  // Zoom state — scale factor and pan offsets in screen pixels
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Guided mode
  const [guidedPos,   setGuidedPos]    = useState<GuidedPos>({ page: 0, zoneIdx: 0 });
  const panelCache    = useRef<Map<number, PanelBox[]>>(new Map());
  const [panelsReady, setPanelsReady]  = useState(0);  // increment to force re-render

  // Image rendered dimensions (set onLoad, used for guided transforms)
  const [imgDims, setImgDims] = useState<ImgDims | null>(null);

  const stripHeightRef = useRef(96);
  const [stripHeight,  setStripHeight] = useState(96);
  const stripRef    = useRef<HTMLDivElement>(null);
  const pageAreaRef = useRef<HTMLDivElement>(null);
  const imgRef      = useRef<HTMLImageElement>(null);
  const bgCrawlerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPanRef     = useRef(false);
  const lastPanRef   = useRef({ x: 0, y: 0 });

  const filePath = comic.file_path;

  // ── Page cache helpers ──────────────────────────────────────────────────
  const applyPage = useCallback((idx: number, data: string) => {
    setPageCache(p => p[idx] === data ? p : { ...p, [idx]: data });
  }, []);

  const loadHigh = useCallback((idx: number) => {
    if (idx < 0 || idx >= totalPages) return;
    const c = getCachedPage(filePath, idx);
    if (c) { applyPage(idx, c); return; }
    loadPageHigh(filePath, idx).then(d => applyPage(idx, d)).catch(() => {});
  }, [filePath, totalPages, applyPage]);

  const loadLow = useCallback((idx: number) => {
    if (idx < 0 || idx >= totalPages) return;
    if (isPageCached(filePath, idx)) {
      const c = getCachedPage(filePath, idx); if (c) applyPage(idx, c); return;
    }
    loadPageLow(filePath, idx).then(d => applyPage(idx, d)).catch(() => {});
  }, [filePath, totalPages, applyPage]);

  const startCrawler = useCallback((from: number, total: number) => {
    if (bgCrawlerRef.current) clearTimeout(bgCrawlerRef.current);
    const order: number[] = [from];
    for (let d = 1; d < total; d++) {
      if (from + d < total) order.push(from + d);
      if (from - d >= 0)    order.push(from - d);
    }
    let i = 0;
    const tick = () => {
      while (i < order.length && isPageCached(filePath, order[i])) i++;
      if (i >= order.length) return;
      loadLow(order[i++]);
      bgCrawlerRef.current = setTimeout(tick, 100);
    };
    bgCrawlerRef.current = setTimeout(tick, 600);
  }, [filePath, loadLow]);

  // ── Init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    setPageCache({}); panelCache.current.clear(); setTotalPages(0);
    setImgDims(null);
    if (bgCrawlerRef.current) clearTimeout(bgCrawlerRef.current);
    const p = comic.current_page ?? 0;
    setCurrentPage(p); setGuidedPos({ page: p, zoneIdx: 0 });
    setZoom(1); setPanX(0); setPanY(0);

    loadPageHigh(filePath, p).then(d => applyPage(p, d)).catch(() => {});

    invoke<number>("get_page_count", { filePath }).then(n => {
      setTotalPages(n);
      if (p+1 < n) loadPageHigh(filePath, p+1).then(d => applyPage(p+1, d)).catch(() => {});
      if (p+2 < n) loadPageHigh(filePath, p+2).then(d => applyPage(p+2, d)).catch(() => {});
      startCrawler(p, n);
    }).catch(console.error);

    return () => { if (bgCrawlerRef.current) clearTimeout(bgCrawlerRef.current); };
  }, [comic.id, filePath]); // eslint-disable-line

  useEffect(() => {
    if (totalPages === 0) return;
    loadHigh(currentPage);
    loadHigh(currentPage + 1);
    loadHigh(currentPage + 2);
    if (currentPage > 0) loadHigh(currentPage - 1);
    startCrawler(currentPage, totalPages);
  }, [currentPage, totalPages]); // eslint-disable-line

  // ── Panel detection ─────────────────────────────────────────────────────
  const runDetect = useCallback((img: HTMLImageElement, pageIdx: number) => {
    if (panelCache.current.has(pageIdx)) return;
    const doDetect = () => {
      try {
        panelCache.current.set(pageIdx, detectPanels(img));
        setPanelsReady(n => n + 1);
      } catch(e) { console.error(e); }
    };
    if ("requestIdleCallback" in window) {
      (window as any).requestIdleCallback(doDetect, { timeout: 1500 });
    } else { setTimeout(doDetect, 50); }
  }, []);

  const effectivePage = layout === "guided" ? guidedPos.page : currentPage;
  // eslint-disable-next-line
  const currentPanels = useMemo(
    () => panelCache.current.get(effectivePage) ?? [],
    [effectivePage, panelsReady]
  );

  // ── Navigation ──────────────────────────────────────────────────────────
  const saveProgress = useCallback((page: number) => {
    invoke("update_reading_progress", { comicId: comic.id, currentPage: page }).catch(() => {});
  }, [comic.id]);

  const resetView = useCallback(() => { setZoom(1); setPanX(0); setPanY(0); }, []);

  const goForward = useCallback(() => {
    if (layout === "guided" && currentPanels.length > 0) {
      setGuidedPos(pos => {
        if (pos.zoneIdx < currentPanels.length - 1) return { ...pos, zoneIdx: pos.zoneIdx + 1 };
        const next = direction === "rtl"
          ? Math.max(0, pos.page - 1) : Math.min(totalPages-1, pos.page+1);
        if (next === pos.page) return pos;
        setCurrentPage(next); saveProgress(next);
        return { page: next, zoneIdx: 0 };
      });
    } else {
      setCurrentPage(p => {
        const next = direction === "rtl"
          ? Math.max(0, p-1) : Math.min(totalPages-1, p+1);
        if (next !== p) { saveProgress(next); resetView(); }
        return next;
      });
    }
  }, [layout, direction, totalPages, currentPanels.length, saveProgress, resetView]);

  const goBack = useCallback(() => {
    if (layout === "guided" && currentPanels.length > 0) {
      setGuidedPos(pos => {
        if (pos.zoneIdx > 0) return { ...pos, zoneIdx: pos.zoneIdx - 1 };
        const prev = direction === "rtl"
          ? Math.min(totalPages-1, pos.page+1) : Math.max(0, pos.page-1);
        if (prev === pos.page) return pos;
        setCurrentPage(prev); saveProgress(prev);
        const prevPanels = panelCache.current.get(prev);
        return { page: prev, zoneIdx: prevPanels ? prevPanels.length-1 : 0 };
      });
    } else {
      setCurrentPage(p => {
        const next = direction === "rtl"
          ? Math.min(totalPages-1, p+1) : Math.max(0, p-1);
        if (next !== p) { saveProgress(next); resetView(); }
        return next;
      });
    }
  }, [layout, direction, totalPages, currentPanels.length, saveProgress, resetView]);

  const goToPage = useCallback((p: number) => {
    setCurrentPage(p); setGuidedPos({ page: p, zoneIdx: 0 });
    saveProgress(p); resetView();
  }, [saveProgress, resetView]);

  // ── Keyboard ────────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (["ArrowRight","ArrowDown"," "].includes(e.key)) { e.preventDefault(); goForward(); }
      if (["ArrowLeft","ArrowUp"].includes(e.key))        { e.preventDefault(); goBack(); }
      if (e.key === "f") setHideUI(v => !v);
      if (e.key === "s") setStripOpen(v => !v);
      if (e.key === "+" || e.key === "=") setZoom(z => Math.min(5, +(z+0.25).toFixed(2)));
      if (e.key === "-") setZoom(z => { const n = Math.max(1, +(z-0.25).toFixed(2)); if(n<=1) resetView(); return n; });
      if (e.key === "0") resetView();
      if (e.key === "Escape") {
        if (zoom > 1) resetView();
        else if (showSettings) setShowSettings(false);
        else onClose?.();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [goForward, goBack, onClose, showSettings, zoom, resetView]);

  // ── Wheel zoom (ctrl+scroll / trackpad pinch) ────────────────────────────
  useEffect(() => {
    const el = pageAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : (1/1.1);
      setZoom(z => {
        const n = Math.min(5, Math.max(1, z * factor));
        if (n <= 1.001) { setPanX(0); setPanY(0); return 1; }
        return +n.toFixed(3);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Pan ──────────────────────────────────────────────────────────────────
  const onPanStart = useCallback((e: React.MouseEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    isPanRef.current = true;
    lastPanRef.current = { x: e.clientX, y: e.clientY };
    const onMove = (ev: MouseEvent) => {
      if (!isPanRef.current) return;
      setPanX(x => x + ev.clientX - lastPanRef.current.x);
      setPanY(y => y + ev.clientY - lastPanRef.current.y);
      lastPanRef.current = { x: ev.clientX, y: ev.clientY };
    };
    const onUp = () => {
      isPanRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [zoom]);

  // ── Filmstrip resize ────────────────────────────────────────────────────
  const onResizeDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY, startH = stripHeightRef.current;
    const onMove = (ev: MouseEvent) => {
      const n = Math.min(240, Math.max(56, startH + startY - ev.clientY));
      stripHeightRef.current = n; setStripHeight(n);
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // ── Auto-scroll filmstrip ────────────────────────────────────────────────
  useEffect(() => {
    if (!stripOpen || !stripRef.current) return;
    const el = stripRef.current.querySelector(`[data-page="${effectivePage}"]`) as HTMLElement | null;
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [effectivePage, stripOpen]);

  // ── Image onLoad: measure dims, run panel detection ─────────────────────
  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    const container = pageAreaRef.current;
    if (!img || !container) return;

    const nw = img.naturalWidth, nh = img.naturalHeight;
    const cw = container.clientWidth, ch = container.clientHeight;

    // Compute actual rendered size within container (object-fit:contain math)
    const containerAR = cw / ch;
    const imageAR     = nw / nh;
    let rw: number, rh: number;
    if (imageAR > containerAR) { rw = cw; rh = cw / imageAR; }
    else                       { rh = ch; rw = ch * imageAR; }

    setImgDims({ natural: { w: nw, h: nh }, rendered: { w: rw, h: rh } });

    if (layout === "guided") runDetect(img, effectivePage);
  }, [layout, effectivePage, runDetect]);

  // Re-measure when container resizes
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (imgRef.current?.complete) onImgLoad();
    });
    if (pageAreaRef.current) observer.observe(pageAreaRef.current);
    return () => observer.disconnect();
  }, [onImgLoad]);

  // When layout or page changes, trigger detection immediately if img is already loaded
  // (cached images may not re-fire onLoad after key-change remount)
  useEffect(() => {
    if (imgRef.current?.complete) onImgLoad();
  }, [layout, effectivePage]); // eslint-disable-line

  // ── Compute the CSS transform ────────────────────────────────────────────
  //
  // DESIGN: image always has maxWidth/maxHeight:100% (contained).
  // Then we apply transform: scale(s) translate(tx,ty) on the img element.
  //
  // For manual zoom:   scale by zoom factor, translate by pan offsets
  // For guided panels: zoom to each detected panel bounding box

  const imgTransform = useMemo((): React.CSSProperties => {
    if (layout === "guided" && currentPanels.length > 0 && imgDims) {
      const panel = currentPanels[guidedPos.zoneIdx];
      if (!panel) return {};

      const { rendered: { w: rw, h: rh } } = imgDims;
      const container = pageAreaRef.current;
      const cw = container?.clientWidth  ?? rw;
      const ch = container?.clientHeight ?? rh;

      // Panel dimensions in rendered-image pixels
      const pw = (panel.x2 - panel.x1) * rw;
      const ph = (panel.y2 - panel.y1) * rh;

      // Scale to fill 90% of container
      const s = Math.min((cw * 0.9) / pw, (ch * 0.9) / ph, 5);

      // Panel centre in rendered-image coords (relative to image centre)
      const panelCX = ((panel.x1 + panel.x2) / 2 - 0.5) * rw;
      const panelCY = ((panel.y1 + panel.y2) / 2 - 0.5) * rh;

      // We want panel centre to appear at container centre.
      // CSS transform: scale(s) translate(-panelCX/s, -panelCY/s)
      // (translate is applied in the scaled coordinate space)
      const tx = -panelCX;
      const ty = -panelCY;

      return {
        transform: `scale(${s.toFixed(4)}) translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`,
        transformOrigin: "center center",
        transition: "transform 0.38s cubic-bezier(0.4,0,0.2,1)",
        willChange: "transform",
      };
    }

    if (zoom > 1) {
      // Simple zoom + pan — translate is in pre-scale coords
      return {
        transform: `scale(${zoom.toFixed(3)}) translate(${(panX/zoom).toFixed(1)}px, ${(panY/zoom).toFixed(1)}px)`,
        transformOrigin: "center center",
        transition: "none",
        willChange: "transform",
      };
    }

    return { transform: "none", transition: "none" };
  }, [layout, currentPanels, guidedPos.zoneIdx, imgDims, zoom, panX, panY]);

  // ── Derived state ────────────────────────────────────────────────────────
  const src = pageCache[effectivePage];
  const pct = totalPages > 0 ? ((effectivePage+1) / totalPages) * 100 : 0;
  const canGoBack    = direction === "ltr" ? effectivePage > 0 : effectivePage < totalPages-1;
  const canGoForward = direction === "ltr" ? effectivePage < totalPages-1 : effectivePage > 0;
  const isGuided     = layout === "guided";

  return (
    <div className="flex flex-col"
      style={{ height:"100vh", background:"#050507", userSelect:"none", overflow:"hidden" }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      {!hideUI && (
        <div className="flex items-center gap-3 px-4 py-2 flex-shrink-0"
          style={{ background:"rgba(8,8,12,0.96)", backdropFilter:"blur(10px)",
                   borderBottom:"1px solid rgba(255,255,255,0.06)" }}>

          {onClose && (
            <button onClick={onClose} className="flex items-center gap-1"
              style={{ color:"var(--text3)", fontSize:12, background:"none", border:"none", cursor:"pointer" }}>
              <X size={13}/> Close
            </button>
          )}

          <div className="flex-1 truncate text-center" style={{ fontSize:12, color:"var(--text2)" }}>
            <span style={{ color:"var(--text)" }}>{comic.title}</span>
            {comic.series && (
              <span style={{ color:"var(--text3)" }}>
                {" · "}{comic.series}{comic.issue_number ? ` #${comic.issue_number}` : ""}
              </span>
            )}
          </div>

          {direction === "rtl" && <Pill bg="rgba(232,168,48,0.15)" color="var(--accent)">MANGA</Pill>}
          {isGuided && currentPanels.length > 0 && (
            <Pill bg="rgba(167,139,250,0.15)" color="#a78bfa">
              PANEL {guidedPos.zoneIdx+1}/{currentPanels.length}
            </Pill>
          )}
          {isGuided && src && currentPanels.length === 0 && (
            <Pill bg="var(--bg3)" color="var(--text3)">detecting…</Pill>
          )}
          {isGuided && (
            <>
              <button onClick={e => { e.stopPropagation(); goBack(); }}
                style={{ color:"var(--text3)", background:"none", border:"none",
                         cursor:"pointer", padding:"2px 6px", fontSize:11 }}>
                ‹ Prev
              </button>
              <button onClick={e => { e.stopPropagation(); goForward(); }}
                style={{ color:"var(--text3)", background:"none", border:"none",
                         cursor:"pointer", padding:"2px 6px", fontSize:11 }}>
                Next ›
              </button>
            </>
          )}

          <button onClick={() => setShowSettings(v => !v)}
            style={{ color:showSettings?"var(--accent)":"var(--text3)",
                     background:"none", border:"none", cursor:"pointer", padding:"2px 4px" }}>
            <Settings2 size={14}/>
          </button>

          <button onClick={() => setHideUI(true)}
            style={{ color:"var(--text3)", background:"none", border:"none",
                     cursor:"pointer", padding:"2px 4px" }}>
            <Maximize2 size={13}/>
          </button>
        </div>
      )}

      {/* ── Settings drawer ──────────────────────────────────────────────── */}
      {showSettings && !hideUI && (
        <SettingsDrawer
          layout={layout} direction={direction}
          onLayout={l => { setLayout(l); setGuidedPos({ page: effectivePage, zoneIdx: 0 }); resetView(); }}
          onDirection={setDirection}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* ── Page area ────────────────────────────────────────────────────── */}
      <div className="flex-1 relative flex items-center justify-center"
        style={{ overflow:"hidden", minHeight:0 }}>

        {zoom <= 1 && !isGuided && (
          <NavArrow side="left" enabled={canGoBack} onClick={goBack}
            icon={direction==="ltr" ? <ChevronLeft size={20}/> : <ChevronRight size={20}/>}
          />
        )}

        <div
          ref={pageAreaRef}
          className="relative w-full h-full"
          style={{
            overflow: "hidden",
            cursor: zoom > 1 ? "grab" : "default",
            // overflow:hidden here is the real clip boundary — avoids the WebKit
            // bug where overflow:hidden on a flex container doesn't clip
            // CSS-transformed children on the Y axis.
          }}
          onMouseDown={onPanStart}
          onClick={e => {
            if (showSettings) return;
            if (isGuided) {
              // In guided mode: click left half = back, right half = forward
              const r = e.currentTarget.getBoundingClientRect();
              if (e.clientX - r.left < r.width / 2) goBack(); else goForward();
              return;
            }
            if (zoom > 1) return;
            const r = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - r.left;
            if (x < r.width * 0.14 || x > r.width * 0.86) return;
            if (x < r.width / 2) goBack(); else goForward();
          }}
        >
          {/* Transform wrapper: the transform lives here, not on the img.
              This div fills the full container, is flex-centered, and carries
              the zoom/pan/guided transform. The img inside is always sized
              to fit the container at zoom=1; visual zoom comes from this div. */}
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              ...imgTransform,
            }}
          >
            {!src ? <Spinner /> : (
              <img
                ref={imgRef}
                key={`${effectivePage}-${layout}`}
                src={src}
                alt={`Page ${effectivePage+1}`}
                onLoad={onImgLoad}
                className="fade-in"
                draggable={false}
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  display: "block",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
        </div>

        {zoom <= 1 && !isGuided && (
          <NavArrow side="right" enabled={canGoForward} onClick={goForward}
            icon={direction==="ltr" ? <ChevronRight size={20}/> : <ChevronLeft size={20}/>}
          />
        )}

        {/* Zoom controls — only shown in single-page mode */}
        {!hideUI && !isGuided && (
          <div
            onClick={e => e.stopPropagation()}
            style={{
            position:"absolute", bottom:12, right:14, zIndex:15,
            display:"flex", alignItems:"center", gap:1,
            background:"rgba(8,8,12,0.78)", backdropFilter:"blur(8px)",
            border:"1px solid rgba(255,255,255,0.08)", borderRadius:20, padding:"3px 6px",
          }}>
            <ZoomBtn title="Zoom out (−)" onClick={() => setZoom(z => { const n = Math.max(1,+(z-0.25).toFixed(2)); if(n<=1) resetView(); return n; })}>
              <ZoomOut size={13}/>
            </ZoomBtn>
            <span
              onClick={resetView}
              title="Reset zoom (0)"
              style={{ fontSize:10, color:"rgba(255,255,255,0.5)", fontFamily:"monospace",
                       minWidth:32, textAlign:"center", cursor:"pointer" }}
            >{zoom===1 ? "1×" : `${zoom.toFixed(1)}×`}</span>
            <ZoomBtn title="Zoom in (+)" onClick={() => setZoom(z => Math.min(5, +(z+0.25).toFixed(2)))}>
              <ZoomInIcon size={13}/>
            </ZoomBtn>
            {zoom > 1 && <ZoomBtn title="Reset" onClick={resetView}><Scan size={12}/></ZoomBtn>}
          </div>
        )}

        {hideUI && (
          <button onClick={() => setHideUI(false)}
            style={{ position:"absolute", top:10, right:10, zIndex:20,
              background:"rgba(0,0,0,0.55)", color:"var(--text2)", border:"none",
              borderRadius:8, padding:"5px 8px", cursor:"pointer" }}>
            <Minimize2 size={12}/>
          </button>
        )}
      </div>

      {/* ── Bottom progress bar ──────────────────────────────────────────── */}
      {!hideUI && (
        <div className="flex items-center gap-3 px-4 py-2 flex-shrink-0"
          style={{ background:"rgba(8,8,12,0.96)", backdropFilter:"blur(10px)",
                   borderTop:"1px solid rgba(255,255,255,0.06)" }}>

          <button onClick={goBack} disabled={!canGoBack}
            style={{ color:"var(--text3)", background:"none", border:"none",
                     cursor:canGoBack?"pointer":"default", padding:2, opacity:canGoBack?1:0.3 }}>
            <ChevronLeft size={14}/>
          </button>

          <div className="flex-1 rounded-full cursor-pointer"
            style={{ height:3, background:"var(--bg4)" }}
            onClick={e => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              goToPage(Math.max(0, Math.min(totalPages-1,
                Math.floor(((e.clientX-r.left)/r.width)*totalPages)
              )));
            }}
          >
            <div style={{ height:"100%", width:`${pct}%`, background:"var(--accent)",
                          borderRadius:9999, transition:"width 0.12s ease" }}/>
          </div>

          <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11,
                         color:"var(--text3)", whiteSpace:"nowrap" }}>
            {effectivePage+1} / {totalPages||"…"}
          </span>

          <button onClick={goForward} disabled={!canGoForward}
            style={{ color:"var(--text3)", background:"none", border:"none",
                     cursor:canGoForward?"pointer":"default", padding:2, opacity:canGoForward?1:0.3 }}>
            <ChevronRight size={14}/>
          </button>
        </div>
      )}

      {/* ── Filmstrip collapse tab ────────────────────────────────────────── */}
      {!hideUI && (
        <div
          onClick={() => setStripOpen(v => !v)}
          title={stripOpen ? "Collapse (S)" : "Expand thumbnails (S)"}
          style={{
            flexShrink:0, height:18, cursor:"pointer",
            background:"rgba(5,5,9,0.98)",
            borderTop:"1px solid rgba(255,255,255,0.07)",
            display:"flex", alignItems:"center", justifyContent:"center",
            color:"rgba(255,255,255,0.2)", transition:"color 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color="rgba(255,255,255,0.7)"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color="rgba(255,255,255,0.2)"}
        >
          {stripOpen ? <ChevronDown size={12}/> : <ChevronUp size={12}/>}
        </div>
      )}

      {/* ── Filmstrip ────────────────────────────────────────────────────── */}
      {stripOpen && !hideUI && (
        <>
          <div onMouseDown={onResizeDrag}
            style={{
              flexShrink:0, height:8, cursor:"ns-resize",
              background:"rgba(5,5,9,0.98)",
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>
            <div style={{ width:36, height:3, borderRadius:3, background:"rgba(255,255,255,0.18)" }}/>
          </div>
          <FilmStrip
            innerRef={stripRef} totalPages={totalPages} currentPage={effectivePage}
            pageCache={pageCache} height={stripHeight} onSelect={goToPage}
          />
        </>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Pill({ bg, color, children }: { bg:string; color:string; children:React.ReactNode }) {
  return (
    <span style={{ fontSize:10, color, background:bg, padding:"1px 7px",
                   borderRadius:10, fontFamily:"monospace", flexShrink:0 }}>
      {children}
    </span>
  );
}

function ZoomBtn({ onClick, title, children }: { onClick:()=>void; title?:string; children:React.ReactNode }) {
  return (
    <button onClick={onClick} title={title}
      style={{ background:"none", border:"none", cursor:"pointer",
               color:"rgba(255,255,255,0.55)", padding:"3px 4px", borderRadius:4,
               display:"flex", alignItems:"center" }}
      onMouseEnter={e => (e.currentTarget.style.color="rgba(255,255,255,0.9)")}
      onMouseLeave={e => (e.currentTarget.style.color="rgba(255,255,255,0.55)")}
    >{children}</button>
  );
}

function NavArrow({ side, enabled, onClick, icon }: {
  side:"left"|"right"; enabled:boolean; onClick:()=>void; icon:React.ReactNode;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} disabled={!enabled}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        position:"absolute", [side]:0, top:0,
        width:"11%", minWidth:48, height:"100%",
        display:"flex", alignItems:"center",
        justifyContent:side==="left"?"flex-start":"flex-end",
        padding:side==="left"?"0 0 0 10px":"0 10px 0 0",
        zIndex:10, background:"transparent", border:"none",
        cursor:enabled?"pointer":"default",
        visibility:enabled?"visible":"hidden",
      }}>
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"center",
        width:38, height:38, borderRadius:"50%",
        background:hov?"rgba(12,12,18,0.82)":"rgba(12,12,18,0.35)",
        border:`1px solid ${hov?"rgba(255,255,255,0.15)":"rgba(255,255,255,0.06)"}`,
        backdropFilter:"blur(6px)",
        color:hov?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.35)",
        transition:"all 0.18s ease", transform:hov?"scale(1.08)":"scale(1)",
      }}>{icon}</div>
    </button>
  );
}

function Spinner() {
  return (
    <div style={{ width:28, height:28,
      border:"2px solid rgba(255,255,255,0.08)", borderTopColor:"var(--accent)",
      borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
  );
}

function SettingsDrawer({ layout, direction, onLayout, onDirection, onClose }: {
  layout:ReaderLayout; direction:ReaderDirection;
  onLayout:(l:ReaderLayout)=>void; onDirection:(d:ReaderDirection)=>void; onClose:()=>void;
}) {
  return (
    <div style={{
      flexShrink:0, background:"rgba(12,12,18,0.98)", backdropFilter:"blur(16px)",
      borderBottom:"1px solid rgba(255,255,255,0.07)", padding:"14px 20px",
    }}>
      <div className="flex items-center justify-between mb-3">
        <span style={{ fontSize:11, fontWeight:600, color:"var(--text2)",
                       letterSpacing:1.5, fontFamily:"monospace", textTransform:"uppercase" }}>
          Reader Settings
        </span>
        <button onClick={onClose} style={{ color:"var(--text3)", background:"none", border:"none", cursor:"pointer" }}>
          <X size={13}/>
        </button>
      </div>
      <div style={{ display:"flex", gap:40 }}>
        <SettingGroup label="Reading Mode">
          <SettingOpt active={layout==="single"} onClick={() => onLayout("single")}
            icon={<BookOpen size={14}/>} label="Single Page" desc="Full page view"/>
          <SettingOpt active={layout==="guided"} onClick={() => onLayout("guided")}
            icon={<ZoomInIcon size={14}/>} label="Guided View" desc="Panel by panel zoom"/>
        </SettingGroup>
        <SettingGroup label="Reading Direction">
          <SettingOpt active={direction==="ltr"} onClick={() => onDirection("ltr")} label="Left → Right" desc="Western comics"/>
          <SettingOpt active={direction==="rtl"} onClick={() => onDirection("rtl")} label="Right → Left" desc="Manga / Japanese"/>
        </SettingGroup>
      </div>
      {layout === "guided" && (
        <p style={{ fontSize:10, color:"var(--text3)", marginTop:10, fontFamily:"monospace" }}>
          Guided view detects panels and zooms in one at a time. Tap or press → to advance.
          Press ← to go back through panels. Works best with scan quality comics.
        </p>
      )}
    </div>
  );
}

function SettingGroup({ label, children }: { label:string; children:React.ReactNode }) {
  return (
    <div>
      <p style={{ fontSize:10, color:"var(--text3)", marginBottom:8,
                  fontFamily:"monospace", textTransform:"uppercase", letterSpacing:1 }}>{label}</p>
      <div style={{ display:"flex", gap:8 }}>{children}</div>
    </div>
  );
}

function SettingOpt({ active, onClick, icon, label, desc }: {
  active:boolean; onClick:()=>void; icon?:React.ReactNode; label:string; desc:string;
}) {
  return (
    <button onClick={onClick} style={{
      display:"flex", flexDirection:"column", gap:3,
      padding:"9px 14px", borderRadius:10, cursor:"pointer", minWidth:130,
      background:active?"rgba(232,168,48,0.1)":"var(--bg3)",
      border:`1px solid ${active?"var(--accent)":"var(--border)"}`,
      color:active?"var(--accent)":"var(--text2)",
    }}>
      <span style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, fontWeight:500 }}>
        {icon}{label}
      </span>
      <span style={{ fontSize:10, color:"var(--text3)" }}>{desc}</span>
    </button>
  );
}

function FilmStrip({ innerRef, totalPages, currentPage, pageCache, height, onSelect }: {
  innerRef:React.RefObject<HTMLDivElement>; totalPages:number; currentPage:number;
  pageCache:Record<number,string>; height:number; onSelect:(p:number)=>void;
}) {
  if (!totalPages) return null;
  const thumbW = Math.round(height * 0.65);
  return (
    <div style={{ flexShrink:0, height, background:"rgba(5,5,9,0.98)",
                  overflowX:"auto", overflowY:"hidden", scrollbarWidth:"none" }}>
      <div ref={innerRef}
        style={{ display:"flex", alignItems:"center", gap:6, height:"100%",
                 padding:"0 12px", width:"max-content" }}>
        {Array.from({length:totalPages}, (_,i) => (
          <ThumbCell key={i} index={i} active={i===currentPage} src={pageCache[i]??null}
            width={thumbW} height={height-14} onSelect={() => onSelect(i)}/>
        ))}
      </div>
    </div>
  );
}

function ThumbCell({ index, active, src, width, height, onSelect }: {
  index:number; active:boolean; src:string|null; width:number; height:number; onSelect:()=>void;
}) {
  return (
    <button data-page={index} onClick={onSelect}
      style={{
        flexShrink:0, width, height, borderRadius:5, overflow:"hidden",
        border:`2px solid ${active?"var(--accent)":"transparent"}`,
        background:"var(--bg4)", cursor:"pointer", position:"relative",
        transition:"border-color 0.15s, transform 0.15s",
        transform:active?"scale(1.08)":"scale(1)",
      }}>
      {src
        ? <img src={src} alt={`Page ${index+1}`} style={{width:"100%",height:"100%",objectFit:"cover"}} draggable={false}/>
        : <div style={{width:"100%",height:"100%",background:"var(--bg3)"}}/>
      }
      <span style={{ position:"absolute", bottom:2, right:3, fontSize:8,
        color:"rgba(255,255,255,0.4)", fontFamily:"'IBM Plex Mono',monospace",
        lineHeight:1, pointerEvents:"none" }}>{index+1}</span>
    </button>
  );
}

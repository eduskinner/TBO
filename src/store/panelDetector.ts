/**
 * Panel detector — finds comic panel bounding boxes from a loaded img element.
 *
 * Algorithm (no ML, pure Canvas pixel analysis):
 * 1. Draw image to offscreen canvas at ~200px wide (fast to process)
 * 2. For each row: compute mean brightness. Very bright rows (white gutters)
 *    or very dark rows (black gutters) spanning >90% width = horizontal separator.
 * 3. For each column strip between horizontal separators: same for columns.
 * 4. Build list of panel bounding boxes in [x1,y1,x2,y2] as 0..1 fractions.
 * 5. Sort left→right, top→bottom (flip for RTL).
 *
 * Returns [{x1,y1,x2,y2}] representing each detected panel, or a sensible
 * fallback grid if detection finds nothing useful.
 */

export interface PanelBox { x1: number; y1: number; x2: number; y2: number; }

const SCALE    = 200;   // process at this width for speed
const GUTTER   = 12;    // min pixels between gutter candidates (merge nearby)
const MIN_SIZE = 0.08;  // panels smaller than 8% of page are noise → skip

/** Analyse a loaded img element and return panel bounding boxes. */
export function detectPanels(img: HTMLImageElement): PanelBox[] {
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;
  if (!naturalW || !naturalH) return fallback();

  // Draw to small offscreen canvas
  const scale = SCALE / naturalW;
  const cw = Math.round(naturalW * scale);
  const ch = Math.round(naturalH * scale);

  const canvas = document.createElement("canvas");
  canvas.width  = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return fallback();

  ctx.drawImage(img, 0, 0, cw, ch);
  const { data } = ctx.getImageData(0, 0, cw, ch);   // RGBA

  // ── Helper: brightness of a pixel at (x,y) ────────────────────────────
  const brightness = (x: number, y: number) => {
    const i = (y * cw + x) * 4;
    return (data[i] + data[i+1] + data[i+2]) / 3;
  };

  // ── Row brightness profile ─────────────────────────────────────────────
  const rowBrightness = new Float32Array(ch);
  for (let y = 0; y < ch; y++) {
    let sum = 0;
    for (let x = 0; x < cw; x++) sum += brightness(x, y);
    rowBrightness[y] = sum / cw;
  }

  // ── Find horizontal separators (very bright ≥ 230 or very dark ≤ 25) ──
  function isGutterRow(y: number): boolean {
    const b = rowBrightness[y];
    if (b >= 230 || b <= 25) return true;
    // Also check uniformity: variance < 10
    let vsum = 0;
    for (let x = 0; x < cw; x++) vsum += (brightness(x, y) - b) ** 2;
    return (vsum / cw) < 100 && (b >= 200 || b <= 40);
  }

  const hSeps = findSeparators(ch, isGutterRow, GUTTER);

  // Convert separators to band ranges [y_start, y_end]
  const hBands = sepsToBands(hSeps, ch);
  if (hBands.length === 0) return fallback();

  // ── For each horizontal band, find vertical separators ────────────────
  const panels: PanelBox[] = [];

  for (const [y1px, y2px] of hBands) {
    const colBrightness = new Float32Array(cw);
    for (let x = 0; x < cw; x++) {
      let sum = 0;
      for (let y = y1px; y < y2px; y++) sum += brightness(x, y);
      colBrightness[x] = sum / (y2px - y1px);
    }

    function isGutterCol(x: number): boolean {
      const b = colBrightness[x];
      if (b >= 230 || b <= 25) return true;
      let vsum = 0;
      for (let y = y1px; y < y2px; y++) vsum += (brightness(x, y) - b) ** 2;
      return (vsum / (y2px - y1px)) < 100 && (b >= 200 || b <= 40);
    }

    const vSeps = findSeparators(cw, isGutterCol, GUTTER);
    const vBands = sepsToBands(vSeps, cw);

    for (const [x1px, x2px] of vBands) {
      const box: PanelBox = {
        x1: x1px / cw,
        y1: y1px / ch,
        x2: x2px / cw,
        y2: y2px / ch,
      };
      // Filter tiny noise panels
      if (box.x2 - box.x1 >= MIN_SIZE && box.y2 - box.y1 >= MIN_SIZE) {
        panels.push(box);
      }
    }
  }

  return panels.length >= 2 ? panels : fallback();
}

/** Find y/x positions where `isGutter(i)` is true, then merge nearby runs. */
function findSeparators(size: number, isGutter: (i: number) => boolean, minGap: number): number[] {
  // Mark gutter pixels
  const marks: boolean[] = Array.from({ length: size }, (_, i) => isGutter(i));

  // Find runs of gutter pixels and take their midpoints
  const midpoints: number[] = [];
  let inRun = false;
  let runStart = 0;
  for (let i = 0; i <= size; i++) {
    const g = i < size && marks[i];
    if (g && !inRun) { inRun = true; runStart = i; }
    if (!g && inRun) {
      inRun = false;
      midpoints.push(Math.round((runStart + i - 1) / 2));
    }
  }

  // Merge midpoints that are closer than minGap
  const merged: number[] = [];
  for (const m of midpoints) {
    if (merged.length === 0 || m - merged[merged.length - 1] > minGap) {
      merged.push(m);
    } else {
      merged[merged.length - 1] = Math.round((merged[merged.length - 1] + m) / 2);
    }
  }
  return merged;
}

/** Convert separator midpoints to [start, end] bands (gaps between separators). */
function sepsToBands(seps: number[], size: number): [number, number][] {
  // Add virtual borders
  const borders = [0, ...seps, size];
  const bands: [number, number][] = [];
  for (let i = 0; i < borders.length - 1; i++) {
    const start = borders[i];
    const end   = borders[i + 1];
    if (end - start > size * MIN_SIZE) {
      bands.push([start, end]);
    }
  }
  return bands;
}

/** Sensible fallback: 4-panel grid (2 rows × 2 cols), left-to-right top-to-bottom. */
function fallback(): PanelBox[] {
  return [
    { x1: 0,    y1: 0,    x2: 0.5, y2: 0.5 },
    { x1: 0.5,  y1: 0,    x2: 1,   y2: 0.5 },
    { x1: 0,    y1: 0.5,  x2: 0.5, y2: 1   },
    { x1: 0.5,  y1: 0.5,  x2: 1,   y2: 1   },
  ];
}

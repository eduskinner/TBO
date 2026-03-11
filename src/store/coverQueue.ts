/**
 * Cover loading — batches many requests into a single Tauri IPC call.
 *
 * API: get_covers_batch(ids: string[], paths: string[]) → CoverResult[]
 *   where CoverResult = { comicId: string, data: string | null }
 *
 * Using flat Vec<String> args on the Rust side avoids ALL serde/camelCase
 * ambiguity with Tauri v1's automatic parameter name conversion.
 *
 * Requests accumulate for one rAF tick (≈16ms) then fire together.
 * Memory-cached after first load — navigating back is instant.
 * Falls back to single get_cover per item on any error.
 */
import { invoke } from "@tauri-apps/api/core";

interface CoverResult { comicId: string; data: string | null; }
type Resolve = (url: string) => void;
type Reject  = (err: unknown) => void;

const memCache = new Map<string, string>();
const pending  = new Map<string, { filePath: string; resolve: Resolve; reject: Reject }[]>();
let   rafId: number | null = null;

// ── Flush ───────────────────────────────────────────────────────────────────
async function flush() {
  rafId = null;
  if (pending.size === 0) return;

  // Drain pending — anything already cached resolves immediately
  const ids: string[]    = [];
  const paths: string[]  = [];
  const waiters = new Map<string, { resolve: Resolve; reject: Reject }[]>();

  for (const [comicId, cbs] of pending.entries()) {
    if (memCache.has(comicId)) {
      const url = memCache.get(comicId)!;
      cbs.forEach(c => c.resolve(url));
    } else {
      ids.push(comicId);
      paths.push(cbs[0].filePath);
      waiters.set(comicId, cbs.map(c => ({ resolve: c.resolve, reject: c.reject })));
    }
  }
  pending.clear();

  if (ids.length === 0) return;

  // Process in chunks so one batch doesn't hold the Rust thread too long
  const CHUNK = 30;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunkIds   = ids.slice(i, i + CHUNK);
    const chunkPaths = paths.slice(i, i + CHUNK);

    try {
      const results = await invoke<CoverResult[]>("get_covers_batch", {
        ids: chunkIds,
        paths: chunkPaths,
      });

      for (const r of results) {
        const cbs = waiters.get(r.comicId) ?? [];
        if (r.data) {
          memCache.set(r.comicId, r.data);
          cbs.forEach(c => c.resolve(r.data!));
        } else {
          // Rust returned null for this cover — try single fallback
          singleFallback(r.comicId, chunkPaths[chunkIds.indexOf(r.comicId)] ?? "", cbs);
        }
      }
    } catch (err) {
      // Entire chunk failed (e.g. binary not rebuilt yet) — fall back individually
      console.warn("[coverQueue] batch failed, falling back to single calls:", err);
      for (let j = 0; j < chunkIds.length; j++) {
        const cbs = waiters.get(chunkIds[j]) ?? [];
        singleFallback(chunkIds[j], chunkPaths[j], cbs);
      }
    }
  }
}

function singleFallback(
  comicId: string,
  filePath: string,
  cbs: { resolve: Resolve; reject: Reject }[],
) {
  // get_cover takes snake_case params — Tauri v1 auto-converts camelCase at top level
  invoke<string>("get_cover", { comicId, filePath })
    .then(url => {
      memCache.set(comicId, url);
      cbs.forEach(c => c.resolve(url));
    })
    .catch(err => cbs.forEach(c => c.reject(err)));
}

function schedule() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => { flush().catch(console.error); });
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Load a single cover. Deduplicates and batches automatically. */
export function loadCover(comicId: string, filePath: string): Promise<string> {
  if (memCache.has(comicId)) return Promise.resolve(memCache.get(comicId)!);
  return new Promise<string>((resolve, reject) => {
    if (!pending.has(comicId)) pending.set(comicId, []);
    pending.get(comicId)!.push({ filePath, resolve, reject });
    schedule();
  });
}

/** Preload covers for a collection in the background (fire-and-forget). */
export function preloadCovers(comics: { id: string; file_path: string }[]) {
  const todo = comics.filter(c => !memCache.has(c.id));
  if (todo.length === 0) return;
  for (const c of todo) loadCover(c.id, c.file_path).catch(() => {});
}

/** Deterministic placeholder colour from comic ID. */
export function placeholderColor(comicId: string): string {
  let h = 0;
  for (let i = 0; i < comicId.length; i++) h = (h * 31 + comicId.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 18%, 18%)`;
}

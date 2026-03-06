/**
 * Cover loading — uses get_covers_batch to load many covers in a single IPC
 * round-trip instead of one call per cover.
 *
 * Strategy:
 * 1. Requests accumulate for one animation frame (16ms), then fire as a batch.
 * 2. Results are cached in memory — navigating back is instant.
 * 3. preloadCovers() queues an entire folder for background loading.
 */
import { invoke } from "@tauri-apps/api/core";

interface CoverRequest { comic_id: string; file_path: string; }
interface CoverResult  { comic_id: string; data: string | null; }
type Resolve = (url: string) => void;
type Reject  = (err: unknown) => void;

const cache    = new Map<string, string>();              // comicId → data-url
const pending  = new Map<string, { filePath: string; resolve: Resolve; reject: Reject }[]>();
let   rafPending = false;

function flushBatch() {
  rafPending = false;
  if (pending.size === 0) return;

  const comics: CoverRequest[] = [];
  const callbacks = new Map<string, { resolve: Resolve; reject: Reject }[]>();

  for (const [comicId, cbs] of pending.entries()) {
    // Only include if not already cached (race: might have loaded in prev batch)
    if (cache.has(comicId)) {
      const url = cache.get(comicId)!;
      cbs.forEach(({ resolve }) => resolve(url));
      continue;
    }
    comics.push({ comic_id: comicId, file_path: cbs[0].filePath });
    callbacks.set(comicId, cbs.map(({ resolve, reject }) => ({ resolve, reject })));
  }
  pending.clear();

  if (comics.length === 0) return;

  // Split into chunks of 30 so one batch doesn't hold the thread too long
  const CHUNK = 30;
  for (let i = 0; i < comics.length; i += CHUNK) {
    const chunk     = comics.slice(i, i + CHUNK);
    const chunkCbs  = new Map(chunk.map((c) => [c.comic_id, callbacks.get(c.comic_id)!]));

    invoke<CoverResult[]>("get_covers_batch", { comics: chunk })
      .then((results) => {
        for (const r of results) {
          const cbs = chunkCbs.get(r.comic_id) ?? [];
          if (r.data) {
            cache.set(r.comic_id, r.data);
            cbs.forEach(({ resolve }) => resolve(r.data!));
          } else {
            // Cache as failure by setting to a marker or just an empty string
            // so we don't try again this session
            cache.set(r.comic_id, "FAILED");
            cbs.forEach(({ reject }) => reject(new Error(`Cover failed: ${r.comic_id}`)));
          }
        }
      })
      .catch((err) => {
        // On total failure, reject everything in this chunk
        for (const [, cbs] of chunkCbs) cbs.forEach(({ reject }) => reject(err));
      });
  }
}

function scheduleBatch() {
  if (rafPending) return;
  rafPending = true;
  // Use requestAnimationFrame if available, else setTimeout(0)
  if (typeof requestAnimationFrame !== "undefined") {
    requestAnimationFrame(flushBatch);
  } else {
    setTimeout(flushBatch, 0);
  }
}

/** Load a single cover. Batches automatically with other pending requests. */
export function loadCover(comicId: string, filePath: string): Promise<string> {
  const cached = cache.get(comicId);
  if (cached === "FAILED") return Promise.reject(new Error("Cover previously failed"));
  if (cached) return Promise.resolve(cached);

  return new Promise<string>((resolve, reject) => {
    if (!pending.has(comicId)) pending.set(comicId, []);
    pending.get(comicId)!.push({ filePath, resolve, reject });
    scheduleBatch();
  });
}

/**
 * Kick off background loading for a collection of comics.
 * All covers will be preloaded in the background without blocking anything.
 */
export function preloadCovers(comics: { id: string; file_path: string }[]) {
  const todo = comics.filter((c) => !cache.has(c.id));
  if (todo.length === 0) return;

  // Stagger in chunks so we don't send everything at once
  const CHUNK = 40;
  let offset = 0;

  const scheduleChunk = (delay: number) => {
    setTimeout(() => {
      const chunk = todo.slice(offset, offset + CHUNK);
      offset += CHUNK;
      for (const c of chunk) loadCover(c.id, c.file_path).catch(() => {});
      if (offset < todo.length) scheduleChunk(80);
    }, delay);
  };

  scheduleChunk(50);
}

/** Deterministic placeholder colour from comic ID. */
export function placeholderColor(comicId: string): string {
  let h = 0;
  for (let i = 0; i < comicId.length; i++) h = (h * 31 + comicId.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 18%, 18%)`;
}

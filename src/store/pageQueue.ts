/**
 * Two-lane priority queue for reading-page loads.
 *
 * HIGH lane  — main reading pages (current, prev, next).
 *              Concurrency: 3. Never blocked by anything.
 * LOW lane   — thumbnail images.
 *              Concurrency: 2. Only runs when HIGH lane has free slots.
 *
 * Total simultaneous Tauri invokes = 5 max.
 * Navigating fires HIGH requests immediately; they can always grab a slot.
 */
import { invoke } from "@tauri-apps/api/core";

const HIGH_CONCURRENCY = 3;
const LOW_CONCURRENCY  = 2;

type Resolve = (data: string) => void;
type Reject  = (err: unknown) => void;

interface Job {
  filePath:  string;
  pageIndex: number;
  resolve:   Resolve;
  reject:    Reject;
}

// Per-file cache: filePath → (pageIndex → data-url)
const cache = new Map<string, Map<number, string>>();

function getCache(filePath: string, pageIndex: number): string | undefined {
  return cache.get(filePath)?.get(pageIndex);
}
function setCache(filePath: string, pageIndex: number, data: string) {
  if (!cache.has(filePath)) cache.set(filePath, new Map());
  cache.get(filePath)!.set(pageIndex, data);
}

// Inflight sets per lane
const highInflight = new Set<string>(); // "filePath:pageIndex"
const lowInflight  = new Set<string>();

const highQueue: Job[] = [];
const lowQueue:  Job[] = [];

let highActive = 0;
let lowActive  = 0;

function key(filePath: string, pageIndex: number) {
  return `${filePath}:${pageIndex}`;
}

function isInflight(filePath: string, pageIndex: number) {
  const k = key(filePath, pageIndex);
  return highInflight.has(k) || lowInflight.has(k);
}

function runJob(job: Job, lane: "high" | "low") {
  const k = key(job.filePath, job.pageIndex);
  if (lane === "high") { highActive++; highInflight.add(k); }
  else                 { lowActive++;  lowInflight.add(k);  }

  invoke<string>("get_page", { filePath: job.filePath, pageIndex: job.pageIndex })
    .then((data) => {
      setCache(job.filePath, job.pageIndex, data);
      job.resolve(data);
    })
    .catch((err) => job.reject(err))
    .finally(() => {
      if (lane === "high") { highActive--; highInflight.delete(k); }
      else                 { lowActive--;  lowInflight.delete(k);  }
      drain();
    });
}

function drain() {
  // Drain HIGH first — always gets its slots
  while (highActive < HIGH_CONCURRENCY && highQueue.length > 0) {
    const job = highQueue.shift()!;
    const cached = getCache(job.filePath, job.pageIndex);
    if (cached) { job.resolve(cached); continue; }
    if (isInflight(job.filePath, job.pageIndex)) {
      // Re-queue for next drain tick
      setTimeout(() => { highQueue.unshift(job); drain(); }, 20);
      break;
    }
    runJob(job, "high");
  }
  // Drain LOW — only when HIGH has headroom
  while (
    lowActive < LOW_CONCURRENCY &&
    highActive < HIGH_CONCURRENCY &&   // don't steal when HIGH is busy
    lowQueue.length > 0
  ) {
    const job = lowQueue.shift()!;
    const cached = getCache(job.filePath, job.pageIndex);
    if (cached) { job.resolve(cached); continue; }
    if (isInflight(job.filePath, job.pageIndex)) {
      setTimeout(() => { lowQueue.unshift(job); drain(); }, 50);
      break;
    }
    runJob(job, "low");
  }
}

/** Load a page at HIGH priority (main reading view). */
export function loadPageHigh(filePath: string, pageIndex: number): Promise<string> {
  const cached = getCache(filePath, pageIndex);
  if (cached) return Promise.resolve(cached);
  return new Promise<string>((resolve, reject) => {
    // Remove any pending LOW request for same page — HIGH supersedes it
    const idx = lowQueue.findIndex((j) => j.filePath === filePath && j.pageIndex === pageIndex);
    if (idx !== -1) lowQueue.splice(idx, 1);
    highQueue.push({ filePath, pageIndex, resolve, reject });
    drain();
  });
}

/** Load a page at LOW priority (thumbnail / background prefetch). */
export function loadPageLow(filePath: string, pageIndex: number): Promise<string> {
  const cached = getCache(filePath, pageIndex);
  if (cached) return Promise.resolve(cached);
  return new Promise<string>((resolve, reject) => {
    // Don't queue if already queued at HIGH or LOW
    if (
      highQueue.some((j) => j.filePath === filePath && j.pageIndex === pageIndex) ||
      lowQueue.some((j)  => j.filePath === filePath && j.pageIndex === pageIndex) ||
      isInflight(filePath, pageIndex)
    ) {
      // Attach to existing result via polling
      const poll = () => {
        const c = getCache(filePath, pageIndex);
        if (c) { resolve(c); return; }
        setTimeout(poll, 80);
      };
      setTimeout(poll, 80);
      return;
    }
    lowQueue.push({ filePath, pageIndex, resolve, reject });
    drain();
  });
}

/** Check if a page is already cached (no IPC needed). */
export function isPageCached(filePath: string, pageIndex: number): boolean {
  return !!getCache(filePath, pageIndex);
}

/** Get cached page immediately (returns undefined if not cached). */
export function getCachedPage(filePath: string, pageIndex: number): string | undefined {
  return getCache(filePath, pageIndex);
}

/** Clear all queues and cache for a given file (when closing reader). */
export function clearFileCache(filePath: string) {
  cache.delete(filePath);
  // Remove pending jobs for this file
  const filterOut = (q: Job[]) => {
    let i = q.length;
    while (i--) { if (q[i].filePath === filePath) q.splice(i, 1); }
  };
  filterOut(highQueue);
  filterOut(lowQueue);
}

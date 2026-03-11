import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  Comic, Source, AppView, SortField, ReaderLayout, ReadStatus, ScanResult,
} from "../types";

// ── Extra types ───────────────────────────────────────────────────────────────

export interface ScanProgress {
  found:   number;
  current: number;
  added:   number;
  skipped: number;
  done:    boolean;
  file?:   string;
}

// ── Store interface ───────────────────────────────────────────────────────────

interface AppStore {
  comics:        Comic[];
  filteredComics: Comic[];
  sources:       Source[];
  loading:       boolean;
  scanning:      boolean;
  scanResult:    ScanResult | null;
  scanProgress:  ScanProgress | null;

  view:          AppView;
  selectedComic: Comic | null;

  searchQuery:   string;
  sortField:     SortField;
  sortAsc:       boolean;
  filterStatus:  ReadStatus | "all";

  // unused in main window after reader became its own window,
  // but kept so Reader.tsx (used in ReaderWindow) can read prefs
  readerLayout:  ReaderLayout;

  loadLibrary:    () => Promise<void>;
  openAddFolder:  () => Promise<void>;
  rescanSources:  () => Promise<void>;
  setSearch:      (q: string) => void;
  setSort:        (f: SortField) => void;
  toggleSortDir:  () => void;
  setFilterStatus:(s: ReadStatus | "all") => void;

  goLibrary:   () => void;
  openDetail:  (comic: Comic) => void;
  openReader:  (comic: Comic) => Promise<void>;
  goSettings:  () => void;

  updateComic:      (comic: Comic) => Promise<void>;
  toggleRead:       (comicId: string) => Promise<void>;
  deleteComic:          (comicId: string)  => Promise<void>;
  deleteFolderComics:   (folderDir: string) => Promise<void>;
  clearMissingComics:   ()                  => Promise<void>;
  updateProgress:   (comicId: string, page: number) => Promise<void>;
  setReaderLayout:  (l: ReaderLayout) => void;

  loadSources:   () => Promise<void>;
  removeSource:  (id: string) => Promise<void>;
}

// ── Filter + sort helper ──────────────────────────────────────────────────────

function applyFiltersAndSort(
  comics:       Comic[],
  query:        string,
  sortField:    SortField,
  sortAsc:      boolean,
  filterStatus: ReadStatus | "all",
): Comic[] {
  let list = [...comics];

  if (filterStatus !== "all") {
    list = list.filter((c) => c.read_status === filterStatus);
  }

  if (query.trim()) {
    const q = query.toLowerCase();
    list = list.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.series.toLowerCase().includes(q) ||
        c.publisher.toLowerCase().includes(q) ||
        c.writer.toLowerCase().includes(q) ||
        c.tags.toLowerCase().includes(q),
    );
  }

  list.sort((a, b) => {
    let av: string | number = "";
    let bv: string | number = "";
    switch (sortField) {
      case "title":        av = a.title.toLowerCase();         bv = b.title.toLowerCase();         break;
      case "series":       av = a.series.toLowerCase();        bv = b.series.toLowerCase();        break;
      case "date_added":   av = a.date_added;                  bv = b.date_added;                  break;
      case "read_status":  av = a.read_status;                 bv = b.read_status;                 break;
      case "issue_number": av = parseInt(a.issue_number) || 0; bv = parseInt(b.issue_number) || 0; break;
      case "year":         av = a.year ?? 0;                   bv = b.year ?? 0;                   break;
    }
    if (av < bv) return sortAsc ? -1 : 1;
    if (av > bv) return sortAsc ?  1 : -1;
    return 0;
  });

  return list;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useStore = create<AppStore>((set, get) => ({
  comics:         [],
  filteredComics: [],
  sources:        [],
  loading:        false,
  scanning:       false,
  scanResult:     null,
  scanProgress:   null,
  view:           "library",
  selectedComic:  null,
  searchQuery:    "",
  sortField:      "series",
  sortAsc:        true,
  filterStatus:   "all",
  readerLayout:   "single",

  // ── Library ────────────────────────────────────────────────────────────────

  loadLibrary: async () => {
    set({ loading: true });
    try {
      const comics = await invoke<Comic[]>("get_library");
      const { searchQuery, sortField, sortAsc, filterStatus } = get();
      set({
        comics,
        filteredComics: applyFiltersAndSort(comics, searchQuery, sortField, sortAsc, filterStatus),
        loading: false,
      });
    } catch (e) {
      console.error("loadLibrary:", e);
      set({ loading: false });
      throw e;
    }
  },

  openAddFolder: async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || typeof selected !== "string") return;

    set({ scanning: true, scanResult: null, scanProgress: null });
    const unlisten = await listen<ScanProgress>("scan_progress", (ev) => {
      set({ scanProgress: ev.payload });
    });
    try {
      const result = await invoke<ScanResult>("scan_folder", { folderPath: selected });
      set({ scanResult: result, scanning: false, scanProgress: null });
      await get().loadLibrary();
      await get().loadSources();
    } catch (e) {
      console.error("scan_folder:", e);
      set({ scanning: false, scanProgress: null });
    } finally {
      unlisten();
    }
  },

  rescanSources: async () => {
    set({ scanning: true, scanResult: null, scanProgress: null });
    const unlisten = await listen<ScanProgress>("scan_progress", (ev) => {
      set({ scanProgress: ev.payload });
    });
    try {
      const result = await invoke<ScanResult>("rescan_sources");
      set({ scanResult: result, scanning: false, scanProgress: null });
      await get().loadLibrary();
    } catch (e) {
      console.error("rescan_sources:", e);
      set({ scanning: false, scanProgress: null });
    } finally {
      unlisten();
    }
  },

  setSearch: (searchQuery) => {
    const { comics, sortField, sortAsc, filterStatus } = get();
    set({ searchQuery, filteredComics: applyFiltersAndSort(comics, searchQuery, sortField, sortAsc, filterStatus) });
  },

  setSort: (sortField) => {
    const { comics, searchQuery, sortAsc, filterStatus } = get();
    set({ sortField, filteredComics: applyFiltersAndSort(comics, searchQuery, sortField, sortAsc, filterStatus) });
  },

  toggleSortDir: () => {
    const { comics, searchQuery, sortField, filterStatus } = get();
    const sortAsc = !get().sortAsc;
    set({ sortAsc, filteredComics: applyFiltersAndSort(comics, searchQuery, sortField, sortAsc, filterStatus) });
  },

  setFilterStatus: (filterStatus) => {
    const { comics, searchQuery, sortField, sortAsc } = get();
    set({ filterStatus, filteredComics: applyFiltersAndSort(comics, searchQuery, sortField, sortAsc, filterStatus) });
  },

  // ── Navigation ─────────────────────────────────────────────────────────────

  goLibrary:  () => set({ view: "library", selectedComic: null }),
  openDetail: (comic) => set({ view: "detail", selectedComic: comic }),
  goSettings: () => set({ view: "settings" }),

  openReader: async (comic) => {
    try {
      await invoke("open_reader_window", { comicId: comic.id });
    } catch (e) {
      console.error("open_reader_window:", e);
    }
  },

  // ── Comic mutations ────────────────────────────────────────────────────────

  updateComic: async (comic) => {
    await invoke("update_comic", { comic });
    const comics = get().comics.map((c) => (c.id === comic.id ? comic : c));
    const { searchQuery, sortField, sortAsc, filterStatus } = get();
    set({ comics, filteredComics: applyFiltersAndSort(comics, searchQuery, sortField, sortAsc, filterStatus), selectedComic: comic });
  },

  toggleRead: async (comicId) => {
    const newStatus = await invoke<string>("toggle_read_status", { comicId });
    const comics = get().comics.map((c) => c.id === comicId ? { ...c, read_status: newStatus as ReadStatus } : c);
    const { searchQuery, sortField, sortAsc, filterStatus } = get();
    set({ comics, filteredComics: applyFiltersAndSort(comics, searchQuery, sortField, sortAsc, filterStatus) });
  },

  deleteComic: async (comicId) => {
    await invoke("delete_comic", { comicId });
    const comics = get().comics.filter((c) => c.id !== comicId);
    const { searchQuery, sortField, sortAsc, filterStatus } = get();
    set({ comics, filteredComics: applyFiltersAndSort(comics, searchQuery, sortField, sortAsc, filterStatus), view: "library", selectedComic: null });
  },

  deleteFolderComics: async (folderDir) => {
    await invoke("delete_folder_comics", { folderPath: folderDir });
    const comics = get().comics.filter((c) => !c.file_path.startsWith(folderDir));
    const { searchQuery, sortField, sortAsc, filterStatus } = get();
    set({ comics, filteredComics: applyFiltersAndSort(comics, searchQuery, sortField, sortAsc, filterStatus), selectedComic: null });
  },

  clearMissingComics: async () => {
    await invoke("clear_missing_comics");
    const comics = get().comics.filter((c) => !c.missing);
    const { searchQuery, sortField, sortAsc, filterStatus } = get();
    set({ comics, filteredComics: applyFiltersAndSort(comics, searchQuery, sortField, sortAsc, filterStatus), selectedComic: null });
  },

  updateProgress: async (comicId, currentPage) => {
    await invoke("update_reading_progress", { comicId, currentPage });
    const comics = get().comics.map((c) => c.id === comicId ? { ...c, current_page: currentPage } : c);
    set({ comics });
  },

  setReaderLayout: (readerLayout) => set({ readerLayout }),

  // ── Sources ────────────────────────────────────────────────────────────────

  loadSources: async () => {
    try {
      const sources = await invoke<Source[]>("get_sources");
      set({ sources });
    } catch (e) {
      console.error("loadSources:", e);
      throw e;
    }
  },

  removeSource: async (id) => {
    await invoke("remove_source", { sourceId: id });
    await get().loadSources();
    await get().loadLibrary();
  },
}));

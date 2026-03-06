export type ReadStatus = "unread" | "reading" | "read";
export type ReaderLayout = "single" | "guided" | "manga";
export type ReaderDirection = "ltr" | "rtl";
export type SortField = "title" | "series" | "date_added" | "read_status" | "issue_number" | "year";
export type AppView = "library" | "detail" | "reader" | "settings";

export interface Comic {
  id: string;
  file_path: string;
  file_name: string;
  title: string;
  series: string;
  issue_number: string;
  year: number | null;
  publisher: string;
  writer: string;
  artist: string;
  genre: string;
  tags: string;
  read_status: ReadStatus;
  rating: number | null;
  notes: string;
  page_count: number;
  current_page: number;
  cover_cached: boolean;
  date_added: string;
  file_size: number;
  missing: boolean;
}

export interface Source {
  id: string;
  name: string;
  path: string;
}

export interface ScanResult {
  added: number;
  skipped: number;
  errors: string[];
}

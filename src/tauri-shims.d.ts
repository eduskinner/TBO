// Ambient declarations for @tauri-apps/api v1.x subpath imports.
// These bypass TypeScript module resolution entirely — no tsconfig changes needed.

declare module '@tauri-apps/api/tauri' {
  export function invoke<T = unknown>(
    cmd: string,
    args?: Record<string, unknown>
  ): Promise<T>;
}

declare module '@tauri-apps/api/event' {
  export type UnlistenFn = () => void;

  export interface Event<T> {
    event: string;
    windowLabel: string;
    id: number;
    payload: T;
  }

  export function listen<T>(
    event: string,
    handler: (event: Event<T>) => void
  ): Promise<UnlistenFn>;

  export function once<T>(
    event: string,
    handler: (event: Event<T>) => void
  ): Promise<UnlistenFn>;

  export function emit(event: string, payload?: unknown): Promise<void>;
}

declare module '@tauri-apps/api/dialog' {
  export interface OpenDialogOptions {
    directory?: boolean;
    multiple?: boolean;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    title?: string;
  }
  export function open(
    options?: OpenDialogOptions
  ): Promise<string | string[] | null>;
}

declare module '@tauri-apps/api' {
  export function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  export type UnlistenFn = () => void;
  export interface TauriEvent<T> { event: string; windowLabel: string; id: number; payload: T; }
  export function listen<T>(event: string, handler: (event: TauriEvent<T>) => void): Promise<UnlistenFn>;
  export function once<T>(event: string, handler: (event: TauriEvent<T>) => void): Promise<UnlistenFn>;
  export function emit(event: string, payload?: unknown): Promise<void>;
  export interface OpenDialogOptions { directory?: boolean; multiple?: boolean; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }>; title?: string; }
  export function open(options?: OpenDialogOptions): Promise<string | string[] | null>;
}

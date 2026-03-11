/**
 * usePlatform — platform detection helpers for Lector TBO
 */

/** Common Android storage paths for the quick-pick folder UI */
export const ANDROID_QUICK_PATHS = [
  { label: "Downloads",   path: "/storage/emulated/0/Download" },
  { label: "Documents",   path: "/storage/emulated/0/Documents" },
  { label: "Comics",      path: "/storage/emulated/0/Comics" },
  { label: "Books",       path: "/storage/emulated/0/Books" },
  { label: "SD Card",     path: "/storage/sdcard1" },
];

/** True when running inside the Tauri Android WebView */
export function isAndroid(): boolean {
  try {
    const internals = (window as any).__TAURI_INTERNALS__;
    if (internals?.metadata?.currentWindow?.platform === "android") return true;
    // Fallback: check user agent
    return /android/i.test(navigator.userAgent);
  } catch {
    return /android/i.test(navigator.userAgent);
  }
}

/** True when running on any mobile platform */
export function isMobile(): boolean {
  return isAndroid() || /iphone|ipad|ipod/i.test(navigator.userAgent);
}

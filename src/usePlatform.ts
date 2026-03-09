/**
 * Detects whether we are running on a mobile device (Android/iOS).
 * Used to switch between the desktop and mobile UI.
 */
export function isMobile(): boolean {
  // Tauri sets a user agent that includes the OS
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("android") || ua.includes("iphone") || ua.includes("ipad")) return true;
  // Fallback: narrow screen
  return window.innerWidth < 768;
}

/** Common Android storage paths shown as quick-pick buttons in the Add Folder modal */
export const ANDROID_QUICK_PATHS = [
  { label: "Internal Storage", path: "/storage/emulated/0" },
  { label: "Downloads",        path: "/storage/emulated/0/Download" },
  { label: "Documents",        path: "/storage/emulated/0/Documents" },
  { label: "Comics",           path: "/storage/emulated/0/Comics" },
  { label: "SD Card",          path: "/storage/sdcard1" },
];

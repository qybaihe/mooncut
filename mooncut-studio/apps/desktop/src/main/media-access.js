/**
 * Path allowlist for mooncut-media protocol + IPC media preview.
 */

import {resolve, sep} from "node:path";

export function isPathUnderRoot(filePath, root) {
  const resolved = resolve(filePath);
  const base = resolve(root);
  return resolved === base || resolved.startsWith(base.endsWith(sep) ? base : base + sep);
}

export function isPathAllowed(filePath, roots) {
  return roots.some((root) => root && isPathUnderRoot(filePath, root));
}

/** Permission types Studio may grant for teleprompter / record studio. */
export const STUDIO_MEDIA_PERMISSIONS = new Set(["media", "mediaKeySystem", "display-capture"]);

/**
 * Only grant camera/mic/display-capture from our own renderer (file:// or local dev).
 * Deny unrelated permissions always.
 */
export function shouldGrantPermission(permission, pageUrl) {
  if (!STUDIO_MEDIA_PERMISSIONS.has(permission)) return false;
  if (!pageUrl) return false;
  try {
    const url = new URL(pageUrl);
    if (url.protocol === "file:") return true;
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return true;
    return false;
  } catch {
    return false;
  }
}

/** Recording size/duration limits (bytes / ms). */
export const MAX_RECORDING_BYTES = 512 * 1024 * 1024; // 512 MiB
export const MAX_RECORDING_DURATION_MS = 45 * 60 * 1000; // 45 minutes

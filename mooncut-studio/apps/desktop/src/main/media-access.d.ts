export function isPathUnderRoot(filePath: string, root: string): boolean;
export function isPathAllowed(filePath: string, roots: string[]): boolean;
export const STUDIO_MEDIA_PERMISSIONS: Set<string>;
export function shouldGrantPermission(permission: string, pageUrl: string): boolean;
export const MAX_RECORDING_BYTES: number;
export const MAX_RECORDING_DURATION_MS: number;

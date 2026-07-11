/**
 * Official MoonCut brand asset.
 * Source: mooncut-logo-transparent.png (1254×1254, crescent + waveform + wordmark).
 */
import mooncutLogoSrc from './mooncut-logo-transparent.png'

export { mooncutLogoSrc }

/** Intrinsic pixel size of the square lockup asset. */
export const MOONCUT_LOGO_SIZE = 1254 as const

/**
 * Icon-only crop region inside the square lockup (pixel space).
 * Used by CSS mark presentation: crescent + spark + waveform, no wordmark.
 * bbox measured from non-transparent content analysis.
 */
export const MOONCUT_LOGO_MARK_REGION = {
  x: 354,
  y: 210,
  size: 560,
} as const

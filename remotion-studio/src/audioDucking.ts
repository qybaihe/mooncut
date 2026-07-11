export type TimedNarrationRange = {
  start_ms: number;
  end_ms: number;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

/**
 * Returns a 0..1 envelope for lowering a music bed under timed narration.
 * Timed subtitles are the shared contract between transcript, edit spec and
 * renderer, so this works for recorded voice and TTS without exposing audio
 * data or provider credentials to a composition.
 */
export const narrationDuckAmount = ({
  timeMs,
  ranges,
  attackMs = 100,
  releaseMs = 350,
}: {
  timeMs: number;
  ranges: TimedNarrationRange[];
  attackMs?: number;
  releaseMs?: number;
}) => {
  if (!Number.isFinite(timeMs)) return 0;
  let amount = 0;
  for (const range of ranges) {
    if (!Number.isFinite(range.start_ms) || !Number.isFinite(range.end_ms) || range.end_ms <= range.start_ms) continue;
    if (timeMs >= range.start_ms && timeMs <= range.end_ms) return 1;
    if (attackMs > 0 && timeMs >= range.start_ms - attackMs && timeMs < range.start_ms) {
      amount = Math.max(amount, clamp((timeMs - (range.start_ms - attackMs)) / attackMs, 0, 1));
    }
    if (releaseMs > 0 && timeMs > range.end_ms && timeMs <= range.end_ms + releaseMs) {
      amount = Math.max(amount, clamp(1 - (timeMs - range.end_ms) / releaseMs, 0, 1));
    }
  }
  return amount;
};

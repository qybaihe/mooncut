import {runProcess} from "./process.ts";
import type {
  SpeechCleanupCut,
  SpeechCleanupKeepRange,
  SpeechCleanupManifest,
  SpeechCleanupPolicy,
  SubtitleData,
  SubtitleWord,
} from "./types.ts";

type Interval = {startMs: number; endMs: number; reason: string};

export const DEFAULT_SPEECH_CLEANUP_POLICY: SpeechCleanupPolicy = {
  enabled: true,
  minSilenceMs: 750,
  retainedSilenceMs: 190,
  fillerPaddingMs: 80,
  wordGuardMs: 55,
};

const fillerTokens = new Set([
  "嗯", "嗯嗯", "啊", "啊啊", "呃", "呃呃", "额", "额额", "噢", "哦", "唔",
  "em", "emm", "emmm", "um", "umm", "uh", "uhh", "er", "err",
]);

const compact = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const toSeconds = (milliseconds: number) => (milliseconds / 1000).toFixed(3);

export const isFillerToken = (value: string) => fillerTokens.has(compact(value));

const sortedWords = (subtitles: SubtitleData) => (subtitles.words ?? [])
  .filter((word) => Number.isFinite(word.start_ms) && Number.isFinite(word.end_ms) && word.end_ms > word.start_ms)
  .slice()
  .sort((left, right) => left.start_ms - right.start_ms || left.end_ms - right.end_ms);

const mergeCuts = (cuts: SpeechCleanupCut[], durationMs: number): SpeechCleanupCut[] => {
  const merged: SpeechCleanupCut[] = [];
  for (const candidate of cuts
    .map((cut) => ({...cut, startMs: clamp(Math.round(cut.startMs), 0, durationMs), endMs: clamp(Math.round(cut.endMs), 0, durationMs)}))
    .filter((cut) => cut.endMs - cut.startMs >= 40)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)) {
    const previous = merged.at(-1);
    if (!previous || candidate.startMs > previous.endMs + 120) {
      merged.push({...candidate, reasons: [...new Set(candidate.reasons)]});
      continue;
    }
    previous.endMs = Math.max(previous.endMs, candidate.endMs);
    previous.kind = previous.kind === candidate.kind ? previous.kind : "combined";
    previous.reasons = [...new Set([...previous.reasons, ...candidate.reasons])];
  }
  return merged;
};

const complementCuts = (cuts: SpeechCleanupCut[], durationMs: number): SpeechCleanupKeepRange[] => {
  let sourceCursor = 0;
  let outputCursor = 0;
  const ranges: SpeechCleanupKeepRange[] = [];
  for (const cut of cuts) {
    if (cut.startMs > sourceCursor) {
      const length = cut.startMs - sourceCursor;
      ranges.push({
        sourceStartMs: sourceCursor,
        sourceEndMs: cut.startMs,
        outputStartMs: outputCursor,
        outputEndMs: outputCursor + length,
      });
      outputCursor += length;
    }
    sourceCursor = Math.max(sourceCursor, cut.endMs);
  }
  if (sourceCursor < durationMs) {
    const length = durationMs - sourceCursor;
    ranges.push({
      sourceStartMs: sourceCursor,
      sourceEndMs: durationMs,
      outputStartMs: outputCursor,
      outputEndMs: outputCursor + length,
    });
  }
  return ranges;
};

const audioCandidateCuts = (
  silences: Interval[],
  words: SubtitleWord[],
  policy: SpeechCleanupPolicy,
): SpeechCleanupCut[] => silences.flatMap((silence) => {
  const previous = words.filter((word) => word.end_ms <= silence.startMs + policy.wordGuardMs).at(-1);
  const next = words.find((word) => word.start_ms >= silence.endMs - policy.wordGuardMs);
  const safeStart = Math.max(silence.startMs, (previous?.end_ms ?? silence.startMs) + policy.wordGuardMs);
  const safeEnd = Math.min(silence.endMs, (next?.start_ms ?? silence.endMs) - policy.wordGuardMs);
  const safeDuration = safeEnd - safeStart;
  if (safeDuration < policy.minSilenceMs) return [];
  const removeDuration = safeDuration - policy.retainedSilenceMs;
  if (removeDuration <= 0) return [];
  const startMs = safeStart + Math.floor(removeDuration / 2);
  const endMs = safeEnd - Math.ceil(removeDuration / 2);
  return endMs - startMs >= 40
    ? [{startMs, endMs, kind: "silence" as const, reasons: [silence.reason]}]
    : [];
});

const wordGapCandidates = (words: SubtitleWord[], policy: SpeechCleanupPolicy): Interval[] => {
  const intervals: Interval[] = [];
  const contentWords = words.filter((word) => !isFillerToken(word.text));
  for (let index = 1; index < contentWords.length; index += 1) {
    const previous = contentWords[index - 1];
    const current = contentWords[index];
    if (current.start_ms - previous.end_ms >= policy.minSilenceMs) {
      intervals.push({startMs: previous.end_ms, endMs: current.start_ms, reason: "timed-word-gap"});
    }
  }
  return intervals;
};

const fillerCandidates = (words: SubtitleWord[], durationMs: number, policy: SpeechCleanupPolicy): SpeechCleanupCut[] => {
  const groups: Array<{start: number; end: number}> = [];
  for (let index = 0; index < words.length; index += 1) {
    if (!isFillerToken(words[index].text)) continue;
    const start = index;
    while (index + 1 < words.length && isFillerToken(words[index + 1].text) && words[index + 1].start_ms - words[index].end_ms <= 260) {
      index += 1;
    }
    groups.push({start, end: index});
  }
  return groups.flatMap((group) => {
    const first = words[group.start];
    const last = words[group.end];
    const previous = words[group.start - 1];
    const next = words[group.end + 1];
    const minimum = previous ? previous.end_ms + policy.wordGuardMs : 0;
    const maximum = next ? next.start_ms - policy.wordGuardMs : durationMs;
    const startMs = clamp(first.start_ms - policy.fillerPaddingMs, minimum, maximum);
    const endMs = clamp(last.end_ms + policy.fillerPaddingMs, minimum, maximum);
    if (endMs - startMs < 40) return [];
    const tokens = words.slice(group.start, group.end + 1).map((word) => word.text).join("");
    return [{startMs, endMs, kind: "filler" as const, reasons: [`filler:${tokens}`]}];
  });
};

/**
 * A filler inside a long gap needs different treatment from a silent gap:
 * preserve one short natural pause across the entire non-content span instead
 * of leaving two large pauses on either side of the deleted filler.
 */
const fillerBridgeCandidates = (words: SubtitleWord[], policy: SpeechCleanupPolicy): SpeechCleanupCut[] => {
  const contentWords = words.filter((word) => !isFillerToken(word.text));
  return contentWords.flatMap((previous, index) => {
    const next = contentWords[index + 1];
    if (!next || next.start_ms - previous.end_ms < policy.minSilenceMs) return [];
    const hasFiller = words.some((word) =>
      isFillerToken(word.text) && word.start_ms >= previous.end_ms && word.end_ms <= next.start_ms);
    if (!hasFiller) return [];
    const retainedEachSide = Math.max(policy.wordGuardMs, Math.floor(policy.retainedSilenceMs / 2));
    const startMs = previous.end_ms + retainedEachSide;
    const endMs = next.start_ms - retainedEachSide;
    return endMs - startMs >= 40
      ? [{startMs, endMs, kind: "combined" as const, reasons: ["filler-bridged-pause"]}]
      : [];
  });
};

/** Build a pure, auditable EDL. It can be tested without FFmpeg or a model. */
export const planSpeechCleanup = ({
  subtitles,
  durationMs,
  policy = DEFAULT_SPEECH_CLEANUP_POLICY,
  audioSilences = [],
}: {
  subtitles: SubtitleData;
  durationMs: number;
  policy?: SpeechCleanupPolicy;
  audioSilences?: Interval[];
}): SpeechCleanupManifest => {
  const words = sortedWords(subtitles);
  const base = {
    schemaVersion: "mooncut.speech-cleanup.v1" as const,
    policy,
    sourceDurationMs: durationMs,
  };
  if (!policy.enabled) {
    return {...base, status: "skipped", reason: "speech cleanup disabled", outputDurationMs: durationMs, removedDurationMs: 0, cuts: [], keptRanges: complementCuts([], durationMs)};
  }
  if (words.length === 0) {
    return {...base, status: "skipped", reason: "word timestamps are required for safe speech cleanup", outputDurationMs: durationMs, removedDurationMs: 0, cuts: [], keptRanges: complementCuts([], durationMs)};
  }
  const silenceIntervals = audioSilences.length > 0 ? audioSilences : wordGapCandidates(words, policy);
  const cuts = mergeCuts([
    ...fillerCandidates(words, durationMs, policy),
    ...fillerBridgeCandidates(words, policy),
    ...audioCandidateCuts(silenceIntervals, words, policy),
  ], durationMs);
  const keptRanges = complementCuts(cuts, durationMs);
  const outputDurationMs = keptRanges.at(-1)?.outputEndMs ?? 0;
  const removedDurationMs = Math.max(0, durationMs - outputDurationMs);
  return {
    ...base,
    status: cuts.length > 0 ? "applied" : "skipped",
    reason: cuts.length > 0 ? "removed isolated fillers and excess silence" : "no removable fillers or long pauses found",
    outputDurationMs,
    removedDurationMs,
    cuts,
    keptRanges,
  };
};

const mapSourceTime = (sourceMs: number, ranges: SpeechCleanupKeepRange[]) => {
  const range = ranges.find((candidate) => sourceMs >= candidate.sourceStartMs && sourceMs <= candidate.sourceEndMs);
  if (!range) return undefined;
  return range.outputStartMs + clamp(sourceMs, range.sourceStartMs, range.sourceEndMs) - range.sourceStartMs;
};

const stripFillerText = (value: string) => value
  .replace(/[，,、\s]*(?:嗯+|啊+|呃+|额+|噢+|哦+|唔+|em+|um+|uh+|er+)[，,、\s]*/giu, "")
  .replace(/^[，,、\s]+|[，,、\s]+$/gu, "")
  .replace(/\s{2,}/gu, " ")
  .trim();

/** Retime captions to the derived timeline and remove captions for deleted fillers. */
export const retimeSubtitlesAfterCleanup = (subtitles: SubtitleData, manifest: SpeechCleanupManifest): SubtitleData => {
  if (manifest.status !== "applied") return subtitles;
  const mappedWords = sortedWords(subtitles).flatMap((word) => {
    if (isFillerToken(word.text)) return [];
    const midpoint = (word.start_ms + word.end_ms) / 2;
    const startMs = mapSourceTime(word.start_ms, manifest.keptRanges);
    const endMs = mapSourceTime(Math.max(word.start_ms, word.end_ms - 1), manifest.keptRanges);
    if (mapSourceTime(midpoint, manifest.keptRanges) === undefined || startMs === undefined || endMs === undefined) return [];
    return [{sourceStartMs: word.start_ms, sourceEndMs: word.end_ms, word: {...word, start_ms: Math.round(startMs), end_ms: Math.max(Math.round(startMs + 1), Math.round(endMs))}}];
  });
  const segments = subtitles.segments.flatMap((segment) => {
    const words = mappedWords.filter((entry) => entry.sourceStartMs >= segment.start_ms && entry.sourceEndMs <= segment.end_ms);
    if (words.length === 0) return [];
    const text = stripFillerText(segment.text) || words.map((entry) => entry.word.text).join("");
    if (!text) return [];
    return [{
      index: 0,
      text,
      start_ms: words[0].word.start_ms,
      end_ms: words.at(-1)!.word.end_ms,
    }];
  }).map((segment, index) => ({...segment, index: index + 1}));
  return {
    duration_ms: manifest.outputDurationMs,
    transcript: segments.map((segment) => segment.text).join(""),
    segments,
    words: mappedWords.map((entry) => entry.word),
    provider: `${subtitles.provider} + speech-cleanup`,
  };
};

/** Parse FFmpeg silencedetect output; no network or model call is involved. */
export const detectAudioSilences = async (inputPath: string, minimumDurationMs: number): Promise<Interval[]> => {
  const result = await runProcess("ffmpeg", [
    "-hide_banner", "-nostats", "-i", inputPath,
    "-af", `silencedetect=n=-35dB:d=${Math.max(0.1, minimumDurationMs / 1000).toFixed(3)}`,
    "-f", "null", "-",
  ], {timeoutMs: 10 * 60_000});
  const intervals: Interval[] = [];
  let openStart: number | undefined;
  for (const line of result.stderr.split(/\r?\n/u)) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/u);
    if (startMatch) {
      openStart = Math.round(Number(startMatch[1]) * 1000);
      continue;
    }
    const endMatch = line.match(/silence_end:\s*([\d.]+)/u);
    if (endMatch && openStart !== undefined) {
      const endMs = Math.round(Number(endMatch[1]) * 1000);
      if (endMs > openStart) intervals.push({startMs: openStart, endMs, reason: "acoustic-silence"});
      openStart = undefined;
    }
  }
  return intervals;
};

/** Render a derived MP4 from the EDL. Original media is never modified. */
export const renderSpeechCleanup = async ({
  inputPath,
  outputPath,
  manifest,
  hasAudio,
}: {
  inputPath: string;
  outputPath: string;
  manifest: SpeechCleanupManifest;
  hasAudio: boolean;
}) => {
  if (manifest.status !== "applied") return;
  const ranges = manifest.keptRanges;
  if (ranges.length === 0) throw new Error("Speech cleanup would remove the entire source");
  const parts = ranges.map((range, index) => {
    const start = toSeconds(range.sourceStartMs);
    const end = toSeconds(range.sourceEndMs);
    const video = `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`;
    const audio = hasAudio ? `;[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]` : "";
    return `${video}${audio};`;
  }).join("");
  const concatInputs = ranges.map((_, index) => hasAudio ? `[v${index}][a${index}]` : `[v${index}]`).join("");
  const filter = hasAudio
    ? `${parts}${concatInputs}concat=n=${ranges.length}:v=1:a=1[vout][aout]`
    : `${parts}${concatInputs}concat=n=${ranges.length}:v=1:a=0[vout]`;
  await runProcess("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", inputPath,
    "-filter_complex", filter,
    "-map", "[vout]",
    ...(hasAudio ? ["-map", "[aout]"] : ["-an"]),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : []),
    "-movflags", "+faststart", "-y", outputPath,
  ], {timeoutMs: 60 * 60_000});
};

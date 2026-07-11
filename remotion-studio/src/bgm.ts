import rawCatalog from './data/bgm-library.json' with {type: 'json'};

export type BgmCategory =
  | 'calm_explainer'
  | 'upbeat_tech'
  | 'serious_documentary'
  | 'energetic_emphasis'
  | 'warm_emotional';

export type BgmMood =
  | 'aggressive'
  | 'bright'
  | 'calm'
  | 'confident'
  | 'dark'
  | 'emotional'
  | 'energetic'
  | 'friendly'
  | 'hopeful'
  | 'inspiring'
  | 'modern'
  | 'mysterious'
  | 'neutral'
  | 'optimistic'
  | 'peaceful'
  | 'playful'
  | 'rebellious'
  | 'reflective'
  | 'relaxed'
  | 'serious'
  | 'soft'
  | 'spacious'
  | 'steady'
  | 'tech'
  | 'tense'
  | 'upbeat'
  | 'urgent'
  | 'warm';

export type BgmUseCase =
  | 'analysis'
  | 'business'
  | 'documentary'
  | 'knowledge'
  | 'lifestyle'
  | 'motivational'
  | 'news'
  | 'opinion'
  | 'product'
  | 'sports'
  | 'story'
  | 'technology'
  | 'tutorial';

export type BgmUsePolicy = 'accent_only' | 'full_bed' | 'low_gain_bed' | 'short_bed';
export type BgmEnergy = 1 | 2 | 3 | 4 | 5;

export type BgmTrack = {
  id: string;
  title: string;
  descriptionZh: string;
  file: string;
  category: BgmCategory;
  moods: BgmMood[];
  useCases: BgmUseCase[];
  energy: BgmEnergy;
  arrangementDensity: 'sparse' | 'medium' | 'dense';
  instrumental: true;
  loopable: boolean;
  demoOnly?: boolean;
  attribution?: string;
  analysis: {
    durationMs: number;
    bpmEstimate: number;
    tempoFeelBpm: number;
    integratedLufs: number;
    peakDbfs: number;
    speechBandRatio: number;
    presenceRatio: number;
    speechFit: number;
  };
  mix: {
    gainDb: number;
    duckDb: number;
    fadeInMs: number;
    fadeOutMs: number;
    crossfadeLoopMs: number;
    usePolicy: BgmUsePolicy;
  };
  source: {
    pageUrl: string;
    downloadUrl: string;
    declaredLicense: string;
    verifiedAt: string;
  };
  integrity: {sourceSha256: string; localSha256: string};
  licenseId: 'CC0-1.0' | 'MIXKIT-FREE-DEMO' | 'CC-BY-NC-SA-4.0';
};

export type BgmSelectionInput = {
  category?: BgmCategory;
  moods?: BgmMood[];
  useCase?: BgmUseCase;
  targetEnergy?: BgmEnergy;
  contentDurationMs?: number;
  allowAccentOnly?: boolean;
  excludedTrackIds?: string[];
  seed?: string;
};

export type RankedBgmTrack = {
  track: BgmTrack;
  score: number;
  reasons: string[];
};

export const bgmCatalog = rawCatalog;
export const bgmTracks = rawCatalog.tracks as BgmTrack[];

const stableUnitInterval = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
};

export const dbToVolume = (db: number) => 10 ** (db / 20);

export const getBgmTrack = (id: string) => bgmTracks.find((track) => track.id === id) ?? null;

export const rankBgmTracks = (input: BgmSelectionInput = {}): RankedBgmTrack[] => {
  const excluded = new Set(input.excludedTrackIds ?? []);
  const requestedMoods = new Set(input.moods ?? []);

  return bgmTracks
    .filter((track) => !excluded.has(track.id))
    .filter((track) => input.allowAccentOnly || track.mix.usePolicy !== 'accent_only')
    .map((track) => {
      let score = track.analysis.speechFit * 1.4;
      const reasons: string[] = [`speech-fit:${track.analysis.speechFit}/5`];

      if (input.category && track.category === input.category) {
        score += 9;
        reasons.push(`category:${input.category}`);
      }

      const moodMatches = track.moods.filter((mood) => requestedMoods.has(mood)).length;
      if (moodMatches > 0) {
        score += moodMatches * 3;
        reasons.push(`mood-matches:${moodMatches}`);
      }

      if (input.useCase && track.useCases.includes(input.useCase)) {
        score += 5;
        reasons.push(`use-case:${input.useCase}`);
      }

      if (input.targetEnergy) {
        const distance = Math.abs(track.energy - input.targetEnergy);
        score += Math.max(0, 5 - distance * 1.75);
        reasons.push(`energy-distance:${distance}`);
      }

      if (input.contentDurationMs && input.contentDurationMs > track.analysis.durationMs && !track.loopable) {
        score -= 1.5;
        reasons.push('crossfade-loop-needed');
      }

      if (track.mix.usePolicy === 'low_gain_bed') score -= 1;
      if (track.mix.usePolicy === 'short_bed' && (input.contentDurationMs ?? 0) > 60000) score -= 4;
      if (track.demoOnly) {
        score += 2.5;
        reasons.push('demo-pack');
      }

      score += stableUnitInterval(`${input.seed ?? 'mooncut'}:${track.id}`) * 0.01;
      return {track, score, reasons};
    })
    .sort((left, right) => right.score - left.score);
};

export const selectBgmTrack = (input: BgmSelectionInput = {}) => rankBgmTracks(input)[0]?.track ?? null;

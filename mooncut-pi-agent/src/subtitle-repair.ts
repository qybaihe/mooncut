import {config} from "./config.ts";
import {requestStructuredCompletion, type GatewayMessage} from "./gateway.ts";
import type {SubtitleData, SubtitleRepairAnalysis, SubtitleRepairChange, SubtitleRepairFeedback, SubtitleSegment} from "./types.ts";

type PlannedChange = {
  segmentIndex?: unknown;
  correctedText?: unknown;
  reason?: unknown;
};

const compact = (value: string) => value.replace(/\s+/gu, " ").trim();
const normalized = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const candidateSegments = (segments: SubtitleSegment[], feedback: SubtitleRepairFeedback) => {
  const cueWindow = Number.isFinite(feedback.atMs) ? 16_000 : 0;
  const keywords = compact(feedback.instruction)
    .split(/[，。！？、,!?\s]+/u)
    .map(normalized)
    .filter((token) => token.length >= 2)
    .slice(0, 8);
  const ranked = segments.map((segment) => {
    const distance = Number.isFinite(feedback.atMs)
      ? Math.max(0, Math.max(segment.start_ms - feedback.atMs!, feedback.atMs! - segment.end_ms))
      : Number.POSITIVE_INFINITY;
    const text = normalized(segment.text);
    const keywordScore = keywords.filter((keyword) => text.includes(keyword) || keyword.includes(text)).length * 5_000;
    const cueScore = distance <= cueWindow ? 20_000 - distance : 0;
    return {segment, score: cueScore + keywordScore - Math.min(distance, 100_000) / 100};
  });
  return ranked
    .sort((left, right) => right.score - left.score || left.segment.start_ms - right.segment.start_ms)
    .slice(0, Math.min(60, segments.length))
    .map(({segment}) => segment)
    .sort((left, right) => left.start_ms - right.start_ms);
};

const cleanChange = (
  raw: PlannedChange,
  segmentsByIndex: Map<number, SubtitleSegment>,
): SubtitleRepairChange | undefined => {
  const segmentIndex = typeof raw.segmentIndex === "number" && Number.isInteger(raw.segmentIndex) ? raw.segmentIndex : -1;
  const segment = segmentsByIndex.get(segmentIndex);
  const after = typeof raw.correctedText === "string" ? compact(raw.correctedText).slice(0, 160) : "";
  if (!segment || !after || after === compact(segment.text)) return undefined;
  return {
    segmentIndex,
    before: segment.text,
    after,
    startMs: segment.start_ms,
    endMs: segment.end_ms,
    reason: typeof raw.reason === "string" ? compact(raw.reason).slice(0, 160) : "根据人工反馈修正字幕",
  };
};

export const planSubtitleRepair = async (
  subtitles: SubtitleData,
  feedback: SubtitleRepairFeedback,
): Promise<SubtitleRepairAnalysis> => {
  const candidates = candidateSegments(subtitles.segments, feedback);
  if (candidates.length === 0) throw new Error("This video does not have timed subtitles to repair");
  const candidatesByIndex = new Map(candidates.map((segment) => [segment.index, segment]));
  const messages: GatewayMessage[] = [
    {
      role: "system",
      content: [
        "你是 MoonCut 的字幕修复 Agent。只根据编辑者的反馈修正已有字幕；不要总结、不要改动视频内容或画面。",
        "只选择候选列表中确实受影响的 segmentIndex。保留说话人的原意与语言，不要凭空补写。",
        "如果编辑者提供了“正确字幕”，应优先采用它；若反馈不足以安全确定文字，返回空 changes，不要猜测。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `编辑者反馈：${feedback.instruction}`,
        Number.isFinite(feedback.atMs) ? `预览定位：${(feedback.atMs! / 1000).toFixed(2)} 秒` : "预览定位：未提供",
        feedback.replacementText ? `编辑者提供的正确字幕：${feedback.replacementText}` : "编辑者未提供精确替换文本",
        "候选字幕（segmentIndex | 起止秒 | 当前文本）：",
        ...candidates.map((segment) => `${segment.index} | ${(segment.start_ms / 1000).toFixed(2)}-${(segment.end_ms / 1000).toFixed(2)} | ${segment.text}`),
        "调用 submit_subtitle_repair 返回修复方案。",
      ].join("\n"),
    },
  ];
  const value = await requestStructuredCompletion({
    model: config.plannerModel,
    messages,
    toolName: "submit_subtitle_repair",
    toolDescription: "Return a narrow, auditable set of subtitle corrections for the editor's feedback.",
    maxTokens: 1600,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: {type: "string", maxLength: 240},
        changes: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              segmentIndex: {type: "integer"},
              correctedText: {type: "string", minLength: 1, maxLength: 160},
              reason: {type: "string", maxLength: 160},
            },
            required: ["segmentIndex", "correctedText", "reason"],
          },
        },
      },
      required: ["summary", "changes"],
    },
  });
  const changes = Array.isArray(value.changes)
    ? value.changes
      .map((item) => cleanChange(item && typeof item === "object" ? item as PlannedChange : {}, candidatesByIndex))
      .filter((item): item is SubtitleRepairChange => Boolean(item))
      .filter((item, index, items) => items.findIndex((other) => other.segmentIndex === item.segmentIndex) === index)
    : [];
  if (changes.length === 0) {
    throw new Error("字幕修复 Agent 未能从反馈中确定可安全应用的改动；请补充时间点或正确字幕");
  }
  return {
    summary: typeof value.summary === "string" && compact(value.summary)
      ? compact(value.summary).slice(0, 240)
      : `已定位并修复 ${changes.length} 处字幕。`,
    changes,
    model: config.plannerModel,
  };
};

export const applySubtitleRepair = (subtitles: SubtitleData, changes: SubtitleRepairChange[]): SubtitleData => {
  const changesByIndex = new Map(changes.map((change) => [change.segmentIndex, change]));
  const segments = subtitles.segments.map((segment) => {
    const change = changesByIndex.get(segment.index);
    return change ? {...segment, text: change.after} : segment;
  });
  return {
    ...subtitles,
    transcript: segments.map((segment) => segment.text).join("\n"),
    segments,
    provider: `${subtitles.provider} + human-repair`,
  };
};

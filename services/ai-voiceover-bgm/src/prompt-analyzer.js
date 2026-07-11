import { ProviderError } from "./errors.js";
import { clamp, joinUrl, safeJsonParse } from "./utils.js";

const KEYWORD_PROFILES = [
  { words: ["科技", "ai", "人工智能", "产品", "发布", "未来", "效率"], mood: "confident, forward-looking", tags: "modern technology, minimal electronic, corporate ambient", bpm: 108, instruments: "soft synth pulse, warm pad, light electronic percussion" },
  { words: ["治愈", "温暖", "生活", "陪伴", "家", "成长"], mood: "warm, gentle, hopeful", tags: "warm acoustic, cinematic ambient", bpm: 82, instruments: "felt piano, soft acoustic guitar, subtle strings" },
  { words: ["紧急", "警告", "风险", "危机", "真相", "揭秘"], mood: "restrained tension, serious", tags: "documentary tension, minimal cinematic", bpm: 96, instruments: "low pulse, muted percussion, sparse piano" },
  { words: ["搞笑", "有趣", "轻松", "段子", "欢乐"], mood: "playful, light, upbeat", tags: "quirky pop, light funk", bpm: 116, instruments: "muted guitar, plucky keys, light drums" },
  { words: ["历史", "文化", "故事", "人物", "纪录"], mood: "thoughtful, dignified, narrative", tags: "documentary cinematic, organic ambient", bpm: 76, instruments: "piano, restrained strings, soft frame drum" },
  { words: ["销售", "优惠", "活动", "直播", "下单", "品牌"], mood: "energetic, positive, persuasive", tags: "upbeat commercial pop, clean electronic", bpm: 122, instruments: "bright synth, clean bass, punchy light drums" },
];

function inferProfile(script) {
  const lowered = script.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const profile of KEYWORD_PROFILES) {
    const score = profile.words.reduce((sum, word) => sum + (lowered.includes(word) ? 1 : 0), 0);
    if (score > bestScore) {
      best = profile;
      bestScore = score;
    }
  }
  return best || {
    mood: "calm, focused, optimistic",
    tags: "modern documentary, minimal corporate ambient",
    bpm: 92,
    instruments: "felt piano, warm pad, subtle pulse, restrained percussion",
  };
}

export function analyzeWithRules(input) {
  const profile = inferProfile(`${input.script} ${input.styleHint || ""} ${input.moodHint || ""}`);
  const duration = clamp(Number(input.durationSeconds) || 60, 5, 3600);
  const mood = input.moodHint || profile.mood;
  const tags = [input.styleHint, profile.tags, mood, "instrumental", "background music for voice-over"]
    .filter(Boolean)
    .join(", ");
  return {
    title: input.title || "AI 口播配乐",
    prompt: [
      `Create an original instrumental background score for a ${Math.round(duration)}-second spoken-word video.`,
      `Mood: ${mood}. Tempo: about ${profile.bpm} BPM.`,
      `Instrumentation: ${profile.instruments}.`,
      "Keep the arrangement sparse under dialogue, with no lead vocal, no spoken words, no abrupt drops, and no melody that competes with narration.",
      "Use a clean opening, gentle development, and a natural loop-friendly ending.",
    ].join(" "),
    tags,
    negativeTags: "vocals, singing, spoken word, aggressive lead melody, heavy bass, harsh cymbals, sudden loud hits, copyrighted melody",
    bpm: profile.bpm,
    mood,
    source: "rules",
  };
}

function validatePlan(plan, input) {
  if (!plan || typeof plan !== "object") return null;
  const fallback = analyzeWithRules(input);
  const clean = (value, fallbackValue, max) => {
    const text = typeof value === "string" ? value.trim() : "";
    return (text || fallbackValue).slice(0, max);
  };
  return {
    title: clean(plan.title, fallback.title, 80),
    prompt: clean(plan.prompt, fallback.prompt, 1200),
    tags: clean(plan.tags, fallback.tags, 300),
    negativeTags: clean(plan.negativeTags ?? plan.negative_tags, fallback.negativeTags, 300),
    bpm: clamp(Number(plan.bpm) || fallback.bpm, 50, 180),
    mood: clean(plan.mood, fallback.mood, 120),
    source: "ai",
  };
}

export class PromptAnalyzer {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async analyze(input) {
    if (!this.config.yunwu.analysisEnabled || !this.config.yunwu.apiKey) {
      return analyzeWithRules(input);
    }
    try {
      return await this.#analyzeWithAi(input);
    } catch (error) {
      return { ...analyzeWithRules(input), fallbackReason: error.message };
    }
  }

  async #analyzeWithAi(input) {
    const url = joinUrl(this.config.yunwu.baseUrl, this.config.yunwu.analysisPath);
    const response = await this.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.yunwu.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.yunwu.analysisModel,
        temperature: 0.3,
        stream: false,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "你是短视频配乐导演。根据口播文案设计不会遮盖人声的原创纯音乐。只输出 JSON，字段为 title、prompt、tags、negativeTags、bpm、mood。prompt 和 tags 使用英文；禁止要求模仿具体艺人、歌曲或受版权保护的旋律。",
          },
          {
            role: "user",
            content: JSON.stringify({
              script: input.script.slice(0, 12000),
              durationSeconds: input.durationSeconds,
              title: input.title || "",
              styleHint: input.styleHint || "",
              moodHint: input.moodHint || "",
              requirements: "instrumental only; sparse arrangement; dialogue-friendly; loop-friendly ending",
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    const text = await response.text();
    if (!response.ok) throw new ProviderError(`文案分析请求失败 (${response.status})`, text.slice(0, 500));
    const body = safeJsonParse(text);
    const content = body?.choices?.[0]?.message?.content;
    const plan = validatePlan(typeof content === "string" ? safeJsonParse(content) : content, input);
    if (!plan) throw new ProviderError("文案分析模型未返回有效 JSON");
    return plan;
  }
}

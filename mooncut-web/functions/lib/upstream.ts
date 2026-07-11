/** Call OpenAI-compatible chat endpoints configured on Cloudflare (not the local agent). */

export type UpstreamEnv = {
  /** Tunnel base, e.g. https://xxx.trycloudflare.com — used to build the LLM relay URL */
  AGENT_ORIGIN?: string
  /** Same as local MOONCUT_API_KEY — authorizes the relay */
  AGENT_INTERNAL_KEY?: string
  /** Optional direct OpenAI-compatible URL (overrides relay) */
  ASSISTANT_SCRIPT_URL?: string
  ASSISTANT_SCRIPT_API_KEY?: string
  ASSISTANT_SCRIPT_MODEL?: string
  ASSISTANT_COACH_URL?: string
  ASSISTANT_COACH_API_KEY?: string
  ASSISTANT_COACH_MODEL?: string
  /** Optional thinking budget for reasoning models (default 4096) */
  ASSISTANT_THINKING_BUDGET?: string
  MODELS_JSON?: string
}

const resolveScriptEndpoint = (env: UpstreamEnv) => {
  if (env.ASSISTANT_SCRIPT_URL && env.ASSISTANT_SCRIPT_API_KEY) {
    return { url: env.ASSISTANT_SCRIPT_URL, key: env.ASSISTANT_SCRIPT_API_KEY }
  }
  const origin = (env.AGENT_ORIGIN || '').replace(/\/$/, '')
  const key = env.AGENT_INTERNAL_KEY || ''
  if (origin && key) {
    return { url: `${origin}/v1/edge-relay/chat/completions`, key }
  }
  return { url: '', key: '' }
}

const resolveCoachEndpoint = (env: UpstreamEnv) => {
  if (env.ASSISTANT_COACH_URL && env.ASSISTANT_COACH_API_KEY) {
    return { url: env.ASSISTANT_COACH_URL, key: env.ASSISTANT_COACH_API_KEY }
  }
  if (env.ASSISTANT_SCRIPT_URL && env.ASSISTANT_SCRIPT_API_KEY) {
    return { url: env.ASSISTANT_SCRIPT_URL, key: env.ASSISTANT_SCRIPT_API_KEY }
  }
  return resolveScriptEndpoint(env)
}

type ChatMessage = { role: string; content: string }

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })

/**
 * Reasoning models share one max_tokens pool for thinking + final answer.
 * If thinking budget eats the whole pool, content is empty (finish_reason=length)
 * and only reasoning_content is filled — which looks like an empty reply.
 *
 * Strategy:
 * - max_tokens as high as OpenCode/glm allows (32k)
 * - thinking budget is separate but MUST leave CONTENT_RESERVE for the final answer
 */
const MAX_OUTPUT_TOKENS = 32_000
/** Always keep this many tokens for the visible reply after thinking. */
const CONTENT_RESERVE = 8_192
const DEFAULT_THINKING_BUDGET = 4_096
const MAX_THINKING_BUDGET = Math.max(1_024, MAX_OUTPUT_TOKENS - CONTENT_RESERVE)

const thinkingBudget = (env?: UpstreamEnv) => {
  const raw = Number.parseInt(env?.ASSISTANT_THINKING_BUDGET || '', 10)
  const requested =
    Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_THINKING_BUDGET
  // Never let thinking consume the full max_tokens pool.
  return Math.min(requested, MAX_THINKING_BUDGET, Math.floor(MAX_OUTPUT_TOKENS * 0.5))
}

const extractContent = (message?: {
  content?: string | null
  reasoning_content?: string | null
}) => {
  const content = (message?.content || '').trim()
  if (content) return content
  // Fallback only if the model never emitted final content (should be rare with high max_tokens).
  const reasoning = (message?.reasoning_content || '').trim()
  if (!reasoning) return ''
  return reasoning
    .replace(/<think>[\s\S]*?<\/think>/giu, ' ')
    .replace(/^\s*[\d.*#-]+\s*/gmu, '')
    .trim()
}

const chatComplete = async (
  url: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; thinkingBudget?: number } = {},
) => {
  const endpoint = url.replace(/\/$/, '')
  const budget = options.thinkingBudget ?? DEFAULT_THINKING_BUDGET
  const temperature = options.temperature ?? 0.7

  // Clamp budget so thinking cannot exhaust the whole completion budget.
  const safeBudget = Math.min(budget, MAX_THINKING_BUDGET, Math.floor(MAX_OUTPUT_TOKENS * 0.5))

  // Send both common shapes: OpenAI reasoning_effort + Anthropic-style thinking budget.
  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: MAX_OUTPUT_TOKENS,
    // Leave room for the final answer after thinking.
    reasoning_effort: safeBudget <= 1024 ? 'low' : safeBudget <= 4096 ? 'medium' : 'high',
    thinking: {
      type: 'enabled',
      budget_tokens: safeBudget,
    },
  }

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `无法从 Cloudflare 边缘访问上游 ${endpoint}（${message}）。请确认网关对公网/CF 出站开放，并优先使用 HTTPS 域名。`,
    )
  }

  const text = await res.text()
  if (!res.ok) {
    // Some gateways reject unknown fields — retry once with plain max_tokens only.
    if (res.status === 400 || res.status === 422) {
      const retry = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: MAX_OUTPUT_TOKENS,
        }),
      })
      const retryText = await retry.text()
      if (!retry.ok) throw new Error(`Upstream ${retry.status}: ${retryText.slice(0, 400)}`)
      const retryData = JSON.parse(retryText) as {
        choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string }>
      }
      const content = extractContent(retryData.choices?.[0]?.message)
      if (!content) {
        throw new Error(
          `Upstream returned empty content (finish=${retryData.choices?.[0]?.finish_reason || 'unknown'}). Increase max_tokens / lower thinking budget.`,
        )
      }
      return content
    }
    throw new Error(`Upstream ${res.status}: ${text.slice(0, 400)}`)
  }

  let data: {
    choices?: Array<{
      message?: { content?: string | null; reasoning_content?: string | null }
      finish_reason?: string
    }>
  }
  try {
    data = JSON.parse(text) as typeof data
  } catch {
    throw new Error(`Upstream returned non-JSON: ${text.slice(0, 200)}`)
  }

  const choice = data.choices?.[0]
  const content = extractContent(choice?.message)
  if (!content) {
    throw new Error(
      `Upstream returned empty content (finish=${choice?.finish_reason || 'unknown'}). Thinking likely consumed max_tokens — raise max_tokens or lower thinking budget.`,
    )
  }
  return content
}

const stringValue = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value.trim() : fallback

const stripCodeFence = (text: string) =>
  text
    .replace(/^\s*```(?:json)?\s*/iu, '')
    .replace(/\s*```\s*$/u, '')
    .trim()

/** Pull a JSON string field even when the model left raw " inside the value. */
const extractLooseStringField = (source: string, field: string): string => {
  const keyRe = new RegExp(`"${field}"\\s*:\\s*"`, 'u')
  const match = keyRe.exec(source)
  if (!match) return ''
  let i = match.index + match[0].length
  let out = ''
  const nextKey =
    /^\s*,\s*"(?:reply|phase|ready|draft|petMessage|suggestions|category|advice|positive|eyebrow|title|detail|model)"/u
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\' && i + 1 < source.length) {
      const next = source[i + 1]
      const map: Record<string, string> = {
        n: '\n',
        r: '\r',
        t: '\t',
        '"': '"',
        '\\': '\\',
        '/': '/',
      }
      out += map[next] ?? next
      i += 2
      continue
    }
    if (ch === '"') {
      const tail = source.slice(i + 1)
      if (/^\s*\}/u.test(tail) || nextKey.test(tail)) return out
      // Unescaped quote inside value — keep it as content.
      out += ch
      i += 1
      continue
    }
    out += ch
    i += 1
  }
  return out.trim()
}

const extractLooseBooleanField = (source: string, field: string): boolean | null => {
  const match = new RegExp(`"${field}"\\s*:\\s*(true|false)`, 'iu').exec(source)
  if (!match) return null
  return match[1].toLowerCase() === 'true'
}

const extractLooseSuggestions = (
  source: string,
): Array<{ eyebrow: string; title: string; detail: string }> => {
  const start = source.search(/"suggestions"\s*:\s*\[/u)
  if (start < 0) return []
  const fromArray = source.slice(start)
  const open = fromArray.indexOf('[')
  if (open < 0) return []
  let depth = 0
  let end = -1
  for (let i = open; i < fromArray.length; i += 1) {
    const ch = fromArray[i]
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) return []
  const arrayText = fromArray.slice(open, end + 1)
  const chunks = arrayText.split(/\{/u).slice(1)
  const items: Array<{ eyebrow: string; title: string; detail: string }> = []
  for (const chunk of chunks) {
    const block = `{${chunk}`
    const eyebrow = extractLooseStringField(block, 'eyebrow')
    const title = extractLooseStringField(block, 'title')
    const detail = extractLooseStringField(block, 'detail')
    if (eyebrow || title || detail) {
      items.push({
        eyebrow: eyebrow || '表达角度',
        title: title || '换一个更具体的说法',
        detail: detail || '补充一个真实场景，让观点落地。',
      })
    }
    if (items.length >= 3) break
  }
  return items
}

/** Pull the first JSON object from model text (plain, fenced, or slightly broken). */
const parseJsonObject = (text: string): Record<string, unknown> | null => {
  const cleaned = stripCodeFence(text)
  const tryParse = (raw: string) => {
    try {
      const value = JSON.parse(raw) as unknown
      return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  const direct = tryParse(cleaned)
  if (direct) return direct
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const sliced = cleaned.slice(start, end + 1)
    const parsed = tryParse(sliced)
    if (parsed) return parsed
    // Broken JSON (unescaped quotes inside Chinese copy) — recover fields loosely.
    const reply = extractLooseStringField(sliced, 'reply')
    const draft = extractLooseStringField(sliced, 'draft')
    const petMessage = extractLooseStringField(sliced, 'petMessage')
    const phase = extractLooseStringField(sliced, 'phase')
    const advice = extractLooseStringField(sliced, 'advice')
    const category = extractLooseStringField(sliced, 'category')
    const ready = extractLooseBooleanField(sliced, 'ready')
    const positive = extractLooseBooleanField(sliced, 'positive')
    const suggestions = extractLooseSuggestions(sliced)
    if (reply || draft || advice || suggestions.length) {
      return {
        reply,
        draft,
        petMessage,
        phase,
        advice,
        category,
        ...(ready === null ? {} : { ready }),
        ...(positive === null ? {} : { positive }),
        suggestions,
      }
    }
  }
  return null
}

const SCRIPT_SYSTEM_PROMPT = `你是 MoonCut 的口播总编“Moon”。把用户想法推进成能直接对镜头念的中文口播稿。

工作原则：
1. 先判断已知信息：目标观众、唯一核心观点、可信场景/证据、语气、目标时长。
2. 信息不足时只追问一个最关键的问题，同时给 3 个可直接点击的具体表达角度；不要一次盘问多项。
3. 信息足够或用户要求直接成稿时，输出完整口播稿：前三秒钩子、具体场景、观点推进、可执行结尾。口语自然，短句优先，拒绝“大家好今天聊聊”等空开场。
4. draft 字段只放可直接朗读的正文，不加标题、分析、Markdown 或引号。若暂不成稿则返回空字符串。
5. reply 是给用户看的推进话术；petMessage 是宠物“小月”说的一句自然短评，最多 24 个汉字，不谄媚。
6. suggestions 恰好 3 条，每条包含 eyebrow、title、detail，必须贴合用户主题，不能复用模板套话。
7. 不编造事实、数据或用户经历；缺少证据时提示用户补充，或明确使用假设性场景。
8. action=generate 时，无论用户选了几个方向，draft 都只返回一篇融合后的 60–90 秒口播稿，禁止分别生成多篇，禁止标题和分隔线。
9. action=polish 时只改写当前 draft，保留事实边界和核心观点，不追加创作分析。
10. 全部使用简体中文。

你必须只输出一个 JSON 对象（不要 Markdown 代码围栏，不要前后解释），字段严格为：
{
  "reply": string,
  "phase": "discover" | "outline" | "draft",
  "ready": boolean,
  "draft": string,
  "petMessage": string,
  "suggestions": [
    {"eyebrow": string, "title": string, "detail": string},
    {"eyebrow": string, "title": string, "detail": string},
    {"eyebrow": string, "title": string, "detail": string}
  ]
}

JSON 字符串内部禁止使用英文双引号 "；口语引用请用「」或『』，确保整段可被 JSON.parse。`

const COACH_SYSTEM_PROMPT = `你是 MoonCut 的实时口播教练。输入包含最近的 ASR、原稿与实时指标。每次只给一条此刻能立刻执行的建议。

规则：
- 优先级：偏离当前台词 > 长时间过快/过慢 > 音量过轻 > 缺少停顿 > 镜头注视/构图。
- advice 最多 28 个汉字，具体、温和、能在下一句话执行；状态稳定时就明确鼓励保持，不制造问题。
- petMessage 是宠物“小月”的一句口语反馈，最多 22 个汉字。
- 不重复 lastAdvice；不做诊断；不返回长篇解释。
- 全部使用简体中文。

只输出一个 JSON 对象（不要 Markdown 代码围栏）：
{
  "category": "pace" | "volume" | "pause" | "script" | "camera" | "steady",
  "advice": string,
  "petMessage": string,
  "positive": boolean
}`

const defaultSuggestions = (theme: string): Array<{ eyebrow: string; title: string; detail: string }> => {
  const topic = theme.trim().slice(0, 24) || '这个主题'
  return [
    {
      eyebrow: '场景切入',
      title: `从一个真实场景打开${topic}`,
      detail: '用一个观众立刻能脑补的画面起头，再落到你的观点。',
    },
    {
      eyebrow: '反常识',
      title: `先抛出一个关于${topic}的意外点`,
      detail: '用“很多人以为…其实…”制造钩子，再讲清你的立场。',
    },
    {
      eyebrow: '行动收口',
      title: `把${topic}收成一个马上能做的小动作`,
      detail: '结尾给观众一句可执行的下一步，而不是空泛总结。',
    },
  ]
}

const normalizeSuggestions = (
  value: unknown,
  theme: string,
): Array<{ eyebrow: string; title: string; detail: string }> => {
  const fromModel = Array.isArray(value)
    ? value.slice(0, 3).map((item) => {
        const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
        return {
          eyebrow: stringValue(record.eyebrow, '表达角度'),
          title: stringValue(record.title, '换一个更具体的说法'),
          detail: stringValue(record.detail, '补充一个真实场景，让观点落地。'),
        }
      })
    : []
  const filled = [...fromModel]
  const fallbacks = defaultSuggestions(theme)
  while (filled.length < 3) filled.push(fallbacks[filled.length])
  return filled.slice(0, 3)
}

const cleanDraft = (value: string) =>
  value
    .replace(/^【[^\n]+】\s*/u, '')
    .replace(/^```(?:\w+)?\s*/u, '')
    .replace(/\s*```$/u, '')
    .trim()

const lastUserTheme = (messages: ChatMessage[], draft?: string) => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user' && messages[i].content.trim()) {
      return messages[i].content.trim().slice(0, 80)
    }
  }
  return (draft || '').trim().slice(0, 40)
}

const normalizeScriptResponse = (
  rawText: string,
  action: string,
  model: string,
  theme: string,
) => {
  const parsed = parseJsonObject(rawText)
  const phaseRaw = stringValue(parsed?.phase, '')
  let phase: 'discover' | 'outline' | 'draft' =
    phaseRaw === 'outline' || phaseRaw === 'draft' || phaseRaw === 'discover'
      ? phaseRaw
      : action === 'generate' || action === 'polish'
        ? 'draft'
        : 'discover'

  let draft = cleanDraft(stringValue(parsed?.draft))
  let reply = stringValue(parsed?.reply)
  let petMessage = stringValue(parsed?.petMessage)
  let suggestions = normalizeSuggestions(parsed?.suggestions, theme)
  let ready = parsed?.ready === true

  // If draft accidentally holds a whole JSON blob, peel it once more.
  if (draft.startsWith('{') && /"draft"\s*:/u.test(draft)) {
    const nested = parseJsonObject(draft)
    if (nested) {
      draft = cleanDraft(stringValue(nested.draft)) || draft
      if (!reply) reply = stringValue(nested.reply)
      if (!petMessage) petMessage = stringValue(nested.petMessage)
      if (!Array.isArray(parsed?.suggestions) || (parsed?.suggestions as unknown[]).length < 3) {
        suggestions = normalizeSuggestions(nested.suggestions, theme)
      }
      if (nested.ready === true) ready = true
    } else {
      const peeled = extractLooseStringField(draft, 'draft')
      if (peeled) draft = cleanDraft(peeled)
    }
  }

  // Model sometimes returns plain script text instead of JSON.
  if (!parsed) {
    if (action === 'generate' || action === 'polish') {
      draft = cleanDraft(rawText)
      reply = '已经整理成可直接朗读的口播稿，右侧可继续改。'
      petMessage = '稿子出来了，去念一遍试试！'
      ready = Boolean(draft)
      phase = 'draft'
      suggestions = defaultSuggestions(theme)
    } else {
      reply = cleanDraft(rawText).slice(0, 280) || '再告诉我一个具体场景，我就能继续成稿。'
      draft = ''
      petMessage = '这个方向有感觉，再具体一点吧。'
      ready = false
      phase = 'discover'
      suggestions = defaultSuggestions(theme)
    }
  } else {
    if ((action === 'generate' || action === 'polish') && !draft) {
      // JSON without draft: use reply body if it looks like a script, else whole raw.
      const candidate = cleanDraft(reply || rawText)
      if (candidate.length > 40) draft = candidate
    }
    if (!reply) {
      reply = draft
        ? '已经整理成可直接朗读的口播稿，右侧可继续改。'
        : '再告诉我一个具体场景，我就能继续成稿。'
    }
    if (!petMessage) {
      petMessage = draft ? '稿子出来了，去念一遍试试！' : '这个方向有感觉，再具体一点吧。'
    }
    if (action === 'generate' || action === 'polish') {
      ready = Boolean(draft)
      phase = 'draft'
    }
  }

  return {
    reply,
    phase,
    ready,
    draft,
    petMessage,
    suggestions,
    model,
    // Keep content alias for older clients / debugging.
    content: draft || reply,
  }
}

const normalizeCoachResponse = (rawText: string, model: string) => {
  const parsed = parseJsonObject(rawText)
  const categories = new Set(['pace', 'volume', 'pause', 'script', 'camera', 'steady'])
  const categoryRaw = stringValue(parsed?.category, 'steady')
  const category = categories.has(categoryRaw) ? categoryRaw : 'steady'
  let advice = stringValue(parsed?.advice)
  let petMessage = stringValue(parsed?.petMessage)
  let positive = parsed?.positive === true

  if (!parsed) {
    advice = cleanDraft(rawText).slice(0, 28) || '状态很稳，继续自然表达。'
    petMessage = '讲得很顺，我开心地跑起来啦！'
    positive = true
  } else {
    if (!advice) advice = '状态很稳，继续自然表达。'
    if (!petMessage) petMessage = positive ? '讲得很顺，我开心地跑起来啦！' : '我在，慢慢来就好。'
  }

  return {
    category,
    advice: advice.slice(0, 40),
    petMessage: petMessage.slice(0, 28),
    positive,
    model,
  }
}

export const handleScriptAssistant = async (env: UpstreamEnv, body: unknown) => {
  const { url, key } = resolveScriptEndpoint(env)
  const model = env.ASSISTANT_SCRIPT_MODEL || 'glm-5.2'
  if (!url || !key) {
    return json(
      {
        error: '口播助手未配置。请设置 ASSISTANT_SCRIPT_URL + ASSISTANT_SCRIPT_API_KEY',
        code: 'ASSISTANT_NOT_CONFIGURED',
      },
      503,
    )
  }
  const payload = body as {
    action?: string
    style?: string
    messages?: ChatMessage[]
    draft?: string
  }
  const action = payload.action === 'generate' || payload.action === 'polish' ? payload.action : 'guide'
  const style = payload.style === 'short' || payload.style === 'emotional' ? payload.style : 'oral'
  const history = (Array.isArray(payload.messages) ? payload.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))

  const taskHint = [
    `当前动作：${action}`,
    `润色方向：${style}`,
    payload.draft?.trim() ? `当前稿件：\n${payload.draft.trim().slice(0, 12_000)}` : '',
    action === 'guide'
      ? '请返回 JSON：reply + 恰好 3 条 suggestions；若信息仍不足 draft 置空字符串。'
      : action === 'generate'
        ? '请返回 JSON：draft 必须是一篇完整 60–90 秒口播正文；suggestions 仍给 3 条后续角度。'
        : '请返回 JSON：draft 必须是润色后的完整口播正文；保留事实边界。',
  ]
    .filter(Boolean)
    .join('\n\n')

  const messages: ChatMessage[] = [
    { role: 'system', content: SCRIPT_SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: taskHint },
  ]

  try {
    const raw = await chatComplete(url, key, model, messages, {
      temperature: action === 'guide' ? 0.7 : 0.55,
      thinkingBudget: thinkingBudget(env),
    })
    const theme = lastUserTheme(history, payload.draft)
    const response = normalizeScriptResponse(raw, action, model, theme)
    if ((action === 'generate' || action === 'polish') && !response.draft) {
      return json(
        {
          error: '模型没有返回完整稿件，请重试一次',
          code: 'ASSISTANT_EMPTY_DRAFT',
          model,
        },
        502,
      )
    }
    return json(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return json({ error: message, code: 'ASSISTANT_UPSTREAM_FAILED' }, 502)
  }
}

export const handleCoachAssistant = async (env: UpstreamEnv, body: unknown) => {
  const { url, key } = resolveCoachEndpoint(env)
  const model = env.ASSISTANT_COACH_MODEL || 'deepseek-v4-flash'
  if (!url || !key) {
    return json(
      {
        error: '实时陪练未配置。请设置 ASSISTANT_COACH_URL + ASSISTANT_COACH_API_KEY',
        code: 'COACH_NOT_CONFIGURED',
      },
      503,
    )
  }
  const payload = body as {
    transcript?: string
    currentScript?: string
    currentSentence?: string
    lastAdvice?: string
    metrics?: Record<string, number>
  }
  const user = JSON.stringify(
    {
      transcript: payload.transcript,
      currentScript: payload.currentScript,
      currentSentence: payload.currentSentence,
      lastAdvice: payload.lastAdvice,
      metrics: payload.metrics,
    },
    null,
    2,
  )
  try {
    const raw = await chatComplete(
      url,
      key,
      model,
      [
        { role: 'system', content: COACH_SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
      { temperature: 0.4, thinkingBudget: Math.min(1024, thinkingBudget(env)) },
    )
    return json(normalizeCoachResponse(raw, model))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return json({ error: message, code: 'COACH_UPSTREAM_FAILED' }, 502)
  }
}

export const handleModels = (env: UpstreamEnv) => {
  if (env.MODELS_JSON) {
    try {
      return json(JSON.parse(env.MODELS_JSON))
    } catch {
      // fall through
    }
  }
  const script = resolveScriptEndpoint(env)
  return json({
    available: [
      env.ASSISTANT_SCRIPT_MODEL || 'glm-5.2',
      env.ASSISTANT_COACH_MODEL || 'deepseek-v4-flash',
    ].filter((v, i, a) => Boolean(v) && a.indexOf(v) === i),
    routing: {
      planner: 'local-video-agent',
      script: env.ASSISTANT_SCRIPT_MODEL || 'glm-5.2',
      coach: env.ASSISTANT_COACH_MODEL || 'deepseek-v4-flash',
      vision: [],
      image: { configured: false, model: null, maxImages: 0 },
    },
    relayConfigured: Boolean(script.url && script.key),
    note: 'Script=glm-5.2, pet coach=deepseek-v4-flash via OpenCode; video cuts on tunnel agent.',
  })
}

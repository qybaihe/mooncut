/** Deepgram speech-to-text proxy for MoonCut live teleprompter. */

export type AsrEnv = {
  DEEPGRAM_API_KEY?: string
  /** e.g. nova-2 | nova-3 | nova-2-general */
  DEEPGRAM_MODEL?: string
  /** e.g. zh-CN | zh | en | multi */
  DEEPGRAM_LANGUAGE?: string
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })

export const isAsrConfigured = (env: AsrEnv) => Boolean((env.DEEPGRAM_API_KEY || '').trim())

const MAX_ASR_AUDIO_BYTES = 3_500_000

const readAudioWithinLimit = async (request: Request) => {
  const declared = Number(request.headers.get('Content-Length') || '0')
  if (Number.isFinite(declared) && declared > MAX_ASR_AUDIO_BYTES) {
    throw new RangeError('ASR_AUDIO_TOO_LARGE')
  }
  if (!request.body) return new ArrayBuffer(0)

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_ASR_AUDIO_BYTES) {
        await reader.cancel('ASR audio exceeds size limit')
        throw new RangeError('ASR_AUDIO_TOO_LARGE')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const audio = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    audio.set(chunk, offset)
    offset += chunk.byteLength
  }
  return audio.buffer
}

export const handleAsrStatus = (env: AsrEnv) =>
  json({
    configured: isAsrConfigured(env),
    provider: 'deepgram',
    model: env.DEEPGRAM_MODEL || 'nova-2',
    language: env.DEEPGRAM_LANGUAGE || 'zh-CN',
    mode: 'chunked-http',
    note: isAsrConfigured(env)
      ? 'Deepgram 准实时：录制中按音频切片转写，用于提词器跟读。'
      : '未配置 DEEPGRAM_API_KEY',
  })

/**
 * POST raw audio body (wav / webm / ogg / mp3 / linear16).
 * Query: encoding, sample_rate, channels, language, model
 */
export const handleAsrTranscribe = async (request: Request, env: AsrEnv) => {
  const apiKey = (env.DEEPGRAM_API_KEY || '').trim()
  if (!apiKey) {
    return json({ error: 'ASR 未配置 DEEPGRAM_API_KEY', code: 'ASR_NOT_CONFIGURED' }, 503)
  }

  const url = new URL(request.url)
  const model = url.searchParams.get('model') || env.DEEPGRAM_MODEL || 'nova-2'
  const language = url.searchParams.get('language') || env.DEEPGRAM_LANGUAGE || 'zh-CN'
  const encoding = url.searchParams.get('encoding') || ''
  const sampleRate = url.searchParams.get('sample_rate') || ''
  const channels = url.searchParams.get('channels') || '1'

  const contentType = request.headers.get('Content-Type') || 'application/octet-stream'
  let audio: ArrayBuffer
  try {
    audio = await readAudioWithinLimit(request)
  } catch (error) {
    if (error instanceof RangeError) {
      return json({ error: '音频片段过大，请缩短切片', code: 'ASR_AUDIO_TOO_LARGE' }, 413)
    }
    throw error
  }
  if (!audio.byteLength) {
    return json({ error: '空音频', code: 'ASR_EMPTY_AUDIO' }, 400)
  }

  const dg = new URL('https://api.deepgram.com/v1/listen')
  dg.searchParams.set('model', model)
  dg.searchParams.set('language', language)
  dg.searchParams.set('punctuate', 'true')
  dg.searchParams.set('smart_format', 'true')
  dg.searchParams.set('utterances', 'false')
  dg.searchParams.set('filler_words', 'false')
  // Help short live chunks
  dg.searchParams.set('endpointing', '300')
  if (encoding) {
    dg.searchParams.set('encoding', encoding)
    if (sampleRate) dg.searchParams.set('sample_rate', sampleRate)
    if (channels) dg.searchParams.set('channels', channels)
  }

  let upstream: Response
  try {
    upstream = await fetch(dg.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': encoding ? 'application/octet-stream' : contentType,
      },
      body: audio,
    })
  } catch (error) {
    console.error('Deepgram network request failed', error)
    return json({ error: '语音服务暂时不可用，请稍后重试', code: 'ASR_UPSTREAM_NETWORK' }, 502)
  }

  const text = await upstream.text()
  if (!upstream.ok) {
    return json(
      {
        error: '语音服务暂时不可用，请稍后重试',
        code: 'ASR_UPSTREAM_FAILED',
      },
      502,
    )
  }

  let data: {
    results?: {
      channels?: Array<{
        alternatives?: Array<{ transcript?: string; confidence?: number }>
      }>
    }
    metadata?: { duration?: number; request_id?: string }
  }
  try {
    data = JSON.parse(text) as typeof data
  } catch {
    return json({ error: 'Deepgram 返回非 JSON', code: 'ASR_BAD_RESPONSE' }, 502)
  }

  const alt = data.results?.channels?.[0]?.alternatives?.[0]
  const transcript = (alt?.transcript || '').trim()
  return json({
    transcript,
    confidence: typeof alt?.confidence === 'number' ? alt.confidence : null,
    duration: data.metadata?.duration ?? null,
    requestId: data.metadata?.request_id ?? null,
    provider: 'deepgram',
    model,
    language,
  })
}

// Gemini 이미지 AI(Interactions API)로 3D 화면 그림을 실사 연출 사진으로 바꾼다. 브라우저 코드에서 가져오지 않는다.
// 열쇠는 서버 환경변수 GEMINI_API_KEY 에서만 읽는다. 실패하면 null 을 돌려주고, 주소 함수가 받은 그림 그대로(기본 답)를 준다.
// 기록에는 까닭 코드만 남긴다(열쇠·그림·프롬프트는 남기지 않는다).
import { takeAiTurn, takeDailyTurn } from './ai.js'

export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'
export const GEMINI_API_REVISION = '2026-05-20'
/** 공식 문서가 새 프로젝트에 권하는 모델. 환경변수 GEMINI_IMAGE_MODEL 로 바꿀 수 있다 */
export const GEMINI_IMAGE_MODEL_DEFAULT = 'gemini-nano-banana-2.1'
/** 그림 만드는 데 걸리는 시간 한도. 브라우저는 이보다 조금 더 기다린다(src/lib/api.ts RENDER_TIMEOUT_MS) */
export const GEMINI_TIMEOUT_MS = 40000

/** @type {((url: string, init: RequestInit) => Promise<Response>) | null} 테스트가 바꿔 끼운다 */
let fetcher = null
/** @param {typeof fetcher} fn */
export function setGeminiFetch(fn) {
  fetcher = fn
}

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY)
}

const TIME_KO = { morning: '아침 햇살', noon: '한낮의 밝은 자연광', evening: '해 질 녘의 따뜻한 빛', night: '밤의 따뜻한 실내 조명' }

/**
 * 프롬프트: 가구의 자리·크기·개수·방 구조는 바꾸지 말고 재질과 빛만 사진처럼. 사람·글자·워터마크 금지
 * @param {string} styleName
 * @param {keyof typeof TIME_KO} timeOfDay
 */
export function renderPrompt(styleName, timeOfDay) {
  const style = String(styleName || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 40)
  return [
    '이 그림은 방 배치 앱의 3D 화면이에요. 같은 카메라 각도에서 찍은 실제 인테리어 사진처럼 바꿔 주세요.',
    '방의 벽·창문·문 위치, 가구의 종류·개수·자리·크기·방향은 그대로 두세요. 가구를 더하거나 빼거나 옮기지 마세요.',
    '단순한 상자 모양 가구는 같은 크기의 실제 가구(나무·패브릭·금속 재질)로 표현하고, 바닥과 벽은 실제 재질로 그려 주세요.',
    `조명은 ${TIME_KO[timeOfDay] || TIME_KO.noon}으로 해 주세요.${style ? ` 분위기는 "${style}" 스타일에 맞춰 주세요.` : ''}`,
    '사람, 글자, 로고, 워터마크는 넣지 마세요.',
  ].join(' ')
}

/**
 * 응답에서 마지막 그림(base64)과 형식을 꺼낸다. 문서의 steps[].content[] 모양과 output_image 편의 모양을 둘 다 읽는다
 * @param {unknown} raw
 * @returns {{ data: string, mime: string } | null}
 */
export function pickImage(raw) {
  if (!raw || typeof raw !== 'object') return null
  /** @type {any} */
  const r = raw
  /** @type {any[]} */
  const blocks = []
  if (Array.isArray(r.steps)) for (const s of r.steps) if (s && Array.isArray(s.content)) blocks.push(...s.content)
  if (Array.isArray(r.outputs)) blocks.push(...r.outputs)
  if (r.output_image) blocks.push({ type: 'image', ...r.output_image })
  const b = blocks.filter((x) => x && x.type === 'image' && typeof x.data === 'string' && x.data.length > 100).pop()
  if (!b) return null
  const mime = typeof b.mime_type === 'string' ? b.mime_type : 'image/jpeg'
  if (!/^image\/(png|jpeg|webp)$/.test(mime) || !/^[A-Za-z0-9+/=]+$/.test(b.data)) return null
  return { data: b.data, mime }
}

/**
 * @param {{ mime: string, data: string, styleName: string, timeOfDay: keyof typeof TIME_KO }} input
 * @param {Request} [request]
 * @returns {Promise<string | null>} data URL 또는 null
 */
export async function tryGeminiRender(input, request) {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null
  if (request && !takeAiTurn(request)) { console.warn('[gemini] 기본 답으로 바꿔요:', 'local_rate_limit'); return null }
  const turn = await takeDailyTurn()
  if (!turn.allowed) { console.warn('[gemini] 기본 답으로 바꿔요:', 'daily_cap'); return null }
  try {
    const response = await (fetcher || fetch)(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, 'Api-Revision': GEMINI_API_REVISION },
      body: JSON.stringify({
        model: process.env.GEMINI_IMAGE_MODEL || GEMINI_IMAGE_MODEL_DEFAULT,
        input: [{ type: 'text', text: renderPrompt(input.styleName, input.timeOfDay) }, { type: 'image', mime_type: input.mime, data: input.data }],
        response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '16:9', image_size: '1K' },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS - turn.waitedMs),
    })
    if (!response.ok) { console.warn('[gemini] 기본 답으로 바꿔요:', 'api_error', response.status); return null }
    const image = pickImage(await response.json())
    if (!image) { console.warn('[gemini] 기본 답으로 바꿔요:', 'no_image'); return null }
    return `data:${image.mime};base64,${image.data}`
  } catch (error) {
    console.warn('[gemini] 기본 답으로 바꿔요:', error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network')
    return null
  }
}

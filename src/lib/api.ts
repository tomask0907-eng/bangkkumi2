// 서버(/api/*)를 부르는 곳. 절대 reject하지 않는다:
// 시간 초과·끊김·오류·모양 이상이면 fallback.js의 규칙 기반 기본 답을 돌려준다.
import type {
  AdviceRequest,
  AdviceResponse,
  FloorplanRequest,
  FloorplanResponse,
  FurnitureRequest,
  FurnitureResponse,
  RenderPhotoRequest,
  RenderPhotoResponse,
  StyleRequest,
  StyleResponse,
} from '../types/schema.ts'
import {
  fallbackAdvice,
  fallbackFloorplan,
  fallbackFurniture,
  fallbackRenderPhoto,
  fallbackStyle,
} from '../engine/fallback.js'
import {
  cleanText,
  sanitizeAdvice,
  sanitizeFloorplan,
  sanitizeFurnitureItems,
  sanitizeImageRef,
  sanitizeStyle,
} from '../engine/sanitize.js'
import { NOTICES } from '../data/labels.js'

/** AI를 쓰지 않은 답의 안내(서버 api/render-photo.js, api/floorplan.js와 같은 글). AI 문구를 쓰지 않는다. */
const PLAIN_SNAPSHOT_NOTE = '3D 화면 그림 그대로예요 (AI 연출 아님)'
const FLOORPLAN_FALLBACK_NOTE = '사진을 읽지 못해 기본 크기로 채웠어요. 실제 치수를 적어 주세요'
/** 스타일 답의 안내. labels.js에 aiStyle이 있으면 그 값을 쓴다. */
const STYLE_NOTE: string = (NOTICES as Record<string, string | undefined>).aiStyle ?? 'AI가 제안한 색이에요. 직접 고칠 수 있어요'

/** 브라우저 쪽 제한 시간 (절대 규칙 7) */
export const API_TIMEOUT_MS = 15000
/** AI 렌더링(그림 만들기)만 더 기다린다. 서버(server/gemini.js)는 40초에서 끊고 기본 답을 준다 */
export const RENDER_TIMEOUT_MS = 45000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 서버를 부르지 않고 바로 기본 답을 써야 하는 상황인지 */
function shouldSkipNetwork(): boolean {
  if (import.meta.env.VITE_USE_MOCK === 'true') return true
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * POST로 부르고, 받은 답을 다듬는다. 어떤 이유로든 실패하면 기본 답.
 * @param path '/api/advice' 같은 경로
 * @param body 보낼 자료
 * @param sanitize 서버 답을 다듬는 함수. 못 쓰는 답이면 null
 * @param fallback 기본 답을 만드는 함수
 */
async function post<T>(
  path: string,
  body: unknown,
  sanitize: (raw: Record<string, unknown>) => T | null,
  fallback: () => T,
  timeoutMs: number = API_TIMEOUT_MS,
): Promise<T> {
  try {
    if (shouldSkipNetwork()) return fallback()
    const base: string = import.meta.env.VITE_API_BASE_URL || ''
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) return fallback()
      // 본문을 읽는 동안에도 제한 시간이 살아 있다.
      const raw: unknown = await response.json()
      if (!isRecord(raw)) return fallback()
      return sanitize(raw) ?? fallback()
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // 시간 초과, 끊김, 깨진 답 모두 여기로 온다. 기본 답은 순수 계산이라 실패하지 않는다.
    return fallback()
  }
}

/** 서버 답의 안내 글. 비어 있으면 기본 문구를 쓴다. */
function noteOf(raw: Record<string, unknown>, isFallback: boolean, aiNote: string): string {
  return cleanText(raw.note, 120) || (isFallback ? NOTICES.fallback : aiNote)
}

export function requestAdvice(request: AdviceRequest): Promise<AdviceResponse> {
  return post(
    '/api/advice',
    request,
    (raw) => {
      const clean = sanitizeAdvice(raw)
      return clean ? { ...clean, isFallback: raw.isFallback === true } : null
    },
    () => fallbackAdvice(request),
  )
}

export function requestFurniture(request: FurnitureRequest): Promise<FurnitureResponse> {
  return post(
    '/api/furniture',
    request,
    (raw) => {
      const items = sanitizeFurnitureItems(raw.items)
      if (!items) return null
      const isFallback = raw.isFallback === true
      return { items, note: noteOf(raw, isFallback, NOTICES.aiEstimate), isFallback }
    },
    () => fallbackFurniture({ text: request.text, url: request.url }),
  )
}

export function requestStyle(request: StyleRequest): Promise<StyleResponse> {
  return post(
    '/api/style',
    request,
    (raw) => {
      const style = sanitizeStyle(raw.style)
      if (!style) return null
      const isFallback = raw.isFallback === true
      return { style, note: noteOf(raw, isFallback, STYLE_NOTE), isFallback }
    },
    () => fallbackStyle({ text: request.text }),
  )
}

export function requestFloorplan(request: FloorplanRequest): Promise<FloorplanResponse> {
  return post(
    '/api/floorplan',
    request,
    (raw) => {
      const clean = sanitizeFloorplan(raw)
      if (!clean) return null
      const isFallback = raw.isFallback === true
      return { ...clean, note: cleanText(raw.note, 120) || (isFallback ? FLOORPLAN_FALLBACK_NOTE : NOTICES.floorplan), isFallback }
    },
    () => ({ ...fallbackFloorplan({ areaPyeong: request.areaPyeong }), note: FLOORPLAN_FALLBACK_NOTE }),
  )
}

export function requestRenderPhoto(request: RenderPhotoRequest): Promise<RenderPhotoResponse> {
  return post(
    '/api/render-photo',
    request,
    (raw) => {
      const image = sanitizeImageRef(raw)
      if (!image) return null
      // 고지 문구는 서버가 무엇을 보내든 정해진 글자를 쓴다. AI 연출이 아니면 AI 문구를 붙이지 않는다.
      const isFallback = raw.isFallback === true
      return { imageUrlOrBase64: image, disclaimer: isFallback ? PLAIN_SNAPSHOT_NOTE : NOTICES.aiImageDisclaimer, isFallback }
    },
    () => ({ ...fallbackRenderPhoto({ snapshotBase64: request.snapshotBase64 }), disclaimer: PLAIN_SNAPSHOT_NOTE }),
    RENDER_TIMEOUT_MS,
  )
}

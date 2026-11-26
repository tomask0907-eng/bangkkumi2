// POST /api/render-photo : 3D 화면 그림 → AI 실사 연출 사진(Gemini). 열쇠가 없거나 실패하면 기본 답(받은 그림 그대로)이다.
/** @import { RenderPhotoResponse, TimeOfDay } from '../src/types/schema.ts' */
import { HttpError, IMAGE_BODY_LIMIT, handle, parseImage } from '../server/http.js'
import { fallbackRenderPhoto } from '../src/engine/fallback.js'
import { tryGeminiRender } from '../server/gemini.js'
import { NOTICES } from '../src/data/labels.js'

/** AI 연출 없이 받은 그림을 그대로 돌려줄 때의 안내. AI 문구를 쓰지 않는다. */
export const PLAIN_SNAPSHOT_NOTE = '3D 화면 그림 그대로예요 (AI 연출 아님)'

/** @type {TimeOfDay[]} */
const TIMES = ['morning', 'noon', 'evening', 'night']

/**
 * @param {Record<string, unknown>} body
 * @param {Request} request
 * @returns {Promise<RenderPhotoResponse>}
 */
async function renderPhoto(body, request) {
  if (typeof body.snapshotBase64 !== 'string' || !body.snapshotBase64) {
    throw new HttpError(400, 'invalid_request', '3D 화면 그림(snapshotBase64)을 보내 주세요.')
  }
  const image = parseImage(body.snapshotBase64)
  if (body.styleName !== undefined && typeof body.styleName !== 'string') {
    throw new HttpError(400, 'invalid_request', '스타일 이름은 글자여야 해요.')
  }
  if (body.timeOfDay !== undefined && !TIMES.some((time) => time === body.timeOfDay)) {
    throw new HttpError(400, 'invalid_request', '시간대는 morning, noon, evening, night 중 하나여야 해요.')
  }
  const timeOfDay = /** @type {TimeOfDay} */ (body.timeOfDay ?? 'noon')
  const made = await tryGeminiRender({ mime: image.mediaType, data: image.data, styleName: typeof body.styleName === 'string' ? body.styleName : '', timeOfDay }, request)
  if (made) return { imageUrlOrBase64: made, disclaimer: NOTICES.aiImageDisclaimer, isFallback: false }
  return { ...fallbackRenderPhoto({ snapshotBase64: body.snapshotBase64 }), disclaimer: PLAIN_SNAPSHOT_NOTE }
}

export default handle(renderPhoto, { maxBytes: IMAGE_BODY_LIMIT })

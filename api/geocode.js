// POST /api/geocode : 단지 주소 → 위도·경도 (카카오 로컬). 열쇠 KAKAO_REST_API_KEY는 서버 환경변수에서만 읽는다.
// 보내는 것: { items: [{ id, district, dong, jibun, name }] } (최대 80곳)
// 받는 것: { configured, results: [{ id, lat, lng, source }], problem }
// 열쇠가 없거나 카카오가 실패해도 200으로 답하고 lat·lng를 null로 둔다. 화면은 그때 원래 자리(map_x, map_z)를 쓴다.
import { HttpError, handle } from '../server/http.js'
import { MAX_ITEMS, geocodeAll } from '../server/kakao.js'

/**
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export default handle(async (body) => {
  const raw = body.items
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS) {
    throw new HttpError(400, 'invalid_items', `단지 목록(items)은 1~${MAX_ITEMS}곳이어야 해요.`)
  }
  const items = raw.map((entry) => {
    /** @type {Record<string, unknown>} */
    const row = typeof entry === 'object' && entry !== null ? /** @type {Record<string, unknown>} */ (entry) : {}
    return { id: text(row.id, 40), district: text(row.district, 20), dong: text(row.dong, 40), jibun: text(row.jibun, 120), name: text(row.name, 80) }
  })
  if (items.some((item) => !item.id || !item.district)) {
    throw new HttpError(400, 'invalid_items', '단지마다 id와 구·군(district)이 있어야 해요.')
  }
  const key = process.env.KAKAO_REST_API_KEY
  if (!key) return { configured: false, results: items.map((item) => ({ id: item.id, lat: null, lng: null, source: null })), problem: null }
  return { configured: true, ...(await geocodeAll(items, key)) }
})

// 카카오 로컬 API로 단지 주소를 위도·경도로 바꾸는 도우미. 서버 함수(api/geocode.js)에서만 쓴다.
// 순서: 지번 주소로 찾기(주소 검색) → 못 찾으면 단지 이름으로 찾기(키워드 검색, 대구 안에서만). 대구 밖으로 나온 답은 버린다.
// 카카오 운영정책상 결과는 화면에서 바로 쓰고, 파일·DB에 모아 두거나 남에게 넘기지 않는다.

const ADDRESS_URL = 'https://dapi.kakao.com/v2/local/search/address.json'
const KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json'
/** 대구(군위군 포함)를 넉넉히 감싼 상자: 경도 최소, 위도 최소, 경도 최대, 위도 최대 */
export const DAEGU_BBOX = [128.3, 35.55, 128.95, 36.35]
/** 한 번 부를 때 받는 단지 수 한도 */
export const MAX_ITEMS = 80
/** 번지까지 맞은 주소만 쓴다(REGION은 동 한가운데라 건물 자리가 아니다) */
const EXACT_TYPES = new Set(['REGION_ADDR', 'ROAD_ADDR'])

/**
 * @typedef {{ id: string, district: string, dong?: string, jibun?: string, name?: string }} GeoItem
 * @typedef {{ id: string, lat: number | null, lng: number | null, source: 'address' | 'place' | null }} GeoResult
 */

/** 지번 번호: 뒤에 번지·일원·띄어쓰기·끝이 와야 한다("1단지"의 1은 번호가 아니다) */
const JIBUN_NUMBER = /(산\s*)?(\d+(?:-\d+)?)(?=\s*(?:번지|일원|\s|$))/

/**
 * 원문 지번을 검색용 주소("대구광역시 중구 삼덕동2가 5")로 바꾼다. 번호가 없으면 null.
 * 원문에 동 이름이 없으면("221-5번지 일원") 읍·면·동 칸을 쓴다.
 * @param {GeoItem} item
 * @returns {string | null}
 */
export function parcelAddress(item) {
  const text = String(item.jibun ?? '').replace(/\s+/g, ' ').trim()
  const match = JIBUN_NUMBER.exec(text)
  if (!match) return null
  const before = text.slice(0, match.index).trim()
  const place = /(?:동|가|리|읍|면)$/.test(before) ? before : String(item.dong ?? '').trim()
  if (!place || !item.district) return null
  return `대구광역시 ${item.district} ${place} ${match[1] ? '산' : ''}${match[2]}`
}

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {boolean} 대구 상자 안의 정상 숫자인지
 */
export function inDaegu(lat, lng) {
  const [minLng, minLat, maxLng, maxLat] = DAEGU_BBOX
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng
}

/** 이 오류면 다른 단지도 똑같이 실패하므로 바로 멈춘다 */
class FatalError extends Error {
  /** @param {'INVALID_KEY' | 'SERVICE_DISABLED' | 'OVER_REQUEST_LIMIT'} code */
  constructor(code) {
    super(code)
    this.code = code
  }
}

/**
 * 카카오를 한 번 부르고 documents 배열을 돌려준다.
 * 401 열쇠 오류, 403 카카오맵 사용 설정 꺼짐, 429·한도 초과(-10)는 FatalError. 그 밖의 실패는 일반 오류.
 * @param {string} base
 * @param {Record<string, string>} params
 * @param {string} key
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<any[]>}
 */
async function call(base, params, key, fetchImpl) {
  const res = await fetchImpl(`${base}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `KakaoAK ${key}` },
    signal: AbortSignal.timeout(6000),
  })
  if (res.status === 401) throw new FatalError('INVALID_KEY')
  if (res.status === 403) throw new FatalError('SERVICE_DISABLED')
  if (res.status === 429) throw new FatalError('OVER_REQUEST_LIMIT')
  /** @type {any} */
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    if (data?.code === -10 || /limit/i.test(String(data?.msg ?? data?.message ?? ''))) throw new FatalError('OVER_REQUEST_LIMIT')
    throw new Error(`HTTP_${res.status}`)
  }
  return Array.isArray(data?.documents) ? data.documents : []
}

/**
 * 단지 하나를 찾는다. 못 찾으면 lat·lng가 null이다.
 * @param {GeoItem} item
 * @param {string} key
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<GeoResult>}
 */
export async function geocodeOne(item, key, fetchImpl) {
  const address = parcelAddress(item)
  if (address) {
    const doc = (await call(ADDRESS_URL, { query: address, analyze_type: 'similar', size: '1' }, key, fetchImpl))[0]
    const lat = Number(doc?.y), lng = Number(doc?.x)
    if (doc && EXACT_TYPES.has(doc.address_type) && inDaegu(lat, lng)) return { id: item.id, lat, lng, source: 'address' }
  }
  if (item.name) {
    const doc = (await call(KEYWORD_URL, { query: item.name, rect: DAEGU_BBOX.join(','), size: '1' }, key, fetchImpl))[0]
    const lat = Number(doc?.y), lng = Number(doc?.x)
    if (doc && inDaegu(lat, lng)) return { id: item.id, lat, lng, source: 'place' }
  }
  return { id: item.id, lat: null, lng: null, source: null }
}

/**
 * 여러 단지를 동시에 8개씩 찾는다. 열쇠 오류·사용 설정 꺼짐·한도 초과면 남은 단지는 부르지 않고 problem에 코드를 남긴다.
 * 시간 안에 못 끝낸 단지와 실패한 단지는 lat·lng가 null이다(화면은 원래 자리를 쓴다).
 * @param {GeoItem[]} items
 * @param {string} key
 * @param {{ fetchImpl?: typeof fetch, deadlineMs?: number, concurrency?: number }} [options]
 * @returns {Promise<{ results: GeoResult[], problem: string | null }>}
 */
export async function geocodeAll(items, key, options = {}) {
  const { fetchImpl = fetch, deadlineMs = 12000, concurrency = 8 } = options
  const end = Date.now() + deadlineMs
  /** @type {GeoResult[]} */
  const results = items.map((item) => ({ id: item.id, lat: null, lng: null, source: null }))
  /** @type {string | null} */
  let problem = null
  let next = 0
  const worker = async () => {
    while (next < items.length && !problem && Date.now() < end) {
      const index = next++
      try {
        results[index] = await geocodeOne(items[index], key, fetchImpl)
      } catch (error) {
        if (error instanceof FatalError) problem = error.code
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return { results, problem }
}

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { geocodeAll, inDaegu, parcelAddress } from '../server/kakao.js'

test('원문 지번을 검색용 주소로 바꾼다', () => {
  const d = { id: 'x', district: '중구' }
  assert.equal(parcelAddress({ ...d, dong: '삼덕동', jibun: '삼덕동2가 5번지 일원' }), '대구광역시 중구 삼덕동2가 5')
  assert.equal(parcelAddress({ ...d, dong: '태평로3가', jibun: '221-5번지 일원' }), '대구광역시 중구 태평로3가 221-5')
  assert.equal(parcelAddress({ ...d, dong: '대봉동', jibun: '대봉동590-395번지 일원' }), '대구광역시 중구 대봉동 590-395')
  assert.equal(parcelAddress({ ...d, dong: '신암동', jibun: '신암동 259-5 동대구역 엘크루 에비뉴원' }), '대구광역시 중구 신암동 259-5')
  assert.equal(parcelAddress({ ...d, dong: '용계동', jibun: '용계역 푸르지오 아츠베르 1단지' }), null)
})

test('대구 밖 좌표는 버린다', () => {
  assert.equal(inDaegu(35.87, 128.6), true)
  assert.equal(inDaegu(37.56, 126.97), false)
  assert.equal(inDaegu(Number.NaN, 128.6), false)
})

/**
 * @param {(url: URL, init: RequestInit | undefined) => { status?: number, body: unknown }} answer
 * @returns {typeof fetch}
 */
const fakeFetch = (answer) =>
  /** @type {typeof fetch} */ (
    async (url, init) => {
      const { status = 200, body } = answer(new URL(String(url)), init)
      return Response.json(body, { status })
    }
  )

test('번지까지 맞으면 주소로, 동만 맞거나 없으면 이름으로 찾고, 대구 밖 답은 버린다', async () => {
  /** @type {string[]} */
  const auth = []
  const fetchImpl = fakeFetch((url, init) => {
    auth.push(String(new Headers(init?.headers).get('authorization')))
    const q = url.searchParams.get('query') ?? ''
    if (url.pathname.endsWith('/address.json')) {
      if (q.endsWith(' 5')) return { body: { documents: [{ address_type: 'REGION_ADDR', x: '128.597', y: '35.866' }] } }
      if (q.endsWith(' 221-5')) return { body: { documents: [{ address_type: 'REGION', x: '128.59', y: '35.87' }] } }
      return { body: { documents: [] } }
    }
    assert.equal(url.searchParams.get('rect'), '128.3,35.55,128.95,36.35')
    if (q === '힐스테이트') return { body: { documents: [{ place_name: '힐스테이트', x: '128.6', y: '35.88' }] } }
    if (q === '서울단지') return { body: { documents: [{ x: '126.97', y: '37.56' }] } }
    return { body: { documents: [] } }
  })
  const { results, problem } = await geocodeAll(
    [
      { id: 'a', district: '중구', dong: '삼덕동', jibun: '삼덕동2가 5번지', name: '' },
      { id: 'b', district: '중구', dong: '태평로3가', jibun: '221-5번지 일원', name: '힐스테이트' },
      { id: 'c', district: '중구', dong: '', jibun: '', name: '서울단지' },
      { id: 'd', district: '중구', dong: '', jibun: '', name: '없는곳' },
    ],
    'test-key',
    { fetchImpl, concurrency: 1 },
  )
  assert.equal(problem, null)
  assert.deepEqual(results, [
    { id: 'a', lat: 35.866, lng: 128.597, source: 'address' },
    { id: 'b', lat: 35.88, lng: 128.6, source: 'place' },
    { id: 'c', lat: null, lng: null, source: null },
    { id: 'd', lat: null, lng: null, source: null },
  ])
  assert.ok(auth.every((value) => value === 'KakaoAK test-key'))
})

for (const [status, body, code] of /** @type {const} */ ([
  [401, { msg: 'invalid key' }, 'INVALID_KEY'],
  [403, { msg: 'disabled' }, 'SERVICE_DISABLED'],
  [400, { code: -10, msg: 'API limit has been exceeded.' }, 'OVER_REQUEST_LIMIT'],
])) {
  test(`HTTP ${status}이면 멈추고 ${code}만 알린다`, async () => {
    let calls = 0
    const fetchImpl = fakeFetch(() => {
      calls++
      return { status, body }
    })
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, district: '중구', dong: '삼덕동', jibun: `${i + 1}번지`, name: '' }))
    const { results, problem } = await geocodeAll(items, 'bad', { fetchImpl, concurrency: 2 })
    assert.equal(problem, code)
    assert.ok(calls <= 2, `멈추지 않고 ${calls}번 불렀어요`)
    assert.ok(results.every((r) => r.lat === null))
  })
}

// @ts-nocheck
// 전월세 기록에 지도 위치 붙이기: bangbom/.cache_rent 의 원본(지번 있음)을 카카오 로컬로 찾아 bangbom/data/daegu_rent.json 에 lat·lng·approx 열을 더한다.
// 카카오 열쇠는 내 PC 개발 서버(npm run dev)의 /api/geocode 가 읽는다. 이 스크립트는 열쇠를 모른다.
// 연립·다세대·오피스텔은 지번 위치, 단독·다가구(지번 비공개)와 못 찾은 곳은 동 중심(approx=1).
// 한 번 찾은 주소는 bangbom/src/tools/rent_geo.json 에 남겨 다시 부르지 않는다.
// 실행: (개발 서버를 켠 채) node scripts/geo-rent.mjs [개발 서버 주소, 기본 http://localhost:5180]
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', 'bangbom')
const CACHE_DIR = path.join(ROOT, '.cache_rent')
const GEO = path.join(ROOT, 'src', 'tools', 'rent_geo.json')
const SITE = path.join(ROOT, 'data', 'daegu_rent.json')
const BASE = process.argv[2] || 'http://localhost:5180'
const FILES = { r: 'daegu_rowhouse_rent_3m.json', d: 'daegu_detached_rent_3m.json', o: 'daegu_officetel_rent_3m.json' }

const site = JSON.parse(fs.readFileSync(SITE, 'utf8'))
const geo = fs.existsSync(GEO) ? JSON.parse(fs.readFileSync(GEO, 'utf8')) : {}
const BASE_COLS = ['cat', 'gu', 'dong', 'name', 'area', 'floor', 'year', 'deposit', 'rent', 'date', 'ctype']
if (site.cols.slice(0, BASE_COLS.length).join() !== BASE_COLS.join()) throw new Error('사이트 자료의 열 모양이 달라요. 수집기를 먼저 다시 돌려 주세요.')

// 원본에서 (종류, 구, 동, 이름, 면적, 층, 계약일, 보증금, 월세) → 지번 을 찾아 둔다 (사이트 자료에는 지번이 없다)
const keyOf = (c, gu, dong, name, area, floor, date, dep, rent) => [c, gu, dong, name, area ?? '', floor ?? '', date, dep, rent].join('|')
const jibunOf = new Map()
for (const [c, f] of Object.entries(FILES)) {
  const p = path.join(CACHE_DIR, f)
  if (!fs.existsSync(p)) continue
  for (const x of JSON.parse(fs.readFileSync(p, 'utf8')).listings) {
    jibunOf.set(keyOf(c, x.location.district, x.location.dong, x.building.name, x.building.areaSqm, x.building.floor, x.contract.dealDate, x.price.depositManwon, x.price.monthlyRentManwon), x.location.jibun || '')
  }
}

const rows = site.rows.map((r) => r.slice(0, BASE_COLS.length))
const want = new Map() // 찾을 것: 'p|구|동|지번' (지번 위치) 또는 'd|구|동' (동 중심)
const placeKey = (r) => {
  const jibun = r[0] === 'd' ? '' : jibunOf.get(keyOf(...r.slice(0, 4), r[4], r[5], r[9], r[7], r[8])) || ''
  return { pk: jibun ? `p|${r[1]}|${r[2]}|${jibun}` : null, dk: `d|${r[1]}|${r[2]}`, jibun }
}
for (const r of rows) {
  const { pk, dk, jibun } = placeKey(r)
  if (pk && !(pk in geo)) want.set(pk, { district: r[1], dong: r[2], jibun, name: '' })
  if (!(dk in geo)) want.set(dk, { district: r[1], dong: r[2], jibun: '', name: `대구 ${r[1]} ${r[2]}` })
}
console.log(`찾을 주소 ${want.size.toLocaleString('ko-KR')}곳 (저장된 것 ${Object.keys(geo).length.toLocaleString('ko-KR')}곳은 건너뜀)`)

const list = [...want.entries()]
for (let i = 0; i < list.length; i += 80) {
  const batch = list.slice(i, i + 80)
  const res = await fetch(`${BASE}/api/geocode`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ items: batch.map(([k, it], j) => ({ id: 'g' + j, ...it })) }) })
  const data = await res.json()
  if (!data.configured) throw new Error('개발 서버가 카카오 열쇠를 읽지 못했어요 (npm run dev 로 켰는지 확인)')
  if (data.problem) throw new Error('카카오 오류: ' + data.problem)
  for (const r of data.results) {
    const [k] = batch[+r.id.slice(1)]
    if (r.lat != null) geo[k] = [Math.round(r.lat * 1e5) / 1e5, Math.round(r.lng * 1e5) / 1e5]
    else if (k.startsWith('d|')) geo[k] = null // 동도 못 찾으면 다음에도 다시 부르지 않게 비워 둔다
  }
  fs.writeFileSync(GEO, JSON.stringify(geo))
  process.stdout.write(`\r${Math.min(i + 80, list.length).toLocaleString('ko-KR')} / ${list.length.toLocaleString('ko-KR')}`)
}
console.log('')

let exact = 0, approx = 0, none = 0
site.cols = [...BASE_COLS, 'lat', 'lng', 'approx']
site.rows = rows.map((r) => {
  const { pk, dk } = placeKey(r)
  const p = pk && geo[pk], d = geo[dk]
  if (p) { exact++; return [...r, p[0], p[1], 0] }
  if (d) { approx++; return [...r, d[0], d[1], 1] }
  none++; return [...r, null, null, 1]
})
site.meta.geo = { source: '카카오 로컬', exact, approx, none }
fs.writeFileSync(SITE, JSON.stringify(site))
console.log(`지도 위치: 지번 ${exact.toLocaleString('ko-KR')}건 · 동 중심 ${approx.toLocaleString('ko-KR')}건 · 못 찾음 ${none.toLocaleString('ko-KR')}건 → ${SITE}`)

#!/usr/bin/env node
// @ts-nocheck
// 방봄 "집 보기"(집 전체 구조 → 방 하나)를 헤드리스 Edge(Chromium)로 눌러 보는 검사.
// 쓰는 법:  node scripts/e2e-house.mjs [주소] [--shots <폴더>]
//   주소    기본 http://localhost:4180  (개발 서버는 http://localhost:5180)
//   --shots 화면 캡처(PNG)를 그 폴더에 남긴다
// PC(1440x900)는 마우스와 키보드로, 휴대폰(390x844)은 크기 흉내 + 합성 터치로 누른다. 끝에 360x740 에서 가로 넘침을 본다.
// 모든 주소에 tutorial=0 을 붙여서 시작 화면과 튜토리얼이 뜨지 않게 한다. AI 는 부르지 않는다.
// 실패가 하나라도 있으면 종료 코드 1.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const shotAt = args.indexOf('--shots')
const SHOTS = shotAt >= 0 ? args[shotAt + 1] : ''
const BASE = (args.find((a, i) => !a.startsWith('--') && (shotAt < 0 || i !== shotAt + 1)) || 'http://localhost:4180').replace(/\/$/, '')
// chat=0: 예전 상담 서랍을 그대로 검사한다 (집찾기 대화는 e2e-chat.mjs 가 본다)
const HOME = BASE + '/?tutorial=0&chat=0'
const EDGE = [process.env.EDGE_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify
const rows = []
const notes = []
const errors = []
let step = '시작'

// 표준 구조의 방 (bangbom/src/modelhouse/house.js 의 ROOMS 와 같아야 한다). 그림에 놓인 순서대로, [방 id, 이름표]
const LAYOUTS = {
  '84㎡ A타입': { all: [['r3', '방 2 3.4 × 3.6m'], ['kit', '주방 4.0 × 3.6m'], ['bath', '욕실 3.0 × 2.0m'], ['hall', '현관 3.0 × 1.6m'], ['bath2', '욕실 2 1.6 × 1.8m'], ['dress', '드레스룸 1.8 × 1.8m'], ['r1', '방 3 3.4 × 3.2m'], ['liv', '거실 4.0 × 5.0m'], ['r2', '안방 3.0 × 5.0m']], deco: ['liv', 'r2', 'r3', 'r1'], living: [400, 500] },
  '59㎡ A타입': { all: [['r3', '방 3 2.9 × 3.0m'], ['kit', '주방 3.0 × 3.0m'], ['bath', '욕실 2.5 × 1.9m'], ['hall', '현관 2.5 × 1.1m'], ['r1', '안방 2.9 × 4.4m'], ['liv', '거실 3.0 × 4.4m'], ['r2', '방 2 2.5 × 4.4m']], deco: ['liv', 'r1', 'r2', 'r3'], living: [300, 440] },
}
const EMPTY = '아직 꾸미지 않았어요'

// 저장소에 미리 넣어 둘 "꾸민 방" (방꾸미가 저장하는 모양: src/types/schema.ts 의 ProjectState)
function seedProject(widthCm, depthCm) {
  const item = (id, name, category, w, d, x, y, rotation) => ({ id, name, category, widthCm: w, depthCm: d, heightCm: 75, xCm: x, yCm: y, rotation, color: '#d8c7a8', material: 'wood', owned: false, clearanceFrontCm: 60, hasSharpCorner: false, price: { estimatedKrw: 100000, manualKrw: null, source: 'catalog' }, locked: false })
  return { version: '2.0.0', activeRoomId: 'room_1', profile: { lifestyle: 'single', budgetKrw: 3000000 }, updatedAt: '2026-11-26T00:00:00.000Z', rooms: [{ id: 'room_1', name: '검사용 방', widthCm, depthCm, heightCm: 240, windowDirection: 'south', openings: [], style: { id: 'natural', name: '내추럴', wallColor: '#f5f1ea', floorColor: '#c9a77c', floorMaterial: 'oak_wood', accentColor: '#1f6b4f', description: '' }, activeVariantId: null, variants: [],
    // 둘째(책상 120x60)는 90도 돌려서 바닥을 60x120 으로 차지한다
    furniture: [item('f1', '침대', 'bed', 150, 200, 10, 10, 0), item('f2', '책상', 'desk', 120, 60, 200, 300, 90), item('f3', '서랍장', 'drawer', 80, 45, 10, 380, 180)] }] }
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 1; this.p = new Map(); this.l = new Map()
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data))
      if (typeof m.id === 'number') { const w = this.p.get(m.id); if (!w) return; this.p.delete(m.id); m.error ? w.rej(new Error('CDP: ' + m.error.message)) : w.res(m.result) }
      else if (m.method) for (const f of [...(this.l.get(m.method) || [])]) f(m.params)
    })
  }
  send(method, params = {}) {
    const id = this.id++
    return new Promise((res, rej) => { this.p.set(id, { res, rej }); this.ws.send(J({ id, method, params })); setTimeout(() => { if (this.p.delete(id)) rej(new Error('CDP 응답 없음: ' + method)) }, 30000) })
  }
  on(ev, f) { if (!this.l.has(ev)) this.l.set(ev, []); this.l.get(ev).push(f) }
  off(ev, f) { const a = this.l.get(ev) || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1) }
}

// 페이지 안에 심는 도우미 (글자로 바뀌어 페이지에서 실행된다)
function helpers() {
  const txt = (el) => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '')
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = el.ownerDocument.defaultView.getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 }
  const rect = (sel) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!vis(el)) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), r: Math.round(r.right) } }
  const fur = (slot) => { try { const p = JSON.parse(localStorage.getItem('bangkkumi2.project.' + slot) || 'null'); if (!p) return null; const room = (p.rooms || []).find((r) => r.id === p.activeRoomId) || (p.rooms || [])[0]; return room ? room.furniture.map((x) => x.name) : null } catch (e) { return 'ERR ' + e.message } }
  // 집 보기가 보내는 알림을 센다 (맨 위 화면에서만)
  if (window === window.top && !window.__mh) {
    window.__mh = { house: [], room: [] }
    document.addEventListener('mh:house', (e) => window.__mh.house.push(e.detail && e.detail.complexId))
    document.addEventListener('mh:room', (e) => window.__mh.room.push(e.detail && e.detail.complexId + '-' + e.detail.roomId))
  }
  window.__q = {
    txt, vis, rect, fur,
    // 누를 자리(가운데 점)와 그 자리가 다른 것에 가려졌는지
    pt(el) {
      if (!el) return null
      let r = el.getBoundingClientRect()
      if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); r = el.getBoundingClientRect() }
      const x = r.left + r.width / 2, y = r.top + r.height / 2
      const top = document.elementFromPoint(x, y), hit = !!top && r.width > 0 && (top === el || el.contains(top))
      const cls = top ? (top.className && top.className.baseVal !== undefined ? top.className.baseVal : String(top.className)) : ''
      return { x, y, hit, w: r.width, h: r.height, by: top ? '<' + top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') + '.' + cls.slice(0, 40) + '>' : '없음' }
    },
    // 화면에 보이고 가려지지 않은 단지 이름표
    label(name) {
      const all = [...document.querySelectorAll('.clabel')]
      if (name) return all.find((b) => b.getAttribute('aria-label') === name) || null
      const free = (b) => { const r = b.getBoundingClientRect(); if (!r.width || r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) return false; const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === b || b.contains(t)) }
      return all.find(free) || null
    },
    // 손가락이 닿는 높이: 가운데 세로줄에서 그 단추가 받는 구간(::after 로 넓힌 것까지)
    touchH(el) {
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2; let top = r.top, bot = r.bottom
      for (let y = r.top; y > r.top - 12; y--) { const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) top = y; else break }
      for (let y = r.bottom - 1; y < r.bottom + 12; y++) { const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) bot = y + 1; else break }
      return Math.round(bot - top)
    },
    // 방꾸미 iframe: 주소 옵션과 다 떴는지
    frame() {
      const f = document.querySelector('#kkumiFrame'); if (!f || !f.getAttribute('src')) return null
      const u = new URL(f.src, location.href), q = u.searchParams, d = f.contentDocument
      let live = ''; try { live = f.contentWindow.location.pathname + f.contentWindow.location.search } catch (e) { live = 'ERR ' + e.message }
      const slot = q.get('slot'), liveSlot = new URLSearchParams(live.split('?')[1] || '').get('slot'), r = f.getBoundingClientRect()
      return { path: u.pathname, embed: q.get('embed'), slot, w: q.get('w'), d: q.get('d'), kind: q.get('kind'), op: q.get('op'), view: q.get('view'), eye: q.get('eye'), liveSlot, shown: vis(f),
        ready: !!d && d.readyState === 'complete' && !!d.querySelector('#root') && d.querySelector('#root').children.length > 0,
        fur: fur(liveSlot), top: Math.round(r.top), bottom: Math.round(r.bottom), wpx: Math.round(r.width), pressed: txt(document.querySelector('#hvRooms button[aria-pressed="true"]')) }
    },
    over() { const de = document.documentElement; return { iw: innerWidth, ih: innerHeight, docW: de.scrollWidth, bodyW: document.body.scrollWidth } },
    // 집 전체 구조 화면의 상태
    ov() {
      const o = document.querySelector('#hvOver'), f = document.querySelector('#kkumiFrame'), plan = o.querySelector('.hvo-plan'), all = (s) => [...o.querySelectorAll(s)]
      const pr = plan ? plan.getBoundingClientRect() : null
      return { on: vis(o), frameShown: vis(f), frameSrc: f.getAttribute('src'), hash: location.hash, hist: history.length, type: txt(document.querySelector('#hvTitle .hv-type')).replace(/^·\s*/, ''),
        lead: txt(o.querySelector('.hvo-lead')), note: txt(o.querySelector('.hvo-note')), keys: txt(o.querySelector('.hvo-key')),
        plan: all('.hvo-plan [data-room]').map((e) => [e.dataset.room, txt(e)]), planBtns: all('.hvo-plan button[data-room]').map((e) => e.dataset.room),
        list: all('.hvo-list button[data-room]').map((e) => [e.dataset.room, txt(e)]), listH: Math.min(...all('.hvo-list button').map((e) => Math.round(e.getBoundingClientRect().height))),
        fur: Object.fromEntries(all('svg[data-fur]').map((s) => [s.dataset.fur, s.querySelectorAll('rect').length])),
        walls: all('.hvo-plan svg line').length, wins: all('.hvo-plan svg g[fill="#fff"] rect').length, entry: !!o.querySelector('.hvo-entry'),
        // 이름표가 평면도 상자 밖으로 나가지 않았는지 (가로)
        inside: !!pr && all('.hvo-plan [data-room] b, .hvo-plan [data-room] i').every((e) => { const r = e.getBoundingClientRect(); return r.left >= pr.left - 1 && r.right <= pr.right + 1 }),
        planRect: rect(plan), listRect: rect('#hvOver .hvo-list'), scroll: [o.scrollHeight, o.clientHeight],
        chips: vis(document.querySelector('#hvRooms')), planBtn: vis(document.querySelector('#hvPlan')), consult: vis(document.querySelector('#hvConsult')), back: vis(document.querySelector('#hvBack')),
        top: rect('#mh .hv-top'), tabbar: vis(document.querySelector('.tabbar')), nav: vis(document.querySelector('#nav')), over: this.over() }
    },
  }
}

async function run(cdp) {
  for (const d of ['Page', 'Runtime', 'Log', 'Network']) await cdp.send(d + '.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${helpers.toString()})()` })
  cdp.on('Runtime.exceptionThrown', (p) => { const d = p.exceptionDetails || {}; errors.push({ step, text: String((d.exception && d.exception.description) || d.text).split('\n')[0] + ' ' + (d.url || '') }) })
  cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') notes.push(`[${step}] console.error: ` + (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)) })

  const ev = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('페이지 계산 오류: ' + String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).split('\n')[0]); return r.result.value }
  const waitFor = async (expr, what, ms = 8000) => { const end = Date.now() + ms; for (;;) { try { const v = await ev(`(() => { try { return (${expr}) } catch { return null } })()`); if (v) return v } catch {} if (Date.now() > end) throw new Error(`${what}: ${ms / 1000}초 기다려도 안 됨`); await sleep(120) } }
  const loadThen = async (fn) => { let done; const p = new Promise((r) => { done = r }); const f = () => done(); cdp.on('Page.loadEventFired', f); await fn(); await Promise.race([p, sleep(20000)]); cdp.off('Page.loadEventFired', f); await sleep(600) }
  const nav = (url) => loadThen(() => cdp.send('Page.navigate', { url }))
  let touch = false
  const size = async (w, h, mobile) => {
    touch = !!mobile
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile, screenWidth: w, screenHeight: h })
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: mobile ? 5 : 1 })
  }
  const shot = async (name) => { if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true }); const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64')) }
  // 그 자리를 진짜로 누른다(PC 는 마우스, 휴대폰은 터치)
  const pressAt = async (x, y) => {
    if (touch) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
    else for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 })
    await sleep(260)
  }
  // 단추를 누른다. 가려져 있으면 실패로 본다
  const tap = async (expr, label) => {
    const p = await ev(`__q.pt(${expr})`)
    if (!p) throw new Error(`${label}: 화면에서 찾지 못했어요`)
    if (!p.hit) throw new Error(`${label}: 누를 자리(${Math.round(p.x)},${Math.round(p.y)})가 ${p.by} 에 가려져 있어요`)
    await pressAt(p.x, p.y)
    return p
  }
  // 키보드: Enter 는 누를 때, Space 는 뗄 때 단추가 눌린다
  const key = async (name) => {
    const d = name === 'Enter' ? { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 } : { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 }
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...d, text: name === 'Enter' ? '\r' : ' ' }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...d }); await sleep(260)
  }
  const check = async (what, fn) => { step = what; let row; try { const r = await fn(); row = { what, ok: !!r.ok, evidence: r.evidence } } catch (e) { row = { what, ok: false, evidence: '오류: ' + e.message } } rows.push(row); console.log(`${row.ok ? 'OK  ' : 'FAIL'} ${what} :: ${row.evidence}`) }
  const q = (sel) => `document.querySelector(${J(sel)})`
  const chip = (name) => `[...document.querySelectorAll('#hvRooms button')].find(b => __q.txt(b) === ${J(name)})`
  const planBtn = (id) => q(`#hvOver .hvo-plan button[data-room="${id}"]`)
  const listBtn = (id) => q(`#hvOver .hvo-list button[data-room="${id}"]`)
  const openCard = async () => {
    const open = `document.querySelector('#panelR').classList.contains('is-open')`
    const find = `(() => { const b = __q.label(''); return b ? b.getAttribute('aria-label') : null })()`
    let name = await waitFor(find, '보이는 단지 이름표', 2500).catch(() => null)
    // 지도를 옮겨서 보이는 이름표가 없으면 구 바로가기 칩으로 단지가 있는 곳으로 간다
    if (!name) { await tap(q('#dnav button'), '구 바로가기 칩'); await sleep(1500); name = await waitFor(find, '보이는 단지 이름표', 6000) }
    await tap(`__q.label(${J(name)})`, '단지 이름표')
    await waitFor(open, '단지 카드', 4000); await sleep(900)
    return name
  }
  // 그 저장 칸의 방꾸미 화면이 다 뜰 때까지
  const waitRoom = async (slot) => { await waitFor(`(() => { const f = __q.frame(); return !!f && f.slot === ${J(slot)} && f.liveSlot === f.slot && f.ready && f.shown })()`, `방꾸미 화면(${slot})`, 25000); await sleep(900); return ev('__q.frame()') }
  // 전체 구조가 보일 때까지
  const waitOver = async () => { await waitFor(`location.hash === '#house' && __q.ov().on`, '집 전체 구조', 6000); await sleep(350); return ev('__q.ov()') }
  // 저장된 것을 지우고 새로 연다 (주소의 # 만 바꾸면 화면을 다시 읽지 않으므로 새로 고침을 한다)
  const fresh = async (hash) => { await nav(HOME); await ev('localStorage.clear()'); await loadThen(() => cdp.send('Page.reload')); await ev('location.hash = ' + J(hash)); await sleep(900) }
  // 주소의 # 만 다르면 화면을 다시 읽지 않는다. 빈 화면을 거쳐서 처음 연 것처럼 연다
  const openAt = async (hash) => { await nav('about:blank'); await nav(HOME + hash) }
  const same = (a, b) => J(a) === J(b)

  for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
    const P = mobile ? `휴대폰 ${w}x${h}` : `PC ${w}x${h}`, tag = mobile ? `m${w}` : 'pc'
    await size(w, h, mobile)
    let cid = '', lay = null, o1 = null, h0 = 0, h1 = 0, opened = []

    await check(`${P} 1. 지도 → 단지 카드 → 집 보기: 방이 아니라 집 전체 구조가 먼저`, async () => {
      await fresh('#map'); await sleep(1500)
      const name = await openCard()
      await tap(q('#ccHouse'), '집 보기 →'); o1 = await waitOver(); h0 = o1.hist
      await shot(`${tag}-overview`)
      lay = LAYOUTS[o1.type]
      if (!lay) return { ok: false, evidence: `모르는 구조 이름: "${o1.type}"` }
      const ev1 = await ev('window.__mh')
      const phone = !mobile || (o1.over.docW <= w && o1.over.bodyW <= w && !o1.tabbar && !o1.nav && o1.top.y === 0 && o1.top.h <= 64 && o1.listH >= 44 && o1.planRect.w >= w - 40 && o1.listRect.y >= o1.planRect.b)
      const ok = o1.on && !o1.frameShown && !o1.frameSrc && o1.lead === '꾸미고 싶은 방을 눌러 주세요.' && same(o1.plan, lay.all) && same(o1.planBtns, lay.all.map((x) => x[0]).filter((id) => lay.deco.includes(id))) && same(o1.list.map((x) => x[0]), lay.deco) && o1.list.every((x) => x[1].endsWith(EMPTY)) && same(o1.fur, {})
        && o1.walls >= 10 && o1.wins >= 3 && o1.entry && /입구/.test(o1.keys) && /창문/.test(o1.keys) && /표준 구조/.test(o1.note) && /이 브라우저에만 저장/.test(o1.note) && o1.inside
        && !o1.chips && !o1.planBtn && o1.consult && o1.back && o1.over.docW <= w && ev1.house.length === 1 && ev1.room.length === 0 && phone
      return { ok, evidence: `단지="${name}" 구조="${o1.type}", 전체 구조 보임=${o1.on}·방꾸미 화면 보임=${o1.frameShown}, 안내="${o1.lead}", 방 이름표 ${o1.plan.length}개=${J(o1.plan.map((x) => x[1]))}, 평면도 단추=${J(o1.planBtns)}, 목록=${J(o1.list.map((x) => x[1]))}, 벽 ${o1.walls}·창문 ${o1.wins}·입구 표시=${o1.entry}, 설명="${o1.keys}", 고지="${o1.note}", 이름표가 그림 안=${o1.inside}, 방 칩 보임=${o1.chips}·[전체 구조] 보임=${o1.planBtn}·상담 보임=${o1.consult}, 가로 ${o1.over.docW}/${w}, 평면도 ${o1.planRect.w}x${o1.planRect.h}px, 내용 높이/보이는 높이=${o1.scroll.join('/')}, 위쪽 틀 ${o1.top.h}px, 목록 단추 높이 ${o1.listH}px, mh:house=${J(ev1.house)}` }
    })
    if (!lay) lay = LAYOUTS['84㎡ A타입']

    await check(`${P} 2. 꾸밀 수 없는 방(주방·욕실·현관)은 눌러도 그대로`, async () => {
      const quiet = lay.all.map((x) => x[0]).filter((id) => !lay.deco.includes(id)), seen = []
      for (const id of quiet) {
        const r = await ev(`__q.rect(${J(`#hvOver .hvo-plan [data-room="${id}"]`)})`)
        await pressAt(r.x + r.w / 2, r.y + r.h / 2)
        seen.push(id + '→' + await ev('location.hash'))
      }
      const a = await ev(`({ btn: ${J(quiet)}.filter(id => document.querySelector('#hvOver button[data-room="' + id + '"]')), tags: ${J(quiet)}.map(id => document.querySelector('#hvOver .hvo-plan [data-room="' + id + '"]').tagName), ov: __q.ov() })`)
      const ok = seen.every((s) => s.endsWith('→#house')) && a.btn.length === 0 && a.tags.every((t) => t === 'SPAN') && a.ov.on && a.ov.hist === h0
      return { ok, evidence: `누른 뒤 주소=${J(seen)}, 단추로 된 것=${J(a.btn)}, 꼬리표=${J([...new Set(a.tags)])}, 전체 구조 그대로=${a.ov.on}, 기록 ${h0}→${a.ov.hist}` }
    })

    await check(`${P} 3. 평면도에서 거실 누르기 → #house/liv 가 새 기록으로, 방꾸미 화면이 그 방으로`, async () => {
      await tap(planBtn('liv'), '평면도의 거실'); await waitFor(`location.hash === '#house/liv'`, '#house/liv', 4000)
      const f = await waitRoom(await ev(`__q.frame().slot`)); cid = f.slot.replace(/-liv$/, ''); opened = [f.slot]
      await shot(`${tag}-room`)
      const a = await ev(`({ hist: history.length, ov: __q.ov(), planTouch: __q.touchH(${q('#hvPlan')}), consultHit: __q.pt(${q('#hvConsult')}).hit, mh: window.__mh })`); h1 = a.hist
      const phone = !mobile || (a.ov.over.docW <= w && !a.ov.tabbar && !a.ov.nav && a.ov.top.h <= 112 && f.top <= 112 && f.bottom >= h - 1 && f.wpx === w && a.planTouch >= 44)
      const ok = f.slot === cid + '-liv' && /^c\d+$/.test(cid) && f.path.endsWith('/room.html') && f.embed === '1' && +f.w === lay.living[0] && +f.d === lay.living[1] && f.kind === 'living' && !!f.op && !f.eye && !f.view && f.pressed === '거실'
        && a.hist === h0 + 1 && !a.ov.on && a.ov.chips && a.ov.planBtn && a.ov.consult && a.consultHit && same(a.mh.room, [f.slot]) && a.mh.house.length === 1 && phone
      return { ok, evidence: `iframe=${J({ path: f.path, slot: f.slot, w: f.w, d: f.d, kind: f.kind, op: f.op, eye: f.eye })}, 다 뜸=${f.ready}, 가구=${J(f.fur)}, 눌린 칩="${f.pressed}", 기록 ${h0}→${a.hist}, 전체 구조 숨음=${!a.ov.on}, [전체 구조] 보임=${a.ov.planBtn}(닿는 높이 ${a.planTouch}px), 상담 누를 수 있음=${a.consultHit}, 위쪽 틀 ${a.ov.top.h}px, iframe y=${f.top}~${f.bottom}, mh:room=${J(a.mh.room)}` }
    })

    await check(`${P} 4. 방 칩으로 두 번 바꿔도 기록이 늘지 않고, 방마다 따로 저장`, async () => {
      const names = await ev(`[...document.querySelectorAll('#hvRooms button')].map(b => __q.txt(b))`), seen = []
      for (const name of ['안방', '방 2']) {
        const id = lay.all.find((x) => x[1].startsWith(name + ' '))[0], slot = cid + '-' + id
        await tap(chip(name), name + ' 칩'); const f = await waitRoom(slot); opened.push(slot)
        seen.push({ name, hash: await ev('location.hash'), slot: f.slot, pressed: f.pressed, hist: await ev('history.length'), state: await ev('history.state && history.state.mhOver') })
      }
      const keep = await ev(`__q.fur(${J(opened[0])})`), mh = await ev('window.__mh')
      const ok = names.length === 4 && seen.every((s) => s.hash === '#house/' + s.slot.split('-')[1] && s.pressed === s.name && s.hist === h1 && s.state === 1) && Array.isArray(keep) && keep.length > 0 && same(mh.room, opened) && mh.house.length === 1
      return { ok, evidence: `방 칩=${J(names)}, 바꾼 뒤=${J(seen)}, 기록 길이 ${h1} 그대로=${seen.every((s) => s.hist === h1)}, 거실 칸 가구 그대로=${J(keep)}, mh:room=${J(mh.room)}` }
    })

    await check(`${P} 5. 뒤로 가기 → 전체 구조: 꾸민 방에 가구 자리와 "가구 N개", mh:house 는 한 번`, async () => {
      await ev('history.back()'); const o = await waitOver(); await shot(`${tag}-overview-after`)
      const want = {}; for (const slot of opened) want[slot.split('-')[1]] = (await ev(`__q.fur(${J(slot)})`) || []).length
      const never = lay.deco.find((id) => !(id in want)), mh = await ev('window.__mh')
      const listOk = o.list.every(([id, t]) => (id in want ? t.endsWith(`가구 ${want[id]}개`) : t.endsWith(EMPTY)))
      const focus = await ev(`document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.room || '' : ''`)
      const ok = o.on && !o.frameShown && !o.frameSrc && Object.values(want).every((n) => n > 0) && same(o.fur, want) && listOk && /놓아 둔 가구/.test(o.keys) && !o.chips && !o.planBtn && mh.house.length === 1 && o.hist === h1
      return { ok, evidence: `주소=${o.hash}, 전체 구조 보임=${o.on}·방꾸미 화면 닫힘=${!o.frameSrc}, 저장된 가구 수=${J(want)}, 그린 가구 자리=${J(o.fur)}, 목록=${J(o.list.map((x) => x[1]))}, 안 연 방=${never}, 초점=${focus}, mh:house=${J(mh.house)}, 기록 길이 ${o.hist}` }
    })

    await check(`${P} 6. 목록에서 다시 열면 저장한 그대로 → [전체 구조]는 뒤로 가기와 같고 → 한 번 더 뒤로 가면 지도`, async () => {
      const before = await ev(`__q.fur(${J(opened[0])})`)
      await tap(listBtn('liv'), '목록의 거실'); const f = await waitRoom(opened[0])
      const a = await ev(`({ hash: location.hash, hist: history.length })`)
      await tap(q('#hvPlan'), '전체 구조'); const o = await waitOver()
      await ev('history.back()'); await waitFor(`location.hash === '#map'`, '#map', 4000); await sleep(500)
      const b = await ev(`({ hash: location.hash, house: __q.vis(${q('#houseView')}) })`)
      const ok = a.hash === '#house/liv' && same(f.fur, before) && o.on && o.hist === a.hist && b.hash === '#map' && !b.house
      return { ok, evidence: `다시 연 거실 가구=${J(f.fur)}(전과 같음=${same(f.fur, before)}), [전체 구조] 뒤 주소=${o.hash}·기록 길이 ${a.hist}→${o.hist}, 뒤로 한 번 더=${b.hash}(집 보기 닫힘=${!b.house})` }
    })

    await check(`${P} 7. 84㎡ 단지와 59㎡ 단지의 전체 구조, 저장해 둔 방은 가구 자리(돌린 가구 포함), 깨진 저장은 조용히 넘어감`, async () => {
      await ev(`MH.openHouse('c01')`); const a = await waitOver()
      await ev('history.back()'); await waitFor(`location.hash === '#map'`, '#map', 4000)
      // c06 은 74㎡ 인데 84㎡ 구조로 대신 보여 준다. 그 사실을 전체 구조에서도 적어야 한다
      await ev(`MH.openHouse('c06')`); const s6 = await waitOver()
      await ev('history.back()'); await waitFor(`location.hash === '#map'`, '#map', 4000)
      // c02 안방(r1, 2.9 x 4.4m)에 가구 3개, 방 2(r2)에는 깨진 글자, 방 3(r3)에는 모양이 다른 자료를 넣어 둔다
      await ev(`(() => { localStorage.setItem('bangkkumi2.project.c02-r1', ${J(J(seedProject(290, 440)))}); localStorage.setItem('bangkkumi2.project.c02-r2', '{broken'); localStorage.setItem('bangkkumi2.project.c02-r3', ${J(J({ version: '2.0.0', rooms: [{ widthCm: 'x', depthCm: 300, furniture: [{ xCm: 1 }, null, 7] }, null] }))}) })()`)
      await ev(`MH.openHouse('c02')`); const b = await waitOver(); await shot(`${tag}-overview-59`)
      const g = await ev(`(() => { const room = ${planBtn('r1')}.getBoundingClientRect(); const rs = [...document.querySelectorAll('#hvOver svg[data-fur="r1"] rect')].map(e => e.getBoundingClientRect()); return { n: rs.length, inside: rs.every(r => r.left >= room.left - 1 && r.right <= room.right + 1 && r.top >= room.top - 1 && r.bottom <= room.bottom + 1), turned: rs[1] ? [Math.round(rs[1].width * 10) / 10, Math.round(rs[1].height * 10) / 10] : null, flat: rs[0] ? [Math.round(rs[0].width * 10) / 10, Math.round(rs[0].height * 10) / 10] : null, scale: room.width / 290 } })()`)
      const turnedOk = !!g.turned && Math.abs(g.turned[0] - 60 * g.scale) < 2 && Math.abs(g.turned[1] - 120 * g.scale) < 2 && Math.abs(g.flat[0] - 150 * g.scale) < 2 && Math.abs(g.flat[1] - 200 * g.scale) < 2
      const txt59 = Object.fromEntries(b.list)
      const ok = a.type === '84㎡ A타입' && same(a.plan, LAYOUTS['84㎡ A타입'].all) && same(a.list.map((x) => x[0]), LAYOUTS['84㎡ A타입'].deco) && a.inside
        && b.type === '59㎡ A타입' && same(b.plan, LAYOUTS['59㎡ A타입'].all) && same(b.list.map((x) => x[0]), LAYOUTS['59㎡ A타입'].deco) && b.inside && b.over.docW <= w
        && /74㎡인데 84㎡ 구조로 대신/.test(s6.note) && !/대신/.test(a.note) && /실제와 다를 수 있어요/.test(a.note)
        && same(b.fur, { r1: 3 }) && txt59.r1.endsWith('가구 3개') && txt59.r2.endsWith(EMPTY) && txt59.r3.endsWith(EMPTY) && txt59.liv.endsWith(EMPTY) && g.inside && turnedOk
      return { ok, evidence: `c01 "${a.type}" 방 ${a.plan.length}개=${J(a.plan.map((x) => x[1]))} / c02 "${b.type}" 방 ${b.plan.length}개=${J(b.plan.map((x) => x[1]))}, 목록=${J(b.list.map((x) => x[1]))}, 가구 자리=${J(b.fur)}, 방 안에 그려짐=${g.inside}, 그대로 둔 침대(150x200cm) ${J(g.flat)}px·90도 돌린 책상(120x60cm) ${J(g.turned)}px (1cm=${g.scale.toFixed(3)}px), 가로 ${b.over.docW}/${w}, c06 고지="${s6.note}"` }
    })

    await check(`${P} 8. 키보드: 목록에서 Enter, 평면도에서 Space 로 방 열기`, async () => {
      await ev(`${listBtn('liv')}.focus()`); await key('Enter')
      await waitFor(`location.hash === '#house/liv'`, 'Enter → #house/liv', 4000); const f1 = await waitRoom('c02-liv')
      const focus1 = await ev(`__q.txt(document.activeElement)`)
      await ev('history.back()'); await waitOver()
      const focus2 = await ev(`document.activeElement.className + ':' + (document.activeElement.dataset.room || '')`)
      await ev(`${planBtn('r2')}.focus()`); await key('Space')
      await waitFor(`location.hash === '#house/r2'`, 'Space → #house/r2', 4000); const f2 = await waitRoom('c02-r2')
      await ev('history.back()'); const o = await waitOver()
      const ok = +f1.w === 300 && +f1.d === 440 && f1.pressed === '거실' && focus1 === '거실' && focus2 === 'hvo-room:liv' && f2.pressed === '방 2' && +f2.w === 250 && +f2.d === 440 && Array.isArray(f2.fur) && o.on && o.fur.r1 === 3
      return { ok, evidence: `Enter → ${f1.slot}(${f1.w}x${f1.d}) 초점="${focus1}" 칩, 뒤로 → 초점=${focus2}, Space → ${f2.slot}(${f2.w}x${f2.d}) 깨진 저장 대신 새로 시작한 가구=${J(f2.fur)}, 다시 전체 구조: 가구 자리=${J(o.fur)}` }
    })

    await check(`${P} 9. 주소로 바로 연 방(#house/liv): [전체 구조]는 주소만 바꾸고, 없는 방 주소는 전체 구조로`, async () => {
      await openAt('#house/liv'); const f = await waitRoom('c01-liv')
      const a = await ev(`({ hist: history.length, state: history.state, planBtn: __q.vis(${q('#hvPlan')}) })`)
      await tap(q('#hvPlan'), '전체 구조'); const o = await waitOver()
      await ev(`location.hash = '#house/kit'`); await sleep(500); const k = await ev('__q.ov()')
      const ok = f.slot === 'c01-liv' && a.planBtn && !a.state && o.on && o.hist === a.hist && k.on && k.hash === '#house' && !k.frameSrc
      return { ok, evidence: `바로 연 방=${f.slot}, [전체 구조] 뒤 주소=${o.hash}·기록 길이 ${a.hist}→${o.hist}, #house/kit → 주소=${k.hash}·전체 구조 보임=${k.on}` }
    })

    await check(`${P} 10. 홈 "아이 눈높이 90cm로 보기" → 전체 구조를 건너뛰고 거실 3D 눈높이, 뒤로 가면 전체 구조`, async () => {
      await fresh('#home')
      // 홈(풀페이지) 01 화면의 아이 시점 상자에 있는 링크까지 내린다
      await ev(`${q('a[data-eye="child"]')}.scrollIntoView({ block: "center" })`); await sleep(900)
      await tap(q('a[data-eye="child"]'), '아이 눈높이 90cm로 보기'); await waitFor(`location.hash === '#house/liv'`, '#house/liv', 6000)
      const f = await waitRoom('c01-liv')
      // 방꾸미 화면(iframe) 안의 눈높이 상태: 3D 화면 바깥 요소의 data-eye-mode
      const mode = await waitFor(`(() => { const d = ${q('#kkumiFrame')}.contentDocument, r = d && d.querySelector('[data-eye-mode]'); return r && r.querySelector('canvas') ? r.dataset.eyeMode : null })()`, '3D 아이 눈높이', 40000); await sleep(800)
      await shot(`${tag}-eye`)
      const a = await ev(`({ state: history.state && history.state.mhOver, mh: window.__mh, planBtn: __q.vis(${q('#hvPlan')}) })`)
      await ev('history.back()'); const o = await waitOver()
      const ok = f.view === '3d' && f.eye === 'child' && f.slot === 'c01-liv' && mode === 'child' && f.pressed === '거실' && a.state === 1 && a.planBtn && same(a.mh.house, ['c01']) && same(a.mh.room, ['c01-liv']) && o.on && !o.frameSrc
      return { ok, evidence: `iframe view=${f.view}&eye=${f.eye}(${f.slot}), 방꾸미 눈높이 상태=${mode}, 눌린 칩="${f.pressed}", mh:house=${J(a.mh.house)}·mh:room=${J(a.mh.room)}, 뒤로 → 주소=${o.hash}·전체 구조 보임=${o.on}` }
    })

    if (mobile) await check(`${P} 11. 전체 구조에서도 상담이 열린다 (아래 막대는 없다)`, async () => {
      await tap(q('#hvConsult'), '상담'); await waitFor(`${q('#drawer')}.classList.contains('is-open')`, '상담 서랍', 3000); await sleep(400)
      const d = await ev(`__q.rect('#drawer')`)
      await tap(q('#drClose'), '상담 닫기'); await waitFor(`!${q('#drawer')}.classList.contains('is-open')`, '상담 서랍 닫힘', 3000); await sleep(400)
      const o = await ev('__q.ov()')
      return { ok: !!d && d.w === w && o.on && !o.tabbar && !o.nav && !o.frameShown, evidence: `상담 서랍 ${d ? d.w + 'x' + d.h : '없음'}, 닫은 뒤 전체 구조 그대로=${o.on}, 방봄 탭 막대 보임=${o.tabbar}·방꾸미 화면 보임=${o.frameShown}` }
    })
  }

  // ═════════ 작은 휴대폰 360x740: 가로로 넘치지 않고, 평면도 아래에 목록 ═════════
  await size(360, 740, true)
  await check('휴대폰 360x740. 전체 구조가 가로로 넘치지 않는다 (84㎡, 59㎡)', async () => {
    await openAt('#house'); const a = await waitOver(); await shot('m360-overview')
    await ev(`location.hash = '#map'`); await sleep(700); await ev(`MH.openHouse('c02')`); const b = await waitOver(); await shot('m360-overview-59')
    const fit = (o) => o.over.docW <= 360 && o.over.bodyW <= 360 && o.planRect.x >= 0 && o.planRect.r <= 360 && o.planRect.w >= 320 && o.listRect.y >= o.planRect.b && o.listRect.r <= 360 && o.inside && o.listH >= 44 && !o.tabbar && !o.nav
    return { ok: fit(a) && fit(b) && a.type === '84㎡ A타입' && b.type === '59㎡ A타입', evidence: `84㎡: 가로 ${a.over.docW}/360, 평면도 ${a.planRect.w}x${a.planRect.h}px, 목록 y=${a.listRect.y}~${a.listRect.b}, 내용 높이/보이는 높이=${a.scroll.join('/')}, 이름표가 그림 안=${a.inside} / 59㎡: 가로 ${b.over.docW}/360, 평면도 ${b.planRect.w}x${b.planRect.h}px, 목록 y=${b.listRect.y}~${b.listRect.b}, 내용 높이/보이는 높이=${b.scroll.join('/')}, 이름표가 그림 안=${b.inside}` }
  })
  step = '끝'
}

async function main() {
  if (!EDGE) { console.log('Edge(또는 Chrome)를 찾지 못했어요. EDGE_PATH 환경변수로 실행 파일 위치를 알려 주세요.'); process.exit(1) }
  const port = await new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })
  const profile = mkdtempSync(path.join(os.tmpdir(), 'bangbom-house-e2e-'))
  const child = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--remote-allow-origins=*', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--mute-audio', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' })
  let timer
  try {
    let target
    for (let i = 0; i < 100 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((e) => e.type === 'page') } catch {} if (!target) await sleep(150) }
    if (!target) throw new Error('브라우저가 뜨지 않았어요')
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('브라우저 연결 실패'))) })
    await Promise.race([run(new Cdp(ws)), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('시간 제한(8분)에 걸렸어요. 마지막 단계: ' + step)), 480000) })])
  } catch (e) { rows.push({ what: '실행', ok: false, evidence: '중단: ' + e.message }); console.log('FAIL 실행 :: ' + e.message) } finally {
    clearTimeout(timer)
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else child.kill('SIGKILL')
    for (let i = 0; i < 8; i++) { try { rmSync(profile, { recursive: true, force: true }); break } catch { await sleep(300) } }
  }
  if (errors.length) { rows.push({ what: '화면 예외 없음', ok: false, evidence: J(errors) }); console.log('FAIL 화면 예외 :: ' + J(errors, null, 1)) }
  if (notes.length) console.log('\n메모\n' + notes.join('\n'))
  const bad = rows.filter((r) => !r.ok)
  console.log(`\n${BASE} · 검사 ${rows.length}개 중 통과 ${rows.length - bad.length}개, 실패 ${bad.length}개 (엔진: Chromium(Edge) 헤드리스, 휴대폰은 크기 흉내 + 합성 터치)`)
  process.exit(bad.length ? 1 : 0)
}
main()

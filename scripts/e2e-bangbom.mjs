#!/usr/bin/env node
// @ts-nocheck
// 방봄 화면(/)을 헤드리스 Edge(Chromium)로 눌러 보는 검사.
// 쓰는 법:  node scripts/e2e-bangbom.mjs [주소] [--ai] [--shots <폴더>]
//   주소    기본 http://localhost:4180  (개발 서버는 http://localhost:5180)
//   --ai    상담에 실제 AI 질문을 한 번 보낸다 (주지 않으면 서랍만 열어 본다)
//   --shots 화면 캡처(PNG)를 그 폴더에 남긴다
// PC(1440x900)는 마우스로, 휴대폰(390x844, 360x740)은 크기 흉내 + 합성 터치로 누른다. 사파리가 아니라 Chromium 이다.
// 모든 화면은 주소에 tutorial=0 을 붙여 연다 (시작 화면과 튜토리얼이 검사를 가로막지 않게). 상담(AI) 질문은 --ai 를 줄 때만 보낸다.
// 실패가 하나라도 있으면 종료 코드 1.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const AI = args.includes('--ai')
const shotAt = args.indexOf('--shots')
const SHOTS = shotAt >= 0 ? args[shotAt + 1] : ''
// --shots 가 없을 때(shotAt = -1) 첫 인자(주소)를 건너뛰지 않게 한다
const BASE = (args.find((a, i) => !a.startsWith('--') && (shotAt < 0 || i !== shotAt + 1)) || 'http://localhost:4180').replace(/\/$/, '')
const EDGE = [process.env.EDGE_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify
const rows = []
const notes = []
const errors = []
let step = '시작'

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
  const fur = (slot) => { try { const p = JSON.parse(localStorage.getItem('bangkkumi2.project' + (slot ? '.' + slot : '')) || 'null'); if (!p) return null; const room = (p.rooms || []).find((r) => r.id === p.activeRoomId) || (p.rooms || [])[0]; return room ? room.furniture.map((x) => x.name) : null } catch (e) { return 'ERR ' + e.message } }
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
    // 화면에 보이고 가려지지 않은 단지 이름표. lit 이면 불이 켜진(요건 충족·확인 필요) 단지만: 계산 내역이 있는 카드가 필요할 때
    label(name, lit) {
      const all = [...document.querySelectorAll('.clabel')]
      if (name) return all.find((b) => b.getAttribute('aria-label') === name) || null
      const free = (b) => { const r = b.getBoundingClientRect(); if (!r.width || r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) return false; const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === b || b.contains(t)) }
      return all.find((b) => free(b) && (!lit || /is-on|is-dim/.test(b.className))) || null
    },
    // 그 자리의 맨 위 요소가 이 요소인지 (다른 것에 가려지지 않았는지)
    free(el) { if (!vis(el)) return false; const r = el.getBoundingClientRect(), t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === el || el.contains(t)) },
    // 낱말 가운데에서 줄이 바뀐 곳의 수 (보이는 글자만). 붙어 있는 두 글자(한글·영문·숫자)가 서로 다른 줄에 있으면 센다.
    // "전세자금대출 / (시연용)"처럼 괄호 앞에서 바뀐 것은 세지 않는다
    midBreaks(root) {
      if (!root) return -1
      let n = 0; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), r = document.createRange(), L = /[\p{L}\p{N}]/u
      const top = (t, i) => { r.setStart(t, i); r.setEnd(t, i + 1); const b = r.getClientRects()[0]; return b ? b.top : null }
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        if (!vis(t.parentElement)) continue
        for (let i = 1; i < t.data.length; i++) { if (!L.test(t.data[i - 1]) || !L.test(t.data[i])) continue; const a = top(t, i - 1), b = top(t, i); if (a != null && b != null && Math.abs(b - a) > 8) n++ }
      }
      return n
    },
    // 글자색과 그 뒤 바탕색의 대비 (WCAG 식)
    contrast(el) {
      const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number), f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]) }
      let b = el, bg = ''
      while (b && /^rgba\(.*, 0\)$|transparent/.test(bg = getComputedStyle(b).backgroundColor)) b = b.parentElement
      const a = lum(getComputedStyle(el).color), c = lum(bg || 'rgb(255,255,255)')
      return Math.round((Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05) * 100) / 100
    },
    // 손가락이 닿는 높이: 가운데 세로줄에서 그 단추가 받는 구간(::after 로 넓힌 것까지)
    touchH(el) {
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2; let top = r.top, bot = r.bottom
      for (let y = r.top; y > r.top - 12; y--) { const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) top = y; else break }
      for (let y = r.bottom - 1; y < r.bottom + 12; y++) { const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) bot = y + 1; else break }
      return Math.round(bot - top)
    },
    frame() {
      const f = document.querySelector('#kkumiFrame'); if (!f || !f.getAttribute('src')) return null
      const u = new URL(f.src, location.href), q = u.searchParams, d = f.contentDocument
      let live = ''; try { live = f.contentWindow.location.pathname + f.contentWindow.location.search } catch (e) { live = 'ERR ' + e.message }
      const slot = q.get('slot'), liveSlot = new URLSearchParams(live.split('?')[1] || '').get('slot'), r = f.getBoundingClientRect()
      return { path: u.pathname, embed: q.get('embed'), slot, w: q.get('w'), d: q.get('d'), kind: q.get('kind'), op: q.get('op'), view: q.get('view'), eye: q.get('eye'), liveSlot,
        ready: !!d && d.readyState === 'complete' && !!d.querySelector('#root') && d.querySelector('#root').children.length > 0,
        fur: fur(liveSlot), top: Math.round(r.top), bottom: Math.round(r.bottom), wpx: Math.round(r.width), pressed: txt(document.querySelector('#hvRooms button[aria-pressed="true"]')) }
    },
    over() { const de = document.documentElement; return { iw: innerWidth, ih: innerHeight, docW: de.scrollWidth, bodyW: document.body.scrollWidth } },
    // 서로 겹치는 쌍 (보이는 것만)
    clash(sels) {
      const rs = sels.map((s) => [s, rect(s)]).filter((x) => x[1]), out = []
      for (let i = 0; i < rs.length; i++) for (let k = i + 1; k < rs.length; k++) { const a = rs[i][1], b = rs[k][1]; if (Math.min(a.r, b.r) - Math.max(a.x, b.x) > 1 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 1) out.push(rs[i][0] + ' × ' + rs[k][0]) }
      return out
    },
    panes() { return [...document.querySelectorAll('#panelR [data-pane]')].filter(vis).map((e) => e.dataset.pane) },
    fields() { return [...document.querySelectorAll('#form .f')].filter(vis).map((f) => { const i = f.querySelector('input'); return i ? i.id : (f.querySelector('.seg') ? f.querySelector('.seg').dataset.k : 'prio') }) },
  }
  // 지도(WebGL)가 그리는 횟수를 센다: 가려진 동안에는 그리지 않는지 보려고
  window.__gl = 0
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) { if (!P) continue; for (const k of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) { const f = P.prototype[k]; if (f) P.prototype[k] = function () { window.__gl++; return f.apply(this, arguments) } } }
  // "WebGL 을 못 쓰는 브라우저" 흉내: sessionStorage 에 e2e-nogl 이 있으면 WebGL 화면을 만들지 못하게 한다
  try { if (sessionStorage.getItem('e2e-nogl')) { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : g.call(this, t, ...a) } } } catch (e) {}
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
  // 진짜로 누른다(PC 는 마우스, 휴대폰은 터치). 가려져 있으면 실패로 본다
  const tap = async (expr, label) => {
    // 화면 전환 효과(view transition) 중에는 잠깐 아무것도 안 잡힌다: 최대 1.5초 동안 다시 본다
    let p = await ev(`__q.pt(${expr})`)
    for (let i = 0; i < 10 && p && !p.hit; i++) { await sleep(150); p = await ev(`__q.pt(${expr})`) }
    if (!p) throw new Error(`${label}: 화면에서 찾지 못했어요`)
    if (!p.hit) throw new Error(`${label}: 누를 자리(${Math.round(p.x)},${Math.round(p.y)})가 ${p.by} 에 가려져 있어요`)
    if (touch) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] }); await sleep(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
    else for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 })
    await sleep(260)
    return p
  }
  const swipe = async (x0, y0, x1, y1) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] })
    for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 8, y: y0 + (y1 - y0) * i / 8 }] }); await sleep(24) }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(450)
  }
  const check = async (what, fn) => { step = what; let row; try { const r = await fn(); row = { what, ok: !!r.ok, evidence: r.evidence } } catch (e) { row = { what, ok: false, evidence: '오류: ' + e.message } } rows.push(row); console.log(`${row.ok ? 'OK  ' : 'FAIL'} ${what} :: ${row.evidence}`) }
  const q = (sel) => `document.querySelector(${J(sel)})`
  const roomBtn = (name) => `[...document.querySelectorAll('#hvRooms button')].find(b => __q.txt(b) === ${J(name)})`
  const openCard = async (lit) => {
    const open = `document.querySelector('#panelR').classList.contains('is-open')`
    const find = `(() => { const b = __q.label('', ${!!lit}); return b ? b.getAttribute('aria-label') : null })()`
    let name = await waitFor(find, '보이는 단지 이름표', 2500).catch(() => null)
    // 지도를 옮겨서 보이는 이름표가 없으면 구 바로가기 칩으로 단지가 있는 곳으로 간다
    if (!name) { await tap(q('#dnav button'), '구 바로가기 칩'); await sleep(1500); name = await waitFor(find, '보이는 단지 이름표', 6000) }
    await tap(`__q.label(${J(name)})`, '단지 이름표')
    await waitFor(open, '단지 카드', 4000); await sleep(900)
    return name
  }
  const waitFrame = async (wantSlotNot) => { await waitFor(`(() => { const f = __q.frame(); return !!f && f.slot !== ${J(wantSlotNot || '')} && f.liveSlot === f.slot && f.ready })()`, 'iframe 안 방 배치 도구', 20000); await sleep(900); return ev('__q.frame()') }
  // 시작 화면과 튜토리얼이 뜨지 않게 늘 tutorial=0 을 붙여 연다. 그 뒤에는 # 만 바꾸므로 이 값이 주소에 계속 남는다
  // chat=0: 24시간 상담을 집찾기 대화로 바꾸지 않고 예전 상담 서랍을 그대로 검사한다 (집찾기 대화는 e2e-chat.mjs 가 본다)
  const HOME = BASE + '/?tutorial=0&chat=0'
  // 저장된 조건을 지우고 새로 연다 (주소의 # 만 바꾸면 화면을 다시 읽지 않으므로 새로 고침을 한다)
  const fresh = async (hash) => { await nav(HOME); await ev('localStorage.clear()'); await loadThen(() => cdp.send('Page.reload')); await ev('location.hash = ' + J(hash)); await sleep(900) }
  // 예시 페르소나의 조건이 저장된 채로 지도부터 연다 (첫 화면이 지도면 판정 모드로 열린다)
  const PERSONA = { age: 27, monthly_income: 250, annual_income_gross: null, assets: 1000, homeless: true, lives_with_parents: false, daegu_resident_or_moving: true, monthly_budget: 60, priorities: [] }
  const persona = async () => { await nav(HOME); await ev(`localStorage.clear(); localStorage.setItem('mh-profile', ${J(J(PERSONA))}); location.hash = '#map'`); await loadThen(() => cdp.send('Page.reload')); await sleep(2200) }
  // 열린 상담 서랍과 단지 카드를 닫고 지도로 돌아온다 (앞 검사가 어디서 끝났든 같은 자리에서 시작하게)
  const calm = async () => { await ev(`(() => { const d = document.querySelector('#drawer'), p = document.querySelector('#panelR'); if (d.classList.contains('is-open')) document.querySelector('#drClose').click(); if (p.classList.contains('is-open')) document.querySelector('#ccX').click(); if (location.hash !== '#map') location.hash = '#map' })()`); await sleep(1300) }
  const key = async (k, vk) => { for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await sleep(70) }
  // 칸을 비우고 글자를 하나씩 친다 (input 이벤트가 진짜처럼 난다)
  const typeIn = async (sel, text) => { await ev(`(() => { const i = ${q(sel)}; i.focus(); i.value = '' })()`); for (const ch of String(text)) await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: ch }); await sleep(80) }
  // 조건 입력 8문항을 한 칸씩 채운다 (선택형은 누르면 다음으로 넘어간다). 금액은 원 단위
  const fillAll = async () => {
    const next = async () => { await waitFor(`(__q.pt(${q('#stNext')}) || {}).hit`, '다음 단추가 눌릴 수 있게', 5000); await tap(q('#stNext'), '다음'); await sleep(250) }
    await typeIn('#f-age', 27); await next()
    await typeIn('#f-income', 2500000); await next()
    await next() // 세전 연소득(선택) 비움
    await typeIn('#f-assets', 10000000); await next()
    for (const k of ['homeless', 'lives_with_parents', 'daegu_resident_or_moving']) { await tap(`${q('.seg[data-k="' + k + '"]')}.querySelector('button.is-on') || ${q('.seg[data-k="' + k + '"] button')}`, k); await sleep(400) }
    await typeIn('#f-budget', 600000)
  }
  // ms 동안 지도가 그린 횟수
  const gl = async (ms = 450) => { const a = await ev('__gl'); await sleep(ms); return (await ev('__gl')) - a }
  // 계산 내역 표의 합계 줄과 그 윗줄의 칸 자리
  const calcRow = `(() => { const rows = [...document.querySelectorAll('#panelR .calc tr')]; if (rows.length < 2) return null; const c = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)] }; const tot = rows[rows.length - 1], prev = rows[rows.length - 2]; return { disp: getComputedStyle(tot).display, tot: [...tot.children].map(c), prev: [...prev.children].map(c), table: c(document.querySelector('#panelR .calc')) } })()`
  const calcOk = (r) => !!r && r.disp === 'table-row' && r.tot.length === 2 && Math.abs(r.tot[1][1] - r.prev[1][1]) <= 1 && Math.abs(r.tot[0][0] - r.table[0]) <= 1 && Math.abs(r.tot[1][1] - r.table[1]) <= 1
  // WebGL 을 못 쓰는 브라우저 흉내 (helpers 의 e2e-nogl). 지도 자리에 안내가 나오고 조건 입력과 집 보기는 열려야 한다
  const noGl = async (P, w) => check(`${P} WebGL 을 못 쓸 때: 지도 자리에 안내, 조건 입력과 집 보기는 열림`, async () => {
    try {
      await nav(HOME); await ev(`localStorage.clear(); sessionStorage.setItem('e2e-nogl', '1'); location.hash = '#input'`); await loadThen(() => cdp.send('Page.reload'))
      const a = await ev(`({ gl: !!document.createElement('canvas').getContext('webgl'), form: __q.free(${q('#f-age')}), fields: __q.fields().length })`)
      await ev(`location.hash = '#map'`); await sleep(900)
      const b = await ev(`({ msg: __q.txt(${q('#mapWrap .map-fail')}), box: __q.rect('#mapWrap .map-fail span'), free: __q.free(${q('#mapWrap .map-fail span')}), panel: __q.vis(${q('#panelL')}), clash: __q.clash(['#mapWrap .map-fail span', '#panelL', '#dnav', '#nav', '#fab', '#mh .notice']), over: __q.over() })`)
      await shot(`nogl-${w}-map`)
      await ev(`location.hash = '#house'`); await sleep(900)
      const c = await ev(`${q('#houseView')}.classList.contains('is-on') && __q.vis(${q('#houseView')})`)
      const ok = !a.gl && a.form && a.fields >= 1 && /지도를 그릴 수 없어요/.test(b.msg) && !!b.box && b.free && b.panel && b.clash.length === 0 && b.over.docW <= w && c
      return { ok, evidence: `WebGL 됨=${a.gl}, 조건 입력 칸 보임=${a.form}(${a.fields}칸), 지도 안내="${b.msg.slice(0, 40)}…" 자리 ${b.box ? `y=${b.box.y}~${b.box.b}` : '없음'} 가려지지 않음=${b.free} 겹침=${J(b.clash)}, 왼쪽 패널 보임=${b.panel}, 집 보기 열림=${c}` }
    } finally { await ev(`sessionStorage.removeItem('e2e-nogl')`).catch(() => {}) }
  })

  // ═════════ PC 1440x900 (마우스) ═════════
  await size(1440, 900, false)
  await check('PC 1. 조건 입력: 한 문항씩(8문항) → 금액 쉼표 → 판정 결과 보기 → 지도', async () => {
    await fresh('#input')
    const a = await ev(`({ fields: __q.fields(), no: __q.txt(${q('#stpNo')}), persona: !!${q('#fillPersona')}, tabbar: __q.vis(${q('.tabbar')}) })`)
    await shot('pc-input')
    await fillAll()
    const money = await ev(`[${q('#f-income')}.value, ${q('#f-assets')}.value, ${q('#f-budget')}.value]`)
    await tap(q('#stSubmit'), '판정 결과 보기')
    await waitFor(`location.hash === '#map'`, '#map', 6000); await sleep(1800)
    const bar = await ev(`__q.txt(${q('#panelL .bar3-txt')})`), top = await ev(`__q.txt(${q('#topRight')})`)
    const ok = J(a.fields) === J(['f-age']) && a.no === '1 / 8' && !a.persona && J(money) === J(['2,500,000', '10,000,000', '600,000']) && /요건 충족 \d+ · .*확인 필요 \d+ · .*미충족 \d+/.test(bar) && top.includes('조건 바꾸기')
    return { ok, evidence: `보이는 칸 ${J(a.fields)} 진행 "${a.no}", 예시 단추 있음=${a.persona}, 금액 칸=${J(money)}, 왼쪽 패널="${bar}", 오른쪽 위="${top}"` }
  })
  let living = null
  await check('PC 2. 단지 카드(접는 목록) → 집 보기', async () => {
    const name = await openCard(); await shot('pc-card')
    const c = await ev(`({ chips: __q.vis(${q('#panelR .cc-chips')}), folds: [...document.querySelectorAll('#panelR details.fold')].map(d => __q.txt(d.querySelector('summary')) + (d.open ? '(열림)' : '')), plan: __q.vis(${q('#panelR .cc-plan')}), btns: __q.txt(${q('#panelR .cc-btns')}) })`)
    await tap(q('#ccHouse'), '집 보기 →'); await waitFor(`location.hash === '#house'`, '#house', 5000); await tap(q('#hvOver .hvo-list button[data-room="liv"]'), '전체 구조에서 거실'); await waitFor(`location.hash === '#house/liv'`, '#house/liv', 5000)
    living = await waitFrame('')
    return { ok: !c.chips && c.folds.length >= 5 && c.folds.every((t) => !t.includes('(열림)')) && c.plan && living.path.endsWith('/room.html') && living.embed === '1' && +living.w > 0 && !!living.op && !living.eye, evidence: `단지="${name}", 칩 줄 보임=${c.chips}, 접는 목록=${J(c.folds)}, 단추="${c.btns}", iframe=${J(living)}` }
  })
  await check('PC 3. 집 보기: 방 바꾸기 → 방마다 따로 저장 → 상담 단추', async () => {
    await shot('pc-house')
    const rooms = await ev(`[...document.querySelectorAll('#hvRooms button')].map(b => __q.txt(b))`)
    await tap(roomBtn('안방'), '안방'); const master = await waitFrame(living.slot)
    const keep = await ev(`__q.fur(${J(living.slot)})`)
    await tap(q('#hvConsult'), '상담'); await waitFor(`${q('#drawer')}.classList.contains('is-open')`, '상담 서랍', 3000); await sleep(400)
    const dr = await ev(`__q.rect('#drawer')`); await tap(q('#drClose'), '상담 닫기'); await sleep(400)
    const ok = rooms.length >= 2 && master.slot !== living.slot && Array.isArray(master.fur) && Array.isArray(keep) && J(keep) === J(living.fur) && !!dr && dr.w <= 420
    return { ok, evidence: `방 단추=${J(rooms)}, 안방 칸=${master.slot} 가구=${J(master.fur)}, 거실 칸(${living.slot}) 가구 그대로=${J(keep)}, 상담 서랍 폭 ${dr ? dr.w : '없음'}px` }
  })
  await check('PC 4. ← 지도로 → 브라우저 뒤로 가기', async () => {
    await tap(q('#hvBack'), '← 지도로'); await waitFor(`location.hash === '#map'`, '#map', 4000)
    await ev('history.back()'); await sleep(1500)
    const h = await ev('location.hash'), f = await ev('__q.frame()')
    return { ok: h.startsWith('#house/') && !!f && f.pressed === '안방', evidence: `뒤로 한 번 → hash=${h}, 눌린 방="${f ? f.pressed : ''}", iframe 칸=${f ? f.liveSlot : ''}` }
  })

  // ── 여기부터는 앞 검사가 어디서 끝났든 예시 조건을 저장하고 지도부터 다시 열어서 본다 (집 보기 검사가 실패해도 영향이 없게) ──
  const drOpen = `${q('#drawer')}.classList.contains('is-open')`
  await persona()
  await check('PC 5. 단지 카드 계산 내역: 합계 줄이 금액 칸에 맞고 표 폭을 다 채움', async () => {
    const name = await openCard(true)
    await ev(`(() => { const d = document.querySelector('#panelR details[data-pane="calc"]'); d.open = true; d.scrollIntoView({ block: 'center' }) })()`); await sleep(300)
    const r = await ev(calcRow); await shot('pc-card-calc')
    return { ok: calcOk(r), evidence: `단지="${name}", 합계 줄 display=${r && r.disp}, 합계 줄 칸 x=${J(r && r.tot)}, 윗줄 칸 x=${J(r && r.prev)}, 표 x=${J(r && r.table)}` }
  })
  await check('PC 6. 닫힌 상담 서랍·단지 카드: 숨겨져서 Tab 이 멈추지 않고, Escape 로 닫히며 초점이 돌아옴', async () => {
    await calm()
    const hid = await ev(`({ drawer: getComputedStyle(${q('#drawer')}).visibility, card: getComputedStyle(${q('#panelR')}).visibility })`)
    await ev('document.activeElement && document.activeElement.blur()')
    const seen = []
    for (let i = 0; i < 36; i++) { await key('Tab', 9); seen.push(await ev(`(() => { const a = document.activeElement; if (!a || a === document.body) return 'body'; const r = a.getBoundingClientRect(), out = r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight; return (a.closest('#drawer') ? '서랍:' : a.closest('#panelR') ? '카드:' : out || !__q.vis(a) ? '안 보임:' : '') + (a.id || String(a.className).split(' ')[0] || a.tagName) })()`)) }
    const bad = seen.filter((s) => s.includes(':'))
    await tap(q('#fab'), '24시간 상담'); await waitFor(drOpen, '상담 서랍', 3000); await sleep(400)
    await key('Escape', 27); await sleep(500)
    const e1 = await ev(`({ open: ${drOpen}, focus: document.activeElement && document.activeElement.id })`)
    await openCard(); await ev(`${q('#ccHouse')}.focus()`); await key('Escape', 27); await sleep(500)
    const e2 = await ev(`({ open: ${q('#panelR')}.classList.contains('is-open'), focus: document.activeElement ? String(document.activeElement.className).split(' ')[0] : '' })`)
    const ok = hid.drawer === 'hidden' && hid.card === 'hidden' && bad.length === 0 && !e1.open && e1.focus === 'fab' && !e2.open && e2.focus === 'clabel'
    return { ok, evidence: `닫힌 서랍 visibility=${hid.drawer}·카드=${hid.card}, Tab 36번 중 보이지 않는 곳에 멈춤 ${bad.length}번${bad.length ? ' ' + J([...new Set(bad)]) : ''}, 서랍에서 Escape → 열림=${e1.open}·초점=#${e1.focus}, 카드에서 Escape → 열림=${e2.open}·초점=.${e2.focus}` }
  })
  await check('PC 7. 상담 서랍을 연 채 화면을 옮기면 닫힘, 안내 문구 대비 4.5:1 이상', async () => {
    await calm(); await tap(q('#fab'), '24시간 상담'); await waitFor(drOpen, '상담 서랍', 3000); await sleep(400)
    const cr = await ev(`__q.contrast(${q('#drawer .dr-note')})`)
    await ev(`location.hash = '#input'`); await sleep(800)
    const a = await ev(`({ open: ${drOpen}, submit: __q.free(${q('#stNext')}) })`); await shot('pc-input-after-drawer')
    await ev('history.back()'); await sleep(900)
    const b = await ev(`({ hash: location.hash, open: ${drOpen} })`)
    return { ok: !a.open && a.submit && b.hash === '#map' && !b.open && cr >= 4.5, evidence: `#input 으로 옮긴 뒤 서랍 열림=${a.open}·[다음] 가려지지 않음=${a.submit}, 뒤로 가기 → ${b.hash} 서랍 열림=${b.open}, 안내 문구 대비 ${cr}:1` }
  })
  await check('PC 8. 한글이 낱말 가운데에서 줄바꿈되지 않음 (판정 패널, 홈 첫 문단), 펼친 뒤 초점 유지', async () => {
    await calm(); await tap(q('#jpFold'), '대출·지원 보기'); await sleep(300)
    const p = await ev(`({ n: __q.midBreaks(${q('#panelL')}), sw: ${q('#panelL')}.scrollWidth, cw: ${q('#panelL')}.clientWidth, focus: document.activeElement && document.activeElement.id })`); await shot('pc-panel-open')
    await tap(q('#jpFold'), '접기')
    await ev(`location.hash = '#home'`); await sleep(1300); await ev('scrollTo(0, 0)'); await sleep(300)
    const h = await ev(`({ n: __q.midBreaks(${q('#page-home .hero')}), len: __q.txt(${q('.hero__desc')}).length })`); await shot('pc-home')
    await ev(`location.hash = '#map'`); await sleep(1100)
    return { ok: p.n === 0 && h.n === 0 && h.len > 10 && p.sw <= p.cw && p.focus === 'jpFold', evidence: `낱말 가운데 줄바꿈: 판정 패널 ${p.n}곳(가로 ${p.sw}/${p.cw}), 홈 첫 화면 ${h.n}곳, [대출·지원 보기]를 누른 뒤 초점=#${p.focus}` }
  })
  await size(834, 1194, false)
  await check('태블릿 834x1194(마우스). 구 칩과 오른쪽 위 단추가 겹치지 않음', async () => {
    await calm()
    const a = await ev(`({ clash: __q.clash(['#dnav', '#topRight']), dnav: __q.rect('#dnav'), right: __q.rect('#topRight'), btns: __q.txt(${q('#topRight')}), over: __q.over() })`); await shot('tablet-834-map')
    return { ok: a.clash.length === 0 && !!a.dnav && !!a.right && a.btns.includes('조건 바꾸기') && a.over.docW <= 834, evidence: `겹침=${J(a.clash)}, 구 칩 x=${a.dnav ? a.dnav.x + '~' + a.dnav.r : '없음'}, 오른쪽 단추("${a.btns}") x=${a.right ? a.right.x + '~' + a.right.r : '없음'}` }
  })
  await size(600, 800, false)
  await check('좁은 PC 창 600x800(마우스). 평면 줄의 앞뒤 단추와 빠른 질문 모두에 닿음', async () => {
    await ev(`location.hash = '#home'`); await sleep(1300)
    await ev(`${q('#plansTrack')}.scrollIntoView({ block: 'center' })`); await sleep(900)
    const x0 = await ev(`${q('#plansTrack')}.scrollLeft`); await tap(q('#plansNext'), '다음 구조'); await sleep(800); const x1 = await ev(`${q('#plansTrack')}.scrollLeft`); await shot('narrow-600-plans')
    await ev(`location.hash = '#map'`); await sleep(1500)
    await tap(q('#fab'), '24시간 상담'); await waitFor(drOpen, '상담 서랍', 3000); await sleep(500)
    const d = await ev(`(() => { const b = [...document.querySelectorAll('#drQuick button')]; return { n: b.length, reach: b.filter(x => { const r = x.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && __q.free(x) }).length, form: __q.rect('#drForm') } })()`); await shot('narrow-600-drawer')
    await tap(q('#drClose'), '상담 닫기'); await sleep(400)
    return { ok: x1 > x0 && d.n === 5 && d.reach === 5 && !!d.form && d.form.b <= 800, evidence: `평면 줄 [다음]으로 ${x0}→${x1}px, 빠른 질문 ${d.n}개 중 닿는 것 ${d.reach}개, 상담 입력 칸 아래 끝 ${d.form ? d.form.b : '없음'}px` }
  })
  await size(1440, 900, false)
  await noGl('PC 9.', 1440)

  // ═════════ 휴대폰 (크기 흉내 + 합성 터치) ═════════
  for (const [w, h] of [[390, 844], [360, 740]]) {
    const P = `휴대폰 ${w}x${h}`
    await size(w, h, true)
    await check(`${P} 1. 조건 입력 첫 문항이 한 화면에`, async () => {
      await fresh('#input')
      const a = await ev(`({ over: __q.over(), fields: __q.fields(), no: __q.txt(${q('#stpNo')}), tabbar: __q.vis(${q('.tabbar')}), btns: [...document.querySelectorAll('.form-btns button')].filter(__q.vis).map(b => __q.txt(b)), btnBottom: __q.rect('.form-btns').b, inFs: getComputedStyle(${q('#f-age')}).fontSize, nextTouch: __q.touchH(${q('#stNext')}) })`)
      await shot(`m${w}-input-1`)
      const ok = a.over.docW <= w && J(a.fields) === J(['f-age']) && a.no === '1 / 8' && !a.tabbar && J(a.btns) === J(['이전', '다음']) && a.btnBottom <= h && parseFloat(a.inFs) >= 16 && a.nextTouch >= 44
      return { ok, evidence: `가로 ${a.over.docW}/${w}, 보이는 칸=${J(a.fields)} 진행 "${a.no}", 아래 탭 막대 보임=${a.tabbar}, 단추=${J(a.btns)} 아래 끝 ${a.btnBottom}px, [다음] 닿는 높이 ${a.nextTouch}px, 입력 글자 ${a.inFs}` }
    })
    await check(`${P} 2. 빈 값으로 다음 → 알림, 채우면 8문항 → 지도`, async () => {
      await tap(q('#stNext'), '다음'); const e1 = await ev(`({ no: __q.txt(${q('#stpNo')}), err: __q.txt(${q('#e-age')}), focus: document.activeElement && document.activeElement.id })`)
      await ev('document.activeElement && document.activeElement.blur()')
      await fillAll()
      const last = await ev(`({ no: __q.txt(${q('#stpNo')}), btns: [...document.querySelectorAll('.form-btns button')].filter(__q.vis).map(b => __q.txt(b)), over: __q.over() })`); await shot(`m${w}-input-8`)
      await tap(q('#stSubmit'), '판정 결과 보기'); await waitFor(`location.hash === '#map'`, '#map', 6000); await sleep(2200)
      const ok = e1.no === '1 / 8' && !!e1.err && e1.focus === 'f-age' && last.no === '8 / 8' && J(last.btns) === J(['이전', '판정 결과 보기']) && last.over.docW <= w
      return { ok, evidence: `빈 값: 진행 "${e1.no}", 알림="${e1.err}", 커서=${e1.focus} / 마지막 진행 "${last.no}" 단추=${J(last.btns)} / hash=${await ev('location.hash')}` }
    })
    await check(`${P} 3. 지도: 한 줄 요약·펼치기, 겹침 없음, 가로 스크롤 없음`, async () => {
      const a = await ev(`({ over: __q.over(), line: __q.txt(${q('#jpLine span')}), panel: __q.rect('#panelL'), clash: __q.clash(['#dnav', '#panelL', '#fab', '#mapHint', '#mh .notice', '.tabbar', '.nav']), dnavTouch: __q.touchH(${q('#dnav button')}), topRight: __q.vis(${q('#topRight')}), canvas: __q.rect('#mapCanvas'), fab: __q.rect('#fab'), notice: __q.rect('#mh .notice'), hint: __q.rect('#mapHint') })`)
      await shot(`m${w}-map`)
      await tap(q('#jpLine'), '펼치기'); const open = await ev(`({ list: __q.vis(${q('#panelL .jp-list')}), rows: document.querySelectorAll('#panelL .jp-row').length, btns: [...document.querySelectorAll('#panelL .jp-btns button')].filter(__q.vis).map(b => __q.txt(b)), panel: __q.rect('#panelL') })`); await shot(`m${w}-map-open`)
      await tap(q('#jpLine'), '접기'); const shut = await ev(`__q.vis(${q('#panelL .jp-list')})`)
      const ok = a.over.docW <= w && a.over.bodyW <= w && /^요건 충족 \d+ · 확인 필요 \d+ · 미충족 \d+$/.test(a.line) && a.panel.h <= 56 && a.clash.length === 0 && a.dnavTouch >= 44 && !a.topRight && a.canvas.w === w && a.canvas.h === h && open.list && open.rows >= 3 && open.btns.includes('조건 바꾸기') && open.panel.b <= h - 64 && !shut
      return { ok, evidence: `가로 ${a.over.docW}/${w}, 요약="${a.line}" 높이 ${a.panel.h}px(위 ${a.panel.y}), 겹침=${J(a.clash)}, 구 칩 닿는 높이 ${a.dnavTouch}px, 지도 ${a.canvas.w}x${a.canvas.h}, 상담 단추 y=${a.fab.y}~${a.fab.b}, 안내 y=${a.notice.y}~${a.notice.b}, 펼침: 목록 ${open.rows}줄 단추=${J(open.btns)} 아래 끝 ${open.panel.b}px, 다시 접힘=${!shut}` }
    })
    let cardName = ''
    await check(`${P} 4. 단지 카드 아래 시트: 높이, 칩으로 한 항목씩, 위쪽 지도 끌기, 끌어서 닫기`, async () => {
      cardName = await openCard()
      const s = await ev(`({ sheet: __q.rect('#panelR'), chips: [...document.querySelectorAll('#panelR .cc-chips button')].map(b => b.dataset.tab), panes: __q.panes(), x: __q.rect('#ccX'), btns: [...document.querySelectorAll('#panelR .cc-btns .btn')].filter(__q.vis).map(b => __q.txt(b)), btnsB: __q.rect('#panelR .cc-btns').b, over: __q.over(), sel: __q.rect('.clabel.is-sel'), chipTouch: __q.touchH(${q('#panelR .cc-chips button')}), fab: __q.vis(${q('#fab')}), top: __q.vis(${q('#panelL')}), head: __q.rect('#panelR .cc-top').h })`)
      await shot(`m${w}-card`)
      const seen = []
      // 칩을 바꿔도 시트 머리(이름·칩 줄)는 제자리에 있고, 고른 항목은 칩 줄 아래에 보여야 한다
      const chipY = [], below = []
      for (const t of s.chips) {
        await tap(`${q('#panelR .cc-chips')}.querySelector('[data-tab="${t}"]')`, '칩 ' + t); seen.push(t + '→' + (await ev('__q.panes()')).join('+'))
        const g = await ev(`({ chips: __q.rect('#panelR .cc-chips'), pane: __q.rect([...document.querySelectorAll('#panelR [data-pane]')].find(__q.vis)) })`)
        chipY.push(g.chips.y); below.push(!!g.pane && g.pane.y >= g.chips.b - 1)
        if (t === 'calc' || t === 'plan') await shot(`m${w}-card-${t}`)
      }
      const steady = chipY.every((y) => y === chipY[0]) && below.every(Boolean)
      await tap(`${q('#panelR .cc-chips')}.querySelector('[data-tab="sum"]')`, '칩 요약')
      // 시트 위쪽 지도를 가로로 끈다 → 고른 단지 이름표가 따라 움직여야 한다
      const y = Math.round((72 + s.sheet.y) / 2), l0 = await ev(`__q.rect('.clabel.is-sel')`)
      await swipe(w / 2 + 60, y, w / 2 - 60, y); const l1 = await ev(`(() => { const e = document.querySelector('.clabel.is-sel'); const r = e.getBoundingClientRect(); return { x: Math.round(r.left) } })()`)
      // 시트 머리를 아래로 끌어 닫는다
      await swipe(w / 2 - 40, s.sheet.y + 14, w / 2 - 40, s.sheet.y + 190); const closed = !(await ev(`${q('#panelR')}.classList.contains('is-open')`))
      const one = seen.every((x) => { const [a, b] = x.split('→'); return a === b })
      const ok = s.sheet.h <= h * 0.67 && s.sheet.h >= h * 0.5 && s.sheet.y >= h * 0.3 && s.chips.length >= 3 && J(s.panes) === J(['sum']) && one && steady && s.x.w >= 44 && s.x.h >= 44 && s.btns[0].startsWith('집 보기') && s.btns.length === 2 && s.btnsB <= h - 64 + 1 && s.over.docW <= w && !!s.sel && s.sel.b <= s.sheet.y + 4 && s.chipTouch >= 44 && !s.fab && s.head <= 96 && Math.abs(l1.x - l0.x) > 40 && closed
      return { ok, evidence: `단지="${cardName}", 시트 y=${s.sheet.y} 높이 ${s.sheet.h}px(화면의 ${Math.round(s.sheet.h / h * 100)}%, 탭 막대 포함 ${Math.round((h - s.sheet.y) / h * 100)}%), 칩=${J(s.chips)} 닿는 높이 ${s.chipTouch}px, 칩→보이는 항목 ${J(seen)}, 칩 줄 y=${[...new Set(chipY)].join('/')}(항목마다 같아야 함)·항목이 칩 줄 아래=${below.every(Boolean)}, 시트 머리 높이 ${s.head}px, 닫기 ${s.x.w}x${s.x.h}, 단추=${J(s.btns)}, 고른 이름표 아래 끝 ${s.sel ? s.sel.b : '없음'}px(시트 위), 지도 끌기: 이름표 x ${l0.x}→${l1.x}, 머리 끌어 닫힘=${closed}` }
    })
    await check(`${P} 5. 집 보기: 아래 탭 막대 숨김, 위쪽 두 줄, 가로 스크롤 없음`, async () => {
      await openCard(); await tap(q('#ccHouse'), '집 보기 →'); await waitFor(`location.hash === '#house'`, '#house', 5000); await tap(q('#hvOver .hvo-list button[data-room="liv"]'), '전체 구조에서 거실'); await waitFor(`location.hash === '#house/liv'`, '#house/liv', 5000)
      const f = await waitFrame('')
      const a = await ev(`({ over: __q.over(), tabbar: __q.vis(${q('.tabbar')}), nav: __q.vis(${q('#nav')}), plan: (() => { const d = ${q('#kkumiFrame')}.contentDocument, s = d && d.querySelector('svg[role="application"]'); return s ? Math.round(s.getBoundingClientRect().height) : 0 })(), top: __q.rect('#mh .hv-top'), back: __q.rect('#hvBack'), title: __q.rect('#hvTitle b'), name: __q.txt(${q('#hvTitle b')}), cut: (() => { const b = ${q('#hvTitle b')}; return b.scrollWidth > b.clientWidth + 1 })(), consult: __q.rect('#hvConsult'), rooms: __q.rect('#hvRooms'), roomTouch: __q.touchH(${q('#hvRooms button')}), backTouch: __q.touchH(${q('#hvBack')}), mode: document.body.classList.contains('house-mode'), fab: __q.vis(${q('#fab')}) })`)
      await shot(`m${w}-house`)
      const row1 = a.back && a.title && a.consult && Math.abs((a.back.y + a.back.h / 2) - (a.consult.y + a.consult.h / 2)) < 3 && a.rooms.y >= a.back.b - 2
      const ok = a.over.docW <= w && a.over.bodyW <= w && a.mode && !a.tabbar && !a.nav && a.top.y === 0 && a.top.h <= 112 && row1 && !a.cut && f.top <= 112 && f.bottom >= h - 1 && f.wpx === w && a.plan >= h * 0.38 && a.roomTouch >= 44 && a.backTouch >= 44 && !a.fab
      return { ok, evidence: `가로 ${a.over.docW}/${w}, house-mode=${a.mode}, 탭 막대 보임=${a.tabbar}, 방봄 위 막대 보임=${a.nav}, 평면도 높이 ${a.plan}px(화면의 ${Math.round(a.plan / h * 100)}%), 위쪽 틀 y=${a.top.y} 높이 ${a.top.h}px, 이름="${a.name}" 잘림=${a.cut}, 방 칩 y=${a.rooms.y} 닿는 높이 ${a.roomTouch}px, iframe y=${f.top}~${f.bottom} (화면 ${h}) 폭 ${f.wpx}, 칸=${f.liveSlot}` }
    })
    await check(`${P} 6. 집 보기에서 상담 열기: 전체 높이, 빠른 질문 한 줄`, async () => {
      await tap(q('#hvConsult'), '상담'); await waitFor(`${q('#drawer')}.classList.contains('is-open')`, '상담 서랍', 3000); await sleep(500)
      const d = await ev(`({ dr: __q.rect('#drawer'), quick: (() => { const b = [...document.querySelectorAll('#drQuick button')]; const row = ${q('#drQuick')}; return { n: b.length, tops: [...new Set(b.map(x => Math.round(x.getBoundingClientRect().top)))].length, scroll: row.scrollWidth > row.clientWidth, touch: __q.touchH(b[0]) } })(), msgFs: getComputedStyle(${q('#drBody .msg')}).fontSize, qFs: getComputedStyle(${q('#drQuick button')}).fontSize, inFs: getComputedStyle(${q('#drIn')}).fontSize, form: __q.rect('#drForm'), x: __q.rect('#drClose'), over: __q.over() })`)
      await shot(`m${w}-drawer`)
      const x0 = await ev(`${q('#drQuick')}.scrollLeft`); await swipe(w - 40, d.form.y - 30, 60, d.form.y - 30); const x1 = await ev(`${q('#drQuick')}.scrollLeft`)
      await sleep(700) // 밀던 힘으로 줄이 아직 움직이는 동안 누르면 멈추기만 하고 눌리지 않는다
      let ai = '실제 AI 질문은 건너뜀(--ai 없음)'
      if (AI && w === 390) {
        const t0 = Date.now(); await ev(`${q('#drQuick')}.scrollLeft = 0`); await tap(q('#drQuick button'), '빠른 질문')
        const res = await waitFor(`(() => { const m = [...document.querySelectorAll('#drBody .msg')]; const last = m[m.length - 1]; if (!m.some(x => x.classList.contains('me')) || !last || !last.classList.contains('ai') || /^답을 쓰고/.test(last.textContent)) return null; return { note: __q.txt(last.querySelector('.msg-note')), text: __q.txt(last).slice(0, 80) } })()`, '상담 답', 22000)
        ai = `${((Date.now() - t0) / 1000).toFixed(1)}초, ${res.note ? 'AI 답' : '규칙 답'}: "${res.text}"`
      }
      await tap(q('#drClose'), '상담 닫기'); await waitFor(`!${q('#drawer')}.classList.contains('is-open')`, '상담 서랍 닫힘', 3000); await sleep(450)
      const ok = d.dr.y === 0 && d.dr.h === h && d.dr.w === w && d.quick.tops === 1 && d.quick.scroll && d.quick.touch >= 44 && parseFloat(d.msgFs) >= 15 && parseFloat(d.qFs) >= 15 && parseFloat(d.inFs) >= 16 && d.form.b <= h && d.x.w >= 44 && d.over.docW <= w && x1 > x0
      return { ok, evidence: `서랍 ${d.dr.w}x${d.dr.h} (화면 ${w}x${h}), 빠른 질문 ${d.quick.n}개가 ${d.quick.tops}줄·가로로 넘김=${d.quick.scroll}(밀어서 ${x0}→${x1}px), 닿는 높이 ${d.quick.touch}px, 글자 말풍선 ${d.msgFs}·질문 ${d.qFs}·입력 ${d.inFs}, 입력 칸 아래 끝 ${d.form.b}px, ${ai}` }
    })
    await check(`${P} 7. 눈높이(MH.setEye): 한 번만 3D 눈높이로 열기`, async () => {
      const before = await ev('__q.frame()')
      await ev(`MH.setEye('child')`); await sleep(500); const a = await ev('__q.frame()')
      const other = await ev(`[...document.querySelectorAll('#hvRooms button')].map(b => __q.txt(b)).find(t => t !== ${J(before.pressed)})`)
      await tap(roomBtn(other), other); await sleep(500); const b = await ev('__q.frame()')
      await ev(`location.hash = '#map'`); await sleep(600); await ev(`MH.setEye('adult'); location.hash = '#house'`); await sleep(700); const c = await ev('__q.frame()')
      const ok = !before.eye && a.slot === before.slot && a.view === '3d' && a.eye === 'child' && !b.eye && !b.view && c.eye === 'adult' && c.view === '3d' && !!c.slot
      return { ok, evidence: `전: eye=${before.eye} / 집 보기에서 setEye('child') → 같은 방(${a.slot}) view=${a.view}&eye=${a.eye} / 방 바꾸면(${b.slot}) eye=${b.eye} / 지도에서 setEye('adult') 뒤 집 보기 → view=${c.view}&eye=${c.eye}` }
    })
    await check(`${P} 8. 홈 "아이 눈높이 90cm로 보기" → 집 보기 3D 아이 눈높이: 시트 접힘, 끌어서 둘러보기, 바닥 눌러 옮겨 가기`, async () => {
      await fresh('#home')
      // 칩 줄은 큰 그림 아래에 있다. 손가락으로 민 것처럼 칩 줄이 위 막대 아래에 붙는 곳까지 내린다
      await ev(`(() => { const r = ${q('#homeCats')}; scrollTo(0, r.getBoundingClientRect().top + scrollY - 72) })()`); await sleep(500)
      await tap(`${q('#homeCats')}.querySelector('[data-cat="help"]')`, '칩 돕는 방법'); await sleep(700)
      await tap(q('#zzNext'), '다음'); await sleep(900); await tap(q('#zzNext'), '다음'); await sleep(1000)
      const link = await ev(`__q.rect('a[data-eye="child"]')`)
      await tap(q('a[data-eye="child"]'), '아이 눈높이 90cm로 보기'); await waitFor(`location.hash.startsWith('#house')`, '#house', 6000)
      const f = await waitFrame('')
      // 방 배치 도구(iframe) 안의 눈높이 상태: 3D 화면 바깥 요소의 data-eye-* 와 캔버스·시트 크기
      const eye = `(() => { const d = ${q('#kkumiFrame')}.contentDocument, r = d && d.querySelector('[data-eye-mode]'), c = r && r.querySelector('canvas'); if (!c || !r.dataset.eyeX) return null; const b = c.getBoundingClientRect(), s = d.querySelector('section[aria-label="조작 패널"]'); return { mode: r.dataset.eyeMode, x: +r.dataset.eyeX, y: +r.dataset.eyeY, yaw: +r.dataset.eyeYaw, markers: +r.dataset.eyeMarkers, cx: b.left, cy: b.top, cw: b.width, ch: b.height, sheet: s ? Math.round(s.getBoundingClientRect().height) : -1, note: __q.txt(r).slice(0, 70) } })()`
      const a0 = await waitFor(eye, '3D 아이 눈높이', 40000); await sleep(1500)
      const fr = await ev(`__q.rect('#kkumiFrame')`), host = await ev(`({ tabbar: __q.vis(${q('.tabbar')}), nav: __q.vis(${q('#nav')}), over: __q.over() })`)
      await shot(`m${w}-house-eye`)
      const mx = fr.x + a0.cx + a0.cw / 2, my = fr.y + a0.cy + a0.ch * 0.55
      await swipe(mx - 60, my, mx + 60, my); const a1 = await ev(eye)
      const sy0 = await ev('scrollY'); await swipe(mx, my - 70, mx, my + 70); const sy1 = await ev('scrollY'), a2 = await ev(eye)
      // 바닥 누르기: 캔버스 아래쪽 몇 곳을 차례로 눌러 본다 (가구나 벽을 누르면 가장 가까운 설 수 있는 자리로 간다)
      let moved = ''
      for (const [fx, fy] of [[0.5, 0.86], [0.35, 0.8], [0.65, 0.8], [0.5, 0.72]]) {
        const b0 = await ev(eye), x = fr.x + a0.cx + a0.cw * fx, y = fr.y + a0.cy + a0.ch * fy
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await sleep(3000); const b1 = await ev(eye)
        if (b1.x !== b0.x || b1.y !== b0.y) { moved = `(${b0.x},${b0.y})→(${b1.x},${b1.y})`; break }
      }
      const ok = !!link && link.h >= 44 && f.view === '3d' && f.eye === 'child' && a0.mode === 'child' && /참고/.test(a0.note) && a0.sheet <= 60 && a0.ch >= h * 0.55 && a1.yaw !== a0.yaw && a1.x === a0.x && a1.y === a0.y && sy0 === sy1 && a2.x === a0.x && a2.y === a0.y && !!moved && !host.tabbar && !host.nav && host.over.docW <= w
      return { ok, evidence: `링크 ${link ? link.w + 'x' + link.h : '없음'}px → iframe view=${f.view}&eye=${f.eye}(${f.slot}), 눈높이 상태 mode=${a0.mode} 자리=(${a0.x},${a0.y}) yaw=${a0.yaw} 빨간 점 ${a0.markers}곳, 안내="${a0.note}", 시트 ${a0.sheet}px(접힘), 3D ${Math.round(a0.cw)}x${Math.round(a0.ch)}px(화면의 ${Math.round(a0.ch / h * 100)}%), 가로로 끌기 yaw ${a0.yaw}→${a1.yaw}(자리 그대로), 세로로 끌기 scrollY ${sy0}→${sy1}, 바닥 누름 ${moved || '자리 안 바뀜'}, 방봄 탭 막대 보임=${host.tabbar}·위 막대 보임=${host.nav}, 가로 ${host.over.docW}/${w}` }
    })

    // ── 여기부터는 예시 조건을 저장하고 지도부터 다시 열어서 본다 (앞의 집 보기 검사가 실패해도 영향이 없게) ──
    await persona()
    await check(`${P} 9. 펼친 판정 패널: 줄을 모두 펴도 상담 단추·도움말·안내 문구와 겹치지 않고 안에서 밀림`, async () => {
      await tap(q('#jpLine'), '펼치기'); await ev(`document.querySelectorAll('#panelL .jp-row').forEach(r => r.click())`); await sleep(300)
      await ev(`${q('#panelL')}.scrollTop = 1e6`); await sleep(250)
      const a = await ev(`(() => { const p = ${q('#panelL')}, pb = p.getBoundingClientRect().bottom; return { panel: __q.rect('#panelL'), fab: __q.rect('#fab'), clash: __q.clash(['#panelL', '#fab', '#mapHint', '#mh .notice', '.tabbar']), scroll: [p.scrollHeight, p.clientHeight], btns: [...p.querySelectorAll('.jp-btns button')].filter(__q.vis).map(b => __q.txt(b) + (__q.free(b) && b.getBoundingClientRect().bottom <= pb + 1 ? '' : '(가려짐)')) } })()`)
      await shot(`m${w}-map-open-all`)
      await ev(`${q('#panelL')}.scrollTop = 0`); await tap(q('#jpLine'), '접기')
      const ok = a.clash.length === 0 && !!a.fab && a.panel.b <= a.fab.y && a.scroll[0] > a.scroll[1] && a.btns.length === 3 && a.btns.every((t) => !t.includes('가려짐'))
      return { ok, evidence: `패널 y=${a.panel.y}~${a.panel.b}, 상담 단추 y=${a.fab ? a.fab.y + '~' + a.fab.b : '없음'}, 겹침=${J(a.clash)}, 안에서 밀기 ${a.scroll.join('/')}px, 끝까지 내린 뒤 단추=${J(a.btns)}` }
    })
    await check(`${P} 10. 카드 계산 내역의 합계 줄이 금액 칸에 맞고, 카드를 닫으면 이름표가 칩 줄·요약 줄에 가려지지 않음`, async () => {
      await calm(); const name = await openCard(true)
      await tap(`${q('#panelR .cc-chips')}.querySelector('[data-tab="calc"]')`, '칩 계산 내역'); await sleep(300)
      await ev(`${q('#panelR .cc-panes')}.scrollTop = 1e6`); await sleep(250)
      const r = await ev(calcRow); await shot(`m${w}-card-calc-total`)
      await tap(q('#ccX'), '카드 닫기'); await sleep(1400)
      const l = await ev(`(() => { const b = __q.label(${J(name)}), r = b.getBoundingClientRect(); return { y: Math.round(r.top), b: Math.round(r.bottom), free: __q.free(b), bar: __q.rect('#panelL').b } })()`); await shot(`m${w}-map-after-close`)
      return { ok: calcOk(r) && l.free && l.y >= l.bar, evidence: `단지="${name}", 합계 줄 display=${r && r.disp}·칸 x=${J(r && r.tot)}·윗줄 칸 x=${J(r && r.prev)}, 닫은 뒤 이름표 y=${l.y}~${l.b}(요약 줄 아래 끝 ${l.bar}px) 가려지지 않음=${l.free}` }
    })
    await check(`${P} 11. 집 보기에 다녀오면 고른 단지의 선·주변 시설 이름표가 지워지고 이름표가 가려지지 않음`, async () => {
      await calm(); const name = await openCard()
      await tap(q('#ccHouse'), '집 보기 →'); await waitFor(`location.hash === '#house'`, '#house', 5000); await sleep(1000)
      await ev('history.back()'); await waitFor(`location.hash === '#map'`, '#map', 5000); await sleep(1500)
      const a = await ev(`(() => { const b = __q.label(${J(name)}); return { card: document.body.classList.contains('card-open'), lines: [...document.querySelectorAll('.ilabel,.score-badge')].filter(__q.vis).length, faint: document.querySelectorAll('.clabel.is-faint').length, free: __q.free(b), y: Math.round(b.getBoundingClientRect().top), bar: __q.rect('#panelL').b } })()`); await shot(`m${w}-map-back-from-house`)
      return { ok: !a.card && a.lines === 0 && a.faint === 0 && a.free && a.y >= a.bar, evidence: `단지="${name}", 돌아온 뒤 카드 열림=${a.card}, 주변 시설 이름표 ${a.lines}개, 흐린 단지 이름표 ${a.faint}개, 이름표 y=${a.y}(요약 줄 아래 끝 ${a.bar}px) 가려지지 않음=${a.free}` }
    })
    await check(`${P} 12. 상담 서랍을 연 채 화면을 옮기면 닫힘, 가려진 지도는 그리지 않음`, async () => {
      await calm(); const g0 = await gl()
      await tap(q('#fab'), '24시간 상담'); await waitFor(drOpen, '상담 서랍', 3000); await sleep(500)
      const g1 = await gl()
      await ev(`location.hash = '#input'`); await sleep(800)
      const a = await ev(`({ open: ${drOpen}, top: (() => { const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return !e ? '없음' : e.closest('#drawer') ? '상담 서랍' : e.closest('#vInput') ? '조건 입력' : e.tagName })(), next: __q.free(${q('#fNext')}) })`); await shot(`m${w}-input-after-drawer`)
      const g2 = await gl()
      await ev('history.back()'); await sleep(900)
      const b = await ev(`({ hash: location.hash, open: ${drOpen} })`)
      const ok = g0 > 0 && g1 === 0 && !a.open && a.top === '조건 입력' && a.next && g2 === 0 && b.hash === '#map' && !b.open
      return { ok, evidence: `#input 으로 옮긴 뒤 서랍 열림=${a.open}·화면 가운데="${a.top}"·[다음] 가려지지 않음=${a.next}, 뒤로 가기 → ${b.hash} 서랍 열림=${b.open}, 지도 그리기 횟수(0.45초): 지도 ${g0}·전체 화면 서랍 ${g1}·조건 입력 ${g2}` }
    })
    await check(`${P} 13. 조건 입력: 고친 칸의 알림은 바로 지워지고, 나갔다 와도 적던 값과 걸음이 남음`, async () => {
      await fresh('#input')
      // 조건 입력으로 바로 들어와도 지도는 한 장 그려져 있어야 한다 (안 그리면 반투명한 위 막대 뒤로 검은 빈 화면이 비친다)
      const drawn = await ev('__gl')
      await tap(q('#fNext'), '다음'); const e0 = await ev(`__q.txt(${q('#e-age')})`)
      await typeIn('#f-age', 31); const e1 = await ev(`({ age: __q.txt(${q('#e-age')}), income: __q.txt(${q('#e-income')}) })`)
      await typeIn('#f-income', 280); await typeIn('#f-assets', 2500); await ev('document.activeElement && document.activeElement.blur()')
      await tap(q('#fNext'), '다음'); await tap(`${q('.seg[data-k="lives_with_parents"]')}.querySelector('[data-v="1"]')`, '함께 살아요'); await tap(q('#fNext'), '다음')
      await typeIn('#f-budget', 55); await ev('document.activeElement && document.activeElement.blur()')
      await ev('history.back()'); await sleep(900); const out = await ev('location.hash')
      await ev('history.forward()'); await sleep(900)
      const a = await ev(`({ hash: location.hash, step: ${q('#vInput')}.dataset.step, v: ['f-age', 'f-income', 'f-assets', 'f-budget'].map(i => document.getElementById(i).value), together: ${q('.seg[data-k="lives_with_parents"] [data-v="1"]')}.classList.contains('is-on') })`); await shot(`m${w}-input-return`)
      const ok = drawn > 0 && !!e0 && e1.age === '' && !!e1.income && out !== '#input' && a.hash === '#input' && a.step === '3' && J(a.v) === J(['31', '280', '2500', '55']) && a.together
      return { ok, evidence: `빈 값 알림="${e0}", 나이를 적은 뒤 나이 알림="${e1.age}"·월 소득 알림="${e1.income}", 3걸음에서 뒤로("${out}") → 앞으로: ${a.hash} ${a.step}걸음, 값=${J(a.v)}, 함께 살아요=${a.together}, 바로 들어왔을 때 지도 첫 장 그림=${drawn > 0}` }
    })
    await check(`${P} 14. 가로로 돌린 화면(${h}x${w}): 카드의 내용과 [집 보기] 단추, 상담 입력 칸에 닿음`, async () => {
      await persona(); const name = await openCard(true)
      await size(h, w, true); await sleep(900)
      try {
        const phone = h <= 820
        const a = await ev(`({ sheet: __q.rect('#panelR'), house: __q.free(${q('#ccHouse')}), over: __q.over() })`); await shot(`land${h}-card`)
        // 내용: 손가락으로 밀 수 있는 곳을 끝까지 내린 뒤, 단추 줄 위로 내용이 보이는 높이
        const c = await ev(`(() => { const sc = [${q('#panelR .cc')}, ${q('#panelR .cc-panes')}, ${q('#panelR')}].find(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4); if (sc) sc.scrollTop = 1e6; const pane = [...document.querySelectorAll('#panelR [data-pane]')].filter(__q.vis).pop(), top = ${q('#panelR')}.getBoundingClientRect().top, btn = ${q('#panelR .cc-btns')}.getBoundingClientRect().top, pr = pane ? pane.getBoundingClientRect() : null; return { win: pr ? Math.round(Math.min(pr.bottom, btn) - Math.max(pr.top, top)) : 0, house: __q.free(${q('#ccHouse')}) } })()`); await shot(`land${h}-card-end`)
        let plan = -1
        if (phone) { await tap(`${q('#panelR .cc-chips')}.querySelector('[data-tab="plan"]')`, '칩 평면'); await sleep(300); plan = await ev(`Math.round(${q('#panelR .cc-plan')}.getBoundingClientRect().height)`) }
        await calm()
        await tap(q('#fab'), '24시간 상담'); await waitFor(drOpen, '상담 서랍', 3000); await sleep(500)
        const d = await ev(`({ form: __q.rect('#drForm'), input: __q.free(${q('#drIn')}) })`); await shot(`land${h}-drawer`)
        await tap(q('#drClose'), '상담 닫기'); await sleep(400)
        const ok = a.house && c.house && (!phone || (c.win >= 100 && plan >= 120)) && a.over.docW <= h && !!d.form && d.form.b <= w && d.input
        return { ok, evidence: `단지="${name}", ${phone ? '휴대폰 배치' : 'PC 배치'}: 카드 y=${a.sheet.y}~${a.sheet.b}, [집 보기] 가려지지 않음=${a.house}(끝까지 민 뒤 ${c.house}), 단추 위로 내용이 보이는 높이 ${c.win}px${phone ? `, 평면 그림 높이 ${plan}px` : ''}, 상담 입력 칸 아래 끝 ${d.form ? d.form.b : '없음'}px(화면 ${w}px) 가려지지 않음=${d.input}` }
      } finally { await size(w, h, true); await sleep(400) }
    })
    await noGl(`${P} 15.`, w)
  }
  step = '끝'
}

async function main() {
  if (!EDGE) { console.log('Edge(또는 Chrome)를 찾지 못했어요. EDGE_PATH 환경변수로 실행 파일 위치를 알려 주세요.'); process.exit(1) }
  const port = await new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })
  const profile = mkdtempSync(path.join(os.tmpdir(), 'bangbom-e2e-'))
  const child = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--remote-allow-origins=*', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--mute-audio', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' })
  let timer
  try {
    let target
    for (let i = 0; i < 100 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((e) => e.type === 'page') } catch {} if (!target) await sleep(150) }
    if (!target) throw new Error('브라우저가 뜨지 않았어요')
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('브라우저 연결 실패'))) })
    await Promise.race([run(new Cdp(ws)), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('시간 제한(12분)에 걸렸어요. 마지막 단계: ' + step)), 720000) })])
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

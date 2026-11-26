#!/usr/bin/env node
// @ts-nocheck
// 방봄 시작 화면(이름)과 튜토리얼을 헤드리스 Edge(Chromium)로 눌러 보는 검사.
// 쓰는 법:  node scripts/e2e-tutorial.mjs [주소] [--shots <폴더>]
//   주소    기본 http://localhost:4180  (개발 서버는 http://localhost:5180)
//   --shots 화면 캡처(PNG)를 그 폴더에 남긴다
// 다른 검사와 달리 주소에 tutorial=0 을 붙이지 않는다(그 규칙을 검사하는 곳에서만 붙인다). AI 상담은 부르지 않는다.
// PC(1440x900)는 마우스와 글쇠로, 휴대폰(390x844, 360x640)은 크기 흉내 + 합성 터치로 누른다. 사파리가 아니라 Chromium 이다.
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
const EDGE = [process.env.EDGE_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const J = JSON.stringify
const rows = []
const notes = []
const errors = []
const reqs = []
let step = '시작'

// 검사에서 적는 이름들. 화면이나 자료에 원래 없는 글자로 골라서, 요청에 섞이면 바로 찾을 수 있게 한다
const NAME1 = '<b>모과&Q7' // < 와 & 가 글자 그대로 보여야 한다
const NAME2 = '새이름모과9'
const NAME3 = '폰모과3'
const NAME4 = '폰바꾼모과4'
const LONG13 = '가나다라마바사아자차카타파' // 13자
const GREET = '방봄은 이렇게 써요.'
const NOTE = '이름은 이 브라우저에만 저장해요. 계정이 아니고 서버로 보내지 않아요.'

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
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 }
  const rect = (sel) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!vis(el)) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), r: Math.round(r.right) } }
  const dlg = () => document.querySelector('dialog.bbt')
  const who = (el) => (!el || el === document.body ? 'body' : el.id ? '#' + el.id : el.tagName.toLowerCase() + '"' + txt(el).slice(0, 24) + '"')
  window.__q = {
    txt, vis, rect,
    // 누를 자리(가운데 점)와 그 자리가 다른 것에 가려졌는지
    pt(el) {
      if (!el) return null
      let r = el.getBoundingClientRect()
      if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); r = el.getBoundingClientRect() }
      const x = r.left + r.width / 2, y = r.top + r.height / 2
      const top = document.elementFromPoint(x, y), hit = !!top && r.width > 0 && (top === el || el.contains(top))
      const cls = top ? (top.className && top.className.baseVal !== undefined ? top.className.baseVal : String(top.className)) : ''
      return { x, y, hit, by: top ? '<' + top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') + '.' + cls.slice(0, 40) + '>' : '없음' }
    },
    // 손가락이 닿는 높이: 가운데 세로줄에서 그 단추가 받는 구간
    touchH(el) {
      if (!vis(el)) return 0
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2; let top = r.top, bot = r.bottom
      for (let y = r.top; y > r.top - 12; y--) { const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) top = y; else break }
      for (let y = r.bottom - 1; y < r.bottom + 12; y++) { const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) bot = y + 1; else break }
      return Math.round(bot - top)
    },
    over() { const de = document.documentElement; return { iw: innerWidth, docW: de.scrollWidth, bodyW: document.body.scrollWidth } },
    // 화면에 보이고 가려지지 않은 단지 이름표
    label(name) {
      if (name) return [...document.querySelectorAll('.clabel')].find((b) => b.getAttribute('aria-label') === name) || null
      const free = (b) => { const r = b.getBoundingClientRect(); if (!r.width || r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) return false; const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === b || b.contains(t)) }
      return [...document.querySelectorAll('.clabel')].find(free) || null
    },
    // 저장된 것과 지금 떠 있는 창
    mode() { const d = dlg(); return d && d.open ? d.dataset.mode : '' },
    store() { let u = localStorage.getItem('bangbom.user.v1'); try { u = u == null ? null : JSON.parse(u) } catch { u = 'BROKEN' } return { user: u, tut: localStorage.getItem('bangbom.tutorial.v1') } },
    chip(where) { const c = document.querySelector('.bbu--' + where + ' .bbu__chip'); return vis(c) ? txt(c.querySelector('.bbu__name')) : '' },
    focus() { return who(document.activeElement) },
    // 뒤 화면이 막혀 있는지: 뒤의 단추가 커서를 받지 못하고, 누를 자리도 창이 받는다
    blocked() {
      const m = document.querySelector('#menuOpen'), a = document.activeElement
      m.focus(); const took = document.activeElement === m; if (a && a.focus) a.focus()
      const top = document.elementFromPoint(24, 24)
      return !took && !!top && !!top.closest('dialog.bbt')
    },
    card() {
      const d = dlg(); if (!d || !d.open) return null
      const c = d.querySelector('.bbt__card'), r = c.getBoundingClientRect(), q = (s) => d.querySelector(s)
      return {
        mode: d.dataset.mode, modal: d.matches(':modal') && d.getAttribute('aria-modal') === 'true', name: txt(document.getElementById(d.getAttribute('aria-labelledby'))),
        x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), extra: c.scrollHeight - c.clientHeight,
        title: txt(q('#bbtTitle')), kids: q('#bbtTitle').children.length, btns: [...d.querySelectorAll('button')].filter(vis).map(txt), inside: d.contains(document.activeElement), focus: who(document.activeElement),
        // 시작 화면
        label: vis(q('label[for="bbtName"]')) ? txt(q('label[for="bbtName"]')) : '', value: q('#bbtName') ? q('#bbtName').value : null, fs: q('#bbtName') ? getComputedStyle(q('#bbtName')).fontSize : '', inH: q('#bbtName') ? Math.round(q('#bbtName').getBoundingClientRect().height) : 0,
        err: q('#bbtErr') && vis(q('#bbtErr')) ? txt(q('#bbtErr')) : '', invalid: q('#bbtName') ? q('#bbtName').getAttribute('aria-invalid') : null, note: txt(q('#bbtNote')),
        // 튜토리얼
        count: txt(q('#bbtCount')), body: txt(q('#bbtBody')), more: txt(q('#bbtMore')), marks: [...d.querySelectorAll('.bbt__marks li')].map(txt), art: !!q('#bbtArt svg') && vis(q('#bbtArt svg')), next: q('#bbtNext') ? rect(q('#bbtNext')) : null,
        touch: [...d.querySelectorAll('button')].filter(vis).map((b) => window.__q.touchH(b)),
      }
    },
  }
}

async function run(cdp) {
  for (const d of ['Page', 'Runtime', 'Log', 'Network']) await cdp.send(d + '.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${helpers.toString()})()` })
  cdp.on('Runtime.exceptionThrown', (p) => { const d = p.exceptionDetails || {}; errors.push({ step, text: String((d.exception && d.exception.description) || d.text).split('\n')[0] + ' ' + (d.url || '') }) })
  cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errors.push({ step, text: 'console.error: ' + (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200) }) })
  cdp.on('Log.entryAdded', (p) => { if (p.entry && p.entry.level === 'error') notes.push(`[${step}] 브라우저 기록: ${String(p.entry.text).slice(0, 160)} ${p.entry.url || ''}`) })
  // 모든 요청의 주소·머리말·본문을 적어 둔다 (끝에서 이름이 섞였는지 본다)
  cdp.on('Network.requestWillBeSent', (p) => {
    const r = p.request, rec = { url: r.url, head: J(r.headers || {}), body: r.postData || '' }
    reqs.push(rec)
    if (r.hasPostData && !r.postData) cdp.send('Network.getRequestPostData', { requestId: p.requestId }).then((x) => { rec.body = x.postData || '' }).catch(() => {})
  })

  const ev = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('페이지 계산 오류: ' + String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).split('\n')[0]); return r.result.value }
  const waitFor = async (expr, what, ms = 8000) => { const end = Date.now() + ms; for (;;) { try { const v = await ev(`(() => { try { return (${expr}) } catch { return null } })()`); if (v) return v } catch {} if (Date.now() > end) throw new Error(`${what}: ${ms / 1000}초 기다려도 안 됨`); await sleep(120) } }
  const loadThen = async (fn) => { let done; const p = new Promise((r) => { done = r }); const f = () => done(); cdp.on('Page.loadEventFired', f); await fn(); await Promise.race([p, sleep(20000)]); cdp.off('Page.loadEventFired', f); await sleep(700) }
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
    const p = await ev(`__q.pt(${expr})`)
    if (!p) throw new Error(`${label}: 화면에서 찾지 못했어요`)
    if (!p.hit) throw new Error(`${label}: 누를 자리(${Math.round(p.x)},${Math.round(p.y)})가 ${p.by} 에 가려져 있어요`)
    if (touch) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] }); await sleep(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
    else for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 })
    await sleep(280)
    return p
  }
  // 글쇠 하나 누르기 (Enter 는 글자가 같이 가야 단추가 눌린다)
  const KEYS = { Enter: [13, '\r'], Escape: [27], Tab: [9], Backspace: [8], PageDown: [34] }
  const key = async (k, shift) => {
    const [vk, text] = KEYS[k], base = { key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: shift ? 8 : 0 }
    await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text, unmodifiedText: text } : {}) })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    await sleep(220)
  }
  // 이름 칸을 비우고 새로 친다 (글자는 브라우저의 입력으로 넣는다)
  const typeName = async (text) => {
    await tap(q('#bbtName'), '이름 칸'); await ev(`${q('#bbtName')}.select()`)
    if (text) await cdp.send('Input.insertText', { text }); else await key('Backspace')
    await sleep(150)
  }
  const check = async (what, fn) => { step = what; let row; try { const r = await fn(); row = { what, ok: !!r.ok, evidence: r.evidence } } catch (e) { row = { what, ok: false, evidence: '오류: ' + e.message } } rows.push(row); console.log(`${row.ok ? 'OK  ' : 'FAIL'} ${what} :: ${row.evidence}`) }
  const q = (sel) => `document.querySelector(${J(sel)})`
  const btn = (text) => `[...document.querySelectorAll('dialog.bbt button')].find(b => __q.vis(b) && __q.txt(b) === ${J(text)})`
  const item = (where, text) => `[...document.querySelectorAll('.bbu--${where} button')].find(b => __q.vis(b) && __q.txt(b) === ${J(text)})`
  const mode = (m) => `__q.mode() === ${J(m)}`
  const card = () => ev('__q.card()')
  const store = () => ev('__q.store()')
  // 창이 뜨고(화면 전환까지 끝나고) 나서 본다
  const waitMode = async (m, what) => { await waitFor(mode(m), what, 8000); await sleep(900) }
  // 저장된 것을 모두 지우고 그 주소를 새로 연다
  const fresh = async (rest) => { await nav(BASE + '/'); await ev('localStorage.clear()'); await nav('about:blank'); await nav(BASE + '/' + rest) }
  const reopen = async (rest) => { await nav('about:blank'); await nav(BASE + '/' + rest) }
  const hash = async (h) => { await ev('location.hash = ' + J(h)); await sleep(1100) }
  // 지도에서 보이는 단지 이름표를 눌러 단지 카드를 연다 (보이는 이름표가 없으면 구 바로가기 칩으로 단지가 있는 곳으로 간다)
  const openCard = async () => {
    const find = `(() => { const b = __q.label(''); return b ? b.getAttribute('aria-label') : null })()`
    let name = await waitFor(find, '보이는 단지 이름표', 2500).catch(() => null)
    if (!name) { await tap(q('#dnav button'), '구 바로가기 칩'); await sleep(1500); name = await waitFor(find, '보이는 단지 이름표', 6000) }
    await tap(`__q.label(${J(name)})`, '단지 이름표')
    const ok = await waitFor(`${q('#panelR')}.classList.contains('is-open')`, '단지 카드', 5000).then(() => true).catch(() => false)
    await sleep(900)
    return ok
  }

  // ═════════ PC 1440x900 (마우스 + 글쇠) ═════════
  await size(1440, 900, false)
  await check('PC 1. 처음 온 사람: 홈과 이용 안내에서는 아무것도 뜨지 않음', async () => {
    await fresh('')
    const a = await ev(`({ mode: __q.mode(), chip: __q.chip('nav'), st: __q.store(), api: [typeof MH.tutorial.open, typeof MH.tutorial.maybeStart, typeof MH.tutorial.reset, typeof MH.user.get, typeof MH.user.set, typeof MH.user.clear].join(), get: MH.user.get(), route: typeof MH.route })`)
    await hash('#guide'); const g = await ev('__q.mode()'); await hash('#home')
    await shot('pc-home-first')
    const ok = !a.mode && !g && a.chip === '이름 정하기' && a.st.user === null && a.st.tut === null && a.api === 'function,function,function,function,function,function' && a.get === null && a.route === 'function'
    return { ok, evidence: `홈: 뜬 창="${a.mode}", 이용 안내: 뜬 창="${g}", 이름 칩="${a.chip}", 저장=${J(a.st)}, MH.tutorial·MH.user 함수=${a.api}, MH.route 그대로=${a.route}` }
  })
  await check('PC 2. 홈 "그냥 둘러보기"로 지도에 들어가면 시작 화면: 가운데 카드, 이름 칸, 정직한 안내, 뒤 화면 막힘', async () => {
    await tap(q('a[data-go="browse"]'), '그냥 둘러보기'); await waitFor(`location.hash === '#map'`, '#map', 6000); await waitMode('start', '시작 화면')
    const c = await card(), blocked = await ev('__q.blocked()'), over = await ev('__q.over()'), st = await store()
    await shot('pc-start')
    const mid = Math.abs(c.x + c.w / 2 - 720) <= 2 && Math.abs(c.y + c.h / 2 - 450) <= 2
    const ok = c.mode === 'start' && c.modal && c.name === '어떻게 불러 드릴까요?' && c.label.startsWith('이름') && parseFloat(c.fs) >= 16 && c.note === NOTE && J(c.btns) === J(['시작하기', '이름 없이 둘러보기']) && c.focus === '#bbtName' && mid && blocked && over.docW <= 1440 && st.user === null && st.tut === null
    return { ok, evidence: `창=${c.mode}(aria-modal+:modal=${c.modal}, 이름표="${c.name}"), 카드 ${c.w}x${c.h} 가운데=${mid}, 칸 이름표="${c.label}" 글자 ${c.fs}, 안내="${c.note}", 단추=${J(c.btns)}, 커서=${c.focus}, 뒤 화면 막힘=${blocked}, 가로 ${over.docW}/1440, 저장=${J(st)}` }
  })
  await check('PC 3. 이름 검사: 빈 값 · 13자 · 빈칸만은 알림, < 와 & 가 든 이름은 글자 그대로', async () => {
    await tap(btn('시작하기'), '시작하기'); const e1 = await card()
    await typeName(LONG13); await key('Enter'); const e2 = await card(); await shot('pc-start-error')
    await typeName('   '); await tap(btn('시작하기'), '시작하기'); const e3 = await card()
    await typeName(NAME1); const e4 = await card(), before = await store()
    await tap(btn('시작하기'), '시작하기'); await waitMode('tour', '튜토리얼')
    const t = await card(), st = await store()
    const ok = e1.mode === 'start' && /한 글자 이상/.test(e1.err) && e1.invalid === 'true' && e1.focus === '#bbtName' && /12자까지/.test(e2.err) && /13자/.test(e2.err) && e2.mode === 'start' && /한 글자 이상/.test(e3.err) && e4.err === '' && e4.invalid === null && before.user === null
      && t.mode === 'tour' && t.title === `${NAME1}님, ${GREET}` && t.kids === 0 && st.user && st.user.name === NAME1 && !Number.isNaN(Date.parse(st.user.since)) && st.tut === null
    return { ok, evidence: `빈 값="${e1.err}"(aria-invalid=${e1.invalid}, 커서=${e1.focus}) / 13자="${e2.err}" / 빈칸만="${e3.err}" / 고치면 알림 사라짐=${e4.err === ''} · 그때까지 저장 없음=${before.user === null} / 시작하기 → 창=${t.mode}, 제목="${t.title}"(안에 생긴 태그 ${t.kids}개), 저장=${J(st)}` }
  })
  await check('PC 4. 튜토리얼: 이름 인사 → 글쇠만으로 네 걸음 → 본 기록 남김 → 뒤의 지도 그대로 동작', async () => {
    const s1 = await card(); await shot('pc-tour-1')
    // 커서 가두기: Tab 을 여러 번 눌러도 창 안에서만 돈다
    const ring = []
    for (let i = 0; i < 2; i++) { await key('Tab'); ring.push(await ev('__q.focus()') + ((await ev(`${q('dialog.bbt')}.contains(document.activeElement)`)) ? '' : '(창 밖!)')) }
    await key('Tab', true); ring.push(await ev('__q.focus()')); await key('Tab'); ring.push(await ev('__q.focus()'))
    const seen = [s1]
    for (let i = 2; i <= 4; i++) { await key('Enter'); const s = await card(); seen.push(s); await shot('pc-tour-' + i) }
    await key('Enter'); await waitFor(`!__q.mode()`, '튜토리얼 닫힘', 4000); await sleep(500)
    const st = await store(), chip = await ev(`__q.chip('nav')`), chipKids = await ev(`${q('.bbu--nav .bbu__name')}.children.length`), h = await ev('location.hash')
    const cardOpen = await openCard()
    await shot('pc-after'); await tap(q('#ccX'), '단지 카드 닫기')
    const counts = seen.map((s) => s.count), sameH = seen.every((s) => s.h === seen[0].h), sameNext = seen.every((s) => J(s.next) === J(seen[0].next))
    const ok = s1.count === '1 / 4' && s1.title === `${NAME1}님, ${GREET}` && J(s1.marks) === J(['● 요건 충족', '◐ 확인 필요', '○ 미충족']) && J(s1.btns) === J(['건너뛰기', '다음']) && s1.focus === '#bbtNext' && s1.modal
      && ring.every((x) => !x.includes('창 밖')) && ring[1] === '#bbtNext' && ring[3] === '#bbtNext'
      && J(counts) === J(['1 / 4', '2 / 4', '3 / 4', '4 / 4']) && new Set(seen.map((s) => s.title)).size === 4 && seen.every((s) => s.art && s.extra <= 0 && s.inside) && /표준 구조/.test(seen[2].more) && /참고값/.test(seen[2].body) && /규칙/.test(seen[3].body) && /최종 결정은 각 기관/.test(seen[3].body)
      && J(seen[1].btns) === J(['건너뛰기', '이전', '다음']) && J(seen[3].btns) === J(['건너뛰기', '이전', '시작하기']) && sameH && sameNext
      && st.tut === 'done' && chip === NAME1 + '님' && chipKids === 0 && h === '#map' && cardOpen
    return { ok, evidence: `1걸음: ${s1.count} "${s1.title}" 표시=${J(s1.marks)} 단추=${J(s1.btns)} 커서=${s1.focus} / Tab 돌기=${J(ring)} / Enter 로 ${J(counts)}, 제목=${J(seen.map((s) => s.title))}, 마지막 단추=${J(seen[3].btns)}, 카드 높이 ${[...new Set(seen.map((s) => s.h))].join('/')}px(걸음마다 같아야 함)·[다음] 자리 같음=${sameNext} / 끝: 본 기록=${st.tut}, 칩="${chip}"(태그 ${chipKids}개), hash=${h}, 닫은 뒤 단지 카드 열림=${cardOpen}` }
  })
  await check('PC 5. 돌아온 사람: 새로 고쳐 지도·조건 입력·집 보기에 들어가도 둘 다 뜨지 않음', async () => {
    await reopen('#map'); await sleep(900); const a = await ev('__q.mode()')
    await hash('#home'); await tap(q('a[data-go="browse"]'), '그냥 둘러보기'); await sleep(1500); const b = await ev('__q.mode()'), h = await ev('location.hash')
    await hash('#input'); const c = await ev('__q.mode()')
    // 이름이 저장된 채로 집 보기(방 배치 도구 iframe)까지 열어 둔다: 끝에서 요청에 이름이 없는지 본다
    await hash('#house'); const d = await ev('__q.mode()'), frame = await waitFor(`${q('#kkumiFrame')}.getAttribute('src')`, '집 보기 iframe', 8000).catch(() => '')
    await sleep(1500); await hash('#map')
    const ok = !a && !b && !c && !d && h === '#map' && (await ev(`__q.chip('nav')`)) === NAME1 + '님'
    return { ok, evidence: `새로 고침(#map) 뜬 창="${a}", 홈에서 다시 들어감(${h}) "${b}", #input "${c}", #house "${d}", iframe 주소="${String(frame).slice(0, 70)}…"` }
  })
  await check('PC 6. 이름 칩 → 메뉴 → 이름 바꾸기(적혀 있던 이름) → 저장, 취소·Esc 는 그대로 둠', async () => {
    const since = (await store()).user.since
    await tap(q('.bbu--nav .bbu__chip'), '이름 칩'); const m = await ev(`({ open: ${q('.bbu--nav .bbu__chip')}.getAttribute('aria-expanded'), items: [...document.querySelectorAll('.bbu--nav .bbu__item')].filter(__q.vis).map(__q.txt), box: __q.rect('.bbu--nav .bbu__menu'), over: __q.over() })`)
    await shot('pc-chip-menu')
    await tap(item('nav', '이름 바꾸기'), '이름 바꾸기'); await waitMode('rename', '이름 바꾸기 창')
    const r = await card(); await shot('pc-rename')
    await typeName('임시모과'); await key('Escape'); await waitFor(`!__q.mode()`, '닫힘', 3000); await sleep(300)
    const kept = await store(), f1 = await ev('__q.focus()')
    await tap(q('.bbu--nav .bbu__chip'), '이름 칩'); await tap(item('nav', '이름 바꾸기'), '이름 바꾸기'); await waitMode('rename', '이름 바꾸기 창')
    await typeName(NAME2); await key('Enter'); await waitFor(`!__q.mode()`, '닫힘', 3000); await sleep(400)
    const st = await store(), chip = await ev(`__q.chip('nav')`), f2 = await ev('__q.focus()')
    const ok = m.open === 'true' && J(m.items) === J(['이름 바꾸기', '사용법 다시 보기', '이 브라우저에서 지우기']) && !!m.box && m.box.r <= 1440 && m.over.docW <= 1440
      && r.mode === 'rename' && r.value === NAME1 && r.name === '이름을 바꿔요' && J(r.btns) === J(['저장하기', '취소']) && r.note === NOTE
      && kept.user.name === NAME1 && /모과/.test(f1) && st.user.name === NAME2 && st.user.since === since && st.tut === 'done' && chip === NAME2 + '님' && /모과/.test(f2)
    return { ok, evidence: `메뉴 열림=${m.open} 항목=${J(m.items)} / 창=${r.mode} "${r.name}" 칸="${r.value}" 단추=${J(r.btns)} / Esc 뒤 이름 그대로="${kept.user.name}" 커서=${f1} / 저장 뒤 이름="${st.user.name}" 처음 날짜 그대로=${st.user.since === since} 칩="${chip}" 커서=${f2}` }
  })
  await check('PC 7. 사용법 다시 보기(data-tutorial="open") → Esc 로 닫으면 커서가 칩으로 돌아옴, 메뉴의 Esc', async () => {
    await tap(q('.bbu--nav .bbu__chip'), '이름 칩'); await key('Escape'); const m1 = await ev(`({ open: ${q('.bbu--nav .bbu__chip')}.getAttribute('aria-expanded'), focus: __q.focus(), hash: location.hash })`)
    await tap(q('.bbu--nav .bbu__chip'), '이름 칩'); await tap(item('nav', '사용법 다시 보기'), '사용법 다시 보기'); await waitMode('tour', '튜토리얼')
    const t = await card(), blocked = await ev('__q.blocked()')
    await key('Escape'); await waitFor(`!__q.mode()`, '닫힘', 3000); await sleep(300)
    const f = await ev('__q.focus()'), st = await store()
    const ok = m1.open === 'false' && /모과/.test(m1.focus) && t.mode === 'tour' && t.title === `${NAME2}님, ${GREET}` && t.count === '1 / 4' && blocked && /모과/.test(f) && st.tut === 'done' && st.user.name === NAME2
    return { ok, evidence: `메뉴에서 Esc: 열림=${m1.open} 커서=${m1.focus} / 다시 보기 → "${t.title}" ${t.count}, 뒤 화면 막힘=${blocked} / Esc → 커서=${f}, 저장=${J(st)}` }
  })
  await check('PC 8. 이 브라우저에서 지우기(확인 한 번) → 처음 온 사람으로 돌아감 → 글쇠로 들어가 Esc 두 번, 커서 돌아옴', async () => {
    await tap(q('.bbu--nav .bbu__chip'), '이름 칩'); await tap(item('nav', '이 브라우저에서 지우기'), '이 브라우저에서 지우기')
    const ask = await ev(`({ text: __q.txt(${q('.bbu--nav .bbu__ask p')}), btns: [...document.querySelectorAll('.bbu--nav .bbu__ask button')].filter(__q.vis).map(__q.txt), st: __q.store() })`)
    await shot('pc-clear-ask')
    await tap(item('nav', '취소'), '취소'); const back = await ev(`({ items: [...document.querySelectorAll('.bbu--nav .bbu__item')].filter(__q.vis).length, st: __q.store() })`)
    await tap(item('nav', '이 브라우저에서 지우기'), '이 브라우저에서 지우기'); await tap(item('nav', '지우기'), '지우기'); await sleep(300)
    const gone = await ev(`({ st: __q.store(), chip: __q.chip('nav'), any: document.querySelectorAll('.bbu').length, toast: __q.txt(${q('#toast')}), focus: __q.focus(), mode: __q.mode() })`)
    // 처음 온 사람처럼: 홈으로 갔다가 위 막대의 "집 찾기"를 글쇠(Enter)로 연다
    await hash('#home'); await ev(`${q('a.nav__link[data-route="map"]')}.focus()`); await key('Enter'); await waitMode('start', '시작 화면')
    const s = await card()
    await key('Escape'); await waitMode('tour', '튜토리얼'); const t = await card(), mid = await store()
    await key('Escape'); await waitFor(`!__q.mode()`, '닫힘', 3000); await sleep(400)
    const end = await ev(`({ st: __q.store(), focus: (() => { const a = document.activeElement; return a && a.matches('a.nav__link[data-route="map"]') })(), chip: __q.chip('nav'), hash: location.hash })`)
    const ok = /지울까요/.test(ask.text) && J(ask.btns) === J(['지우기', '취소']) && ask.st.user !== null && back.items === 3 && back.st.user !== null
      && gone.st.user === null && gone.st.tut === null && gone.chip === '이름 정하기' && /지웠어요/.test(gone.toast) && gone.focus === '#menuOpen' && !gone.mode
      && s.mode === 'start' && s.value === '' && t.title === GREET && mid.user && mid.user.name === '' && mid.tut === null
      && end.st.tut === 'done' && end.st.user.name === '' && end.focus && end.chip === '이름 정하기' && end.hash === '#map'
    return { ok, evidence: `확인="${ask.text}" 단추=${J(ask.btns)}(아직 저장 있음=${ask.st.user !== null}) / 취소 → 항목 ${back.items}개 / 지우기 → 저장=${J(gone.st)}, 칩 ${gone.any}개, 알림="${gone.toast}", 커서=${gone.focus} / 다시 들어가면 창=${s.mode}(빈 칸=${s.value === ''}) → Esc → "${t.title}" 저장=${J(mid)} → Esc → 본 기록=${end.st.tut}, 커서가 "집 찾기"로=${end.focus}, 칩="${end.chip}"` }
  })
  await check('PC 9. "이름 없이 둘러보기" 길: 바로 #input 으로 들어옴 → 홈으로 나가면 그냥 닫힘 → 이름 없이 → 건너뛰기', async () => {
    await fresh('#input'); await waitMode('start', '시작 화면'); const s0 = await card()
    await hash('#home'); const out = await ev(`({ mode: __q.mode(), st: __q.store() })`)
    await hash('#input'); await waitMode('start', '시작 화면')
    await tap(btn('이름 없이 둘러보기'), '이름 없이 둘러보기'); await waitMode('tour', '튜토리얼'); const t = await card(), mid = await store()
    await tap(btn('건너뛰기'), '건너뛰기'); await waitFor(`!__q.mode()`, '닫힘', 3000); await sleep(400)
    const st = await store(), chip = await ev(`__q.chip('nav')`)
    await tap(q('.bbu--nav .bbu__chip'), '이름 칩'); const first = await ev(`__q.txt(${q('.bbu--nav .bbu__item')})`)
    await tap(item('nav', '이름 정하기'), '이름 정하기'); await waitMode('rename', '이름 정하기 창'); const r = await card()
    await tap(btn('취소'), '취소'); await waitFor(`!__q.mode()`, '닫힘', 3000); await sleep(300)
    const again = await ev(`(location.hash = '#map', new Promise(r => setTimeout(() => r(__q.mode()), 900)))`)
    const ok = s0.mode === 'start' && !out.mode && out.st.user === null && out.st.tut === null && t.title === GREET && t.kids === 0 && mid.user.name === '' && mid.tut === null
      && st.tut === 'done' && st.user.name === '' && chip === '이름 정하기' && first === '이름 정하기' && r.name === '어떻게 불러 드릴까요?' && J(r.btns) === J(['저장하기', '취소']) && r.value === '' && !again
    return { ok, evidence: `#input 으로 바로: 창=${s0.mode} / 홈으로 나감 → 창="${out.mode}" 저장=${J(out.st)} / 이름 없이 → "${t.title}" 저장=${J(mid)} / 건너뛰기 → 본 기록=${st.tut}, 칩="${chip}", 메뉴 첫 항목="${first}" → 창 "${r.name}" 단추=${J(r.btns)} / 지도로 가도 다시 안 뜸=${!again}` }
  })
  await check('PC 10. 주소 tutorial=1: 본 사람에게도 다시 열림 (지도·홈), 홈에서 열어도 뒤 화면이 밀리거나 따라 움직이지 않음', async () => {
    await reopen('?tutorial=1#map'); await waitMode('tour', '튜토리얼'); const a = await card()
    await key('Escape'); await waitFor(`!__q.mode()`, '닫힘', 3000)
    await reopen('?tutorial=1'); await waitMode('tour', '튜토리얼'); const b = await card()
    const geo = `({ cw: document.documentElement.clientWidth, bar: innerWidth - document.documentElement.clientWidth, x: Math.round(${q('.hero__inner')}.getBoundingClientRect().left), sy: Math.round(scrollY) })`
    const open = await ev(geo), over = await ev('__q.over()')
    await shot('pc-home-tutorial1')
    // 창이 떠 있는 동안: 휠을 굴리거나 PageDown 을 눌러도 뒤의 홈 화면은 그대로여야 한다
    const wheel = async () => { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: 600 }); await sleep(600); return ev('Math.round(scrollY)') }
    const sy1 = await wheel(); await key('PageDown'); await sleep(300); const sy2 = await ev('Math.round(scrollY)')
    await tap(btn('건너뛰기'), '건너뛰기'); await waitFor(`!__q.mode()`, '닫힘', 3000); await sleep(300)
    const shut = await ev(geo), st = await store(), sy3 = await wheel()
    const ok = a.mode === 'tour' && a.count === '1 / 4' && b.mode === 'tour' && open.cw === shut.cw && open.x === shut.x && over.docW <= 1440 && sy1 === open.sy && sy2 === open.sy && sy3 > open.sy && st.tut === 'done'
    return { ok, evidence: `?tutorial=1#map → 창=${a.mode} ${a.count} / ?tutorial=1(홈) → 창=${b.mode} / 열린 동안 화면 폭 ${open.cw}px(세로 막대 ${open.bar}px)·큰 그림 글 x=${open.x} → 닫은 뒤 ${shut.cw}px·x=${shut.x}(같아야 함), 열린 동안 휠 scrollY ${open.sy}→${sy1}·PageDown →${sy2}(그대로여야 함), 닫은 뒤 휠 →${sy3}(다시 움직임)` }
  })
  await check('PC 11. 주소 tutorial=0: 처음 온 사람에게도 둘 다 뜨지 않음 (들어올 때·화면을 옮길 때·직접 물을 때), 주소가 바뀌면 그때 다시 판단', async () => {
    await fresh('?tutorial=0#map'); await sleep(900); const a = await ev('__q.mode()')
    await hash('#input'); const b = await ev('__q.mode()'); await hash('#house'); const c = await ev('__q.mode()'); await hash('#map')
    const ask = await ev('MH.tutorial.maybeStart()'), st = await store(), chips = await ev(`document.querySelectorAll('.bbu').length`)
    // 화면을 새로 읽지 않고 주소에서 tutorial=0 만 뗀다 → 그때는 처음 온 사람으로 본다. 다시 붙이면 또 막는다
    await ev(`history.replaceState(null, '', location.pathname + location.hash)`); const on = await ev('MH.tutorial.maybeStart()'); await sleep(600); const m1 = await ev('__q.mode()')
    await hash('#home'); const m2 = await ev('__q.mode()')
    await ev(`history.replaceState(null, '', location.pathname + '?tutorial=0' + location.hash)`); await hash('#map'); const m3 = await ev('__q.mode()'), off = await ev('MH.tutorial.maybeStart()')
    const ok = !a && !b && !c && ask === false && st.user === null && st.tut === null && chips >= 1 && on === true && m1 === 'start' && !m2 && !m3 && off === false
    return { ok, evidence: `?tutorial=0#map 뜬 창="${a}", #input "${b}", #house "${c}", maybeStart()=${ask}, 저장=${J(st)}, 칩 ${chips}개 / 주소에서 뗀 뒤 maybeStart()=${on} → 창=${m1} / 다시 붙이고 지도로 → 창="${m3}", maybeStart()=${off}` }
  })

  // ═════════ 휴대폰 390x844 (크기 흉내 + 합성 터치) ═════════
  await size(390, 844, true)
  await check('휴대폰 390x844 1. 아래 탭 "집 찾기" → 아래에서 올라오는 시작 시트: 폭 가득, 입력 16px, 단추 44px 이상, 탭 막대 그대로', async () => {
    await fresh('')
    const tab0 = await ev(`__q.rect('.tabbar')`), home = await ev('__q.mode()')
    await tap(q('.tabbar a[data-route="map"]'), '탭 집 찾기'); await waitFor(`location.hash === '#map'`, '#map', 6000); await waitMode('start', '시작 화면')
    const c = await card(), tab1 = await ev(`(() => { const r = ${q('.tabbar')}.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } })()`), over = await ev('__q.over()')
    await shot('m390-start')
    await tap(btn('시작하기'), '시작하기'); const e = await card(); await shot('m390-start-error')
    await typeName(NAME3); await tap(btn('시작하기'), '시작하기'); await waitMode('tour', '튜토리얼')
    const st = await store()
    const ok = !home && c.mode === 'start' && c.x === 0 && c.w === 390 && c.b === 844 && c.y >= 844 * 0.3 && c.extra <= 0 && parseFloat(c.fs) >= 16 && c.inH >= 44 && c.touch.every((h) => h >= 44) && c.focus === '#bbtTitle' && c.note === NOTE
      && tab1.y === tab0.y && tab1.h === tab0.h && over.docW <= 390 && over.bodyW <= 390 && /한 글자 이상/.test(e.err) && e.extra <= 0 && e.b === 844 && st.user.name === NAME3
    return { ok, evidence: `홈에서 뜬 창="${home}" / 시트 x=${c.x} 폭 ${c.w} y=${c.y}~${c.b}(화면 844), 안쪽 스크롤 ${c.extra}px, 입력 글자 ${c.fs}·높이 ${c.inH}px, 단추 닿는 높이=${J(c.touch)}, 커서=${c.focus}(키보드가 저절로 안 올라옴), 탭 막대 y ${tab0.y}→${tab1.y}, 가로 ${over.docW}/390, 빈 값 알림="${e.err}", 저장 이름="${st.user.name}"` }
  })
  await check('휴대폰 390x844 2. 튜토리얼 시트: 네 걸음(이전·다음), 단추 제자리, 닫은 뒤 지도·단지 카드·탭 막대 그대로', async () => {
    const s1 = await card(); await shot('m390-tour-1')
    await tap(btn('다음'), '다음'); const s2 = await card(); await shot('m390-tour-2')
    await tap(btn('이전'), '이전'); const b1 = await card(); await tap(btn('다음'), '다음')
    await tap(btn('다음'), '다음'); const s3 = await card(); await shot('m390-tour-3')
    await tap(btn('다음'), '다음'); const s4 = await card(); await shot('m390-tour-4')
    const all = [s1, s2, s3, s4], over = await ev('__q.over()')
    await tap(btn('시작하기'), '시작하기'); await waitFor(`!__q.mode()`, '닫힘', 3000); await sleep(500)
    const st = await store(), tab = await ev(`__q.rect('.tabbar')`)
    const sheet = (await openCard()) ? await ev(`__q.rect('#panelR')`) : null
    await shot('m390-after'); await tap(q('#ccX'), '단지 카드 닫기')
    const sameH = all.every((s) => s.h === s1.h), sameNext = [s2, s3, s4].every((s) => J(s.next) === J(s2.next)) && s1.next.r === s2.next.r && s1.next.y === s2.next.y
    const ok = s1.title === `${NAME3}님, ${GREET}` && J(all.map((s) => s.count)) === J(['1 / 4', '2 / 4', '3 / 4', '4 / 4']) && b1.count === '1 / 4' && all.every((s) => s.x === 0 && s.w === 390 && s.b === 844 && s.extra <= 0 && s.art && s.touch.every((h) => h >= 44)) && sameH && sameNext
      && J(s1.marks) === J(['● 요건 충족', '◐ 확인 필요', '○ 미충족']) && over.docW <= 390 && st.tut === 'done' && !!tab && tab.b === 844 && !!sheet && sheet.b === 844 - 64
    return { ok, evidence: `"${s1.title}", 걸음=${J(all.map((s) => s.count))}(이전으로 ${b1.count}), 시트 y=${all.map((s) => s.y).join('/')} 높이 ${[...new Set(all.map((s) => s.h))].join('/')}px, 안쪽 스크롤 ${Math.max(...all.map((s) => s.extra))}px, 단추 닿는 높이 최소 ${Math.min(...all.flatMap((s) => s.touch))}px, [다음] 자리=${J(s2.next)}(걸음마다 같음=${sameNext}), 가로 ${over.docW}/390 / 닫은 뒤 본 기록=${st.tut}, 탭 막대 아래 끝 ${tab ? tab.b : '없음'}, 단지 카드 시트 아래 끝 ${sheet ? sheet.b : '안 열림'}(=780)` }
  })
  await check('휴대폰 390x844 3. 이름 칩은 메뉴 패널 안: 이름 보임 → 이름 바꾸기 → 지우기', async () => {
    const bar = await ev(`__q.chip('nav')`)
    await tap(q('#menuOpen'), '메뉴'); await sleep(700)
    const p = await ev(`({ chip: __q.chip('panel'), touch: __q.touchH(${q('.bbu--panel .bbu__chip')}), over: __q.over() })`)
    await tap(q('.bbu--panel .bbu__chip'), '이름 칩'); await sleep(200)
    const m = await ev(`({ items: [...document.querySelectorAll('.bbu--panel .bbu__item')].filter(__q.vis).map(__q.txt), touch: [...document.querySelectorAll('.bbu--panel .bbu__item')].filter(__q.vis).map(b => __q.touchH(b)), box: __q.rect('.bbu--panel .bbu__menu'), panelOpen: document.body.classList.contains('menu-open') })`)
    await shot('m390-panel-chip')
    await tap(item('panel', '이름 바꾸기'), '이름 바꾸기'); await waitMode('rename', '이름 바꾸기 시트'); const r = await card(); await shot('m390-rename')
    await typeName(NAME4); await tap(btn('저장하기'), '저장하기'); await waitFor(`!__q.mode()`, '닫힘', 3000); await sleep(400)
    const after = await ev(`({ chip: __q.chip('panel'), st: __q.store(), panelOpen: document.body.classList.contains('menu-open') })`)
    await tap(q('.bbu--panel .bbu__chip'), '이름 칩'); await tap(item('panel', '이 브라우저에서 지우기'), '이 브라우저에서 지우기'); await shot('m390-panel-ask')
    const askTouch = await ev(`[...document.querySelectorAll('.bbu--panel .bbu__ask button')].filter(__q.vis).map(b => __q.touchH(b))`)
    await tap(item('panel', '지우기'), '지우기'); await sleep(300)
    const gone = await ev(`({ st: __q.store(), any: document.querySelectorAll('.bbu').length, focus: __q.focus() })`)
    await tap(q('#menuClose'), '메뉴 닫기'); await sleep(600)
    const ok = !bar && p.chip === NAME3 + '님' && p.touch >= 44 && p.over.docW <= 390 && m.items.length === 3 && m.touch.every((h) => h >= 44) && m.panelOpen && !!m.box && m.box.r <= 390
      && r.mode === 'rename' && r.value === NAME3 && r.b === 844 && r.w === 390 && after.chip === NAME4 + '님' && after.st.user.name === NAME4 && after.panelOpen
      && askTouch.every((h) => h >= 44) && gone.st.user === null && gone.st.tut === null && gone.any >= 1 && gone.focus === '#menuClose'
    return { ok, evidence: `위 막대의 칩="${bar}"(없어야 함), 패널 안 칩="${p.chip}" 닿는 높이 ${p.touch}px, 항목=${J(m.items)} 닿는 높이=${J(m.touch)} / 이름 바꾸기 시트: 칸="${r.value}" y=${r.y}~${r.b} → 저장 뒤 칩="${after.chip}"(패널 열린 채=${after.panelOpen}) / 지우기 확인 단추 ${J(askTouch)}px → 저장=${J(gone.st)}, 칩 ${gone.any}개, 커서=${gone.focus}` }
  })

  // ═════════ 작은 휴대폰: 스크롤 없이 한 화면에 ═════════
  for (const [w, h] of [[360, 740], [360, 640]]) {
    await size(w, h, true)
    await check(`휴대폰 ${w}x${h}. 시작 시트와 튜토리얼 네 걸음이 스크롤 없이 한 화면에, 가로 스크롤 없음`, async () => {
      await fresh('#map'); await waitMode('start', '시작 화면')
      const s = await card(); await shot(`m${w}x${h}-start`)
      await tap(btn('시작하기'), '시작하기'); const e = await card()
      await tap(btn('이름 없이 둘러보기'), '이름 없이 둘러보기'); await waitMode('tour', '튜토리얼')
      const all = []
      for (let i = 1; i <= 4; i++) { all.push(await card()); await shot(`m${w}x${h}-tour-${i}`); if (i < 4) await tap(btn('다음'), '다음') }
      const over = await ev('__q.over()')
      await tap(btn('건너뛰기'), '건너뛰기'); await waitFor(`!__q.mode()`, '닫힘', 3000)
      const fit = (c) => c.y >= 0 && c.b === h && c.extra <= 0 && c.x === 0 && c.w === w
      const ok = fit(s) && fit(e) && /한 글자 이상/.test(e.err) && all.every((c) => fit(c) && c.touch.every((t) => t >= 44)) && all.every((c) => c.h === all[0].h) && J(all.map((c) => c.count)) === J(['1 / 4', '2 / 4', '3 / 4', '4 / 4']) && all[0].title === GREET && over.docW <= w && over.bodyW <= w
      return { ok, evidence: `시작 시트 y=${s.y}~${s.b}(화면 ${h}) 안쪽 스크롤 ${s.extra}px, 알림이 뜬 뒤 y=${e.y} 스크롤 ${e.extra}px / 튜토리얼 y=${all.map((c) => c.y).join('/')} 높이 ${[...new Set(all.map((c) => c.h))].join('/')}px 안쪽 스크롤 ${Math.max(...all.map((c) => c.extra))}px, 가로 ${over.docW}/${w}` }
    })
  }

  await check('이름이 어떤 요청에도 없음 (주소·머리말·본문)', async () => {
    await sleep(800)
    // 적은 이름 그대로, 주소에 실을 때의 모양(%XX), JSON 에 실을 때의 모양(\\uXXXX) 을 모두 찾는다
    const forms = (n) => [n, encodeURIComponent(n), encodeURIComponent(n).toLowerCase(), encodeURI(n), J(n).slice(1, -1), [...n].map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('')]
    const needles = [...new Set([NAME1, NAME2, NAME3, NAME4, LONG13, '임시모과', '모과'].flatMap(forms))]
    const hits = reqs.filter((r) => needles.some((n) => r.url.includes(n) || r.head.includes(n) || r.body.includes(n) || r.url.toLowerCase().includes(n.toLowerCase())))
    const posts = reqs.filter((r) => r.body).length, api = reqs.filter((r) => /\/api\//.test(r.url)).map((r) => r.url.replace(BASE, ''))
    return { ok: reqs.length > 20 && hits.length === 0 && !api.some((u) => /consult/.test(u)), evidence: `요청 ${reqs.length}건(본문 있는 것 ${posts}건, /api 요청=${J([...new Set(api)])})을 살핌, 이름이 든 요청 ${hits.length}건${hits.length ? ': ' + J(hits.slice(0, 3).map((r) => r.url.slice(0, 120))) : ''}` }
  })
  step = '끝'
}

async function main() {
  if (!EDGE) { console.log('Edge(또는 Chrome)를 찾지 못했어요. EDGE_PATH 환경변수로 실행 파일 위치를 알려 주세요.'); process.exit(1) }
  const port = await new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })
  const profile = mkdtempSync(path.join(os.tmpdir(), 'bangbom-tut-'))
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
  // 화면에서 난 예외와 console.error 는 하나라도 있으면 실패
  rows.push({ what: '화면 예외·console.error 없음', ok: errors.length === 0, evidence: errors.length ? J(errors) : '0건' })
  console.log(`${errors.length ? 'FAIL' : 'OK  '} 화면 예외·console.error 없음 :: ${errors.length ? J(errors, null, 1) : '0건'}`)
  if (notes.length) console.log('\n메모\n' + [...new Set(notes)].join('\n'))
  const bad = rows.filter((r) => !r.ok)
  console.log(`\n${BASE} · 검사 ${rows.length}개 중 통과 ${rows.length - bad.length}개, 실패 ${bad.length}개 (엔진: Chromium(Edge) 헤드리스, 휴대폰은 크기 흉내 + 합성 터치)`)
  process.exit(bad.length ? 1 : 0)
}
main()

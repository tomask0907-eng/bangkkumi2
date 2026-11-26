#!/usr/bin/env node
// 실제 브라우저로 눌러 보는 점검. 새 패키지 없이 Node 내장 WebSocket·fetch로 Chrome DevTools Protocol에 붙는다.
// @ts-nocheck — 브라우저 안에서 도는 코드 조각(document 등)이 섞여 있어, Node용 타입 검사에서는 이 파일만 건너뛴다.
//
// 쓰는 법:  node scripts/e2e-smoke.mjs [주소]        (주소를 안 쓰면 http://localhost:4180)
// 먼저 `npm run build` 뒤 `npm run serve`로 미리보기 서버를 켜 둔다.
//
// 환경변수(모두 선택):
//   E2E_SHOTS        화면 그림(PNG)을 저장할 폴더
//   E2E_PROFILE      브라우저 프로필 폴더. 안 쓰면 임시 폴더를 만들고 끝나면 지운다
//   E2E_BROWSER      브라우저 실행 파일 경로 (기본: 설치된 Edge 또는 Chrome)
//   E2E_ONLY         pc 또는 phone 만 돌리기
//   E2E_IDS          이 번호로 시작하는 점검만 돌리기. 쉼표로 여러 개 (예: 1-,12-3). 앞 점검에 기대는 점검은 같이 골라야 한다
//   E2E_3D_SWITCHES  2D↔3D 를 되풀이해 바꾸는 횟수 (기본 10)
//   E2E_NO_AI        1 이면 AI를 부르는 주소(/api/advice 등)를 막고 규칙 기반 기본 답으로 점검한다 (AI 호출 횟수를 아낄 때)
//
// 한 줄에 점검 하나씩 "통과" 또는 "실패 — 이유"를 찍는다. 콘솔 오류와 잡히지 않은 예외도 실패로 센다.
// 하나라도 실패하면 종료 코드 1. 브라우저는 어떤 경우에도 닫는다.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const BASE_URL = (process.argv[2] || 'http://localhost:4180').replace(/\/+$/, '')
const SHOTS_DIR = process.env.E2E_SHOTS || ''
const PROFILE_DIR = process.env.E2E_PROFILE || ''
const ONLY = (process.env.E2E_ONLY || '').toLowerCase()
const IDS = (process.env.E2E_IDS || '').split(',').map((part) => part.trim()).filter(Boolean)
const SWITCHES = Math.max(1, Number(process.env.E2E_3D_SWITCHES) || 10)
const NO_AI = process.env.E2E_NO_AI === '1'
const TOTAL_LIMIT_MS = 12 * 60 * 1000

const PROJECT_KEY = 'bangkkumi2.project'
const COACH_KEY = 'bangkkumi2.onboardingDone'
const FALLBACK_NOTICE = '규칙으로 만든 기본 답이에요 (AI 연결 안 됨)'

const VIEWPORTS = [
  { key: 'pc', label: 'PC', width: 1280, height: 800, scale: 1, mobile: false, touch: false },
  { key: 'phone', label: '휴대폰', width: 390, height: 844, scale: 2, mobile: true, touch: true },
]

const BROWSER_PATHS = [
  process.env.E2E_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms))
const J = JSON.stringify

/** 점검이 틀렸을 때 던진다 */
function must(/** @type {unknown} */ ok, /** @type {string} */ reason) {
  if (!ok) throw new Error(reason)
}

// ── 페이지 안에 심는 도우미 ─────────────────────────────────────────────
// 이 함수는 글자로 바뀌어 페이지 안에서 실행된다. 바깥 변수를 쓰면 안 된다.
function installHelpers() {
  const KEY = 'bangkkumi2.project'
  /** @param {Element | null} el */
  const isVisible = (el) => {
    if (!el || !el.isConnected) return false
    const box = el.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }
  /** @param {Element | null} el */
  const text = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '')
  /** @param {Element} el */
  const describe = (el) => {
    const label = el.getAttribute('aria-label')
    const words = text(el).slice(0, 30)
    const cls = typeof el.className === 'string' ? el.className.split(' ').slice(0, 3).join('.') : ''
    return `<${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}>${label ? ` [${label}]` : ''}${words ? ` "${words}"` : ''}`
  }
  const api = {
    isVisible,
    text,
    describe,
    project() {
      try {
        return JSON.parse(localStorage.getItem(KEY) || 'null')
      } catch {
        return null
      }
    },
    room() {
      const project = api.project()
      if (!project || !Array.isArray(project.rooms)) return null
      return project.rooms.find((/** @type {{id: string}} */ r) => r.id === project.activeRoomId) || project.rooms[0] || null
    },
    /** @param {string} selector @param {ParentNode} [root] */
    all(selector, root) {
      return [...(root || document).querySelectorAll(selector)].filter(isVisible)
    },
    /** @param {string} selector @param {string} wanted @param {boolean} [exact] */
    byText(selector, wanted, exact = true) {
      return api.all(selector).find((el) => (exact ? text(el) === wanted : text(el).includes(wanted))) || null
    },
    /** @param {string} label @param {boolean} [exact] */
    byLabel(label, exact = true) {
      return (
        api.all('[aria-label]').find((el) => {
          const value = el.getAttribute('aria-label') || ''
          return exact ? value === label : value.includes(label)
        }) || null
      )
    },
    /** 라벨 글자로 입력 칸 찾기 @param {string} label */
    field(label) {
      const tag = api.all('label').find((el) => text(el) === label)
      const id = tag ? tag.getAttribute('for') : null
      return id ? document.getElementById(id) : null
    },
    /** 접는 구역의 제목 버튼 @param {string} title */
    fold(title) {
      return api.all('button[aria-expanded]').find((el) => text(el.firstElementChild) === title) || null
    },
    svg() {
      return document.querySelector('svg[role="application"]')
    },
    /** 방 좌표(cm) → 화면 좌표(px) @param {number} x @param {number} y */
    cmToClient(x, y) {
      const svg = /** @type {SVGSVGElement | null} */ (api.svg())
      const matrix = svg ? svg.getScreenCTM() : null
      if (!matrix) return null
      const point = new DOMPoint(x, y).matrixTransform(matrix)
      return { x: point.x, y: point.y }
    },
    pxPerCm() {
      const svg = /** @type {SVGSVGElement | null} */ (api.svg())
      const matrix = svg ? svg.getScreenCTM() : null
      return matrix ? matrix.a : 0
    },
    /** 화면에 그려진 가구들의 바닥 차지 영역(cm) */
    pieces() {
      return [...document.querySelectorAll('[data-piece-id]')].map((g) => {
        const body = g.querySelectorAll(':scope > rect')[1]
        return {
          id: g.getAttribute('data-piece-id'),
          label: g.getAttribute('aria-label'),
          x: Number(body.getAttribute('x')),
          y: Number(body.getAttribute('y')),
          w: Number(body.getAttribute('width')),
          h: Number(body.getAttribute('height')),
        }
      })
    },
    /** 화면의 가구와 저장된 자료의 좌표가 같은지 */
    inSync() {
      if (!api.svg()) return true
      const room = api.room()
      if (!room) return false
      const drawn = api.pieces()
      if (drawn.length !== room.furniture.length) return false
      return drawn.every((piece) => {
        const item = room.furniture.find((/** @type {{id: string}} */ f) => f.id === piece.id)
        if (!item) return false
        const turned = item.rotation === 90 || item.rotation === 270
        const w = turned ? item.depthCm : item.widthCm
        const h = turned ? item.widthCm : item.depthCm
        return item.xCm === piece.x && item.yCm === piece.y && w === piece.w && h === piece.h
      })
    },
    /** 누를 자리와, 그 자리가 다른 것에 가려졌는지 @param {Element} el */
    point(el) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const box = el.getBoundingClientRect()
      const x = box.left + box.width / 2
      const y = box.top + box.height / 2
      const inView = x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight
      const top = inView ? document.elementFromPoint(x, y) : null
      return {
        x,
        y,
        width: box.width,
        height: box.height,
        inView,
        hit: !!top && (top === el || el.contains(top)),
        cover: top ? describe(top) : '',
        disabled: /** @type {HTMLButtonElement} */ (el).disabled === true,
      }
    },
    /** 가구에서 가려지지 않은 누를 자리 @param {string} id */
    piecePoint(id) {
      const g = document.querySelector(`[data-piece-id="${id}"]`)
      if (!g) return null
      const piece = api.pieces().find((entry) => entry.id === id)
      if (!piece) return null
      const tries = [
        [0.5, 0.5],
        [0.5, 0.72],
        [0.5, 0.28],
        [0.28, 0.5],
        [0.72, 0.5],
        [0.28, 0.72],
        [0.72, 0.72],
        [0.28, 0.28],
        [0.72, 0.28],
      ]
      for (const [fx, fy] of tries) {
        const p = api.cmToClient(piece.x + piece.w * fx, piece.y + piece.h * fy)
        if (!p) return null
        const top = document.elementFromPoint(p.x, p.y)
        if (top && g.contains(top)) return { x: p.x, y: p.y, free: true, cover: '', piece }
      }
      const c = api.cmToClient(piece.x + piece.w / 2, piece.y + piece.h / 2)
      const top = c ? document.elementFromPoint(c.x, c.y) : null
      return { x: c ? c.x : 0, y: c ? c.y : 0, free: false, cover: top ? describe(top) : '화면 밖', piece }
    },
    /** 선택한 가구의 손잡이 8개가 눌리는 자리인지 @param {string} id */
    handles(id) {
      const svg = api.svg()
      const piece = api.pieces().find((entry) => entry.id === id)
      if (!svg || !piece) return []
      const out = []
      for (const hy of [-1, 0, 1]) {
        for (const hx of [-1, 0, 1]) {
          if (hx === 0 && hy === 0) continue
          const p = api.cmToClient(piece.x + ((hx + 1) / 2) * piece.w, piece.y + ((hy + 1) / 2) * piece.h)
          if (!p) continue
          const top = document.elementFromPoint(p.x, p.y)
          const free = !!top && svg.contains(top) && !top.closest('[data-piece-id]')
          out.push({ hx, hy, x: p.x, y: p.y, free, cover: top ? describe(top) : '화면 밖' })
        }
      }
      return out
    },
    /** 선택한 가구의 크기 글자 ("120 × 60 cm") */
    sizeLabel() {
      const svg = api.svg()
      if (!svg) return ''
      const found = [...svg.querySelectorAll('text')].map(text).find((value) => /^\d+ × \d+ cm$/.test(value))
      return found || ''
    },
    /** 피드백 패널에 보이는 내용 */
    feedback() {
      const root = api.all('section[aria-label="배치 피드백"]')[0]
      if (!root) return null
      /** @type {{ kind: string, title: string, message: string }[]} */
      const items = []
      for (const card of root.querySelectorAll('.card')) {
        const chip = card.querySelector('.chip')
        const kind = text(chip)
        if (kind !== '문제' && kind !== '제안') continue
        items.push({ kind, title: text(card.children[1]), message: text(card.children[2]) })
      }
      /** @type {Record<string, string>} */
      const badges = {}
      for (const head of root.querySelectorAll('button[aria-expanded]')) {
        badges[text(head.firstElementChild)] = text(head.querySelector('.chip'))
      }
      return {
        errors: items.filter((item) => item.kind === '문제'),
        tips: items.filter((item) => item.kind === '제안'),
        badges,
      }
    },
    /** 비용 요약 카드의 줄들 */
    costRows() {
      /** @type {Record<string, string>} */
      const rows = {}
      for (const row of api.all('dl.card > div')) rows[text(row.querySelector('dt'))] = text(row.querySelector('dd'))
      return rows
    },
    /** 화면 밖으로 잘려 나간 것들 (가로) */
    clipped() {
      const out = []
      for (const el of document.querySelectorAll('#root *')) {
        if (!isVisible(el) || el.closest('svg')) continue
        const box = el.getBoundingClientRect()
        if (box.width < 2 || box.height < 2) continue
        if (box.right > innerWidth + 1 || box.left < -1) out.push(`${describe(el)} (왼쪽 ${Math.round(box.left)}, 오른쪽 ${Math.round(box.right)})`)
        if (out.length >= 5) break
      }
      return out
    },
    /** 고장 안내가 떠 있으면 그 글 */
    crashNotes() {
      return api
        .all('[role="alert"]')
        .map(text)
        .filter((value) => /못했어요|열 수 없어요|멈췄어요/.test(value))
    },
  }
  // @ts-expect-error 점검용 전역
  window.__e2e = api
}

// ── PNG 읽기 (화면 그림의 픽셀을 보려고) ────────────────────────────────
/** @param {Buffer} buffer */
function decodePng(buffer) {
  let pos = 8
  let width = 0
  let height = 0
  let colorType = 6
  /** @type {Buffer[]} */
  const chunks = []
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos)
    const type = buffer.toString('latin1', pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]
      if (data[8] !== 8 || data[12] !== 0) throw new Error('읽을 수 없는 PNG 형식이에요')
    } else if (type === 'IDAT') chunks.push(data)
    else if (type === 'IEND') break
    pos += 12 + length
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1
  const raw = zlib.inflateSync(Buffer.concat(chunks))
  const stride = width * bpp
  const out = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = y * (stride + 1) + 1
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0
      let value = raw[line + x]
      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[y * stride + x] = value & 255
    }
  }
  return { width, height, bpp, data: out }
}

/** 색이 몇 가지인지, 가장 많은 색이 얼마나 차지하는지 @param {ReturnType<typeof decodePng>} png */
function imageStats(png) {
  /** @type {Map<number, number>} */
  const counts = new Map()
  let total = 0
  for (let y = 0; y < png.height; y += 2) {
    for (let x = 0; x < png.width; x += 2) {
      const i = (y * png.width + x) * png.bpp
      const key = ((png.data[i] >> 3) << 10) | ((png.data[i + 1] >> 3) << 5) | (png.data[i + 2] >> 3)
      counts.set(key, (counts.get(key) || 0) + 1)
      total += 1
    }
  }
  let most = 0
  for (const count of counts.values()) most = Math.max(most, count)
  return { colors: counts.size, dominant: total ? most / total : 1 }
}

/** 두 그림에서 다른 픽셀의 비율 @param {ReturnType<typeof decodePng>} a @param {ReturnType<typeof decodePng>} b */
function imageDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height || a.bpp !== b.bpp) return 1
  let differ = 0
  let total = 0
  for (let y = 0; y < a.height; y += 2) {
    for (let x = 0; x < a.width; x += 2) {
      const i = (y * a.width + x) * a.bpp
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
      if (d > 30) differ += 1
      total += 1
    }
  }
  return total ? differ / total : 0
}

// ── 브라우저 띄우기와 CDP 연결 ──────────────────────────────────────────
function findBrowser() {
  const found = BROWSER_PATHS.find((candidate) => candidate && existsSync(candidate))
  if (!found) throw new Error('Edge나 Chrome을 찾지 못했어요. E2E_BROWSER에 실행 파일 경로를 넣어 주세요.')
  return found
}

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

class Cdp {
  /** @param {WebSocket} socket */
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    /** 브라우저가 꺼졌거나 연결이 끊겼는지 */
    this.closed = false
    /** @type {Map<number, { resolve: (value: any) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }>} */
    this.pending = new Map()
    /** @type {Map<string, Set<(params: any) => void>>} */
    this.listeners = new Map()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (typeof message.id === 'number') {
        const waiting = this.pending.get(message.id)
        if (!waiting) return
        this.pending.delete(message.id)
        clearTimeout(waiting.timer)
        if (message.error) waiting.reject(new Error(`CDP 오류: ${message.error.message}`))
        else waiting.resolve(message.result)
      } else if (message.method) {
        for (const listener of this.listeners.get(message.method) || []) listener(message.params)
      }
    })
    socket.addEventListener('close', () => {
      this.closed = true
      for (const waiting of this.pending.values()) {
        clearTimeout(waiting.timer)
        waiting.reject(new Error('브라우저 연결이 끊겼어요'))
      }
      this.pending.clear()
    })
  }

  /** @param {string} method @param {Record<string, unknown>} [params] @returns {Promise<any>} */
  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('브라우저 연결이 끊겼어요'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP 응답이 없어요: ${method}`))
      }, 30000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(J({ id, method, params }))
    })
  }

  /** @param {string} event @param {(params: any) => void} listener */
  on(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)?.add(listener)
  }

  /** 이벤트를 한 번 기다린다 @param {string} event @param {number} timeoutMs */
  once(event, timeoutMs) {
    return new Promise((resolve, reject) => {
      const set = this.listeners.get(event) || new Set()
      this.listeners.set(event, set)
      const timer = setTimeout(() => {
        set.delete(listener)
        reject(new Error(`${Math.round(timeoutMs / 1000)}초 안에 화면이 열리지 않았어요`))
      }, timeoutMs)
      const listener = (/** @type {any} */ params) => {
        clearTimeout(timer)
        set.delete(listener)
        resolve(params)
      }
      set.add(listener)
    })
  }
}

/** @param {string} url @returns {Promise<WebSocket>} */
function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.addEventListener('open', () => resolve(socket))
    socket.addEventListener('error', () => reject(new Error('브라우저에 연결하지 못했어요')))
  })
}

// ── 점검 본체 ───────────────────────────────────────────────────────────
/** @type {{ line: string }[]} */
const failures = []
let passCount = 0
/** @type {{ kind: string, text: string, during: string }[]} */
const pageErrors = []
/** @type {{ level: string, text: string }[]} */
const pageWarnings = []
let currentCheck = '시작 전'

/** @param {Cdp} cdp */
async function runAll(cdp) {
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installHelpers.toString()})()` })
  if (NO_AI) {
    // AI를 부르는 주소만 막는다. 화면은 15초를 기다리지 않고 바로 기본 답을 보여 준다 (/api/health 는 그대로 둔다)
    await cdp.send('Network.enable')
    await cdp.send('Network.setBlockedURLs', { urls: ['*/api/advice*', '*/api/furniture*', '*/api/style*', '*/api/floorplan*', '*/api/render-photo*', '*/api/consult*'] })
    console.log('AI 주소를 막고 기본 답으로 점검해요 (E2E_NO_AI=1)')
  }

  cdp.on('Runtime.exceptionThrown', (params) => {
    const detail = params.exceptionDetails || {}
    const textValue = (detail.exception && (detail.exception.description || detail.exception.value)) || detail.text || '알 수 없는 예외'
    pageErrors.push({ kind: '잡히지 않은 예외', text: String(textValue).split('\n').slice(0, 3).join(' | '), during: currentCheck })
  })
  cdp.on('Log.entryAdded', (params) => {
    const entry = params.entry || {}
    // 일부러 막아 둔 AI 주소의 "막혔어요" 기록은 오류로 세지 않는다
    if (NO_AI && /ERR_BLOCKED_BY_CLIENT/.test(entry.text || '')) return
    const line = `${entry.text || ''}${entry.url ? ` (${entry.url})` : ''}`
    if (entry.level === 'error') pageErrors.push({ kind: `콘솔 오류(${entry.source})`, text: line, during: currentCheck })
    else pageWarnings.push({ level: entry.level, text: line })
  })
  cdp.on('Runtime.consoleAPICalled', (params) => {
    const line = (params.args || []).map((/** @type {any} */ arg) => arg.value ?? arg.description ?? '').join(' ')
    if (params.type === 'error') pageErrors.push({ kind: 'console.error', text: line.split('\n').slice(0, 3).join(' | '), during: currentCheck })
    else if (params.type === 'warning') pageWarnings.push({ level: 'warning', text: line })
  })

  /** @param {string} expression @returns {Promise<any>} */
  async function ev(expression) {
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails
      throw new Error(`페이지 안 계산 오류: ${(detail.exception && detail.exception.description) || detail.text}`.split('\n')[0])
    }
    return result.result.value
  }

  /** @param {string} expression @param {string} what @param {number} [timeoutMs] @returns {Promise<any>} */
  async function waitFor(expression, what, timeoutMs = 8000) {
    const end = Date.now() + timeoutMs
    for (;;) {
      try {
        const value = await ev(`(() => { try { const v = (${expression}); return v instanceof Node ? true : v } catch { return null } })()`)
        if (value) return value
      } catch {
        // 화면이 바뀌는 중이면 잠깐 계산이 안 된다. 다시 해 본다
      }
      if (Date.now() > end) throw new Error(`${what}: ${Math.round(timeoutMs / 1000)}초를 기다려도 되지 않았어요`)
      await sleep(100)
    }
  }

  for (const vp of VIEWPORTS) {
    if (ONLY && ONLY !== vp.key) continue
    await runViewport(vp)
  }

  /** @param {typeof VIEWPORTS[number]} vp */
  async function runViewport(vp) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: vp.scale,
      mobile: vp.mobile,
      screenWidth: vp.width,
      screenHeight: vp.height,
    })
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: vp.touch, maxTouchPoints: vp.touch ? 5 : 1 })

    /** 지금 화면 크기. 몇몇 점검은 다른 크기(360×740, 태블릿, 키보드가 올라온 높이)로 잠깐 바꿨다가 되돌린다 */
    const view = { width: vp.width, height: vp.height }
    /** @param {number} width @param {number} height */
    async function resize(width, height) {
      view.width = width
      view.height = height
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: vp.scale, mobile: vp.mobile, screenWidth: width, screenHeight: height })
    }

    /** @param {string} id @param {string} title @param {() => Promise<string | void>} run */
    async function check(id, title, run) {
      if (IDS.length > 0 && !IDS.some((prefix) => id.startsWith(prefix))) return
      const name = `[${vp.label}] ${id} ${title}`
      if (cdp.closed) throw new Error(`브라우저가 도중에 꺼졌어요 (${name} 앞에서)`)
      currentCheck = name
      const errorsBefore = pageErrors.length
      let reason = ''
      let note = ''
      try {
        note = (await run()) || ''
        const crash = await ev('window.__e2e ? __e2e.crashNotes() : []').catch(() => [])
        if (crash.length > 0) reason = `고장 안내가 떠 있어요: ${crash.join(' / ')}`
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error)
      }
      await sleep(50)
      const fresh = pageErrors.slice(errorsBefore)
      if (!reason && fresh.length > 0) reason = `${fresh[0].kind}: ${fresh[0].text}`
      else if (reason && fresh.length > 0) reason += ` (+ ${fresh[0].kind}: ${fresh[0].text})`
      if (reason) {
        const line = `실패 ${name} — ${reason}`
        failures.push({ line })
        console.log(line)
        await shot(`fail-${id}`)
      } else {
        passCount += 1
        console.log(`통과 ${name}${note ? ` (${note})` : ''}`)
      }
    }

    /** @param {string} name */
    async function shot(name) {
      if (!SHOTS_DIR) return
      try {
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(path.join(SHOTS_DIR, `${vp.key}-${name}.png`), Buffer.from(data, 'base64'))
      } catch {
        // 그림 저장 실패는 점검 결과에 넣지 않는다
      }
    }

    // ── 입력 ──
    /** @param {number} x @param {number} y */
    async function tapAt(x, y) {
      if (vp.touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
        await sleep(40)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      } else {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0, pointerType: 'mouse' })
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' })
        await sleep(30)
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' })
      }
      await sleep(150)
    }

    /** 실제 포인터로 끌기 @param {{x: number, y: number}} from @param {{x: number, y: number}} to */
    async function dragPx(from, to, steps = 10) {
      const end = {
        x: Math.min(view.width - 2, Math.max(2, to.x)),
        y: Math.min(view.height - 2, Math.max(2, to.y)),
      }
      const at = (/** @type {number} */ i) => ({
        x: from.x + ((end.x - from.x) * i) / steps,
        y: from.y + ((end.y - from.y) * i) / steps,
      })
      if (vp.touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] })
        await sleep(60)
        for (let i = 1; i <= steps; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...at(i), id: 1 }] })
          await sleep(30)
        }
        await sleep(60)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      } else {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0, pointerType: 'mouse' })
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' })
        await sleep(60)
        for (let i = 1; i <= steps; i++) {
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at(i), button: 'left', buttons: 1, pointerType: 'mouse' })
          await sleep(30)
        }
        await sleep(60)
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' })
      }
      await sleep(150)
    }

    /** @type {Record<string, { code: string, vk: number, text?: string }>} */
    const KEYS = {
      Delete: { code: 'Delete', vk: 46 },
      Backspace: { code: 'Backspace', vk: 8 },
      Enter: { code: 'Enter', vk: 13, text: '\r' },
      Escape: { code: 'Escape', vk: 27 },
      ArrowLeft: { code: 'ArrowLeft', vk: 37 },
      ArrowUp: { code: 'ArrowUp', vk: 38 },
      ArrowRight: { code: 'ArrowRight', vk: 39 },
      ArrowDown: { code: 'ArrowDown', vk: 40 },
    }

    /** 키 하나를 눌렀다 뗀다 @param {string} key @param {{ ctrl?: boolean, shift?: boolean }} [mods] */
    async function press(key, mods = {}) {
      const def = KEYS[key] || { code: `Key${key.toUpperCase()}`, vk: key.toUpperCase().charCodeAt(0), text: key }
      const modifiers = (mods.ctrl ? 2 : 0) | (mods.shift ? 8 : 0)
      const textValue = mods.ctrl ? undefined : def.text
      // nativeVirtualKeyCode는 넣지 않는다. 넣으면 헤드리스 Edge가 Ctrl+C에서 통째로 꺼진다(앱과 상관없는 브라우저 문제)
      const common = { key, code: def.code, windowsVirtualKeyCode: def.vk, modifiers }
      await cdp.send('Input.dispatchKeyEvent', { type: textValue ? 'keyDown' : 'rawKeyDown', ...common, text: textValue, unmodifiedText: textValue })
      await sleep(30)
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common })
      await sleep(90)
    }

    /** 화면의 것 하나를 찾아 누른다. 가려져 있거나 꺼져 있으면 실패 @param {string} expression @param {string} what */
    async function clickEl(expression, what) {
      const p = await ev(`(() => { const el = ${expression}; return el ? __e2e.point(el) : null })()`)
      must(p, `'${what}'을(를) 화면에서 찾지 못했어요`)
      must(!p.disabled, `'${what}'이(가) 꺼져 있어서 누를 수 없어요`)
      must(p.inView, `'${what}'이(가) 화면 밖에 있어요 (x ${Math.round(p.x)}, y ${Math.round(p.y)})`)
      must(p.hit, `'${what}'이(가) 다른 것에 가려져서 누를 수 없어요: ${p.cover}`)
      await tapAt(p.x, p.y)
    }

    /** 입력 칸을 눌러 글자를 바꿔 넣는다 @param {string} expression @param {string} value @param {string} what */
    async function typeInto(expression, value, what) {
      await clickEl(expression, what)
      const focused = await ev(`(() => { const el = ${expression}; if (el !== document.activeElement) return false; el.select(); return true })()`)
      must(focused, `'${what}'을(를) 눌러도 입력할 수 있게 되지 않았어요`)
      await cdp.send('Input.insertText', { text: value })
      await sleep(120)
    }

    const button = (/** @type {string} */ label) => `__e2e.byText('button', ${J(label)})`
    const navButton = (/** @type {string} */ label) => `__e2e.byText('nav[aria-label="메뉴"] button', ${J(label)})`
    const furnitureTab = (/** @type {string} */ label) => `__e2e.all('[role="tab"]').find((el) => __e2e.text(el).startsWith(${J(label)}))`
    // 휴대폰: 시트 머리줄의 카테고리 칩 하나, 아래 탭 바의 [피드백]
    const sheetTab = (/** @type {string} */ label) => `__e2e.all('section[aria-label="조작 패널"] [role="tab"]').find((el) => __e2e.text(el).startsWith(${J(label)}))`
    const feedbackNav = `__e2e.all('nav[aria-label="메뉴"] button').find((el) => __e2e.text(el).includes('피드백'))`

    /** 휴대폰에서만: 시트의 칩을 눌러 그 항목을 연다 @param {string} label */
    async function openSheetTab(label) {
      if (!vp.touch) return
      await clickEl(sheetTab(label), `시트의 [${label}] 칩`)
      must(await ev(`${sheetTab(label)}.getAttribute('aria-selected') === 'true'`), `[${label}] 칩을 눌러도 켜지지 않아요`)
    }

    /** @param {string} label */
    async function goCategory(label) {
      await clickEl(navButton(label), `${label} 메뉴`)
      await waitFor(`__e2e.byText('h2.panel-title', ${J(label)})`, `${label} 패널`)
    }

    /** 자동 저장(0.4초)을 기다린 뒤, 화면과 저장된 자료가 같은지 본다 */
    async function settle() {
      await sleep(750)
      await waitFor('__e2e.inSync()', '화면의 가구 위치와 자동 저장된 자료가 같아지기', 4000)
    }

    /** @returns {Promise<any>} 저장된 지금 방 */
    async function savedRoom() {
      await settle()
      return ev('__e2e.room()')
    }

    /** @param {string} url */
    async function open(url) {
      const loaded = cdp.once('Page.loadEventFired', 45000)
      loaded.catch(() => {}) // 아래에서 먼저 실패해도 프로그램이 죽지 않게 한다
      const result = await cdp.send('Page.navigate', { url })
      must(!result.errorText, `주소를 열지 못했어요: ${result.errorText}`)
      await loaded
      await waitFor(`typeof __e2e === 'object' && document.querySelector('#root') && document.querySelector('#root').children.length > 0`, '첫 화면이 그려지기', 20000)
    }

    async function reload() {
      const loaded = cdp.once('Page.loadEventFired', 45000)
      loaded.catch(() => {})
      await cdp.send('Page.reload')
      await loaded
      await waitFor(`typeof __e2e === 'object' && document.querySelector('#root') && document.querySelector('#root').children.length > 0`, '새로고침 뒤 화면이 그려지기', 20000)
    }

    /**
     * 방꾸미 주소. 첫 방문 도움말을 보는 점검(coach)이 아니면 tips=0을 붙여서, 어떤 점검에도 도움말이 끼어들지 않게 한다
     * @param {{ coach?: boolean }} options @param {string} [extra]
     */
    const roomUrl = (options, extra = '') => `${BASE_URL}/room.html?${[extra, options.coach ? '' : 'tips=0'].filter(Boolean).join('&')}`.replace(/\?$/, '')

    /** 이 기기에 처음 온 것처럼, 저장된 방과 "도움말을 닫았다"는 기억을 지운다 @param {boolean} [waitForSave] */
    async function clearSaved(waitForSave = true) {
      const origin = await ev('location.origin').catch(() => '')
      if (origin !== new URL(BASE_URL).origin) await open(`${BASE_URL}/room.html?tips=0`)
      // 앞 점검이 예약해 둔 자동 저장(배치안 0.25초 + 저장 0.4초)이 끝나게 한다. 안 그러면 화면을 떠날 때 다시 저장된다
      if (waitForSave) await sleep(800)
      await ev(`(() => { localStorage.removeItem(${J(PROJECT_KEY)}); localStorage.removeItem(${J(COACH_KEY)}) })()`)
    }

    /** 저장된 것을 지우고 시작 화면을 연다 @param {{ coach?: boolean }} [options] */
    async function gotoStart(options = {}) {
      await clearSaved()
      await open(roomUrl(options))
      await waitFor(`__e2e.byText('h2', '방 크기 설정')`, '시작 화면')
    }

    /**
     * 예시 방으로 시작한다. 시작 화면의 예시 단추는 없앴고, 주소 옵션 ?example=1(숨은 연결)로 연다
     * @param {{ coach?: boolean }} [options]
     */
    async function startExample(options = {}) {
      await clearSaved(false) // 예시로 시작하면 앞에 저장된 방은 어차피 덮인다
      await open(roomUrl(options, 'example=1'))
      await waitFor('__e2e.svg() && __e2e.pieces().length > 0', '예시 방 평면도')
      // example=1이 주소에 남으면 새로고침할 때마다 예시 방이 새로 시작된다. 보통 방문처럼 그 옵션만 뗀다
      await ev(`history.replaceState(null, '', ${J(roomUrl(options))})`)
      await sleep(200)
    }

    /** @param {number} widthCm @param {number} depthCm */
    async function startEmpty(widthCm, depthCm) {
      await gotoStart()
      await typeInto(`__e2e.field('가로 (cm)')`, String(widthCm), '가로 칸')
      await typeInto(`__e2e.field('세로 (cm)')`, String(depthCm), '세로 칸')
      await clickEl(button('이 크기로 시작'), '이 크기로 시작')
      await waitFor('__e2e.svg()', '빈 방 평면도')
      await sleep(200)
    }

    // ── 가구 다루기 ──
    /** @param {string} id */
    async function piecePoint(id) {
      const p = await ev(`__e2e.piecePoint(${J(id)})`)
      must(p, `평면도에서 가구(${id})를 찾지 못했어요`)
      must(p.free, `가구(${id})가 다른 것에 가려져 누를 수 없어요: ${p.cover}`)
      return p
    }

    /** @param {string} id */
    async function selectPiece(id) {
      const p = await piecePoint(id)
      await tapAt(p.x, p.y)
      await waitFor(`!!__e2e.all('[role="toolbar"]')[0]`, '가구를 누른 뒤 도구 막대가 뜨기', 3000)
    }

    /** 가구를 cm만큼 끈다 @param {string} id @param {number} dxCm @param {number} dyCm */
    async function dragPieceBy(id, dxCm, dyCm) {
      const p = await piecePoint(id)
      const k = await ev('__e2e.pxPerCm()')
      await dragPx({ x: p.x, y: p.y }, { x: p.x + dxCm * k, y: p.y + dyCm * k })
    }

    /** 가구를 골라 둔 채, 가구 안쪽 왼쪽 가장자리 6px 안을 눌러 40cm·20cm 끈다. 크기는 그대로이고 자리만 바뀌어야 한다 @param {string} id */
    async function dragSelectedNearEdge(id) {
      await selectPiece(id)
      const p = await piecePoint(id)
      const k = await ev('__e2e.pxPerCm()')
      // 벽에 붙은 가구는 벽 쪽으로 못 가니, 방 안쪽으로 끈다
      const before = p.piece, dx = before.x > 100 ? -40 : 40, dy = before.y > 100 ? -20 : 20
      const fx = p.x - (before.w * k) / 2 + Math.min(6, (before.w * k) / 4)
      await dragPx({ x: fx, y: p.y }, { x: fx + dx * k, y: p.y + dy * k })
      const after = (await piecePoint(id)).piece
      return { before, after, dx, dy }
    }

    /** 가구의 왼쪽 위가 (xCm, yCm)에 오도록 끈다 @param {string} id @param {number} xCm @param {number} yCm */
    async function dragPieceTo(id, xCm, yCm) {
      const p = await piecePoint(id)
      await dragPieceBy(id, xCm - p.piece.x, yCm - p.piece.y)
    }

    /** @param {any} item */
    const footprintOf = (item) => {
      const turned = item.rotation === 90 || item.rotation === 270
      return { x: item.xCm, y: item.yCm, w: turned ? item.depthCm : item.widthCm, h: turned ? item.widthCm : item.depthCm }
    }
    /** @param {any} room @param {any} item */
    const insideRoom = (room, item) => {
      const f = footprintOf(item)
      return f.x >= 0 && f.y >= 0 && f.x + f.w <= room.widthCm && f.y + f.h <= room.depthCm
    }
    /** 1cm 이상 겹치는지 @param {any} a @param {any} b */
    const overlaps = (a, b) => {
      const p = footprintOf(a)
      const q = footprintOf(b)
      return Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) >= 1 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) >= 1
    }
    /** @param {any} room @param {string} id */
    const itemOf = (room, id) => room.furniture.find((/** @type {any} */ item) => item.id === id)
    /** @param {any} room */
    const spots = (room) => Object.fromEntries(room.furniture.map((/** @type {any} */ item) => [item.id, `${item.xCm},${item.yCm},${item.rotation}`]))
    /** @param {any} item */
    const where = (item) => `(${item.xCm}, ${item.yCm})`

    /** 피드백 패널을 읽는다. 휴대폰에서는 아래 탭의 [피드백]으로 가서 칩(문제·제안)을 하나씩 눌러 읽고, 보던 메뉴로 돌아온다 */
    async function readFeedback() {
      if (!vp.touch) return waitFor('__e2e.feedback()', '피드백 패널', 4000)
      const back = await ev(`__e2e.text(document.querySelector('nav[aria-label="메뉴"] [aria-current="page"]'))`)
      await clickEl(feedbackNav, '탭 바의 [피드백]')
      await waitFor(sheetTab('문제'), '피드백의 칩', 4000)
      await openSheetTab('문제')
      const errors = (await waitFor('__e2e.feedback()', '피드백 패널', 4000)).errors
      await openSheetTab('제안')
      const tips = (await ev('__e2e.feedback()')).tips
      // 칩에 적힌 개수("문제 1")를 PC의 표시("문제 1개" / "없음")와 같은 모양으로 맞춘다
      const counts = await ev(`__e2e.all('section[aria-label="조작 패널"] [role="tab"]').map((el) => __e2e.text(el))`)
      /** @param {string} label */
      const badge = (label) => {
        const found = counts.find((/** @type {string} */ value) => value.startsWith(label))
        const count = found ? Number(found.replace(/\D/g, '')) : NaN
        return Number.isNaN(count) ? '' : count > 0 ? `${label} ${count}개` : '없음'
      }
      const badges = { '확실한 문제': badge('문제'), '개선 제안': badge('제안'), '좋은 점': badge('좋은 점') }
      must(errors.length === Number(badges['확실한 문제'].replace(/\D/g, '') || 0), `[문제] 칩의 개수(${badges['확실한 문제']})와 보이는 문제(${errors.length}개)가 달라요`)
      if (back && !back.includes('피드백')) await clickEl(navButton(back), `탭 바의 ${back}`)
      return { errors, tips, badges }
    }

    /** 3D 캔버스만 찍어서 픽셀을 읽는다 */
    async function canvasImage() {
      const box = await ev(`(() => { const c = __e2e.all('canvas')[0]; if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height } })()`)
      must(box && box.width > 10 && box.height > 10, '3D 캔버스가 보이지 않아요')
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 } })
      return decodePng(Buffer.from(data, 'base64'))
    }

    async function open3d() {
      await clickEl(`__e2e.byText('[aria-label="보기 방식"] button', '3D')`, '3D 버튼')
      await waitFor(`__e2e.all('canvas')[0] || __e2e.crashNotes()[0]`, '3D 화면', 30000)
      const crash = await ev('__e2e.crashNotes()')
      must(crash.length === 0, `3D 대신 안내가 떴어요: ${crash.join(' / ')}`)
    }

    async function open2d() {
      await clickEl(`__e2e.byText('[aria-label="보기 방식"] button', '2D')`, '2D 버튼')
      await waitFor('__e2e.svg()', '2D 평면도', 8000)
    }

    const CHAIR = 'furn_chair_1'
    const DESK = 'furn_desk_1'
    const BED = 'furn_bed_1'

    // ════════ 0. 첫 방문 도움말 ════════
    await check('0-1', '첫 방문 도움말이 뜨고, 닫으면 다시 나오지 않아요', async () => {
      await startExample({ coach: true })
      const coach = `__e2e.all('aside[aria-label="처음 쓰는 분을 위한 도움말"]')[0]`
      await waitFor(coach, '첫 방문 도움말', 3000)
      await shot('coach')
      await clickEl(`__e2e.byLabel('도움말 닫기')`, '도움말 닫기')
      must(!(await ev(`!!${coach}`)), '닫기를 눌러도 도움말이 남아 있어요')
      must((await ev(`localStorage.getItem(${J(COACH_KEY)})`)) === 'true', '닫은 것이 기기에 저장되지 않았어요')
      await sleep(600)
      await reload()
      await waitFor('__e2e.svg()', '새로고침 뒤 평면도')
      must(!(await ev(`!!${coach}`)), '새로고침하니 도움말이 다시 나왔어요')
    })

    await check('0-2', '첫 방문 도움말이 떠 있어도 가구를 모두 누를 수 있어요', async () => {
      await startExample({ coach: true })
      const covered = await ev(`__e2e.pieces().map((p) => __e2e.piecePoint(p.id)).filter((p) => !p.free).map((p) => p.piece.label + ' ← ' + p.cover)`)
      must(covered.length === 0, `가려진 가구: ${covered.join(' / ')}`)
    })

    await check('0-3', '주소에 tips=0이 있으면 처음 온 기기에서도 첫 방문 도움말이 뜨지 않아요', async () => {
      await startExample()
      const coach = `__e2e.all('aside[aria-label="처음 쓰는 분을 위한 도움말"]')[0]`
      const ready = await ev(`({ remembered: localStorage.getItem(${J(COACH_KEY)}), tips: new URLSearchParams(location.search).get('tips') })`)
      must(ready.remembered === null && ready.tips === '0', `점검 준비가 잘못됐어요 (닫은 기억 ${ready.remembered}, 주소의 tips ${ready.tips})`)
      await sleep(400)
      must(!(await ev(`!!${coach}`)), 'tips=0인데 첫 방문 도움말이 떠 있어요')
      await sleep(600)
      await reload()
      await waitFor('__e2e.svg() && __e2e.pieces().length > 0', '새로고침 뒤 평면도')
      must(!(await ev(`!!${coach}`)), 'tips=0으로 새로고침하니 첫 방문 도움말이 나왔어요')
      must((await ev(`localStorage.getItem(${J(COACH_KEY)})`)) === null, 'tips=0으로 열었을 뿐인데 도움말을 닫았다고 기억했어요')
    })

    // ════════ 1. 시작 화면 ════════
    await check('1-1', '시작 화면에는 방 크기를 넣고 시작하는 길 하나와 [방봄에서 집 고르기] 링크만 있어요', async () => {
      await gotoStart()
      const seen = await ev(`({
        size: !!__e2e.byText('h2', '방 크기 설정'), width: !!__e2e.field('가로 (cm)'), depth: !!__e2e.field('세로 (cm)'),
        start: !!__e2e.byText('button', '이 크기로 시작'), example: /예시/.test(document.body.innerText),
        forms: __e2e.all('form').length, buttons: __e2e.all('button').map(__e2e.text),
        home: (() => { const a = __e2e.byText('a', '방봄에서 집 고르기'); if (!a) return null; const r = a.getBoundingClientRect(); return { href: a.href, raw: a.getAttribute('href'), height: r.height } })(),
        links: __e2e.all('a[href]').length,
        bottom: Math.max(...__e2e.all('button, a[href]').map((b) => b.getBoundingClientRect().bottom)), height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth, innerWidth, clipped: __e2e.clipped(),
      })`)
      must(seen.size && seen.width && seen.depth && seen.start, '[방 크기 설정]의 가로·세로 칸과 시작 버튼이 보이지 않아요')
      must(!seen.example, '시작 화면에 예시 체험이 남아 있어요')
      must(seen.forms === 1 && seen.buttons.length === 1, `시작하는 길이 하나가 아니에요 (입력 틀 ${seen.forms}개, 버튼: ${seen.buttons.join(', ')})`)
      must(seen.home, '[방봄에서 집 고르기] 링크가 보이지 않아요')
      must(seen.home.raw === './' && seen.home.href === `${new URL(BASE_URL).origin}/`, `[방봄에서 집 고르기]가 방봄 첫 화면으로 가지 않아요 (${seen.home.raw} → ${seen.home.href})`)
      must(seen.links === 1, `링크가 ${seen.links}개예요 (방봄으로 가는 것 하나만 있어야 해요)`)
      must(seen.home.height >= (vp.touch ? 43.5 : 35.5), `[방봄에서 집 고르기]의 누르는 자리가 ${Math.round(seen.home.height)}px로 낮아요`)
      must(seen.bottom <= seen.height, `버튼이나 링크가 첫 화면 아래로 밀려 있어요 (아래 끝 ${Math.round(seen.bottom)}px, 화면 ${seen.height}px)`)
      must(seen.scrollWidth <= seen.innerWidth && seen.clipped.length === 0, `시작 화면이 가로로 넘쳐요: ${seen.clipped[0] || seen.scrollWidth + 'px'}`)
      await shot('start')
    })

    await check('1-2', '방 크기 320 × 450을 넣고 시작하면 그 크기의 빈 방이 열려요', async () => {
      await startEmpty(320, 450)
      const room = await savedRoom()
      must(room, '시작했는데 자동 저장된 프로젝트가 없어요')
      must(room.widthCm === 320 && room.depthCm === 450, `저장된 방 크기가 ${room.widthCm} × ${room.depthCm}이에요`)
      must(room.furniture.length === 0, `빈 방이어야 하는데 가구가 ${room.furniture.length}개 있어요`)
      // PC는 무대 도구 줄에 "320 × 450 cm"를 적고, 휴대폰은 좁아서 평면도의 치수선(가로·세로)에 적는다
      const sizeShown = vp.touch
        ? await ev(`(() => { const texts = [...__e2e.svg().querySelectorAll('text')].filter(__e2e.isVisible).map(__e2e.text); return texts.includes('가로 320 cm') && texts.includes('세로 450 cm') })()`)
        : await ev(`document.body.innerText.includes('320 × 450 cm')`)
      must(sizeShown, vp.touch ? '평면도에 "가로 320 cm", "세로 450 cm"가 보이지 않아요' : '화면에 "320 × 450 cm"가 보이지 않아요')
      await shot('empty-room')
    })

    await check('1-3', '주소 옵션 ?example=1(숨은 연결)로 열면 가구 5개인 예시가 열려요', async () => {
      await startExample()
      const room = await savedRoom()
      must(room, '자동 저장된 프로젝트가 없어요')
      must(room.furniture.length === 5, `예시 가구가 ${room.furniture.length}개예요`)
      const drawn = await ev('__e2e.pieces().length')
      must(drawn === 5, `평면도에 그려진 가구가 ${drawn}개예요`)
      await shot('example')
    })

    // ════════ 2. 끌어서 옮기기와 실행취소 ════════
    /** @type {any} */ let before2 = null
    /** @type {any} */ let after2 = null
    await check('2-1', '평면도에서 가구를 끌면 좌표가 바뀌고 방 안에 있어요', async () => {
      await startExample()
      before2 = itemOf(await savedRoom(), CHAIR)
      await dragPieceBy(CHAIR, 100, 150)
      const room = await savedRoom()
      after2 = itemOf(room, CHAIR)
      must(after2.xCm !== before2.xCm && after2.yCm !== before2.yCm, `끌었는데 좌표가 그대로예요 ${where(before2)} → ${where(after2)}`)
      must(Math.abs(after2.xCm - before2.xCm - 100) <= 8 && Math.abs(after2.yCm - before2.yCm - 150) <= 8, `끈 만큼 옮겨지지 않았어요 ${where(before2)} → ${where(after2)} (기대: 약 +100, +150)`)
      must(insideRoom(room, after2), `가구가 방 밖으로 나갔어요 ${where(after2)}`)
      await shot('dragged')
      return `${where(before2)} → ${where(after2)}`
    })

    await check('2-2', 'Ctrl+Z 한 번에 끌기 전 자리로 정확히 돌아와요', async () => {
      must(before2 && after2, '앞 단계(끌기)가 되지 않아 확인하지 못했어요')
      await press('z', { ctrl: true })
      const now = itemOf(await savedRoom(), CHAIR)
      must(now.xCm === before2.xCm && now.yCm === before2.yCm, `한 번 눌렀는데 ${where(now)}이에요 (끌기 전 ${where(before2)})`)
    })

    await check('2-3', 'Ctrl+Y로 끈 자리가 다시 돼요', async () => {
      must(before2 && after2, '앞 단계(끌기)가 되지 않아 확인하지 못했어요')
      await press('y', { ctrl: true })
      const now = itemOf(await savedRoom(), CHAIR)
      must(now.xCm === after2.xCm && now.yCm === after2.yCm, `다시실행 뒤 ${where(now)}이에요 (끈 자리 ${where(after2)})`)
    })

    await check('2-4', '방 밖으로 끌어도 가구는 벽 안에서 멈춰요', async () => {
      await startExample()
      await dragPieceBy(CHAIR, 400, 500)
      const room = await savedRoom()
      const chair = itemOf(room, CHAIR)
      must(insideRoom(room, chair), `가구가 방 밖으로 나갔어요 ${where(chair)}`)
      const f = footprintOf(chair)
      must(f.x + f.w === room.widthCm || f.y + f.h === room.depthCm, `벽에 닿지 않았어요 ${where(chair)}`)
      return where(chair)
    })

    // ════════ 3. 단축키와 크기 조절 ════════
    await check('3-1', '가구를 고르고 R을 누르면 90도 돌아요', async () => {
      await startExample()
      const old = itemOf(await savedRoom(), CHAIR)
      await selectPiece(CHAIR)
      await press('r')
      const now = itemOf(await savedRoom(), CHAIR)
      must(now.rotation === (old.rotation + 90) % 360, `회전이 ${old.rotation} → ${now.rotation}이에요`)
    })

    await check('3-2', '방향키를 한 번 누르면 5cm 움직여요', async () => {
      const old = itemOf(await savedRoom(), CHAIR)
      await selectPiece(CHAIR)
      await press('ArrowRight')
      const mid = itemOf(await savedRoom(), CHAIR)
      must(mid.xCm === old.xCm + 5 && mid.yCm === old.yCm, `오른쪽 키: ${where(old)} → ${where(mid)}`)
      await press('ArrowDown')
      const now = itemOf(await savedRoom(), CHAIR)
      must(now.xCm === mid.xCm && now.yCm === mid.yCm + 5, `아래 키: ${where(mid)} → ${where(now)}`)
    })

    /** @type {string | null} */ let copyId = null
    await check('3-3', 'Ctrl+C 다음 Ctrl+V를 누르면 같은 가구가 하나 더 생겨요', async () => {
      const old = await savedRoom()
      await selectPiece(CHAIR)
      await press('c', { ctrl: true })
      await press('v', { ctrl: true })
      const room = await savedRoom()
      must(room.furniture.length === old.furniture.length + 1, `가구 수가 ${old.furniture.length} → ${room.furniture.length}이에요`)
      const added = room.furniture.find((/** @type {any} */ item) => !itemOf(old, item.id))
      const source = itemOf(room, CHAIR)
      must(added.name === source.name && added.widthCm === source.widthCm && added.depthCm === source.depthCm, '복사한 가구의 이름이나 크기가 달라요')
      copyId = added.id
      const hit = room.furniture.filter((/** @type {any} */ item) => item.id !== added.id && item.category !== 'mat' && overlaps(item, added))
      must(hit.length === 0, `복사한 가구가 ${hit.map((/** @type {any} */ item) => item.name).join(', ')}와(과) 겹친 자리에 놓였어요 ${where(added)}`)
      must(spots(old)[CHAIR] === spots(room)[CHAIR], '원래 가구가 움직였어요')
    })

    await check('3-4', 'Delete를 누르면 고른 가구가 지워져요', async () => {
      must(copyId, '앞 단계(복사)가 되지 않아 확인하지 못했어요')
      const old = await savedRoom()
      await selectPiece(String(copyId))
      await press('Delete')
      const room = await savedRoom()
      must(room.furniture.length === old.furniture.length - 1, `가구 수가 ${old.furniture.length} → ${room.furniture.length}이에요`)
      must(!itemOf(room, String(copyId)), '고른 가구가 남아 있어요')
      must(itemOf(room, CHAIR), '다른 가구가 지워졌어요')
    })

    await check('3-5', '크기 손잡이를 끌면 크기와 크기 글자가 바뀌어요', async () => {
      await startExample()
      await selectPiece(DESK)
      const old = itemOf(await savedRoom(), DESK)
      const handles = await ev(`__e2e.handles(${J(DESK)})`)
      const grip = handles.find((/** @type {any} */ h) => h.hx === 1 && h.hy === 0)
      must(grip, '오른쪽 손잡이를 찾지 못했어요')
      must(grip.free, `오른쪽 손잡이가 가려져 있어요: ${grip.cover}`)
      const labelBefore = await ev('__e2e.sizeLabel()')
      must(labelBefore === `${old.widthCm} × ${old.depthCm} cm`, `고른 가구의 크기 글자가 "${labelBefore}"이에요`)
      const k = await ev('__e2e.pxPerCm()')
      await dragPx({ x: grip.x, y: grip.y }, { x: grip.x + 40 * k, y: grip.y })
      const now = itemOf(await savedRoom(), DESK)
      must(Math.abs(now.widthCm - (old.widthCm + 40)) <= 3, `가로가 ${old.widthCm} → ${now.widthCm}cm이에요 (기대: 약 ${old.widthCm + 40})`)
      must(now.depthCm === old.depthCm && now.xCm === old.xCm && now.yCm === old.yCm, `끌지 않은 쪽이 바뀌었어요: 깊이 ${now.depthCm}, 자리 ${where(now)}`)
      const labelAfter = await ev('__e2e.sizeLabel()')
      must(labelAfter === `${now.widthCm} × ${now.depthCm} cm`, `크기 글자가 "${labelAfter}"이에요 (저장된 크기 ${now.widthCm} × ${now.depthCm})`)
      await shot('resized')
      await press('z', { ctrl: true })
      const back = itemOf(await savedRoom(), DESK)
      must(back.widthCm === old.widthCm, `실행취소 한 번에 크기가 돌아오지 않았어요 (${back.widthCm}cm)`)
      return `${old.widthCm} → ${now.widthCm}cm`
    })

    await check('3-6', '고른 가구의 손잡이 8개가 도구 막대에 가려지지 않아요', async () => {
      await startExample()
      /** @type {string[]} */
      const blocked = []
      for (const id of [DESK, BED, CHAIR]) {
        await selectPiece(id)
        const handles = await ev(`__e2e.handles(${J(id)})`)
        const covered = handles.filter((/** @type {any} */ h) => !h.free)
        if (covered.length > 0) blocked.push(`${id}: 손잡이 ${covered.length}개 ← ${covered[0].cover}`)
        await press('Escape')
      }
      must(blocked.length === 0, blocked.join(' / '))
    })

    await check('3-7', '입력 칸에 글자를 넣는 동안에는 단축키가 가구를 건드리지 않아요', async () => {
      await startExample()
      await goCategory('가구')
      await selectPiece(CHAIR)
      const old = await savedRoom()
      await clickEl(furnitureTab('글로 추가'), '글로 추가 탭')
      await clickEl(`document.getElementById('furniture-text')`, '글로 추가 입력 칸')
      must(await ev(`document.activeElement === document.getElementById('furniture-text')`), '입력 칸을 눌러도 커서가 들어가지 않아요')
      for (const key of ['r', 'Delete', 'Backspace', 'ArrowRight', 'ArrowDown']) await press(key)
      await press('z', { ctrl: true })
      let room = await savedRoom()
      must(J(spots(room)) === J(spots(old)), '글로 추가 칸에서 누른 키가 가구를 바꿨어요')
      must(room.furniture.length === old.furniture.length, '글로 추가 칸에서 누른 키가 가구를 지웠어요')
      await clickEl(furnitureTab('놓인 가구'), '놓인 가구 탭')
      await clickEl(`__e2e.field('이름')`, '이름 칸')
      must(await ev(`document.activeElement === __e2e.field('이름')`), '이름 칸을 눌러도 커서가 들어가지 않아요')
      for (const key of ['r', 'Delete', 'Backspace', 'ArrowLeft', 'ArrowUp']) await press(key)
      await press('Escape')
      room = await savedRoom()
      must(J(spots(room)) === J(spots(old)), '이름 칸에서 누른 키가 가구를 바꿨어요')
      must(room.furniture.length === old.furniture.length, '이름 칸에서 누른 키가 가구를 지웠어요')
    })

    await check('3-8', '가구를 톡 누르는 순간 뜨는 도구 막대의 버튼이 대신 눌리지 않아요', async () => {
      await startExample()
      const before = await savedRoom()
      let tried = 0
      for (const item of before.furniture) {
        // 이 가구를 골랐을 때 도구 막대가 어디에 뜨는지 먼저 알아 둔다 (포커스하면 선택된다)
        await ev(`document.querySelector(${J(`[data-piece-id="${item.id}"]`)}).focus()`)
        await sleep(250)
        const buttons = await ev(`(() => { const bar = __e2e.all('[role="toolbar"]')[0]; return bar ? [...bar.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return { label: __e2e.text(b), left: r.left, top: r.top, width: r.width, height: r.height } }) : [] })()`)
        await press('Escape')
        await sleep(200)
        must(!(await ev(`!!__e2e.all('[role="toolbar"]')[0]`)), 'Esc를 눌러도 선택이 풀리지 않아요')
        // 도구 막대 버튼이 뜰 자리 가운데, 지금은 이 가구가 보이는 곳
        const spot = await ev(`(() => {
          const g = document.querySelector(${J(`[data-piece-id="${item.id}"]`)})
          for (const b of ${J(buttons)}) for (const fy of [0.5, 0.8, 0.2]) for (const fx of [0.5, 0.2, 0.8]) {
            const x = b.left + b.width * fx, y = b.top + b.height * fy
            const top = document.elementFromPoint(x, y)
            if (top && g.contains(top)) return { x, y, label: b.label }
          }
          return null
        })()`)
        if (!spot) continue
        tried += 1
        await tapAt(spot.x, spot.y)
        const room = await savedRoom()
        const what =
          room.furniture.length < before.furniture.length ? '가구가 지워졌어요' : room.furniture.length > before.furniture.length ? '가구가 하나 더 생겼어요' : J(spots(room)) !== J(spots(before)) ? '가구가 돌아가거나 움직였어요' : ''
        await shot('toolbar-under-finger')
        must(what === '', `${item.name}을(를) 한 번 눌렀을 뿐인데 ${what} (누른 자리 x ${Math.round(spot.x)}, y ${Math.round(spot.y)}에 도구 막대의 [${spot.label}] 버튼이 떴어요)`)
        await press('Escape')
      }
      return tried === 0 ? '도구 막대가 가구 위에 뜨는 경우가 없었어요' : `가구 ${tried}개에서 확인`
    })

    // ════════ 4. 가구 탭 ════════
    await check('4-1', '가구를 추가해도 이미 놓인 가구의 자리와 방향은 그대로예요', async () => {
      await startExample()
      await dragPieceBy(CHAIR, 90, 140) // 손으로 옮겨 둔 가구가 있는 상태에서 추가한다
      const old = await savedRoom()
      const oldProblems = (await readFeedback()).errors.map((/** @type {any} */ e) => e.title)
      await goCategory('가구')
      await clickEl(furnitureTab('가구 추가'), '가구 추가 탭')
      /** @type {string[]} */
      const notes = []
      let current = old
      for (const [group, name] of [['서랍장', '협탁'], ['의자', '책상 의자']]) {
        if (!(await ev(`!!__e2e.byLabel(${J(`${name} 추가`)})`))) await clickEl(`__e2e.fold(${J(group)})`, `${group} 묶음`)
        await clickEl(`__e2e.byLabel(${J(`${name} 추가`)})`, `${name} 추가`)
        const room = await savedRoom()
        must(room.furniture.length === current.furniture.length + 1, `${name}: 가구 수가 ${current.furniture.length} → ${room.furniture.length}이에요`)
        const moved = current.furniture.filter((/** @type {any} */ item) => spots(room)[item.id] !== spots(current)[item.id])
        must(moved.length === 0, `${name}을(를) 추가하니 ${moved.map((/** @type {any} */ item) => `${item.name} ${spots(current)[item.id]} → ${spots(room)[item.id]}`).join(' / ')}`)
        const added = room.furniture.find((/** @type {any} */ item) => !itemOf(current, item.id))
        must(insideRoom(room, added), `${name}이(가) 방 밖에 놓였어요 ${where(added)}`)
        const hit = room.furniture.filter((/** @type {any} */ item) => item.id !== added.id && item.category !== 'mat' && overlaps(item, added))
        must(hit.length === 0, `새 ${name}이(가) ${hit.map((/** @type {any} */ item) => item.name).join(', ')}와(과) 겹쳐요 ${where(added)}`)
        notes.push(`${name} ${where(added)}`)
        current = room
      }
      await shot('furniture-added')
      const problems = (await readFeedback()).errors.map((/** @type {any} */ e) => e.title)
      const fresh = problems.filter((/** @type {string} */ title) => !oldProblems.includes(title))
      must(fresh.length === 0, `자동으로 놓은 자리 때문에 확실한 문제가 새로 생겼어요: ${fresh.join(' / ')}`)
      return notes.join(', ')
    })

    await check('4-2', '글로 추가에 "슈퍼싱글 침대, 1200 책상"을 넣으면 가구 2개가 나와요', async () => {
      await startExample()
      await goCategory('가구')
      await clickEl(furnitureTab('글로 추가'), '글로 추가 탭')
      await typeInto(`document.getElementById('furniture-text')`, '슈퍼싱글 침대, 1200 책상', '글로 추가 입력 칸')
      await clickEl(button('가구 찾기'), '가구 찾기')
      const names = await waitFor(
        `(() => { const rows = __e2e.all('li.card').filter((li) => li.querySelector('input[type="checkbox"]')); const done = __e2e.byText('button', '고른 가구', false) || __e2e.byText('p', '알아볼 수 있는 가구가 없었어요', false) || __e2e.byText('p', '가구를 찾지 못했어요', false); return done ? [rows.map((li) => __e2e.text(li.querySelector('label span')))] : null })()`,
        '가구 찾기 결과',
        25000,
      )
      must(names[0].length === 2, `찾은 가구가 ${names[0].length}개예요: ${names[0].join(' / ')}`)
      must(/침대/.test(names[0][0]) && /책상/.test(names[0][1]), `찾은 가구: ${names[0].join(' / ')}`)
      await shot('text-add')
      return names[0].join(' / ')
    })

    // ════════ 5. 배치 탭 ════════
    /** @param {any} room */
    const variantKinds = (room) => new Set(room.variants.map((/** @type {any} */ v) => J([...v.placements].sort((a, b) => (a.furnitureId < b.furnitureId ? -1 : 1)).map((p) => [p.furnitureId, p.xCm, p.yCm, p.rotation])))).size

    await check('5-1', '[전체 다시 추천]을 누르면 서로 다른 배치안이 나오고 첫 번째 안이 적용돼요', async () => {
      await startExample()
      await goCategory('배치')
      await clickEl(button('전체 다시 추천'), '전체 다시 추천')
      const room = await savedRoom()
      must(room.variants.length >= 2, `배치안이 ${room.variants.length}개뿐이에요`)
      must(variantKinds(room) === room.variants.length, `배치안 ${room.variants.length}개 가운데 서로 다른 것은 ${variantKinds(room)}개예요`)
      must(room.activeVariantId === room.variants[0].id, '첫 번째 배치안이 적용됨으로 표시되지 않았어요')
      const cards = await ev(`__e2e.all('section[aria-label="배치안"]')[0].querySelectorAll('li').length`)
      must(cards === room.variants.length, `화면의 배치안 카드가 ${cards}개예요 (자료는 ${room.variants.length}개)`)
      const feedback = await readFeedback()
      must(feedback.errors.length === 0, `첫 번째 안을 적용했더니 확실한 문제: ${feedback.errors.map((/** @type {any} */ e) => e.title).join(' / ')}`)
      await shot('variants')
      return `${room.variants.length}가지`
    })

    await check('5-2', '다른 배치안의 [적용]을 누르면 가구 자리가 바뀌고 확실한 문제가 없어요', async () => {
      let room = await savedRoom()
      must(room.variants.length >= 2, '배치안이 없어서 확인하지 못했어요')
      /** @type {string[]} */
      const bad = []
      for (const variant of room.variants.slice(1).concat(room.variants[0])) {
        const old = room
        await clickEl(`__e2e.byLabel(${J(`${variant.title} 적용`)})`, `${variant.title} 적용`)
        room = await savedRoom()
        if (room.activeVariantId !== variant.id) bad.push(`${variant.title}: 적용됨으로 바뀌지 않았어요`)
        if (J(spots(room)) === J(spots(old))) bad.push(`${variant.title}: 가구 자리가 그대로예요`)
        const wrong = variant.placements.filter((/** @type {any} */ p) => {
          const item = itemOf(room, p.furnitureId)
          return !item || item.xCm !== p.xCm || item.yCm !== p.yCm || item.rotation !== p.rotation
        })
        if (wrong.length > 0) bad.push(`${variant.title}: 가구 ${wrong.length}개가 배치안과 다른 자리에 있어요`)
        const feedback = await readFeedback()
        if (feedback.errors.length > 0) bad.push(`${variant.title}: 확실한 문제 ${feedback.errors.map((/** @type {any} */ e) => e.title).join(' / ')}`)
        if (variant.unplacedIds.length > 0) bad.push(`${variant.title}: 자리를 찾지 못한 가구 ${variant.unplacedIds.length}개`)
        await shot(`variant-${variant.id}`)
      }
      must(bad.length === 0, bad.join(' | '))
    })

    await check('5-3', '가구를 손으로 옮긴 뒤에도 [전체 다시 추천]이 서로 다른 배치안을 줘요', async () => {
      await startExample()
      await dragPieceBy(CHAIR, 90, 140)
      await dragPieceBy(DESK, 20, 150)
      await goCategory('배치')
      await clickEl(button('전체 다시 추천'), '전체 다시 추천')
      const room = await savedRoom()
      must(room.variants.length >= 3 && variantKinds(room) === room.variants.length, `배치안 ${room.variants.length}개, 서로 다른 것 ${variantKinds(room)}개`)
      const feedback = await readFeedback()
      must(feedback.errors.length === 0, `다시 추천한 뒤 확실한 문제: ${feedback.errors.map((/** @type {any} */ e) => e.title).join(' / ')}`)
      return `${room.variants.length}가지`
    })

    // ════════ 6. 피드백 ════════
    await check('6-1', '가구를 다른 가구 위로 끌면 [확실한 문제]에 겹침이 떠요', async () => {
      await startExample()
      const startFeedback = await readFeedback()
      must(startFeedback.errors.length === 0, `예시 방을 열자마자 확실한 문제가 있어요: ${startFeedback.errors.map((/** @type {any} */ e) => e.title).join(' / ')}`)
      const room = await savedRoom()
      const bed = footprintOf(itemOf(room, BED))
      await dragPieceTo(CHAIR, bed.x + 30, bed.y + 60)
      await settle()
      const feedback = await readFeedback()
      const hit = feedback.errors.find((/** @type {any} */ e) => /겹쳐요/.test(e.title))
      must(hit, `겹침 문제가 뜨지 않았어요. 뜬 문제: ${feedback.errors.map((/** @type {any} */ e) => e.title).join(' / ') || '없음'}`)
      must(/문제 \d+개/.test(feedback.badges['확실한 문제'] || ''), `확실한 문제 개수 표시가 "${feedback.badges['확실한 문제']}"이에요`)
      await shot('overlap')
      return hit.title
    })

    /** @type {{ desk: string, shelf: string } | null} */ let flushIds = null
    await check('6-2', '책상과 책장을 벽과 서로에게 딱 붙여도 문제나 틈 제안이 없어요', async () => {
      await startEmpty(320, 450)
      await goCategory('가구')
      await clickEl(furnitureTab('가구 추가'), '가구 추가 탭')
      for (const [group, name] of [['책상', '1200 책상'], ['책장', '800 책장']]) {
        if (!(await ev(`!!__e2e.byLabel(${J(`${name} 추가`)})`))) await clickEl(`__e2e.fold(${J(group)})`, `${group} 묶음`)
        await clickEl(`__e2e.byLabel(${J(`${name} 추가`)})`, `${name} 추가`)
      }
      let room = await savedRoom()
      must(room.furniture.length === 2, `가구 2개를 추가했는데 ${room.furniture.length}개예요`)
      const desk = room.furniture.find((/** @type {any} */ item) => item.category === 'desk')
      const shelf = room.furniture.find((/** @type {any} */ item) => item.category === 'bookshelf')
      // 먼저 선택을 풀고 방 가운데로 옮겨 둔다 (좁은 화면에서는 도구 막대가 맨 위쪽 가구를 덮는다. 그 문제는 3-6·3-8에서 따로 본다)
      await press('Escape')
      await dragPieceTo(shelf.id, 200, 330)
      await dragPieceTo(desk.id, 30, 200)
      // 둘 다 정면이 아래를 보게(회전 0) 맞춘다
      for (const item of [desk, shelf]) {
        await selectPiece(item.id)
        for (let turn = item.rotation; turn % 360 !== 0; turn += 90) await press('r')
        await press('Escape')
      }
      await dragPieceTo(desk.id, 0, 200)
      room = await savedRoom()
      const d = footprintOf(itemOf(room, desk.id))
      await dragPieceTo(shelf.id, d.x + d.w + 2, d.y + 2) // 2cm 어긋나게 놓아도 자석처럼 붙어야 한다
      room = await savedRoom()
      const s = footprintOf(itemOf(room, shelf.id))
      must(d.x === 0, `책상이 왼쪽 벽에 붙지 않았어요 (x ${d.x})`)
      must(s.x === d.x + d.w && s.y === d.y, `책장이 책상 옆에 딱 붙지 않았어요: 책상 오른쪽 끝 ${d.x + d.w}, 책장 (${s.x}, ${s.y}), 책상 y ${d.y}`)
      flushIds = { desk: desk.id, shelf: shelf.id }
      const feedback = await readFeedback()
      await shot('flush')
      must(feedback.errors.length === 0, `딱 붙였더니 확실한 문제: ${feedback.errors.map((/** @type {any} */ e) => `${e.title} — ${e.message}`).join(' / ')}`)
      const gaps = feedback.tips.filter((/** @type {any} */ t) => /틈/.test(t.title + t.message))
      must(gaps.length === 0, `딱 붙였는데 틈 제안: ${gaps.map((/** @type {any} */ t) => t.title).join(' / ')}`)
      return `책상 (${d.x}, ${d.y}), 책장 (${s.x}, ${s.y}), 다른 제안 ${feedback.tips.length}개`
    })

    await check('6-3', '붙여 둔 책장을 20cm 떼면 그때는 틈 제안이 떠요', async () => {
      must(flushIds, '앞 단계(딱 붙이기)가 되지 않아 확인하지 못했어요')
      await selectPiece(String(flushIds?.shelf))
      for (let i = 0; i < 4; i++) await press('ArrowRight')
      await press('Escape')
      await settle()
      const feedback = await readFeedback()
      const gaps = feedback.tips.filter((/** @type {any} */ t) => /20cm 틈/.test(t.title))
      must(gaps.length === 1, `20cm 틈 제안이 ${gaps.length}개예요. 뜬 제안: ${feedback.tips.map((/** @type {any} */ t) => t.title).join(' / ') || '없음'}`)
      must(feedback.errors.length === 0, `확실한 문제가 떴어요: ${feedback.errors.map((/** @type {any} */ e) => e.title).join(' / ')}`)
      await shot('gap-tip')
      return gaps[0].title
    })

    await check('6-4', '[AI 해설 듣기]를 누르면 글로 된 답이 나와요 (AI가 없으면 기본 답 안내와 함께)', async () => {
      await startExample()
      /** @type {{ aiConfigured?: boolean }} */
      const health = await ev(`fetch('/api/health').then((r) => r.json()).catch(() => ({}))`)
      if (vp.touch) {
        await clickEl(feedbackNav, '탭 바의 [피드백]')
        await openSheetTab('AI 해설')
      }
      const started = Date.now()
      await clickEl(button('AI 해설 듣기'), 'AI 해설 듣기')
      await waitFor(`__e2e.byText('button', 'AI 해설 다시 듣기') || __e2e.byText('p', '해설을 가져오지 못했어요', false)`, 'AI 해설 답', 25000)
      const seconds = ((Date.now() - started) / 1000).toFixed(1)
      const answer = await ev(`(() => {
        const again = __e2e.byText('button', 'AI 해설 다시 듣기')
        const card = again ? again.parentElement.querySelector('.card') : null
        return {
          failed: !!__e2e.byText('p', '해설을 가져오지 못했어요', false),
          notice: card ? __e2e.text(card.querySelector('.chip')) : '',
          summary: card ? __e2e.text(card.querySelector('p.text-sm')) : '',
          lines: card ? card.querySelectorAll('li').length : 0,
          all: card ? __e2e.text(card) : '',
        }
      })()`)
      await shot('advice')
      must(!answer.failed, '"해설을 가져오지 못했어요"가 떴어요')
      must(answer.summary.length >= 10, `해설 글이 없어요: "${answer.all.slice(0, 80)}"`)
      must(!/점수|\d+\s*점|등급/.test(answer.all), `해설에 점수 같은 표현이 있어요: "${answer.all.slice(0, 120)}"`)
      if (health.aiConfigured === true) return `${seconds}초, AI 연결됨${answer.notice ? `, 안내: ${answer.notice}` : ''}`
      must(answer.notice === FALLBACK_NOTICE, `기본 답 안내 문구가 "${answer.notice}"이에요`)
      return `${seconds}초, 기본 답, 요약 ${answer.summary.length}자`
    })

    await check('6-5', '다른 메뉴에 다녀와도 받아 둔 AI 해설이 그대로 남아 있어요 (다시 받으면 AI를 한 번 더 불러요)', async () => {
      const read = () => ev(`(() => { const again = __e2e.byText('button', 'AI 해설 다시 듣기'); const card = again ? again.parentElement.querySelector('.card') : null; return card ? __e2e.text(card) : '' })()`)
      const before = await read()
      must(before.length >= 10, '앞 단계(AI 해설 듣기)가 되지 않아 확인하지 못했어요')
      // 휴대폰에서는 다른 메뉴로 가면 피드백 패널이 화면에서 사라졌다가 새로 그려진다
      await goCategory('가구')
      if (vp.touch) {
        await clickEl(feedbackNav, '탭 바의 [피드백]')
        await openSheetTab('AI 해설')
      }
      const after = await read()
      must(after !== '', '다녀오니 받아 둔 AI 해설이 사라지고 [AI 해설 듣기]만 남았어요')
      must(after === before, `다녀오니 해설 글이 달라졌어요: "${after.slice(0, 60)}"`)
    })

    // ════════ 7. 비용 탭 ════════
    const won = (/** @type {string} */ value) => Number(String(value || '').replace(/[^\d]/g, ''))
    /** @param {any} room */
    const buyTotal = (room) => room.furniture.filter((/** @type {any} */ item) => !item.owned).reduce((/** @type {number} */ sum, /** @type {any} */ item) => sum + (item.price.manualKrw ?? item.price.estimatedKrw), 0)
    const totalOnScreen = async () => {
      const rows = await ev('__e2e.costRows()')
      const key = Object.keys(rows).find((name) => name.startsWith('살 가구 합계'))
      must(key, '비용 요약에 "살 가구 합계"가 없어요')
      return { total: won(rows[String(key)]), rows }
    }

    await check('7-1', '[이미 있어요]를 켜고 끄면 합계가 바뀌어요', async () => {
      await startExample()
      await goCategory('비용')
      const room = await savedRoom()
      const first = await totalOnScreen()
      must(first.total === buyTotal(room), `화면 합계 ${first.total}원, 저장된 자료로 계산한 합계 ${buyTotal(room)}원`)
      const desk = itemOf(room, DESK)
      const toggle = `__e2e.byLabel(${J(`${desk.name} 이미 있어요`)}) || document.querySelector(${J(`input[aria-label="${desk.name} 이미 있어요"]`)})`
      await openSheetTab('가구별 가격')
      await clickEl(`(${toggle}).closest('label')`, `${desk.name} 이미 있어요`)
      await openSheetTab('요약')
      const owned = await totalOnScreen()
      must(owned.total === first.total - desk.price.estimatedKrw, `켰더니 합계가 ${first.total} → ${owned.total}원 (기대 ${first.total - desk.price.estimatedKrw})`)
      must(itemOf(await savedRoom(), DESK).owned === true, '켠 것이 저장되지 않았어요')
      await openSheetTab('가구별 가격')
      await clickEl(`(${toggle}).closest('label')`, `${desk.name} 이미 있어요`)
      await openSheetTab('요약')
      const back = await totalOnScreen()
      must(back.total === first.total, `껐더니 합계가 ${back.total}원 (처음 ${first.total})`)
      const budget = won(back.rows['예산'])
      const leftKey = Object.keys(back.rows).find((name) => name.startsWith('남는 금액') || name.startsWith('초과 금액'))
      must(leftKey && won(back.rows[String(leftKey)]) === Math.abs(budget - back.total), `예산 ${budget} − 합계 ${back.total}과 남는 금액 줄(${leftKey ? back.rows[String(leftKey)] : '없음'})이 달라요`)
      return `${first.total} → ${owned.total} → ${back.total}원`
    })

    await check('7-2', '가격을 눌러 고치면 합계가 바뀌어요', async () => {
      const room = await savedRoom()
      const desk = itemOf(room, DESK)
      const first = await totalOnScreen()
      await openSheetTab('가구별 가격')
      await clickEl(`__e2e.byLabel(${J(`${desk.name} 가격`)}, false)`, `${desk.name} 가격`)
      const input = `document.querySelector(${J(`input[aria-label^="${desk.name} 가격"]`)})`
      await waitFor(input, '가격 입력 칸', 3000)
      await ev(`(() => { const el = ${input}; el.focus(); el.select() })()`)
      await cdp.send('Input.insertText', { text: '150000' })
      await press('Enter')
      must(await ev(`document.body.innerText.includes('직접 입력')`), '"직접 입력" 표시가 없어요')
      await shot('cost-items')
      await openSheetTab('요약')
      const now = await totalOnScreen()
      const expected = first.total - (desk.price.manualKrw ?? desk.price.estimatedKrw) + 150000
      must(now.total === expected, `합계가 ${first.total} → ${now.total}원 (기대 ${expected})`)
      const saved = itemOf(await savedRoom(), DESK)
      must(saved.price.manualKrw === 150000, `저장된 직접 입력 가격이 ${saved.price.manualKrw}이에요`)
      await shot('cost')
      return `${first.total} → ${now.total}원`
    })

    await check('7-3', '쇼핑몰 링크 3개가 https 검색 주소이고 새 창으로 안전하게 열려요', async () => {
      const room = await savedRoom()
      await openSheetTab('가구별 가격')
      const links = await ev(`__e2e.all('aside a[target], section[aria-label="조작 패널"] a[target], a[href^="http"]').map((a) => ({ text: __e2e.text(a), href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') || '', label: a.getAttribute('aria-label') || '' }))`)
      const unique = [...new Map(links.map((/** @type {any} */ link) => [link.label + link.href, link])).values()]
      must(unique.length === room.furniture.length * 3, `링크가 ${unique.length}개예요 (가구 ${room.furniture.length}개 × 3)`)
      const hosts = { 오늘의집: 'https://ohou.se/search/', 네이버쇼핑: 'https://search.shopping.naver.com/search/', 쿠팡: 'https://www.coupang.com/np/search' }
      /** @type {string[]} */
      const bad = []
      for (const link of unique) {
        const start = hosts[/** @type {keyof typeof hosts} */ (link.text)]
        if (!start) bad.push(`모르는 링크 "${link.text}"`)
        else if (!link.href.startsWith(start)) bad.push(`${link.text}: ${link.href}`)
        if (link.target !== '_blank') bad.push(`${link.text}: target이 ${link.target}`)
        if (!/\bnoopener\b/.test(link.rel)) bad.push(`${link.text}: rel이 "${link.rel}"`)
      }
      for (const item of room.furniture) {
        const mine = unique.filter((/** @type {any} */ link) => link.href.includes(encodeURIComponent(item.name)))
        if (mine.length !== 3) bad.push(`${item.name}: 이름이 들어간 링크가 ${mine.length}개`)
      }
      must(bad.length === 0, bad.slice(0, 4).join(' | '))
    })

    // ════════ 8. 3D ════════
    /** @type {ReturnType<typeof decodePng> | null} */ let birdImage = null
    await check('8-1', '3D로 바꾸면 방이 실제로 그려져요 (빈 화면이 아니에요)', async () => {
      await startExample()
      await open3d()
      await sleep(2500)
      birdImage = await canvasImage()
      const stats = imageStats(birdImage)
      await shot('3d')
      must(stats.colors >= 20 && stats.dominant < 0.95, `캔버스가 거의 한 가지 색이에요 (색 ${stats.colors}가지, 가장 많은 색 ${(stats.dominant * 100).toFixed(0)}%)`)
      return `색 ${stats.colors}가지, 가장 많은 색 ${(stats.dominant * 100).toFixed(0)}%`
    })

    await check('8-2', '[위에서]와 [조감] 버튼을 누르면 보는 방향이 바뀌어요', async () => {
      must(birdImage, '앞 단계(3D 열기)가 되지 않아 확인하지 못했어요')
      await clickEl(button('위에서'), '위에서')
      await sleep(1800)
      const top = await canvasImage()
      await shot('3d-top')
      const toTop = imageDiff(/** @type {any} */ (birdImage), top)
      must(toTop > 0.03, `[위에서]를 눌러도 그림이 거의 그대로예요 (다른 픽셀 ${(toTop * 100).toFixed(1)}%)`)
      must(imageStats(top).colors >= 20, '[위에서] 화면이 비어 있어요')
      await clickEl(button('조감'), '조감')
      await sleep(1800)
      const bird = await canvasImage()
      const toBird = imageDiff(top, bird)
      must(toBird > 0.03, `[조감]을 눌러도 그림이 거의 그대로예요 (다른 픽셀 ${(toBird * 100).toFixed(1)}%)`)
      return `바뀐 픽셀 ${(toTop * 100).toFixed(0)}%, ${(toBird * 100).toFixed(0)}%`
    })

    await check('8-3', '화질 버튼을 눌러도 3D가 계속 그려져요', async () => {
      for (const label of ['낮음', '보통', '높음']) {
        await clickEl(`__e2e.byText('[aria-label="화질"] button', ${J(label)})`, `화질 ${label}`)
        await sleep(900)
        must(await ev(`__e2e.byText('[aria-label="화질"] button', ${J(label)}).getAttribute('aria-pressed') === 'true'`), `${label}이(가) 켜진 것으로 표시되지 않아요`)
        const stats = imageStats(await canvasImage())
        must(stats.colors >= 20, `화질 ${label}: 캔버스가 비었어요 (색 ${stats.colors}가지)`)
      }
    })

    await check('8-4', '2D로 돌아오면 평면도와 가구가 그대로 보여요', async () => {
      await open2d()
      const drawn = await ev('__e2e.pieces().length')
      must(drawn === 5, `평면도의 가구가 ${drawn}개예요`)
      must((await ev(`__e2e.all('canvas').length`)) === 0, '2D인데 3D 캔버스가 남아 있어요')
    })

    await check('8-5', `2D↔3D를 ${SWITCHES}번 바꿔도 WebGL 경고 없이 3D가 그려져요`, async () => {
      const warningsBefore = pageWarnings.length
      for (let i = 0; i < SWITCHES; i++) {
        await open3d()
        await sleep(250)
        await open2d()
      }
      await open3d()
      await sleep(2000)
      const stats = imageStats(await canvasImage())
      const canvases = await ev(`document.querySelectorAll('canvas').length`)
      const leaks = pageWarnings.slice(warningsBefore).filter((entry) => /webgl/i.test(entry.text) && /context|too many/i.test(entry.text))
      must(leaks.length === 0, `WebGL 경고 ${leaks.length}건: ${leaks[0]?.text}`)
      must(canvases === 1, `캔버스가 ${canvases}개 남아 있어요`)
      must(stats.colors >= 20, `여러 번 바꾼 뒤 3D가 비었어요 (색 ${stats.colors}가지)`)
      await open2d()
    })

    // ════════ 9. 헤더 ════════
    const headerState = () => ev(`({ undo: __e2e.byLabel('실행취소').disabled, redo: __e2e.byLabel('다시실행').disabled })`)

    await check('9-1', '[실행취소]·[다시실행]이 할 수 있을 때만 켜져요', async () => {
      await startExample()
      let state = await headerState()
      must(state.undo && state.redo, `처음인데 실행취소 ${state.undo ? '꺼짐' : '켜짐'}, 다시실행 ${state.redo ? '꺼짐' : '켜짐'}`)
      const old = itemOf(await savedRoom(), CHAIR)
      await selectPiece(CHAIR)
      await press('ArrowRight')
      await sleep(200)
      state = await headerState()
      must(!state.undo && state.redo, `고친 뒤 실행취소 ${state.undo ? '꺼짐' : '켜짐'}, 다시실행 ${state.redo ? '꺼짐' : '켜짐'}`)
      await clickEl(`__e2e.byLabel('실행취소')`, '실행취소 버튼')
      state = await headerState()
      must(state.undo && !state.redo, `실행취소 뒤 실행취소 ${state.undo ? '꺼짐' : '켜짐'}, 다시실행 ${state.redo ? '꺼짐' : '켜짐'}`)
      let now = itemOf(await savedRoom(), CHAIR)
      must(now.xCm === old.xCm && now.yCm === old.yCm, `실행취소 버튼으로 돌아오지 않았어요 ${where(now)}`)
      await clickEl(`__e2e.byLabel('다시실행')`, '다시실행 버튼')
      state = await headerState()
      must(!state.undo && state.redo, `다시실행 뒤 실행취소 ${state.undo ? '꺼짐' : '켜짐'}, 다시실행 ${state.redo ? '꺼짐' : '켜짐'}`)
      now = itemOf(await savedRoom(), CHAIR)
      must(now.xCm === old.xCm + 5, `다시실행 버튼으로 다시 되지 않았어요 ${where(now)}`)
    })

    await check('9-2', '고친 뒤 새로고침하면 자동 저장된 방이 그대로 열려요', async () => {
      await dragPieceBy(CHAIR, 80, 160)
      const saved = await savedRoom()
      await reload()
      await waitFor('__e2e.svg() && __e2e.pieces().length > 0', '새로고침 뒤 평면도 (시작 화면이 뜨면 안 돼요)', 8000)
      const room = await savedRoom()
      must(J(spots(room)) === J(spots(saved)), '새로고침 뒤 가구 자리가 달라요')
      must(await ev('__e2e.inSync()'), '새로고침 뒤 화면과 저장된 자료가 달라요')
    })

    /** [처음부터]를 누른다. 휴대폰에서는 무대 도구 줄의 [더보기]를 먼저 연다 */
    async function pressReset() {
      if (vp.touch) {
        await clickEl(`__e2e.byLabel('더보기')`, '더보기')
        await waitFor(button('처음부터'), '[더보기] 메뉴의 처음부터', 3000)
      }
      await clickEl(button('처음부터'), '처음부터')
    }

    await check('9-3', '[처음부터]는 먼저 물어보고, 확인하면 시작 화면으로 가며 저장된 것을 지워요', async () => {
      await pressReset()
      await waitFor(`__e2e.all('[role="alertdialog"]')[0]`, '확인 창', 3000)
      await shot('reset-dialog')
      must(await ev('!!__e2e.svg() && __e2e.pieces().length > 0'), '확인하기도 전에 방이 지워졌어요')
      await clickEl(button('취소'), '취소')
      must(!(await ev(`!!__e2e.all('[role="alertdialog"]')[0]`)), '취소를 눌러도 확인 창이 남아 있어요')
      must(await ev(`!!localStorage.getItem(${J(PROJECT_KEY)}) && __e2e.pieces().length > 0`), '취소했는데 방이 지워졌어요')
      await pressReset()
      await waitFor(`__e2e.all('[role="alertdialog"]')[0]`, '확인 창', 3000)
      await clickEl(button('처음부터 시작'), '처음부터 시작')
      await waitFor(`__e2e.byText('h2', '방 크기 설정')`, '시작 화면', 4000)
      await sleep(1200)
      must((await ev(`localStorage.getItem(${J(PROJECT_KEY)})`)) === null, '시작 화면으로 갔는데 저장된 프로젝트가 남아 있어요')
      await reload()
      must(await ev(`!!__e2e.byText('h2', '방 크기 설정')`), '새로고침하니 지운 방이 다시 열렸어요')
    })

    // ════════ 10. 휴대폰 화면 ════════
    if (vp.touch) {
      const sheet = `__e2e.all('section[aria-label="조작 패널"]')[0]`
      const handle = `${sheet}.querySelector('button[aria-expanded][aria-label^="패널"]')`
      const scroller = `[...${sheet}.children].find((el) => getComputedStyle(el).overflowY === 'auto')`
      const MENUS = ['방', '스타일', '가구', '배치', '비용', '리포트']
      /** 무대(평면도·3D)가 화면 높이에서 차지하는 비율 */
      const stageShare = () => ev(`(() => { const view = __e2e.svg() || __e2e.all('canvas')[0]; return view ? view.parentElement.getBoundingClientRect().height / innerHeight : 0 })()`)

      await check('10-1', '아래 탭 바로 메뉴가 바뀌고, 어느 메뉴에서도 가로로 밀리지 않아요', async () => {
        await startExample()
        /** @type {string[]} */
        const bad = []
        for (const label of ['방', '스타일', '가구', '배치', '비용', '리포트']) {
          await clickEl(navButton(label), `탭 바의 ${label}`)
          await sleep(250)
          const seen = await ev(`({
            title: __e2e.text(${sheet}.querySelector('h2.panel-title')),
            current: __e2e.text(document.querySelector('nav[aria-label="메뉴"] [aria-current="page"]')),
            scrollWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, innerWidth,
            clipped: __e2e.clipped(),
          })`)
          if (seen.title !== label) bad.push(`${label}: 패널 제목이 "${seen.title}"`)
          if (seen.current !== label) bad.push(`${label}: 탭 바에 켜진 것은 "${seen.current}"`)
          if (seen.scrollWidth > seen.innerWidth || seen.bodyWidth > seen.innerWidth) bad.push(`${label}: 가로 ${Math.max(seen.scrollWidth, seen.bodyWidth)}px > 화면 ${seen.innerWidth}px`)
          if (seen.clipped.length > 0) bad.push(`${label}: 화면 밖으로 잘린 것 ${seen.clipped[0]}`)
          await shot(`tab-${label}`)
        }
        await clickEl(feedbackNav, '탭 바의 [피드백]')
        await sleep(250)
        const feedbackWidth = await ev(`({
          title: __e2e.text(${sheet}.querySelector('h2.panel-title')),
          current: __e2e.text(document.querySelector('nav[aria-label="메뉴"] [aria-current="page"]')),
          scrollWidth: document.documentElement.scrollWidth, innerWidth, clipped: __e2e.clipped(),
        })`)
        if (feedbackWidth.title !== '피드백') bad.push(`피드백: 패널 제목이 "${feedbackWidth.title}"`)
        if (!feedbackWidth.current.includes('피드백')) bad.push(`피드백: 탭 바에 켜진 것은 "${feedbackWidth.current}"`)
        if (feedbackWidth.scrollWidth > feedbackWidth.innerWidth) bad.push(`피드백: 가로 ${feedbackWidth.scrollWidth}px`)
        if (feedbackWidth.clipped.length > 0) bad.push(`피드백: 화면 밖으로 잘린 것 ${feedbackWidth.clipped[0]}`)
        await shot('tab-피드백')
        // 고정 막대는 위 하나(무대 도구 줄), 아래 하나(메뉴 탭)뿐이어야 한다
        const bars = await ev(`({ headers: __e2e.all('header').length, navs: __e2e.all('nav').length, navBottom: __e2e.all('nav')[0].getBoundingClientRect().bottom, innerHeight, segments: __e2e.all('[aria-label="시트 내용"]').length })`)
        if (bars.headers !== 1) bad.push(`위 막대(머리줄)가 ${bars.headers}개예요`)
        if (bars.navs !== 1 || Math.abs(bars.navBottom - bars.innerHeight) > 1) bad.push(`아래 막대가 ${bars.navs}개이거나 화면 맨 아래에 있지 않아요`)
        if (bars.segments !== 0) bad.push('시트 안에 예전 [패널/피드백] 전환 줄이 남아 있어요')
        must(bad.length === 0, bad.join(' | '))
      })

      await check('10-2', '시트 손잡이를 누르거나 끌면 시트가 커지고 작아져요', async () => {
        await startExample()
        const read = () => ev(`({ expanded: ${handle}.getAttribute('aria-expanded'), top: ${sheet}.getBoundingClientRect().top })`)
        const start = await read()
        must(start.expanded === 'false', '처음부터 시트가 펼쳐져 있어요')
        await clickEl(handle, '시트 손잡이')
        await sleep(450)
        const open = await read()
        must(open.expanded === 'true' && open.top < start.top - 100, `눌러도 커지지 않아요 (위쪽 ${Math.round(start.top)} → ${Math.round(open.top)}px)`)
        await shot('sheet-open')
        await clickEl(handle, '시트 손잡이')
        await sleep(450)
        const closed = await read()
        must(closed.expanded === 'false' && Math.abs(closed.top - start.top) < 2, `다시 눌러도 작아지지 않아요 (위쪽 ${Math.round(closed.top)}px)`)
        const grip = await ev(`__e2e.point(${handle})`)
        await dragPx({ x: grip.x, y: grip.y }, { x: grip.x, y: grip.y - 180 })
        await sleep(450)
        const dragged = await read()
        must(dragged.expanded === 'true' && dragged.top < start.top - 100, `위로 끌어도 커지지 않아요 (위쪽 ${Math.round(dragged.top)}px)`)
        const grip2 = await ev(`__e2e.point(${handle})`)
        await dragPx({ x: grip2.x, y: grip2.y }, { x: grip2.x, y: grip2.y + 180 })
        await sleep(450)
        const down = await read()
        must(down.expanded === 'false' && Math.abs(down.top - start.top) < 2, `아래로 끌어도 작아지지 않아요 (위쪽 ${Math.round(down.top)}px)`)
      })

      await check('10-3', '평면도 전체가 시트 위에 다 보여요', async () => {
        await startExample()
        await settle()
        const seen = await ev(`(() => {
          const room = __e2e.room()
          const a = __e2e.cmToClient(0, 0), b = __e2e.cmToClient(room.widthCm, room.depthCm)
          const stage = __e2e.svg().parentElement.getBoundingClientRect()
          const texts = [...__e2e.svg().querySelectorAll('text')].map((t) => t.getBoundingClientRect())
          return {
            sheetTop: ${sheet}.getBoundingClientRect().top, stageTop: stage.top, stageBottom: stage.bottom,
            left: a.x, top: a.y, right: b.x, bottom: b.y, innerWidth,
            textBottom: Math.max(...texts.map((t) => t.bottom)), textTop: Math.min(...texts.map((t) => t.top)), textLeft: Math.min(...texts.map((t) => t.left)),
          }
        })()`)
        must(seen.stageBottom <= seen.sheetTop + 1, `평면도 영역이 시트 밑으로 ${Math.round(seen.stageBottom - seen.sheetTop)}px 들어가 있어요`)
        must(seen.top >= seen.stageTop && seen.bottom <= seen.sheetTop, `방이 세로로 잘려요 (방 ${Math.round(seen.top)}~${Math.round(seen.bottom)}px, 보이는 곳 ${Math.round(seen.stageTop)}~${Math.round(seen.sheetTop)}px)`)
        must(seen.left >= 0 && seen.right <= seen.innerWidth, `방이 가로로 잘려요 (${Math.round(seen.left)}~${Math.round(seen.right)}px)`)
        must(seen.textTop >= seen.stageTop - 1 && seen.textLeft >= -1 && seen.textBottom <= seen.sheetTop + 1, '치수 글자가 잘려요')
        await shot('plan')
        return `방 ${Math.round(seen.right - seen.left)} × ${Math.round(seen.bottom - seen.top)}px, 1cm = ${((seen.right - seen.left) / 300).toFixed(2)}px`
      })

      await check('10-4', '손가락으로 끌면 가구가 움직여요 (화면은 같이 밀리지 않아요)', async () => {
        await startExample()
        const old = itemOf(await savedRoom(), CHAIR)
        await dragPieceBy(CHAIR, 100, 150)
        const room = await savedRoom()
        const now = itemOf(room, CHAIR)
        must(Math.abs(now.xCm - old.xCm - 100) <= 8 && Math.abs(now.yCm - old.yCm - 150) <= 8, `터치로 끈 결과: ${where(old)} → ${where(now)} (기대: 약 +100, +150)`)
        must(insideRoom(room, now), `가구가 방 밖으로 나갔어요 ${where(now)}`)
        const scroll = await ev(`({ x: scrollX, y: scrollY, top: document.scrollingElement.scrollTop })`)
        must(scroll.x === 0 && scroll.y === 0 && scroll.top === 0, `끄는 동안 화면이 밀렸어요 (${scroll.x}, ${scroll.y})`)
        return `${where(old)} → ${where(now)}`
      })

      await check('10-5', '휴대폰에서 도구 막대의 회전·복사·삭제가 눌려요', async () => {
        await startExample()
        const old = await savedRoom()
        await selectPiece(CHAIR)
        await clickEl(`__e2e.byLabel('선택한 가구 90도 회전')`, '회전 버튼')
        let room = await savedRoom()
        must(itemOf(room, CHAIR).rotation === (itemOf(old, CHAIR).rotation + 90) % 360, '회전 버튼을 눌러도 돌지 않아요')
        await clickEl(`__e2e.byLabel('선택한 가구 복사해서 하나 더 놓기')`, '복사 버튼')
        room = await savedRoom()
        must(room.furniture.length === old.furniture.length + 1, '복사 버튼을 눌러도 늘지 않아요')
        await clickEl(`__e2e.byLabel('선택한 가구 삭제')`, '삭제 버튼')
        room = await savedRoom()
        must(room.furniture.length === old.furniture.length, '삭제 버튼을 눌러도 지워지지 않아요')
      })

      await check('10-6', '휴대폰 3D에서도 가로로 밀리지 않고 캔버스가 시트 위에 있어요', async () => {
        await startExample()
        await open3d()
        await sleep(1500)
        const seen = await ev(`(() => { const c = __e2e.all('canvas')[0].getBoundingClientRect(); return { bottom: c.bottom, sheetTop: ${sheet}.getBoundingClientRect().top, scrollWidth: document.documentElement.scrollWidth, innerWidth, clipped: __e2e.clipped() } })()`)
        await shot('3d-phone')
        must(seen.scrollWidth <= seen.innerWidth, `가로 ${seen.scrollWidth}px > 화면 ${seen.innerWidth}px`)
        must(seen.bottom <= seen.sheetTop + 1, `3D 캔버스가 시트 밑으로 ${Math.round(seen.bottom - seen.sheetTop)}px 들어가 있어요`)
        must(seen.clipped.length === 0, `화면 밖으로 잘린 것: ${seen.clipped[0]}`)
        const share = await stageShare()
        must(share >= 0.45, `3D 자리가 화면 높이의 ${(share * 100).toFixed(1)}%예요 (45% 이상이어야 해요)`)
        await open2d()
      })

      await check('10-7', '기본 상태에서 평면도가 화면 높이의 45% 이상이고, 이름표가 "…"로 잘리지 않아요', async () => {
        await startExample({ coach: true }) // 첫 방문 도움말이 떠 있어도 평면도 자리는 줄지 않아야 한다
        const share = await stageShare()
        must(share >= 0.45, `평면도 자리가 화면 높이의 ${(share * 100).toFixed(1)}%예요 (45% 이상이어야 해요)`)
        const labels = await ev(`[...__e2e.svg().querySelectorAll('[data-piece-id] text')].map(__e2e.text)`)
        const cut = labels.filter((/** @type {string} */ value) => value.includes('…'))
        must(cut.length === 0, `잘린 이름표: ${cut.join(' / ')}`)
        must(labels.length >= 4, `이름표가 ${labels.length}줄뿐이에요: ${labels.join(' / ')}`)
        return `평면도 ${(share * 100).toFixed(1)}%, 이름표 ${labels.join(' / ')}`
      })

      await check('10-8', '시트 안 칩을 누르면 그 항목만 보이고, 칩은 한 줄이며 한 번에 하나만 켜져요', async () => {
        await startExample()
        await goCategory('방')
        const state = () => ev(`({
          selected: __e2e.all('section[aria-label="조작 패널"] [role="tab"]').filter((el) => el.getAttribute('aria-selected') === 'true').map(__e2e.text),
          size: __e2e.all('section[aria-label="방 크기"]').length, openings: __e2e.all('section[aria-label="문과 창문"]').length,
          life: !!__e2e.field('생활 유형'), width: !!__e2e.field('가로 (cm)'),
          rows: new Set(__e2e.all('section[aria-label="조작 패널"] [role="tab"]').map((el) => Math.round(el.getBoundingClientRect().top))).size,
          lists: __e2e.all('section[aria-label="조작 패널"] [role="tablist"]').length,
          small: __e2e.all('section[aria-label="조작 패널"] [role="tab"]').map((el) => el.getBoundingClientRect()).filter((box) => box.width < 44 || box.height < 44).length,
        })`)
        let seen = await state()
        must(seen.selected.length === 1 && seen.selected[0].startsWith('크기'), `처음에 켜진 칩: ${seen.selected.join(', ') || '없음'}`)
        must(seen.size === 1 && seen.width && seen.openings === 0 && !seen.life, '[크기]인데 다른 항목이 같이 보여요')
        must(seen.lists === 1 && seen.rows === 1, `칩 줄이 ${seen.lists}개, ${seen.rows}줄이에요`)
        must(seen.small === 0, `손가락이 닿는 자리가 44px보다 작은 칩이 ${seen.small}개 있어요`)
        await openSheetTab('문·창문')
        seen = await state()
        must(seen.selected.length === 1 && seen.selected[0].startsWith('문·창문'), `켜진 칩: ${seen.selected.join(', ')}`)
        must(seen.openings === 1 && seen.size === 0 && !seen.width && !seen.life, '[문·창문]인데 다른 항목이 같이 보여요')
        await shot('chip-openings')
        await openSheetTab('생활')
        seen = await state()
        must(seen.life && seen.openings === 0 && seen.size === 0, '[생활·창 방향]인데 다른 항목이 같이 보여요')
        // 다른 메뉴에 다녀와도 칩 줄은 그 메뉴의 것 하나뿐이다
        for (const label of MENUS) {
          await clickEl(navButton(label), `탭 바의 ${label}`)
          await sleep(200)
          const rows = await ev(`({ lists: __e2e.all('section[aria-label="조작 패널"] [role="tablist"]').length, rows: new Set(__e2e.all('section[aria-label="조작 패널"] [role="tab"]').map((el) => Math.round(el.getBoundingClientRect().top))).size })`)
          must(rows.lists <= 1 && rows.rows <= 1, `${label}: 칩 줄이 ${rows.lists}개, ${rows.rows}줄이에요`)
        }
      })

      await check('10-9', '시트를 크게 폈을 때 어느 칩의 내용도 시트 높이의 1.3배를 넘게 스크롤되지 않아요', async () => {
        await startExample()
        await clickEl(handle, '시트 크게 보기 단추')
        await sleep(450)
        /** @type {string[]} */
        const long = []
        /** @type {string[]} */
        const notes = []
        const measure = async (/** @type {string} */ name) => {
          const size = await ev(`({ scroll: ${scroller}.scrollHeight, sheet: ${sheet}.getBoundingClientRect().height })`)
          const ratio = size.scroll / size.sheet
          notes.push(`${name} ${ratio.toFixed(2)}`)
          if (ratio > 1.3) long.push(`${name}: 내용 ${Math.round(size.scroll)}px, 시트 ${Math.round(size.sheet)}px (${ratio.toFixed(2)}배)`)
        }
        for (const label of [...MENUS, '피드백']) {
          if (label === '피드백') await clickEl(feedbackNav, '탭 바의 [피드백]')
          else await clickEl(navButton(label), `탭 바의 ${label}`)
          await sleep(250)
          const chips = await ev(`__e2e.all('section[aria-label="조작 패널"] [role="tab"]').map((el) => __e2e.text(el))`)
          if (chips.length === 0) await measure(label)
          for (const chip of chips) {
            await clickEl(sheetTab(chip), `${label}의 [${chip}] 칩`)
            await sleep(200)
            await measure(`${label}>${chip}`)
          }
        }
        must(long.length === 0, long.join(' | '))
        return notes.join(', ')
      })

      await check('10-10', '시트를 아래로 끌면 가장 작게 접히고(무대가 넓어져요), 메뉴 탭을 누르면 다시 펴져요', async () => {
        await startExample()
        const read = () => ev(`({ top: ${sheet}.getBoundingClientRect().top, bottom: ${sheet}.getBoundingClientRect().bottom, stage: __e2e.svg().parentElement.getBoundingClientRect().height, inert: ${scroller}.inert === true })`)
        const start = await read()
        const grip = await ev(`__e2e.point(${handle})`)
        await dragPx({ x: grip.x, y: grip.y }, { x: grip.x, y: grip.y + 260 })
        await sleep(450)
        const small = await read()
        must(small.bottom - small.top <= 60 && small.top > start.top + 100, `아래로 끌어도 가장 작게 접히지 않아요 (시트 높이 ${Math.round(small.bottom - small.top)}px)`)
        must(small.stage > start.stage + 100, `시트를 접어도 평면도 자리가 넓어지지 않아요 (${Math.round(start.stage)} → ${Math.round(small.stage)}px)`)
        must(small.inert, '접힌 시트의 내용이 여전히 눌리는 상태예요')
        await shot('sheet-min')
        // 접힌 상태에서도 평면도 전체가 보이고 가구를 누를 수 있다
        const covered = await ev(`__e2e.pieces().map((p) => __e2e.piecePoint(p.id)).filter((p) => !p.free).map((p) => p.piece.label + ' ← ' + p.cover)`)
        must(covered.length === 0, `가려진 가구: ${covered.join(' / ')}`)
        await clickEl(navButton('가구'), '탭 바의 가구')
        await sleep(450)
        const back = await read()
        must(Math.abs(back.top - start.top) < 2 && !back.inert, `메뉴 탭을 눌러도 시트가 기본 크기로 펴지지 않아요 (위쪽 ${Math.round(back.top)}px, 처음 ${Math.round(start.top)}px)`)
        // 칩 줄을 위로 끌어도 시트가 커진다 (칩이 대신 눌리지 않는다)
        const chip = await ev(`__e2e.point(${sheetTab('가구 추가')})`)
        const selectedBefore = await ev(`__e2e.text(__e2e.all('section[aria-label="조작 패널"] [role="tab"]').find((el) => el.getAttribute('aria-selected') === 'true'))`)
        await dragPx({ x: chip.x, y: chip.y }, { x: chip.x, y: chip.y - 200 })
        await sleep(450)
        const big = await read()
        must(big.top < start.top - 100, `칩 줄을 위로 끌어도 시트가 커지지 않아요 (위쪽 ${Math.round(big.top)}px)`)
        const selectedAfter = await ev(`__e2e.text(__e2e.all('section[aria-label="조작 패널"] [role="tab"]').find((el) => el.getAttribute('aria-selected') === 'true'))`)
        must(selectedAfter === selectedBefore, `시트를 끌었는데 칩이 눌렸어요 (${selectedBefore} → ${selectedAfter})`)
      })

      await check('10-11', '시트 내용을 손가락으로 밀면 내용만 스크롤돼요 (시트 크기와 화면은 그대로예요)', async () => {
        await startExample()
        await goCategory('가구')
        await openSheetTab('가구 추가')
        const read = () => ev(`({ top: ${sheet}.getBoundingClientRect().top, scroll: ${scroller}.scrollTop, room: ${scroller}.scrollHeight - ${scroller}.clientHeight, box: (() => { const r = ${scroller}.getBoundingClientRect(); return { x: r.left + r.width / 2, top: r.top, bottom: r.bottom } })(), pageY: scrollY, pageX: scrollX })`)
        const start = await read()
        must(start.room > 40, `밀어 볼 만큼 내용이 길지 않아요 (${start.room}px)`)
        // 세로로 밀기: 내용이 올라간다
        await dragPx({ x: start.box.x, y: start.box.bottom - 30 }, { x: start.box.x, y: start.box.top + 20 })
        await sleep(500)
        const scrolled = await read()
        must(scrolled.scroll > 30, `손가락으로 밀어도 시트 내용이 스크롤되지 않아요 (scrollTop ${scrolled.scroll})`)
        must(Math.abs(scrolled.top - start.top) < 2, `내용을 밀었는데 시트 크기가 바뀌었어요 (위쪽 ${Math.round(start.top)} → ${Math.round(scrolled.top)}px)`)
        must(scrolled.pageY === 0 && scrolled.pageX === 0, `내용을 밀었는데 화면 전체가 밀렸어요 (${scrolled.pageX}, ${scrolled.pageY})`)
        // 칩 줄을 가로로 밀기: 시트 크기도, 켜진 칩도 그대로다
        const chip = await ev(`__e2e.point(${sheetTab('가구 추가')})`)
        const selectedBefore = await ev(`__e2e.text(__e2e.all('section[aria-label="조작 패널"] [role="tab"]').find((el) => el.getAttribute('aria-selected') === 'true'))`)
        await dragPx({ x: chip.x + 30, y: chip.y }, { x: chip.x - 90, y: chip.y })
        await sleep(400)
        const swiped = await read()
        const selectedAfter = await ev(`__e2e.text(__e2e.all('section[aria-label="조작 패널"] [role="tab"]').find((el) => el.getAttribute('aria-selected') === 'true'))`)
        must(Math.abs(swiped.top - start.top) < 2, `칩 줄을 가로로 밀었는데 시트 크기가 바뀌었어요 (위쪽 ${Math.round(swiped.top)}px)`)
        must(selectedAfter === selectedBefore, `칩 줄을 가로로 밀었는데 칩이 눌렸어요 (${selectedBefore} → ${selectedAfter})`)
        return `내용 ${Math.round(scrolled.scroll)}px 스크롤`
      })

      // ════════ 11. 방봄 "집 보기" 안에 끼워진 휴대폰 화면 (390 × 700) ════════
      const EMBED_KEY = 'bangkkumi2.project.e2e-embed'
      const EMBED_URL = `${BASE_URL}/room.html?embed=1&slot=e2e-embed&w=400&d=500&kind=living&name=${encodeURIComponent('거실')}&op=door:left:183:90,window:bottom:76:248`

      await check('11-1', '끼워진 화면(390×700)에는 머리줄과 첫 방문 도움말이 없고, 가로로 밀리지 않아요', async () => {
        await gotoStart({ coach: true })
        await ev(`localStorage.removeItem(${J(EMBED_KEY)})`)
        await resize(390, 700)
        await open(EMBED_URL)
        await waitFor('__e2e.svg() && __e2e.pieces().length > 0', '끼워진 화면의 평면도')
        await sleep(300)
        const seen = await ev(`({
          headers: __e2e.all('header').length, coach: __e2e.all('aside[aria-label="처음 쓰는 분을 위한 도움말"]').length,
          oldTitle: __e2e.all('h1').map(__e2e.text),
          undo: !!__e2e.byLabel('실행취소'), redo: !!__e2e.byLabel('다시실행'), more: !!__e2e.byLabel('더보기'),
          view: __e2e.all('[aria-label="보기 방식"] button').length, name: document.body.innerText.includes('거실'),
          navs: __e2e.all('nav').length, navBottom: __e2e.all('nav')[0].getBoundingClientRect().bottom,
          scrollWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, innerWidth, innerHeight, clipped: __e2e.clipped(),
          small: __e2e.all('button, a[href], select, input').filter((el) => !el.closest('svg[role="application"]')).map((el) => ({ box: el.getBoundingClientRect(), what: __e2e.describe(el) })).filter((entry) => entry.box.top < innerHeight && entry.box.bottom > 0 && (entry.box.width < 43.5 || entry.box.height < 43.5)).map((entry) => entry.what + ' ' + Math.round(entry.box.width) + 'x' + Math.round(entry.box.height)),
        })`)
        await shot('embed')
        must(seen.headers === 0, `머리줄이 ${seen.headers}개 남아 있어요`)
        must(seen.oldTitle.length === 0, `예전 머리줄 제목이 남아 있어요: ${seen.oldTitle.join(', ')}`)
        must(seen.coach === 0, '끼워진 화면에 첫 방문 도움말이 떠 있어요')
        must(seen.undo && seen.redo && seen.more && seen.view === 2, '무대 도구 줄에 2D/3D, 실행취소, 다시실행, 더보기가 다 있지 않아요')
        must(seen.name, '무대 도구 줄에 방 이름(거실)이 보이지 않아요')
        must(seen.navs === 1 && Math.abs(seen.navBottom - seen.innerHeight) <= 1, `아래 고정 막대가 메뉴 탭 하나가 아니에요 (nav ${seen.navs}개)`)
        must(seen.scrollWidth <= seen.innerWidth && seen.bodyWidth <= seen.innerWidth, `가로 ${Math.max(seen.scrollWidth, seen.bodyWidth)}px > 화면 ${seen.innerWidth}px`)
        must(seen.clipped.length === 0, `화면 밖으로 잘린 것: ${seen.clipped[0]}`)
        must(seen.small.length === 0, `손가락이 닿는 자리가 44px보다 작아요: ${seen.small.slice(0, 3).join(' / ')}`)
        const share = await stageShare()
        must(share >= 0.45, `평면도 자리가 화면 높이의 ${(share * 100).toFixed(1)}%예요 (45% 이상이어야 해요)`)
        return `평면도 ${(share * 100).toFixed(1)}%`
      })

      await check('11-2', '끼워진 화면에서 가구를 끈 뒤 [실행취소]를 누르면 돌아오고, [더보기]에 처음부터와 저장/공유가 있어요', async () => {
        must(await ev(`location.search.includes('embed=1') && !!__e2e.svg()`), '앞 단계(끼워진 화면 열기)가 되지 않아 확인하지 못했어요')
        must(await ev(`__e2e.byLabel('실행취소').disabled`), '아무것도 안 했는데 실행취소가 켜져 있어요')
        const before = await ev('__e2e.pieces()[0]')
        const p = await piecePoint(before.id)
        const k = await ev('__e2e.pxPerCm()')
        // 방 가운데 쪽으로 60cm 끈다
        const room = { w: 400, d: 500 }
        const dx = before.x + before.w / 2 < room.w / 2 ? 60 : -60
        const dy = before.y + before.h / 2 < room.d / 2 ? 60 : -60
        await dragPx({ x: p.x, y: p.y }, { x: p.x + dx * k, y: p.y + dy * k })
        const moved = await ev(`__e2e.pieces().find((piece) => piece.id === ${J(before.id)})`)
        must(moved.x !== before.x || moved.y !== before.y, `손가락으로 끌어도 가구가 움직이지 않아요 (${before.x}, ${before.y})`)
        must(!(await ev(`__e2e.byLabel('실행취소').disabled`)), '가구를 옮겼는데 실행취소가 꺼져 있어요')
        await clickEl(`__e2e.byLabel('실행취소')`, '실행취소 버튼')
        const back = await ev(`__e2e.pieces().find((piece) => piece.id === ${J(before.id)})`)
        must(back.x === before.x && back.y === before.y, `실행취소를 눌러도 돌아오지 않아요 (${back.x}, ${back.y}) ← 처음 (${before.x}, ${before.y})`)
        must(!(await ev(`__e2e.byLabel('다시실행').disabled`)), '실행취소 뒤에 다시실행이 꺼져 있어요')
        await press('Escape')
        await clickEl(`__e2e.byLabel('더보기')`, '더보기')
        const menu = await ev(`({ reset: !!__e2e.byText('button', '처음부터'), save: !!__e2e.byText('button', '프로젝트 파일 내려받기'), share: !!__e2e.byText('button', '링크 공유하기'), scrollWidth: document.documentElement.scrollWidth, innerWidth, clipped: __e2e.clipped() })`)
        await shot('embed-more')
        must(menu.reset && menu.save && menu.share, '[더보기] 안에 처음부터·프로젝트 파일 내려받기·링크 공유하기가 다 있지 않아요')
        must(menu.scrollWidth <= menu.innerWidth && menu.clipped.length === 0, `[더보기]를 열면 가로로 넘쳐요: ${menu.clipped[0] || menu.scrollWidth + 'px'}`)
        await clickEl(button('처음부터'), '처음부터')
        await waitFor(`__e2e.all('[role="alertdialog"]')[0]`, '확인 창', 3000)
        await clickEl(button('취소'), '취소')
        return `(${before.x}, ${before.y}) → (${moved.x}, ${moved.y}) → 실행취소`
      })

      await check('11-3', '끼워진 화면에서 이미 고른 가구를 가장자리 가까이에서 끌어도 크기는 그대로이고 자리만 바뀌어요', async () => {
        must(await ev(`location.search.includes('embed=1') && !!__e2e.svg()`), '앞 단계(끼워진 화면 열기)가 되지 않아 확인하지 못했어요')
        await press('Escape')
        // 화면에서 가장 좁은 가구(거실에서는 TV장). 좁을수록 크기 손잡이의 누르는 자리가 가구를 많이 덮는다
        const narrow = await ev(`__e2e.pieces().slice().sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h))[0]`)
        const { before, after, dx, dy } = await dragSelectedNearEdge(narrow.id)
        must(after.w === before.w && after.h === before.h, `${before.label}: 끌었더니 크기가 ${before.w} × ${before.h} → ${after.w} × ${after.h}cm로 바뀌었어요 (옮겨져야 해요)`)
        must(Math.abs(after.x - before.x - dx) <= 8 && Math.abs(after.y - before.y - dy) <= 8, `${before.label}: 끈 만큼 옮겨지지 않았어요 (${before.x}, ${before.y}) → (${after.x}, ${after.y}), 기대: 약 ${Math.round(dx)}, ${Math.round(dy)}`)
        await press('Escape')
        return `${before.label}: (${before.x}, ${before.y}) → (${after.x}, ${after.y})`
      })

      await check('11-4', '끼워진 화면에서 가구를 골라도 도구 막대가 방과 치수 글자를 가리지 않아요', async () => {
        must(await ev(`location.search.includes('embed=1') && !!__e2e.svg()`), '앞 단계(끼워진 화면 열기)가 되지 않아 확인하지 못했어요')
        const bad = await toolbarCovers(400, 500)
        await shot('embed-toolbar')
        must(bad.length === 0, bad.join(' / '))
      })

      await check('11-5', '끼워진 화면(360×637)에서 키보드가 올라와 화면이 300px 낮아져도 누른 입력 칸이 시트 안에 다 보여요', async () => {
        await resize(360, 637)
        await ev(`localStorage.removeItem(${J(EMBED_KEY)})`)
        await open(EMBED_URL)
        await waitFor('__e2e.svg() && __e2e.pieces().length > 0', '끼워진 화면의 평면도')
        await goCategory('방')
        await clickEl(`__e2e.field('가로 (cm)')`, '가로 칸')
        must(await ev(`document.activeElement === __e2e.field('가로 (cm)')`), '가로 칸을 눌러도 커서가 들어가지 않아요')
        // 화면 키보드가 페이지 높이를 줄이는 브라우저(안드로이드의 앱 안 브라우저 등)를 흉내 낸다
        await resize(360, 337)
        await sleep(450)
        const seen = await ev(`(() => {
          const field = document.activeElement
          // 브라우저는 키보드가 뜨면 입력 중인 칸을 보이는 곳으로 옮긴다
          field.scrollIntoView({ block: 'nearest' })
          const box = ${scroller}.getBoundingClientRect(), r = field.getBoundingClientRect(), nav = __e2e.all('nav')[0].getBoundingClientRect()
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return { top: box.top, bottom: Math.min(box.bottom, nav.top), fieldTop: r.top, fieldBottom: r.bottom, hit: top === field, plan: __e2e.svg() ? __e2e.svg().getBoundingClientRect().height : 0 }
        })()`)
        await shot('embed-keyboard')
        must(seen.fieldTop >= seen.top - 1 && seen.fieldBottom <= seen.bottom + 1 && seen.hit, `입력 칸(${Math.round(seen.fieldTop)}~${Math.round(seen.fieldBottom)}px)이 시트의 보이는 곳(${Math.round(seen.top)}~${Math.round(seen.bottom)}px)에 다 들어오지 않아요`)
        must(seen.plan >= 40, `평면도가 ${Math.round(seen.plan)}px밖에 남지 않았어요`)
        await press('Escape')
        return `시트의 보이는 곳 ${Math.round(seen.bottom - seen.top)}px, 평면도 ${Math.round(seen.plan)}px`
      })

      await resize(vp.width, vp.height)
      await ev(`localStorage.removeItem(${J(EMBED_KEY)})`).catch(() => {})

      // ════════ 12. 휴대폰 검수에서 고친 것 ════════
      await check('12-1', '이미 고른 작은 가구를 가장자리 가까이에서 끌어도 크기는 그대로이고 자리만 바뀌어요', async () => {
        await startExample()
        const { before, after, dx, dy } = await dragSelectedNearEdge(CHAIR)
        must(after.w === before.w && after.h === before.h, `끌었더니 크기가 ${before.w} × ${before.h} → ${after.w} × ${after.h}cm로 바뀌었어요 (옮겨져야 해요)`)
        must(Math.abs(after.x - before.x - dx) <= 8 && Math.abs(after.y - before.y - dy) <= 8, `끈 만큼 옮겨지지 않았어요 (${before.x}, ${before.y}) → (${after.x}, ${after.y}), 기대: 약 +${Math.round(dx)}, +${Math.round(dy)}`)
        const saved = itemOf(await savedRoom(), CHAIR)
        must(saved.widthCm === 50 && saved.depthCm === 50, `저장된 크기가 ${saved.widthCm} × ${saved.depthCm}cm예요`)
        // 크기 손잡이는 가구 바깥쪽에서 계속 잡힌다 (3-5가 손잡이 한가운데를 끌어 본다)
        return `(${before.x}, ${before.y}) → (${after.x}, ${after.y}), 크기 ${after.w} × ${after.h}`
      })

      for (const [width, height] of [[390, 844], [360, 740]]) {
        const at = `${width}×${height}`

        await check(`12-2-${width}`, `[${at}] 가구 추가에서 아래쪽 종류를 눌러 펼치면 그 목록의 [추가] 단추가 시트 안에 보여요`, async () => {
          await resize(width, height)
          await startExample()
          await goCategory('가구')
          await openSheetTab('가구 추가')
          await ev(`(() => { const el = ${scroller}; el.scrollTop = el.scrollHeight })()`)
          await sleep(200)
          await clickEl(`__e2e.fold('소파')`, '소파 묶음')
          await sleep(450)
          const seen = await ev(`(() => {
            const add = document.querySelector('[aria-label="2인 소파 추가"]'), head = __e2e.fold('소파')
            if (!add || !head) return null
            const box = ${scroller}.getBoundingClientRect(), a = add.getBoundingClientRect(), h = head.getBoundingClientRect()
            const top = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2)
            return { top: box.top, bottom: box.bottom, addTop: a.top, addBottom: a.bottom, headTop: h.top, hit: !!top && add.contains(top) }
          })()`)
          await shot(`catalog-open-${width}`)
          must(seen, '소파를 눌러도 목록이 펼쳐지지 않아요')
          must(seen.addTop >= seen.top - 1 && seen.addBottom <= seen.bottom + 1 && seen.hit, `[2인 소파 추가] 단추(${Math.round(seen.addTop)}~${Math.round(seen.addBottom)}px)가 시트의 보이는 곳(${Math.round(seen.top)}~${Math.round(seen.bottom)}px) 밖에 있어요`)
          must(seen.headTop >= seen.top - 1, '펼친 종류의 제목이 위로 밀려 보이지 않아요')
        })

        await check(`12-3-${width}`, `[${at}] 목록을 내려 둔 채 [추가]를 눌러도 결과 알림이 시트 안에 보여요`, async () => {
          await resize(width, height)
          await startExample()
          await goCategory('가구')
          await openSheetTab('가구 추가')
          await ev(`(() => { ${scroller}.scrollTop = 100 })()`)
          await sleep(200)
          await clickEl(`__e2e.byLabel('퀸 침대 추가')`, '퀸 침대 추가')
          await sleep(500)
          const seen = await ev(`(() => {
            const note = __e2e.all('[role="status"]').find((el) => /추가했어요|놓았어요/.test(__e2e.text(el)))
            if (!note) return null
            const box = ${scroller}.getBoundingClientRect(), r = note.getBoundingClientRect()
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
            const add = document.querySelector('[aria-label="퀸 침대 추가"]').getBoundingClientRect()
            return { text: __e2e.text(note), top: box.top, bottom: box.bottom, noteTop: r.top, noteBottom: r.bottom, hit: !!top && note.contains(top), addMid: add.top + add.height / 2 }
          })()`)
          await shot(`catalog-notice-${width}`)
          must(seen, '추가했는데 결과 알림이 없어요')
          must(/가운데에 두었으니 직접 옮겨/.test(seen.text), `자리가 없을 때의 알림이 아니에요: "${seen.text}"`)
          must(seen.noteTop >= seen.top - 1 && seen.noteBottom <= seen.bottom + 1 && seen.hit, `결과 알림(${Math.round(seen.noteTop)}~${Math.round(seen.noteBottom)}px)이 시트의 보이는 곳(${Math.round(seen.top)}~${Math.round(seen.bottom)}px) 밖에 있어요`)
          return `알림 ${Math.round(seen.noteTop)}~${Math.round(seen.noteBottom)}px, 보이는 곳 ${Math.round(seen.top)}~${Math.round(seen.bottom)}px`
        })

        await check(`12-4-${width}`, `[${at}] 가구를 골라도 도구 막대가 방과 치수 글자를 가리지 않고, 단추가 44px 이상이에요`, async () => {
          await resize(width, height)
          await startExample()
          const bad = await toolbarCovers(300, 400)
          await selectPiece(DESK)
          await shot(`toolbar-${width}`)
          await press('Escape')
          must(bad.length === 0, bad.join(' / '))
        })
      }
      await resize(vp.width, vp.height)

      await check('12-5', '피드백 탭의 숫자 표시는 두 자리여도 한 줄로 온전히 보여요', async () => {
        await startExample()
        await goCategory('가구')
        await openSheetTab('가구 추가')
        for (let i = 0; i < 4; i++) await clickEl(`__e2e.byLabel('싱글 침대 추가')`, '싱글 침대 추가')
        await settle()
        const seen = await ev(`(() => {
          const tab = ${feedbackNav}
          const badge = tab.querySelector('span.relative > span')
          if (!badge) return null
          const range = document.createRange()
          range.selectNodeContents(badge)
          const b = badge.getBoundingClientRect(), t = range.getBoundingClientRect(), cell = tab.getBoundingClientRect()
          return {
            label: tab.getAttribute('aria-label'), text: __e2e.text(badge),
            lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size,
            inBox: t.left >= b.left - 0.5 && t.right <= b.right + 0.5 && t.top >= b.top - 2 && t.bottom <= b.bottom + 2,
            inCell: b.left >= cell.left - 0.5 && b.right <= cell.right + 0.5 && b.top >= cell.top - 0.5, width: b.width, height: b.height,
          }
        })()`)
        await shot('badge')
        must(seen, '피드백 탭에 숫자 표시가 없어요')
        const count = Number((/문제 (\d+)개/.exec(seen.label) || [])[1])
        must(count >= 10, `두 자리 숫자를 만들지 못했어요 (${seen.label})`)
        must(seen.text === String(count), `숫자 표시가 "${seen.text}"예요 (문제 ${count}개)`)
        must(seen.lines === 1, `숫자가 ${seen.lines}줄로 꺾였어요`)
        must(seen.inBox, `숫자가 동그란 바탕(${Math.round(seen.width)} × ${Math.round(seen.height)}px) 밖으로 나가요`)
        must(seen.inCell, '숫자 표시가 피드백 탭 칸 밖으로 나가요')
        return `문제 ${count}개, 표시 ${Math.round(seen.width)} × ${Math.round(seen.height)}px`
      })

      await check('12-6', '태블릿 너비(768×1024)의 휴대폰 틀에서도 가구 이름표가 "…"로 잘리지 않아요', async () => {
        await resize(768, 1024)
        await startExample()
        must(await ev(`!!${sheet}`), '768px인데 휴대폰 틀이 아니에요')
        const labels = await ev(`[...__e2e.svg().querySelectorAll('[data-piece-id] text')].map(__e2e.text)`)
        await shot('tablet')
        const cut = labels.filter((/** @type {string} */ value) => value.includes('…'))
        must(cut.length === 0, `잘린 이름표: ${cut.join(' / ')}`)
        must(labels.length >= 5, `이름표가 ${labels.length}줄뿐이에요: ${labels.join(' / ')}`)
        return labels.join(' / ')
      })
      await resize(vp.width, vp.height)

      await check('12-7', '시트 모양이 방봄 카드 시트와 같아요 (위 모서리 20px, 옅은 선, 칩 옆 여백 14px)', async () => {
        await startExample()
        await goCategory('가구')
        const seen = await ev(`(() => { const s = getComputedStyle(${sheet}); const chip = ${sheet}.querySelector('.seg-chip'); return { radius: s.borderTopLeftRadius, line: s.borderTopColor, pad: chip ? getComputedStyle(chip).paddingLeft : '' } })()`)
        must(seen.radius === '20px', `시트 위 모서리가 ${seen.radius}예요 (방봄 카드 시트는 20px)`)
        must(seen.line === 'rgb(227, 225, 219)', `시트 위 선 색이 ${seen.line}예요 (방봄 카드 시트는 #e3e1db)`)
        must(seen.pad === '14px', `칩의 옆 여백이 ${seen.pad}예요 (방봄 카드 칩은 14px)`)
      })

      await check('12-8', '폭 280px 화면에서도 위 막대의 [실행취소] [다시실행] [더보기]가 화면 안에 있어요', async () => {
        await resize(280, 653)
        await startExample()
        const seen = await ev(`({
          tools: ['실행취소', '다시실행', '더보기'].map((label) => { const el = __e2e.byLabel(label); const r = el ? el.getBoundingClientRect() : null; return { label, left: r ? r.left : -1, right: r ? r.right : -1 } }),
          view: __e2e.all('[aria-label="보기 방식"] button').length, innerWidth, scrollWidth: document.documentElement.scrollWidth,
        })`)
        await shot('narrow')
        const out = seen.tools.filter((/** @type {any} */ tool) => tool.left < 0 || tool.right > seen.innerWidth + 0.5)
        must(out.length === 0, `화면(${seen.innerWidth}px) 밖으로 나간 단추: ${out.map((/** @type {any} */ tool) => `${tool.label} ${Math.round(tool.left)}~${Math.round(tool.right)}px`).join(', ')}`)
        must(seen.view === 2, '2D/3D 단추가 보이지 않아요')
        must(seen.scrollWidth <= seen.innerWidth, `가로 ${seen.scrollWidth}px > 화면 ${seen.innerWidth}px`)
      })

      await check('12-9', '낮은 화면(720×450)에 처음 와도 시트에 패널 내용이 100px 넘게 보여요', async () => {
        await resize(720, 450)
        await startExample({ coach: true })
        await goCategory('방')
        const seen = await ev(`(() => { const box = ${scroller}.getBoundingClientRect(); const field = __e2e.field('가로 (cm)'); const r = field ? field.getBoundingClientRect() : null; return { room: box.height, field: !!r && r.top >= box.top - 1 && r.bottom <= box.bottom + 1, plan: __e2e.svg().getBoundingClientRect().height } })()`)
        await shot('short')
        must(seen.room >= 100, `시트에서 패널 내용이 보이는 높이가 ${Math.round(seen.room)}px뿐이에요`)
        must(seen.field, '방 크기의 가로 칸이 처음 화면에 다 보이지 않아요')
        must(seen.plan >= 100, `평면도가 ${Math.round(seen.plan)}px밖에 남지 않았어요`)
        return `패널 내용 ${Math.round(seen.room)}px, 평면도 ${Math.round(seen.plan)}px`
      })
      await resize(vp.width, vp.height)
    }

    // ════════ 13. PC 틀은 그대로 ════════
    if (!vp.touch) {
      await check('13-1', 'PC 1024px 너비에서는 가구 이름표가 예전처럼 한 줄이에요 (두 줄로 나누는 규칙은 휴대폰 틀에서만 써요)', async () => {
        await resize(1024, 768)
        await startExample()
        const seen = await ev(`({
          desktop: __e2e.all('section[aria-label="조작 패널"]').length === 0 && __e2e.all('header').length === 1,
          plan: Math.round(__e2e.svg().getBoundingClientRect().width),
          pieces: [...document.querySelectorAll('[data-piece-id]')].map((g) => ({ name: g.getAttribute('aria-label'), lines: [...g.querySelectorAll('text')].map(__e2e.text) })),
        })`)
        await shot('pc-1024')
        must(seen.desktop, '1024px인데 PC 틀이 아니에요')
        const split = seen.pieces.filter((/** @type {any} */ piece) => piece.lines.length > 1)
        must(split.length === 0, `두 줄로 나뉜 이름표: ${split.map((/** @type {any} */ piece) => piece.lines.join('/')).join(', ')} (평면도 너비 ${seen.plan}px)`)
        return `평면도 너비 ${seen.plan}px, 이름표 ${seen.pieces.map((/** @type {any} */ piece) => piece.lines.join('/') || '없음').join(', ')}`
      })
      await resize(vp.width, vp.height)
    }
  }
}

// ── 실행 ────────────────────────────────────────────────────────────────
async function main() {
  const browserPath = findBrowser()
  const port = await freePort()
  const ownProfile = PROFILE_DIR === ''
  const profileDir = ownProfile ? mkdtempSync(path.join(os.tmpdir(), 'bangkkumi-e2e-')) : path.resolve(PROFILE_DIR)
  mkdirSync(profileDir, { recursive: true })
  if (SHOTS_DIR) mkdirSync(SHOTS_DIR, { recursive: true })

  const child = spawn(
    browserPath,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--remote-allow-origins=*',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--disable-background-networking',
      '--mute-audio',
      '--window-size=1280,800',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  let exited = false
  child.on('exit', (code, signal) => {
    exited = true
    if (process.env.E2E_DEBUG) console.log(`(브라우저 종료: 코드 ${code}, 신호 ${signal})`)
  })

  /** @type {string} */
  let browserSocketUrl = ''
  const closeBrowser = async () => {
    try {
      if (!exited && browserSocketUrl) {
        const socket = await openSocket(browserSocketUrl)
        socket.send(J({ id: 1, method: 'Browser.close' }))
        for (let i = 0; i < 50 && !exited; i++) await sleep(100)
        socket.close()
      }
    } catch {
      // 아래에서 강제로 끈다
    }
    if (!exited) {
      if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else child.kill('SIGKILL')
      for (let i = 0; i < 30 && !exited; i++) await sleep(100)
    }
    if (ownProfile) {
      for (let i = 0; i < 10; i++) {
        try {
          rmSync(profileDir, { recursive: true, force: true })
          break
        } catch {
          await sleep(300)
        }
      }
    }
  }

  let watchdog
  try {
    // 브라우저가 CDP 주소를 열 때까지 기다린다
    /** @type {{ type: string, webSocketDebuggerUrl: string } | undefined} */
    let target
    for (let i = 0; i < 100 && !target; i++) {
      try {
        const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
        browserSocketUrl = version.webSocketDebuggerUrl || ''
        const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
        target = list.find((/** @type {{ type: string }} */ entry) => entry.type === 'page')
      } catch {
        // 아직 안 떴다
      }
      if (!target) await sleep(150)
    }
    if (!target) throw new Error('브라우저가 뜨지 않았어요')

    const cdp = new Cdp(await openSocket(target.webSocketDebuggerUrl))
    console.log(`점검 주소: ${BASE_URL}`)
    const limit = new Promise((_, reject) => {
      watchdog = setTimeout(() => reject(new Error(`전체 점검이 ${TOTAL_LIMIT_MS / 60000}분 안에 끝나지 않았어요`)), TOTAL_LIMIT_MS)
    })
    await Promise.race([runAll(cdp), limit])
  } catch (error) {
    const line = `실패 점검을 끝까지 하지 못했어요 — ${error instanceof Error ? error.message : String(error)}`
    failures.push({ line })
    console.log(line)
  } finally {
    clearTimeout(watchdog)
    await closeBrowser()
  }

  console.log('')
  if (pageErrors.length > 0) {
    console.log(`콘솔 오류·예외 ${pageErrors.length}건:`)
    for (const entry of pageErrors.slice(0, 20)) console.log(`  - ${entry.kind}: ${entry.text}  ← ${entry.during}`)
  }
  console.log(`결과: 통과 ${passCount}개, 실패 ${failures.length}개, 콘솔 오류·예외 ${pageErrors.length}건`)
  process.exit(failures.length > 0 || pageErrors.length > 0 ? 1 : 0)
}

main()

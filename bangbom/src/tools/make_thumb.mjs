// 공개 링크 미리보기 그림(thumb.png, 1200×630) 만들기
// 사용: 저장소 맨 위에서  node bangbom/src/tools/make_thumb.mjs
// 히어로 사진(bangbom/img/hero.jpg) 위에 "따져 보고, 살아 보고, 고르는 집" + "방봄 BANGBOM" 을 얹어 헤드리스 Edge 로 찍는다.
// 결과는 public/thumb.png (vite 가 dist 루트로 복사한다). 1MB 를 넘으면 사진 쪽을 조금 더 어둡고 흐리게 해서 다시 찍는다.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p))
if (!EDGE) { console.error('Edge 를 찾지 못했어요'); process.exit(1) }
const img = pathToFileURL(path.join(ROOT, 'bangbom/img/hero.jpg')).href
const font = (w) => pathToFileURL(path.join(ROOT, `bangbom/fonts/Pretendard-${w}.woff2`)).href
const OUT = path.join(ROOT, 'public/thumb.png')

const page = (blur) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@font-face{font-family:P;src:url(${font('SemiBold')}) format('woff2');font-weight:600}
@font-face{font-family:P;src:url(${font('Regular')}) format('woff2');font-weight:400}
html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#1d211d}
.bg{position:absolute;inset:0;background:url(${img}) center/cover;filter:blur(${blur}px) saturate(.9);transform:scale(1.04)}
.shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(20,23,20,.78) 0%,rgba(20,23,20,.45) 55%,rgba(20,23,20,.15) 100%)}
.t{position:absolute;left:80px;bottom:96px;color:#fff;font-family:P,sans-serif}
.t h1{margin:0;font-size:68px;line-height:1.18;font-weight:600;letter-spacing:-.045em}
.t h1 span{display:block;font-weight:400}
.t p{margin:28px 0 0;font-size:28px;font-weight:600;letter-spacing:.02em;color:#e2efe7}
.t p b{display:inline-block;width:10px;height:10px;border-radius:50%;background:#7ED6A8;margin-right:12px;vertical-align:4px}
</style></head><body><div class="bg"></div><div class="shade"></div>
<div class="t"><h1>따져 보고, 살아 보고,<span>고르는 집</span></h1><p><b></b>방봄 BANGBOM</p></div></body></html>`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-'))
const port = 9700 + Math.floor(Math.random() * 200)
const ed = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--allow-file-access-from-files', 'about:blank'])
let list
for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((t) => t.type === 'page')) break } catch {} await sleep(200) }
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r })
let id = 0; const pend = {}
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id] } }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })) })
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false })
let size = 0
for (const blur of [0, 2, 4, 8]) {
  const f = path.join(dir, 'thumb.html'); fs.writeFileSync(f, page(blur))
  await send('Page.navigate', { url: pathToFileURL(f).href }); await sleep(1500)
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } })
  const buf = Buffer.from(s.result.data, 'base64'); size = buf.length
  if (size <= 1024 * 1024) { fs.writeFileSync(OUT, buf); console.log(`public/thumb.png ${Math.round(size / 1024)}KB (흐림 ${blur}px)`); break }
}
ed.kill()
if (size > 1024 * 1024) { console.error('1MB 아래로 만들지 못했어요'); process.exit(1) }

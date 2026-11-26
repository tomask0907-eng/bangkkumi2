// @ts-nocheck  (브라우저 검사용 짧은 스크립트라 타입 검사에서 뺀다)
// 집찾기 대화(vendor/bangbom-chat) 검사: 홈 입력 → 조건 확인 → 후보 → [지도 보기]·[평면도 보기]가 그 단지를 여는지, 상담 단추가 같은 대화를 여는지.
// 쓰는 법: node scripts/e2e-chat.mjs http://localhost:5180
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

const BASE = process.argv[2] || 'http://localhost:5180'
const D = process.env.SHOTS || require('node:os').tmpdir()
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const port = 9412, prof = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-'))
const child = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws = ''
for (let i = 0; i < 60 && !ws; i++) { try { ws = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl } catch { await sleep(250) } }
const sock = new WebSocket(ws); await new Promise((r) => sock.addEventListener('open', r))
let id = 0; const wait = new Map(); const errors = []; const posts = []
sock.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m.result ?? m.error); wait.delete(m.id) } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); if (m.method === 'Network.requestWillBeSent' && m.params.request.method === 'POST') posts.push(m.params.request.url) })
const send = (method, params = {}, sessionId) => new Promise((r) => { id++; wait.set(id, r); sock.send(JSON.stringify({ id, method, params, sessionId })) })
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Runtime.enable', {}, s); await send('Page.enable', {}, s); await send('Network.enable', {}, s)
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, s); return r.result?.value }
const H = `(() => { const hosts = [...document.querySelectorAll('*')].filter(e => e.shadowRoot && e.shadowRoot.textContent.includes('방봄')); return hosts.length })()`
const root = `([...document.querySelectorAll('*')].find(e => e.shadowRoot && e.shadowRoot.textContent.includes('방봄')).shadowRoot)`
const text = () => ev(`[...${root}.querySelectorAll('.msg,[class*=bubble],article,li,p')].map(e=>e.textContent.trim()).filter(Boolean).slice(-6).join(' | ').slice(-420)`)
const textOld = () => ev(`${root}.textContent.replace(/\\s+/g,' ').slice(-700)`)
const click = (label, first) => ev(`(() => { const b = [...${root}.querySelectorAll('button')].filter(b => b.textContent.trim().startsWith(${JSON.stringify(label)}) && b.offsetParent !== null)[${first ? "'shift'" : "'pop'"}](); if (!b) return false; b.click(); return true })()`)
const say = async (t) => { await ev(`(() => { const i = ${root}.querySelector('textarea,input[type=text],input:not([type])'); i.value = ${JSON.stringify(t)}; i.dispatchEvent(new Event('input',{bubbles:true})); const f = i.closest('form'); if (f) f.requestSubmit(); })()`); await sleep(700) }
const out = []
for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }, s)
  await send('Page.navigate', { url: 'about:blank' }, s); await sleep(300); await send('Page.navigate', { url: BASE + '/?tutorial=0#home' }, s); await sleep(2500)
  out.push(`[${w}] 홈 입력 있음=${await ev(`!!document.querySelector('#homeAsk')`)}, 위젯 수=${await ev(H)}, 예전 상담 서랍 열림=${await ev(`document.querySelector('#drawer')?.classList.contains('is-open')`)}`)
  await ev(`(() => { const i = document.querySelector('#homeAskIn'); i.value = '달서구, 전세 2억 5천 이하'; document.querySelector('#homeAsk').requestSubmit() })()`); await sleep(1200)
  out.push(`  첫 문장 뒤: ${await text()}`)
  await click('이대로 반영'); await sleep(800); await click('지금 후보 보기'); await sleep(900)
  out.push(`  반영 뒤: ${await text()}`)
  fs.writeFileSync(`${D}/chat-${w}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, s)).data, 'base64'))
  out.push(`  공개 미분양 참고(매매, 전세 후보와 따로)=${(await text()).includes('매매 · 전세 아님')}`)
  const okMap = await click('지도 보기', true); await sleep(2500)
  out.push(`  [지도 보기] 누름=${okMap} → hash=${await ev('location.hash')}, 카드 열림=${await ev(`document.querySelector('#panelR')?.classList.contains('is-open')`)}, 카드 이름=${await ev(`document.querySelector('#panelR h2')?.textContent`)}`)
  await ev(`document.querySelector('#fab')?.click()`); await sleep(800)
  out.push(`  [24시간 상담] → 위젯 수=${await ev(H)}, 같은 대화 이어짐=${await ev(`${root}.textContent.includes('상인푸르지오')`)}, 예전 서랍 열림=${await ev(`document.querySelector('#drawer')?.classList.contains('is-open')`)}`)
  const okPlan = await click('평면도 보기'); await sleep(2500)
  out.push(`  [평면도 보기] 누름=${okPlan} → hash=${await ev('location.hash')}, 집 보기 제목=${await ev(`document.querySelector('#hvTitle .hv-name')?.textContent`)}`)
  await say('수성구, 2억 이하, 84㎡ 이상'); await sleep(500)
  await ev(`document.querySelector('#hvConsult')?.click()`); await sleep(800)
  out.push(`  집 보기의 [상담] → 위젯 수=${await ev(H)}, 대화=${(await text()).slice(-260)}`)
}
out.push('POST 요청: ' + JSON.stringify(posts))
out.push('오류: ' + JSON.stringify(errors))
console.log(out.join('\n'))
const bad = out.filter((l) => /참고(매매, 전세 후보와 따로)=false|누름=false|카드 열림=false|같은 대화 이어짐=false|위젯 수=(0|[2-9])|예전 서랍 열림=true|오류: \["(?!InvalidStateError: Transition)/.test(l))
console.log(bad.length ? `결과: 실패 ${bad.length}줄` : '결과: 모두 통과')
process.exitCode = bad.length ? 1 : 0
child.kill(); await sleep(400); fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5 }); process.exit(process.exitCode)

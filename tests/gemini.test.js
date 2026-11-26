// AI 렌더링(Gemini) 테스트. 네트워크를 쓰지 않는다: fetch 를 가짜로 끼운다.
import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'

import renderPhotoHandler from '../api/render-photo.js'
import { pickImage, renderPrompt, setGeminiFetch } from '../server/gemini.js'
import { resetAiRateLimit } from '../server/ai.js'
import { NOTICES } from '../src/data/labels.js'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const FAKE_KEY = 'gemini-test-0000-절대-나가면-안-되는-값'
const JPEG_B64 = '/9j/' + 'A'.repeat(400)
const BODY = { snapshotBase64: PNG, styleName: '웜 미니멀', timeOfDay: 'evening' }

/** @param {object} body */
const send = (body) => renderPhotoHandler.fetch(new Request('http://test.local/api/render-photo', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.' + Math.random() }, body: JSON.stringify(body) }))

afterEach(() => { delete process.env.GEMINI_API_KEY; setGeminiFetch(null); resetAiRateLimit() })

test('열쇠가 있고 Gemini 가 그림을 주면 AI 연출 사진과 정해진 고지 문구를 돌려줘요', async () => {
  process.env.GEMINI_API_KEY = FAKE_KEY
  /** @type {{ url: string, init: RequestInit }[]} */
  const calls = []
  setGeminiFetch(async (url, init) => { calls.push({ url, init }); return Response.json({ steps: [{ type: 'model_output', content: [{ type: 'text', text: '완료' }, { type: 'image', mime_type: 'image/jpeg', data: JPEG_B64 }] }] }) })
  const res = await send(BODY)
  const data = /** @type {any} */ (await res.json())
  assert.equal(data.isFallback, false)
  assert.equal(data.imageUrlOrBase64, 'data:image/jpeg;base64,' + JPEG_B64)
  assert.equal(data.disclaimer, NOTICES.aiImageDisclaimer)
  assert.equal(calls.length, 1)
  // 열쇠는 머리말로만 가고 본문·답에는 없다
  assert.equal(/** @type {Record<string, string>} */ (calls[0].init.headers)['x-goog-api-key'], FAKE_KEY)
  assert.ok(!String(calls[0].init.body).includes(FAKE_KEY))
  assert.ok(!JSON.stringify(data).includes(FAKE_KEY))
  const sent = JSON.parse(String(calls[0].init.body))
  assert.equal(sent.input[1].type, 'image')
  assert.equal(sent.input[1].mime_type, 'image/png')
  assert.match(sent.input[0].text, /해 질 녘/)
})

test('Gemini 가 실패하거나 그림이 없으면 받은 그림 그대로(AI 연출 아님) 돌려줘요', async () => {
  process.env.GEMINI_API_KEY = FAKE_KEY
  for (const fake of [
    async () => new Response('busy', { status: 503 }),
    async () => Response.json({ steps: [{ content: [{ type: 'text', text: '못 했어요' }] }] }),
    async () => { throw new TypeError('fetch failed') },
  ]) {
    setGeminiFetch(fake)
    const data = /** @type {any} */ (await (await send(BODY)).json())
    assert.equal(data.isFallback, true)
    assert.equal(data.imageUrlOrBase64, PNG)
    assert.match(data.disclaimer, /AI 연출 아님/)
  }
})

test('첫 모델이 한도(429)면 다음 모델로 다시 해 봐요', async () => {
  process.env.GEMINI_API_KEY = FAKE_KEY
  /** @type {string[]} */
  const models = []
  setGeminiFetch(async (_url, init) => {
    models.push(JSON.parse(String(init.body)).model)
    return models.length === 1 ? Response.json({ error: { message: 'limit: 0' } }, { status: 429 }) : Response.json({ output_image: { data: JPEG_B64, mime_type: 'image/jpeg' } })
  })
  const data = /** @type {any} */ (await (await send(BODY)).json())
  assert.equal(data.isFallback, false)
  assert.equal(models.length, 2)
  assert.notEqual(models[0], models[1])
})

test('열쇠가 없으면 Gemini 를 부르지 않아요', async () => {
  let called = 0
  setGeminiFetch(async () => { called += 1; return Response.json({}) })
  const data = /** @type {any} */ (await (await send(BODY)).json())
  assert.equal(data.isFallback, true)
  assert.equal(called, 0)
})

test('pickImage: 이상한 형식·글자는 버리고, 프롬프트는 배치를 바꾸지 말라고 해요', () => {
  assert.equal(pickImage({ steps: [{ content: [{ type: 'image', mime_type: 'image/svg+xml', data: JPEG_B64 }] }] }), null)
  assert.equal(pickImage({ steps: [{ content: [{ type: 'image', mime_type: 'image/png', data: '<script>' + 'A'.repeat(200) }] }] }), null)
  assert.deepEqual(pickImage({ output_image: { data: JPEG_B64, mime_type: 'image/jpeg' } }), { data: JPEG_B64, mime: 'image/jpeg' })
  const p = renderPrompt('<b>모던</b>', 'noon')
  assert.match(p, /옮기지 마세요/)
  assert.ok(!p.includes('<'))
})

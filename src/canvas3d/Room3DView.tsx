// 3D 보기. Stage에서 React.lazy로만 불러온다(three.js는 이 폴더 안에서만 가져온다).
// 장면을 만드는 일은 sceneEngine.ts가 하고, 여기서는 상태를 전달하고 버튼을 그린다.
//
// 보는 방식은 세 가지다: 둘러보기(밖에서 보기) / 어른 눈높이 / 아이 눈높이(방 안에 서서 보기).
// 눈높이 보기에서는 끌어서 둘러보고 바닥을 누르면 그 자리로 걸어간다. 지금 상태는 바깥 요소의 data-eye-* 속성에 남는다.

import { useEffect, useRef, useState } from 'react'
import { EYE_MODE_LABELS, NOTICES } from '../data/labels.js'
import { eyeHeightCm } from '../engine/eyeLevel.js'
import { actions, useActiveRoom, useAppState } from '../state/store.ts'
import type { EyeMode } from '../state/store.ts'
import { createSceneEngine } from './sceneEngine.ts'
import { requestRenderPhoto } from '../lib/api.ts'
import type { RenderPhotoResponse } from '../types/schema.ts'
import type { EyeInfo, Quality, SceneEngine, ViewPreset } from './sceneEngine.ts'

type Problem = 'none' | 'unsupported' | 'lost'

const SAVE_FILE_NAME = '방봄_3D.png'

const QUALITY_OPTIONS: { key: Quality; label: string }[] = [
  { key: 'high', label: '높음' },
  { key: 'medium', label: '보통' },
  { key: 'low', label: '낮음' },
]

const VIEW_OPTIONS: { key: ViewPreset; label: string; title: string }[] = [
  { key: 'bird', label: '조감', title: '비스듬히 내려다봐요' },
  { key: 'top', label: '위에서', title: '바로 위에서 내려다봐요' },
]

const EYE_OPTIONS: { key: EyeMode; title: string }[] = [
  { key: 'off', title: '밖에서 방 전체를 둘러봐요' },
  { key: 'adult', title: `방 안에 서서 어른 눈높이 ${eyeHeightCm('adult')}cm로 봐요` },
  { key: 'child', title: `방 안에 서서 아이 눈높이 ${eyeHeightCm('child')}cm로 봐요` },
]

const EYE_HINT = '끌어서 둘러보고, 바닥을 누르면 그 자리로 가요.'

/** 좁은 화면(휴대폰·태블릿)은 발열을 줄이려고 보통 화질로 시작한다 */
function defaultQuality(): Quality {
  return typeof window !== 'undefined' && window.innerWidth >= 1024 ? 'high' : 'medium'
}

export default function Room3DView() {
  const room = useActiveRoom()
  const selectedId = useAppState((state) => state.selectedId)
  const eyeMode = useAppState((state) => state.eyeMode)
  const rootRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<SceneEngine | null>(null)
  /** 눈높이 보기에 들어왔을 때의 자리와 방향. 여기서 달라지면 한 번은 움직여 본 것이다 */
  const eyeStart = useRef<{ mode: EyeMode; pose: string }>({ mode: 'off', pose: '' })
  const [quality, setQuality] = useState<Quality>(defaultQuality)
  const [problem, setProblem] = useState<Problem>('none')
  const [notice, setNotice] = useState('')
  const [markerCount, setMarkerCount] = useState(0)
  const [eyeMoved, setEyeMoved] = useState(false)
  /** AI 렌더링: 만드는 중이면 true, 받은 사진이 있으면 창으로 보여 준다 */
  const [rendering, setRendering] = useState(false)
  const [rendered, setRendered] = useState<RenderPhotoResponse | null>(null)

  // 장면 만들기와 정리. 개발 모드(StrictMode)에서 두 번 실행돼도 앞의 것은 깨끗이 지워진다.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onEyeChange = (info: EyeInfo): void => {
      // 검사하기 쉽게 지금 상태를 바깥 요소에 남긴다 (자리는 cm, 방향은 도)
      const root = rootRef.current
      if (root) {
        root.dataset.eyeMode = info.mode
        root.dataset.eyeX = info.xCm === null ? '' : String(info.xCm)
        root.dataset.eyeY = info.yCm === null ? '' : String(info.yCm)
        root.dataset.eyeYaw = info.yawDeg === null ? '' : String(info.yawDeg)
        root.dataset.eyeMarkers = String(info.markers)
      }
      setMarkerCount(info.markers)
      // 조작 안내는 한 번 끌거나 걸어 보면 접는다
      const pose = `${info.xCm}|${info.yCm}|${info.yawDeg}`
      const start = eyeStart.current
      if (info.mode !== 'off' && start.mode === 'off') {
        start.pose = pose
        setEyeMoved(false)
      } else if (info.mode !== 'off' && pose !== start.pose) {
        setEyeMoved(true)
      }
      start.mode = info.mode
    }
    let engine: SceneEngine
    try {
      engine = createSceneEngine(host, {
        quality: defaultQuality(),
        onContextLost: (lost) => setProblem(lost ? 'lost' : 'none'),
        onEyeChange,
      })
    } catch {
      setProblem('unsupported')
      return
    }
    engineRef.current = engine
    return () => {
      engineRef.current = null
      eyeStart.current = { mode: 'off', pose: '' }
      engine.dispose()
    }
  }, [])

  // 아래 효과들은 장면을 다시 만들지 않고 바뀐 것만 전달한다 (위의 효과보다 뒤에 실행된다)
  useEffect(() => {
    engineRef.current?.setRoom(room)
  }, [room])

  useEffect(() => {
    engineRef.current?.setSelected(selectedId)
  }, [selectedId])

  useEffect(() => {
    engineRef.current?.setQuality(quality)
  }, [quality])

  // 방을 넘긴 뒤에 보는 방식을 넘긴다 (서는 자리는 방이 있어야 정해진다)
  useEffect(() => {
    engineRef.current?.setEyeMode(eyeMode)
  }, [eyeMode])

  // 저장 안내는 잠깐만 보여 준다
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2600)
    return () => window.clearTimeout(timer)
  }, [notice])

  const handleSave = () => {
    const ok = engineRef.current?.savePng(SAVE_FILE_NAME) ?? false
    setNotice(ok ? '그림을 저장했어요.' : '그림을 저장하지 못했어요. 다시 눌러 주세요.')
  }

  /* 지금 화면을 찍어 서버로 보낸다. 서버가 AI를 못 쓰면 받은 그림 그대로(AI 연출 아님)가 온다 */
  const handleRender = async () => {
    const shot = engineRef.current?.snapshot() ?? ''
    if (!shot) { setNotice('화면을 찍지 못했어요. 다시 눌러 주세요.'); return }
    setRendering(true)
    try {
      setRendered(await requestRenderPhoto({ snapshotBase64: shot, styleName: room.style?.name ?? '', timeOfDay: 'noon' }))
    } finally {
      setRendering(false)
    }
  }
  const saveRendered = () => {
    if (!rendered) return
    const link = document.createElement('a')
    link.href = rendered.imageUrlOrBase64
    link.download = rendered.isFallback ? '방봄_3D.jpg' : '방봄_AI렌더링.jpg'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  const ready = problem === 'none'
  const eyeOn = eyeMode !== 'off'
  const eyeCm = eyeHeightCm(eyeMode)
  const showHint = ready && eyeOn && !eyeMoved

  return (
    <div ref={rootRef} data-eye-mode={eyeMode} className="@container relative h-full min-h-0 w-full overflow-hidden bg-paper">
      <div ref={hostRef} className="absolute inset-0" />

      {problem === 'unsupported' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center" role="alert">
          <p className="text-sm font-medium text-ink">이 기기에서는 3D 보기를 열 수 없어요.</p>
          <p className="hint max-w-xs">2D 평면도에서는 배치와 비용을 그대로 쓸 수 있어요.</p>
        </div>
      )}

      {problem === 'lost' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-paper p-6 text-center" role="alert">
          <p className="text-sm font-medium text-ink">3D 화면이 잠시 멈췄어요.</p>
          <p className="hint max-w-xs">2D로 갔다가 다시 3D를 누르면 돌아와요.</p>
        </div>
      )}

      {ready && (
        <>
          {/* 3D 화면이 좁으면(휴대폰, 폭 528px 미만) 보는 방식이 맨 위 한 줄이고 그 아래에 방향 버튼이나 안내가 온다.
              넓으면(PC) 왼쪽 위는 예전 그대로이고 보는 방식은 오른쪽 위에 있다. 화면 폭이 아니라 3D 화면 폭으로 나눈다 */}
          <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col items-start gap-2 @[33rem]:flex-row @[33rem]:justify-between">
            {eyeOn ? (
              <div className="card max-w-full px-3 py-2 text-sm @[33rem]:max-w-[15rem] @[44rem]:max-w-[21rem]">
                {/* 화면을 덜 가리게 두 줄로 줄였다: 빨간 점 설명 한 줄 + 참고값 고지와 눈높이 한 줄 */}
                {eyeMode === 'child' && (
                  <p className="mb-0.5 flex items-start gap-1.5 text-ink">
                    <span aria-hidden="true" className="mt-1 size-3 shrink-0 rounded-full border-2 border-white bg-danger ring-1 ring-line-strong" />
                    <span>{NOTICES.eyeCorners}</span>
                  </p>
                )}
                {eyeMode === 'child' && markerCount === 0 && <p className="mb-0.5 text-ink">이 방에는 표시할 모서리가 없어요.</p>}
                <p className="flex flex-wrap items-center justify-between gap-x-4">
                  {eyeMode === 'child' && <span className="text-muted">{NOTICES.reference}</span>}
                  <span className="flex items-center gap-1.5 font-semibold whitespace-nowrap text-ink">
                    {/* 방봄의 치수선 표시: 얇은 선 양 끝에 짧은 꺾쇠 */}
                    <svg width="10" height="16" viewBox="0 0 10 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
                      <path d="M5 2v12M2 2h6M2 14h6" />
                    </svg>
                    눈높이 {eyeCm}cm
                  </span>
                </p>
              </div>
            ) : (
              <div role="group" aria-label="보는 방향" className="pointer-events-auto flex gap-1.5">
                {VIEW_OPTIONS.map((view) => (
                  <button
                    key={view.key}
                    type="button"
                    className="btn"
                    title={view.title}
                    onClick={() => engineRef.current?.setView(view.key)}
                  >
                    {view.label}
                  </button>
                ))}
              </div>
            )}

            <div
              role="group"
              aria-label="보는 방식"
              className="card pointer-events-auto order-first grid w-full grid-cols-3 gap-0.5 p-0.5 @[33rem]:order-none @[33rem]:flex @[33rem]:w-auto"
            >
              {EYE_OPTIONS.map((option) => {
                const active = eyeMode === option.key
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={active}
                    title={option.title}
                    onClick={() => actions.setEyeMode(option.key)}
                    className={`btn min-w-0 px-1 @[33rem]:px-3 ${active ? 'border-ink bg-ink text-white hover:bg-ink' : 'btn-quiet text-muted'}`}
                  >
                    {EYE_MODE_LABELS[option.key]}
                  </button>
                )
              })}
            </div>
          </div>

          <p
            role="status"
            className={
              showHint
                ? 'pointer-events-none absolute inset-x-3 bottom-[4.75rem] mx-auto w-fit rounded-2xl bg-ink px-4 py-2 text-center text-sm font-medium text-white'
                : 'sr-only'
            }
          >
            {showHint ? EYE_HINT : ''}
          </p>

          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
            <div
              role="group"
              aria-label="화질"
              className="card pointer-events-auto flex items-center gap-0.5 p-0.5"
            >
              <span className="px-2 text-[13px] font-medium text-muted max-lg:text-sm">화질</span>
              {QUALITY_OPTIONS.map((option) => {
                const active = quality === option.key
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setQuality(option.key)}
                    className={`btn max-lg:min-w-11 max-lg:px-2.5 ${active ? 'border-ink bg-ink text-white hover:bg-ink' : 'btn-quiet text-muted'}`}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>

            <div className="pointer-events-auto flex items-center gap-2">
              <span role="status" aria-live="polite" className={notice ? 'chip chip-accent max-lg:text-sm' : 'sr-only'}>
                {notice}
              </span>
              <button type="button" className="btn btn-primary" onClick={handleSave} title="지금 보이는 모습을 큰 그림(2400×1500)으로 저장해요">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 2.5v7.5M5 7.5l3 3 3-3M3 13.5h10" />
                </svg>
                고화질 저장
              </button>
              <button type="button" className="btn" onClick={handleRender} disabled={rendering} aria-busy={rendering} title="지금 보이는 배치를 AI가 실사 느낌 사진으로 만들어요 (20~40초)">
                {rendering ? '만드는 중…' : 'AI 렌더링'}
              </button>
            </div>
          </div>
        </>
      )}
      {rendered && (
        <div role="dialog" aria-modal="true" aria-label="AI 렌더링 결과" className="absolute inset-0 z-30 flex items-center justify-center bg-ink/55 p-4" onClick={(e) => { if (e.target === e.currentTarget) setRendered(null) }}>
          <div className="w-full max-w-3xl overflow-hidden rounded-[24px] bg-surface shadow-2xl">
            <div className="relative bg-sunken">
              <img src={rendered.imageUrlOrBase64} alt="지금 배치를 실사 느낌으로 그린 사진" className="block max-h-[65vh] w-full object-contain" />
              <span className="chip absolute bottom-3 left-3 bg-surface/95">{rendered.isFallback ? rendered.disclaimer : NOTICES.aiImageBadge}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 p-4">
              <p className="text-sm text-muted">{rendered.isFallback ? 'AI 렌더링을 지금 쓸 수 없어서 3D 화면을 그대로 보여 드려요.' : rendered.disclaimer}</p>
              <div className="flex gap-2">
                <button type="button" className="btn btn-quiet" onClick={saveRendered}>사진 저장</button>
                <button type="button" className="btn btn-primary" onClick={() => setRendered(null)} autoFocus>닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

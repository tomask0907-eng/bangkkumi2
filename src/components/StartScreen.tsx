// 시작 화면: 방 크기를 넣고 시작하는 길 하나와 방봄으로 돌아가는 링크. 예시 방은 주소 ?example=1 로만 연다(자동 검사·옛 링크용).
import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { actions } from '../state/store.ts'

const MIN_CM = 150
const MAX_CM = 1500

function parseCm(text: string): number | null {
  const value = Number(text.trim())
  if (text.trim() === '' || !Number.isFinite(value)) return null
  const rounded = Math.round(value)
  return rounded >= MIN_CM && rounded <= MAX_CM ? rounded : null
}

function BrandMark() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-accent"
    >
      <path d="M13 27H6V5h20v22h-6" />
      <path d="M20 27v-7" />
      <path d="M20 20a7 7 0 0 0-7 7" strokeWidth="1.25" />
      <path d="M6 14h9" />
    </svg>
  )
}

export default function StartScreen() {
  const widthId = useId()
  const depthId = useId()
  const errorId = useId()
  const [width, setWidth] = useState('300')
  const [depth, setDepth] = useState('400')
  const [error, setError] = useState('')

  function start(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const widthCm = parseCm(width)
    const depthCm = parseCm(depth)
    if (widthCm === null || depthCm === null) {
      setError(`가로와 세로는 ${MIN_CM}~${MAX_CM}cm 사이 숫자로 넣어 주세요.`)
      return
    }
    actions.startEmpty({ widthCm, depthCm })
  }

  return (
    <main className="flex min-h-full items-center justify-center px-5 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <div className="w-full max-w-3xl">
        <header className="mb-6 lg:mb-10">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <span className="text-xl font-bold tracking-tight text-ink">방봄 <span className="en text-muted">Bangbom</span></span>
          </div>
          <span className="eyebrow mt-8 lg:mt-12">Your room</span>
          <h1 className="text-[32px] leading-[1.2] font-bold tracking-[-0.05em] text-ink lg:text-[44px]">방 크기만 넣으면,<br />바로 꾸며 볼 수 있어요</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted lg:text-base">
            가구를 놓고 2D·3D로 보면서, 문제와 개선 제안을 바로 확인해요.
          </p>
        </header>

        <div className="mx-auto grid max-w-md gap-3">
          <form className="card p-5 lg:p-6" onSubmit={start} noValidate>
            <h2 className="panel-title">방 크기 설정</h2>
            <p className="hint mt-1">벽 안쪽 길이를 cm로 넣어요. 나중에 언제든 바꿀 수 있어요.</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor={widthId}>
                  가로 (cm)
                </label>
                <input
                  id={widthId}
                  className="input h-11 text-base"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  value={width}
                  aria-invalid={error !== '' && parseCm(width) === null}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(event) => {
                    setWidth(event.target.value)
                    setError('')
                  }}
                />
              </div>
              <div>
                <label className="label" htmlFor={depthId}>
                  세로 (cm)
                </label>
                <input
                  id={depthId}
                  className="input h-11 text-base"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  value={depth}
                  aria-invalid={error !== '' && parseCm(depth) === null}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(event) => {
                    setDepth(event.target.value)
                    setError('')
                  }}
                />
              </div>
            </div>
            {error && (
              <p id={errorId} role="alert" className="mt-2 text-[13px] text-danger">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-primary btn-lg mt-4 w-full">
              이 크기로 시작
            </button>
          </form>

          <a href="./" className="btn btn-lg w-full">방봄에서 집 고르기</a>
        </div>
      </div>
    </main>
  )
}

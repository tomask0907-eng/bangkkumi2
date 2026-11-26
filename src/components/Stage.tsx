// 가운데 무대: [2D]/[3D] 전환. 3D는 따로 내려받는다(지연 로딩).
// 인터넷이 끊겨도 3D가 열리도록 앱이 켜진 조금 뒤에 미리 받아 두고, 실패하면 다시 받아 올 수 있게 한다.
// 휴대폰 틀에서는 이 도구 줄이 화면의 하나뿐인 위 막대다: [2D|3D] + 방 이름 + [실행취소] [다시실행] [더보기].
import { Suspense, lazy, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import FloorPlanEditor from '../canvas2d/FloorPlanEditor.tsx'
import { EMBEDDED } from '../lib/embed.ts'
import { actions, useActiveRoom, useAppState } from '../state/store.ts'
import type { ViewMode } from '../state/store.ts'
import ErrorBoundary from './ErrorBoundary.tsx'
import { MobileTools } from './Header.tsx'
import { useInSheet } from './sheetContext.ts'

const load3D = () => import('../canvas3d/Room3DView.tsx')

// React.lazy는 한 번 실패하면 계속 실패한 채로 남으므로, 실패했을 때 새로 만들어 다시 받아 오게 한다
let Room3DView = lazy(load3D)
function renew3D(): void {
  Room3DView = lazy(load3D)
}

/** 3D 묶음을 미리 받아 두는 시간(ms). 첫 화면을 그린 뒤에 조용히 받는다 */
const PRELOAD_DELAY_MS = 1200

const VIEW_MODES: { key: ViewMode; label: string; title: string }[] = [
  { key: '2d', label: '2D', title: '평면도로 보기' },
  { key: '3d', label: '3D', title: '입체로 보기' },
]

function CenterNote({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">{children}</div>
}

/** 휴대폰 틀의 위 막대. 단독으로 열면 이름(방봄)이 있는 머리줄이고, 방봄 "집 보기" 안에서는 방 이름만 적은 도구 줄이다 */
function MobileBar({ viewMode, roomName }: { viewMode: ViewMode; roomName: string }) {
  const Bar = EMBEDDED ? 'div' : 'header'
  return (
    <Bar className="relative z-30 shrink-0 border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
      <div className="flex h-12 items-center gap-2 max-[320px]:gap-0.5 pr-[max(0.25rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))]">
        {EMBEDDED ? null : <h1 className="shrink-0 text-[17px] font-semibold tracking-tight text-ink">방봄</h1>}
        <div role="group" aria-label="보기 방식" className="inline-flex h-10 shrink-0 items-center rounded-lg bg-sunken px-0.5">
          {VIEW_MODES.map((mode) => {
            const active = viewMode === mode.key
            return (
              // 보이는 단추는 36px, 손가락이 닿는 자리는 44px
              <button
                key={mode.key}
                type="button"
                aria-pressed={active}
                onClick={() => actions.setViewMode(mode.key)}
                className="flex h-11 min-w-12 cursor-pointer items-center rounded-md max-[320px]:min-w-11"
              >
                <span
                  className={`flex h-9 w-full items-center justify-center rounded-md border px-3 text-[15px] font-medium transition-colors ${
                    active ? 'border-line bg-surface text-accent' : 'border-transparent text-muted'
                  }`}
                >
                  {mode.label}
                </span>
              </button>
            )
          })}
        </div>
        <p className={`min-w-0 flex-1 truncate text-sm text-muted ${EMBEDDED ? '' : 'max-sm:invisible'}`}>{roomName}</p>
        <MobileTools />
      </div>
    </Bar>
  )
}

export default function Stage() {
  const viewMode = useAppState((state) => state.viewMode)
  const room = useActiveRoom()
  const inSheet = useInSheet()
  // 3D를 다시 받아 올 때 화면을 새로 그리게 하는 값
  const [, setAttempt] = useState(0)

  useEffect(() => {
    // 온라인일 때 미리 받아 두면 그 뒤에 인터넷이 끊겨도 3D가 열린다. 실패해도 조용히 넘긴다
    const preload = (): void => {
      load3D().catch(() => {})
    }
    const timer = window.setTimeout(preload, PRELOAD_DELAY_MS)
    // 인터넷이 다시 연결되면 한 번 더 받아 본다
    window.addEventListener('online', preload)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('online', preload)
    }
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      {inSheet ? (
        <MobileBar viewMode={viewMode} roomName={room.name} />
      ) : (
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-3">
          <div role="group" aria-label="보기 방식" className="inline-flex rounded-lg bg-sunken p-0.5">
            {VIEW_MODES.map((mode) => {
              const active = viewMode === mode.key
              return (
                <button
                  key={mode.key}
                  type="button"
                  title={mode.title}
                  aria-pressed={active}
                  onClick={() => actions.setViewMode(mode.key)}
                  className={`h-9 min-w-14 cursor-pointer rounded-md px-3 text-sm font-medium transition-colors ${
                    active ? 'border border-line bg-surface text-accent' : 'border border-transparent text-muted hover:text-ink'
                  }`}
                >
                  {mode.label}
                </button>
              )
            })}
          </div>
          <p className="hint min-w-0 truncate">
            {room.name} · {room.widthCm} × {room.depthCm} cm
          </p>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          {viewMode === '2d' ? (
            <ErrorBoundary
              resetKey="2d"
              fallback={(retry) => (
                <CenterNote>
                  <p className="text-sm text-ink" role="alert">
                    평면도를 그리지 못했어요.
                  </p>
                  <button type="button" className="btn" onClick={retry}>
                    다시 시도
                  </button>
                </CenterNote>
              )}
            >
              <FloorPlanEditor />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary
              resetKey="3d"
              onError={renew3D}
              fallback={(retry) => (
                <CenterNote>
                  <p className="text-sm text-ink" role="alert">
                    3D 화면을 열지 못했어요.
                  </p>
                  <p className="hint max-w-xs">
                    인터넷 연결이 끊겼거나 이 기기에서 3D 그래픽을 쓸 수 없을 때 생겨요. 2D에서는 그대로 계속할 수 있어요.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        renew3D()
                        setAttempt((value) => value + 1)
                        retry()
                      }}
                    >
                      다시 시도
                    </button>
                    <button type="button" className="btn" onClick={() => actions.setViewMode('2d')}>
                      2D로 돌아가기
                    </button>
                  </div>
                </CenterNote>
              )}
            >
              <Suspense
                fallback={
                  <CenterNote>
                    <p className="hint" role="status">
                      3D 화면을 준비하고 있어요.
                    </p>
                  </CenterNote>
                }
              >
                <Room3DView />
              </Suspense>
            </ErrorBoundary>
          )}
        </div>
      </div>
    </div>
  )
}

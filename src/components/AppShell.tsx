// 반응형 틀. PC(1024px 이상): 헤더 + 왼쪽 레일 + 패널 하나 + 가운데 무대 + 오른쪽 배치안·피드백.
// 휴대폰: 위 막대 하나(무대 도구 줄) + 평면도·3D(화면 높이의 46%) + 아래 시트(메뉴 내용) + 맨 아래 탭 바 하나.
// 시트는 세 가지 크기다: 가장 작게(머리줄만) / 기본 / 크게. 눈높이 보기에서는 가장 작게 접어 3D를 넓게 보여 준다.
import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ComponentType, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { EMBEDDED } from '../lib/embed.ts'
import { actions, useAppState } from '../state/store.ts'
import type { CategoryKey } from '../state/store.ts'
import { CATEGORIES, categoryLabel } from './categories.ts'
import CoachMarks from './CoachMarks.tsx'
import ErrorBoundary, { PanelFallback } from './ErrorBoundary.tsx'
import FeedbackPanel from './FeedbackPanel.tsx'
import Header from './Header.tsx'
import Icon from './Icon.tsx'
import { SheetContext } from './sheetContext.ts'
import type { SheetInfo } from './sheetContext.ts'
import Stage from './Stage.tsx'
import VariantList from './VariantList.tsx'
import CostPanel from './panels/CostPanel.tsx'
import FurniturePanel from './panels/FurniturePanel.tsx'
import LayoutPanel from './panels/LayoutPanel.tsx'
import ReportPanel from './panels/ReportPanel.tsx'
import RoomPanel from './panels/RoomPanel.tsx'
import StylePanel from './panels/StylePanel.tsx'

const PANELS: Record<CategoryKey, ComponentType> = {
  room: RoomPanel,
  style: StylePanel,
  furniture: FurniturePanel,
  layout: LayoutPanel,
  cost: CostPanel,
  report: ReportPanel,
}

const DESKTOP_QUERY = '(min-width: 1024px)'

function subscribeDesktop(onChange: () => void): () => void {
  const media = window.matchMedia(DESKTOP_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/** 화면 너비가 1024px 이상인지. 무대(2D·3D)를 한 번만 그리려고 CSS가 아니라 코드로 나눈다 */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  )
}

/** 지금 고른 카테고리의 패널 하나. 패널이 고장 나도 나머지 화면은 그대로 둔다 */
function ActivePanel({ category }: { category: CategoryKey }) {
  const Panel = PANELS[category]
  return (
    <ErrorBoundary resetKey={category} fallback={(retry) => <PanelFallback retry={retry} />}>
      <Panel />
    </ErrorBoundary>
  )
}

function DesktopShell({ category }: { category: CategoryKey }) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header />
      <div className="flex min-h-0 flex-1">
        <nav aria-label="메뉴" className="flex w-[76px] shrink-0 flex-col gap-1 border-r border-line bg-surface px-2 py-3">
          {CATEGORIES.map((entry) => {
            const active = entry.key === category
            return (
              <button
                key={entry.key}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => actions.setCategory(entry.key)}
                className={`flex h-[60px] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg text-[12px] font-medium transition-colors ${
                  active ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:bg-sunken hover:text-ink'
                }`}
              >
                <Icon name={entry.icon} size={22} />
                {entry.label}
              </button>
            )
          })}
        </nav>

        <aside
          aria-label={`${categoryLabel(category)} 패널`}
          className="relative w-72 shrink-0 overflow-x-hidden overflow-y-auto border-r border-line bg-surface p-4 xl:w-80 xl:p-5"
        >
          <ActivePanel category={category} />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <CoachMarks />
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0">
              <Stage />
            </div>
          </div>
        </main>

        <aside
          aria-label="배치안과 피드백"
          className="relative w-[300px] shrink-0 space-y-6 overflow-x-hidden overflow-y-auto border-l border-line bg-surface p-4 xl:w-[340px] xl:p-5"
        >
          <ErrorBoundary resetKey="feedback" fallback={(retry) => <PanelFallback retry={retry} />}>
            <FeedbackPanel />
          </ErrorBoundary>
          <div className="divider" />
          <ErrorBoundary resetKey="variants" fallback={(retry) => <PanelFallback retry={retry} />}>
            <VariantList />
          </ErrorBoundary>
        </aside>
      </div>
    </div>
  )
}

type SheetView = 'panel' | 'feedback'
/** 시트 크기: 가장 작게(머리줄만) / 기본 / 크게 */
type SheetSize = 'min' | 'mid' | 'max'

/** 위에서부터 차례로: 시트 위쪽이 화면 위에 가까운 순서 */
const SIZE_ORDER: SheetSize[] = ['max', 'mid', 'min']
/**
 * 시트 위쪽 위치 (무대와 시트를 담은 칸 기준).
 * - 크게: 무대 도구 줄(48px + 노치 여백) 바로 아래. 2D/3D와 실행취소는 계속 보인다
 * - 기본: 도구 줄 + 화면 높이의 46%. 평면도·3D가 화면의 45% 넘게 보인다
 * - 가장 작게: 시트 머리줄(56px)만 남긴다
 */
const SHEET_TOP: Record<SheetSize, string> = {
  max: 'calc(3rem + env(safe-area-inset-top))',
  // 낮은 화면(가로로 돌린 휴대폰, 키보드가 올라온 화면)에서도 시트 내용이 보이게 시트 높이를 14rem 넘게 남긴다. 키보드로 더 낮아지면 평면도도 6rem은 남긴다
  mid: 'min(calc(46dvh + 3rem + env(safe-area-inset-top)), max(calc(100% - 14rem), calc(9rem + env(safe-area-inset-top))))',
  min: 'calc(100% - 3.5rem)',
}
/** 이만큼(px) 넘게 끌어야 크기가 바뀐다 */
const DRAG_THRESHOLD_PX = 24
/** 이만큼(px) 움직이면 끌기로 본다 (그 전에는 누르기) */
const DRAG_SLOP_PX = 6

interface SheetDrag {
  pointerId: number
  startX: number
  startY: number
  startTop: number
  /** 시트 크기별 위쪽 위치(px). 끌기가 시작될 때 잰다 */
  tops: Record<SheetSize, number> | null
}

function MobileShell({ category }: { category: CategoryKey }) {
  const errorCount = useAppState((state) => state.validation.errors.length)
  const tipCount = useAppState((state) => state.validation.tips.length)
  const eyeMode = useAppState((state) => state.eyeMode)
  const viewMode = useAppState((state) => state.viewMode)
  // 눈높이 보기(3D 안에 서서 보기)를 켜면 시트를 가장 작게 접고, 끄면 켜기 전 크기로 되돌린다
  const eyeOn = eyeMode !== 'off' && viewMode === '3d'
  // 주소 옵션(?eye=child)으로 처음부터 눈높이 보기로 열리면 "켜짐으로 바뀜"이 없으므로 처음 크기를 접힌 것으로 잡는다
  const [size, setSize] = useState<SheetSize>(eyeOn ? 'min' : 'mid')
  const [view, setView] = useState<SheetView>('panel')
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const drag = useRef<SheetDrag | null>(null)
  const dragged = useRef(false)

  const [seenEyeOn, setSeenEyeOn] = useState(eyeOn)
  const [sizeBeforeEye, setSizeBeforeEye] = useState<SheetSize>('mid')
  if (seenEyeOn !== eyeOn) {
    setSeenEyeOn(eyeOn)
    if (eyeOn) {
      setSizeBeforeEye(size)
      setSize('min')
    } else {
      setSize(sizeBeforeEye)
    }
  }

  // 다른 곳(첫 방문 도움말 등)에서 메뉴를 바꾸면 그 메뉴의 내용을 보여 준다
  const [seenCategory, setSeenCategory] = useState(category)
  if (seenCategory !== category) {
    setSeenCategory(category)
    setView('panel')
  }

  const sheetInfo = useMemo<SheetInfo>(
    () => ({
      slot,
      resetScroll: () => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0
      },
    }),
    [slot],
  )

  /** 지금 화면에서 시트 크기별 위쪽 위치가 몇 px인지 잰다 */
  function measureTops(sheet: HTMLElement): Record<SheetSize, number> {
    const tops = { min: 0, mid: 0, max: 0 }
    for (const key of SIZE_ORDER) {
      sheet.style.top = SHEET_TOP[key]
      tops[key] = sheet.offsetTop
    }
    return tops
  }

  function onSheetPointerDown(event: ReactPointerEvent<HTMLElement>): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const sheet = sheetRef.current
    // 머리줄(손잡이·칩 줄)에서 시작한 것만 시트를 끄는 것으로 본다
    if (!sheet || !(event.target instanceof Node) || !headRef.current?.contains(event.target)) return
    dragged.current = false
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startTop: sheet.offsetTop, tops: null }
  }

  function onSheetPointerMove(event: ReactPointerEvent<HTMLElement>): void {
    const gesture = drag.current
    const sheet = sheetRef.current
    if (!gesture || !sheet || gesture.pointerId !== event.pointerId) return
    const dx = event.clientX - gesture.startX
    const dy = event.clientY - gesture.startY
    if (!gesture.tops) {
      // 가로로 미는 것은 칩 줄 넘기기다. 세로로 움직이기 시작할 때부터 시트를 끈다
      if (Math.abs(dy) < DRAG_SLOP_PX || Math.abs(dy) < Math.abs(dx)) return
      sheet.style.transition = 'none'
      gesture.tops = measureTops(sheet)
      try {
        sheet.setPointerCapture(event.pointerId)
      } catch {
        // 잡지 못해도 손가락은 처음 누른 곳이 계속 받는다
      }
    }
    const top = Math.min(gesture.tops.min, Math.max(gesture.tops.max, gesture.startTop + dy))
    sheet.style.top = `${top}px`
  }

  function endSheetDrag(event: ReactPointerEvent<HTMLElement>, apply: boolean): void {
    const gesture = drag.current
    const sheet = sheetRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    drag.current = null
    if (!gesture.tops || !sheet) return // 끌지 않고 누르기만 했다
    // 마우스로 끌면 바로 뒤에 클릭이 따라온다. 그 한 번만 넘기고, 손가락처럼 클릭이 안 오는 경우를 위해 곧 푼다
    dragged.current = true
    window.setTimeout(() => {
      dragged.current = false
    }, 80)
    const tops = gesture.tops
    const dy = event.clientY - gesture.startY
    let next = size
    if (apply && Math.abs(dy) >= DRAG_THRESHOLD_PX) {
      // 끈 방향에 있는 크기 가운데 손을 뗀 자리에서 가장 가까운 것
      const landed = gesture.startTop + dy
      const choices = SIZE_ORDER.filter((key) => (dy < 0 ? tops[key] < gesture.startTop - 1 : tops[key] > gesture.startTop + 1))
      if (choices.length > 0) {
        next = choices.reduce((best, key) => (Math.abs(tops[key] - landed) < Math.abs(tops[best] - landed) ? key : best))
      }
    }
    sheet.style.transition = ''
    sheet.style.top = SHEET_TOP[next]
    setSize(next)
  }

  function onSheetClickCapture(event: ReactMouseEvent<HTMLElement>): void {
    const inHead = event.target instanceof Node && headRef.current?.contains(event.target) === true
    // 끌고 난 바로 뒤에 따라오는 클릭은 넘긴다 (단추·칩이 대신 눌리지 않게)
    if (dragged.current) {
      dragged.current = false
      if (inHead) {
        event.preventDefault()
        event.stopPropagation()
      }
      return
    }
    // 접혀 있을 때 칩을 누르면 내용이 보이게 편다 (크게/작게 단추는 스스로 편다)
    if (inHead && !toggleRef.current?.contains(event.target as Node)) openIfClosed()
  }

  function toggleSize(): void {
    setSize((value) => (value === 'mid' ? 'max' : 'mid'))
  }

  /** 접혀 있을 때 메뉴나 칩을 누르면 내용이 보이게 편다 */
  function openIfClosed(): void {
    setSize((value) => (value === 'min' ? 'mid' : value))
  }

  const title = view === 'feedback' ? '피드백' : categoryLabel(category)
  const feedbackNote = errorCount > 0 ? `문제 ${errorCount}개` : tipCount > 0 ? `제안 ${tipCount}개` : ''

  return (
    <SheetContext.Provider value={sheetInfo}>
      <div className="flex h-dvh flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1">
          <main
            className="absolute inset-x-0 top-0"
            style={{ height: size === 'min' ? SHEET_TOP.min : SHEET_TOP.mid }}
          >
            <Stage />
          </main>

          <section
            ref={sheetRef}
            aria-label="조작 패널"
            className="absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-[20px] border-t border-line bg-surface transition-[top] duration-200 ease-out motion-reduce:transition-none"
            style={{ top: SHEET_TOP[size] }}
            onPointerDown={onSheetPointerDown}
            onPointerMove={onSheetPointerMove}
            onPointerUp={(event) => endSheetDrag(event, true)}
            onPointerCancel={(event) => endSheetDrag(event, false)}
            onClickCapture={onSheetClickCapture}
          >
            {/* 머리줄: 손잡이 + 칩 줄(패널이 채운다) + 크게/작게 단추. 이 줄을 위아래로 끌면 시트 크기가 바뀐다 */}
            <div ref={headRef} className="shrink-0 select-none">
              <div aria-hidden="true" className="flex h-2 touch-none items-end justify-center">
                <span className="h-1 w-9 rounded-full bg-line-strong" />
              </div>
              <div className="flex h-12 items-center">
                <div ref={setSlot} className="peer no-scrollbar min-w-0 flex-1 touch-pan-x overflow-x-auto overscroll-x-contain empty:hidden" />
                <p className="hidden min-w-0 flex-1 touch-none truncate pl-4 text-[15px] font-semibold text-ink peer-empty:block">{title}</p>
                <button
                  ref={toggleRef}
                  type="button"
                  aria-expanded={size === 'max'}
                  aria-label={size === 'max' ? '패널 작게 보기' : '패널 크게 보기'}
                  className="mr-1 flex h-11 w-11 shrink-0 cursor-pointer touch-none items-center justify-center rounded-full text-muted"
                  onClick={toggleSize}
                >
                  <span className={`flex transition-transform duration-200 motion-reduce:transition-none ${size === 'max' ? 'rotate-180' : ''}`}>
                    <Icon name="chevronUp" size={22} />
                  </span>
                </button>
              </div>
            </div>

            {EMBEDDED ? null : <CoachMarks />}

            <div
              ref={scrollRef}
              inert={size === 'min'}
              className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pt-1 pb-5"
            >
              {view === 'feedback' ? (
                <ErrorBoundary resetKey="feedback" fallback={(retry) => <PanelFallback retry={retry} />}>
                  <FeedbackPanel />
                </ErrorBoundary>
              ) : (
                <ActivePanel category={category} />
              )}
            </div>
          </section>
        </div>

        <nav
          aria-label="메뉴"
          className="relative z-20 grid shrink-0 grid-cols-7 border-t border-line bg-surface pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
        >
          {CATEGORIES.map((entry) => {
            const active = entry.key === category && view === 'panel'
            return (
              <button
                key={entry.key}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  actions.setCategory(entry.key)
                  setView('panel')
                  openIfClosed()
                }}
                className={`flex min-h-[52px] min-w-0 cursor-pointer flex-col items-center justify-center gap-0.5 text-[12px] font-medium transition-colors ${
                  active ? 'text-accent-strong' : 'text-muted'
                }`}
              >
                <Icon name={entry.icon} size={22} />
                <span className="max-w-full whitespace-nowrap">{entry.label}</span>
              </button>
            )
          })}
          <button
            type="button"
            aria-current={view === 'feedback' ? 'page' : undefined}
            aria-label={feedbackNote ? `피드백, ${feedbackNote}` : '피드백'}
            onClick={() => {
              setView('feedback')
              openIfClosed()
            }}
            className={`flex min-h-[52px] min-w-0 cursor-pointer flex-col items-center justify-center gap-0.5 text-[12px] font-medium transition-colors ${
              view === 'feedback' ? 'text-accent-strong' : 'text-muted'
            }`}
          >
            <span className="relative flex">
              <Icon name="feedback" size={22} />
              {errorCount > 0 || tipCount > 0 ? (
                <span
                  className={`absolute -top-1 left-full -ml-2 flex h-4 min-w-4 items-center justify-center rounded-full px-1 whitespace-nowrap text-[11px] leading-none font-semibold text-white tabular-nums ${
                    errorCount > 0 ? 'bg-danger' : 'bg-tip'
                  }`}
                >
                  {errorCount > 0 ? errorCount : tipCount}
                </span>
              ) : null}
            </span>
            <span className="max-w-full whitespace-nowrap">피드백</span>
          </button>
        </nav>
      </div>
    </SheetContext.Provider>
  )
}

export default function AppShell() {
  const category = useAppState((state) => state.activeCategory)
  const isDesktop = useIsDesktop()
  return isDesktop ? <DesktopShell category={category} /> : <MobileShell category={category} />
}

// SVG 2D 평면도 편집기. 방·문·창문·가구를 cm 좌표 그대로 그리고, 끌기·크기 조절·단축키로 고친다.
// 상태는 src/state/store.ts 에서 읽고 actions 로만 바꾼다. 계산은 src/engine/geometry.js 와 planMath.ts 에 있다.
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useInSheet } from '../components/sheetContext.ts'
import { CATEGORY_LABELS } from '../data/labels.js'
import { footprint, frontDirection, frontZone } from '../engine/geometry.js'
import { actions, activeRoomOf, getState, useActiveRoom, useAppState } from '../state/store.ts'
import type { FurnitureItem, Opening, Rect } from '../types/schema.ts'
import { clipToRoom, fitLabel, isDarkColor, layoutLabel, openingShape, resizeRect, snapMove, wallBoxes } from './planMath.ts'
import type { SnapGuides } from './planMath.ts'

type GestureKind = 'move' | 'resize'
type Grip = -1 | 0 | 1
type Status = 'error' | 'tip' | 'none'

interface Gesture {
  kind: GestureKind
  id: string
  pointerId: number
  /** 조금이라도 움직였는지. 그냥 누르기만 한 것은 옮기지 않는다 */
  active: boolean
  slopPx: number
  startClientX: number
  startClientY: number
  lastClientX: number
  lastClientY: number
  /** 포인터와 가구(또는 잡은 변) 사이의 거리(cm). 잡은 자리가 튀지 않게 한다 */
  offsetX: number
  offsetY: number
  startRect: Rect
  hx: Grip
  hy: Grip
  frame: number
}

const NO_GUIDES: SnapGuides = { x: null, y: null }
const WALL_PX = 5
const HANDLE_PX = 9
const HANDLE_HIT_PX = 28
/** 손가락으로 쓰는 화면인지 (휴대폰·태블릿) */
const COARSE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches
const LABEL_FONT_PX = 11
const TOOLBAR_HALF_PX = 124
/** 떠 있는 도구 막대의 높이(px). 휴대폰 틀에서는 단추가 44px라 더 높다 */
const TOOLBAR_PX = 46
const TOOLBAR_TOUCH_PX = 54
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

const HANDLES: { hx: Grip; hy: Grip; cursor: string }[] = [
  { hx: -1, hy: -1, cursor: 'nwse-resize' },
  { hx: 0, hy: -1, cursor: 'ns-resize' },
  { hx: 1, hy: -1, cursor: 'nesw-resize' },
  { hx: 1, hy: 0, cursor: 'ew-resize' },
  { hx: 1, hy: 1, cursor: 'nwse-resize' },
  { hx: 0, hy: 1, cursor: 'ns-resize' },
  { hx: -1, hy: 1, cursor: 'nesw-resize' },
  { hx: -1, hy: 0, cursor: 'ew-resize' },
]

/** 글자를 넣는 중이면 단축키를 쓰지 않는다 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"]') !== null
}

/** 방향키를 스스로 쓰는 부품(탭, 라디오 묶음 등) 위에서는 가구를 옮기지 않는다 */
function usesArrowKeys(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return (
    target.closest(
      '[role="tablist"], [role="radiogroup"], [role="slider"], [role="listbox"], [role="menu"], [role="menubar"], [role="tree"], [role="grid"]',
    ) !== null
  )
}

function hasTextSelection(): boolean {
  const selection = window.getSelection()
  return selection !== null && !selection.isCollapsed && selection.toString().length > 0
}

// ── 가구 한 점 ──────────────────────────────────────────────────────────
interface PieceProps {
  item: FurnitureItem
  status: Status
  /** 화면 px ÷ cm */
  scale: number
  /** 좁은 화면(휴대폰). 이름표를 잘라 쓰지 않고 줄이거나 두 줄로 쓴다 */
  compact: boolean
  onDown: (event: ReactPointerEvent<SVGGElement>, id: string) => void
}

const Piece = memo(function Piece({ item, status, scale, compact, onDown }: PieceProps) {
  const px = (n: number): number => n / scale
  const r = footprint(item)
  const isMat = item.category === 'mat'
  const wPx = r.widthCm * scale
  const dPx = r.depthCm * scale
  const corner = Math.min(px(3), r.widthCm / 4, r.depthCm / 4)

  // 손가락으로 누르기 어려운 작은 가구는 누르는 자리만 넓힌다
  const hitW = Math.max(r.widthCm, px(HANDLE_HIT_PX))
  const hitD = Math.max(r.depthCm, px(HANDLE_HIT_PX))

  // 정면 표시: 정면 변 안쪽의 가는 선 + 가운데 작은 세모
  const { dx, dy } = frontDirection(item.rotation)
  const inset = Math.min(px(4), r.widthCm / 5, r.depthCm / 5)
  const cx = r.xCm + r.widthCm / 2
  const cy = r.yCm + r.depthCm / 2
  const frontX = cx + dx * (r.widthCm / 2 - inset)
  const frontY = cy + dy * (r.depthCm / 2 - inset)
  const halfSpan = (dx === 0 ? r.widthCm : r.depthCm) / 2 - inset
  const notch = Math.min(px(6), halfSpan / 2)
  const showNotch = Math.min(wPx, dPx) >= 26
  // 정면 변에 나란한 방향
  const ax = dx === 0 ? 1 : 0
  const ay = dx === 0 ? 0 : 1

  // 이름표: 가구 밖으로 나가지 않게 줄이거나 숨긴다. 세로로 긴 가구는 세로로 쓴다
  const margin = 6
  let label: string | null = null
  let vertical = false
  let labelLines: string[] = []
  let labelFontPx = LABEL_FONT_PX
  if (compact) {
    // 좁은 화면: "800…"처럼 자르지 않고, 두 줄·작은 글자·가구 종류 이름 가운데 들어가는 것을 쓴다
    const fitted = layoutLabel(item.name, item.category === 'other' ? '' : CATEGORY_LABELS[item.category], wPx, dPx)
    if (fitted) {
      labelLines = fitted.lines
      vertical = fitted.vertical
      labelFontPx = fitted.fontPx
    }
  } else {
    if (dPx >= LABEL_FONT_PX + 8) label = fitLabel(item.name, wPx - margin * 2, LABEL_FONT_PX)
    if ((label === null || label !== item.name.trim()) && dPx > wPx && wPx >= LABEL_FONT_PX + 8) {
      const turned = fitLabel(item.name, dPx - margin * 2, LABEL_FONT_PX)
      if (turned !== null && (label === null || turned.length > label.length)) {
        label = turned
        vertical = true
      }
    }
    if (label !== null) labelLines = [label]
  }
  const lineGap = px(labelFontPx * 1.2)
  const darkFill = !isMat && isDarkColor(item.color)

  return (
    <g
      tabIndex={0}
      role="button"
      aria-label={`${item.name}, 가로 ${r.widthCm}cm 세로 ${r.depthCm}cm`}
      data-piece-id={item.id}
      style={{ cursor: 'move', outline: 'none' }}
      onPointerDown={(event) => onDown(event, item.id)}
      onFocus={() => actions.select(item.id)}
    >
      <rect x={cx - hitW / 2} y={cy - hitD / 2} width={hitW} height={hitD} fill="transparent" />
      <rect
        x={r.xCm}
        y={r.yCm}
        width={r.widthCm}
        height={r.depthCm}
        rx={corner}
        fill={item.color}
        fillOpacity={isMat ? 0.32 : 0.94}
        stroke={isMat ? 'var(--color-line-strong)' : 'var(--color-ink)'}
        strokeOpacity={isMat ? 1 : 0.72}
        strokeWidth={px(1)}
        strokeDasharray={isMat ? `${px(4)} ${px(3)}` : undefined}
      />
      {!isMat && (
        <g pointerEvents="none" stroke={darkFill ? '#ffffff' : 'var(--color-ink)'} strokeOpacity={0.6}>
          <line
            x1={frontX - ax * halfSpan}
            y1={frontY - ay * halfSpan}
            x2={frontX + ax * halfSpan}
            y2={frontY + ay * halfSpan}
            strokeWidth={px(1.5)}
            strokeLinecap="round"
          />
          {showNotch && (
            <path
              d={`M ${frontX - ax * notch} ${frontY - ay * notch} L ${frontX - dx * notch} ${frontY - dy * notch} L ${frontX + ax * notch} ${frontY + ay * notch}`}
              fill="none"
              strokeWidth={px(1)}
              strokeLinejoin="round"
            />
          )}
        </g>
      )}
      {status !== 'none' && (
        <rect
          x={r.xCm + px(1)}
          y={r.yCm + px(1)}
          width={Math.max(0, r.widthCm - px(2))}
          height={Math.max(0, r.depthCm - px(2))}
          rx={corner}
          fill="none"
          pointerEvents="none"
          stroke={status === 'error' ? 'var(--color-danger)' : 'var(--color-tip)'}
          strokeWidth={px(status === 'error' ? 2.5 : 2)}
          strokeDasharray={status === 'tip' ? `${px(5)} ${px(3)}` : undefined}
        />
      )}
      {labelLines.length > 0 && (
        // 안쪽 svg는 자기 크기 밖을 잘라 내므로 글자가 가구 밖으로 나가지 않는다
        <svg x={r.xCm} y={r.yCm} width={r.widthCm} height={r.depthCm} pointerEvents="none">
          <g transform={vertical ? `rotate(-90 ${r.widthCm / 2} ${r.depthCm / 2})` : undefined}>
            {labelLines.map((line, index) => (
              <text
                key={index}
                x={r.widthCm / 2}
                y={r.depthCm / 2 + (index - (labelLines.length - 1) / 2) * lineGap}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={px(labelFontPx)}
                fontWeight={500}
                fill={darkFill ? '#ffffff' : 'var(--color-ink)'}
              >
                {line}
              </text>
            ))}
          </g>
        </svg>
      )}
    </g>
  )
})

// ── 방(바닥·벽·문·창문·치수) ────────────────────────────────────────────
interface RoomLayerProps {
  widthCm: number
  depthCm: number
  openings: Opening[]
  floorColor: string
  scale: number
  outsidePx: number
}

// 가구를 끌어도 다시 그리지 않도록 방에서 바뀌지 않는 값만 받는다
const RoomLayer = memo(function RoomLayer({ widthCm, depthCm, openings, floorColor, scale, outsidePx }: RoomLayerProps) {
  const room = { widthCm, depthCm, openings }
  const px = (n: number): number => n / scale
  const wall = px(WALL_PX)
  const walls = wallBoxes(room, wall)
  const dimOffset = px(WALL_PX + 10)
  const tick = px(4)
  const fontSize = px(11)
  const dimStroke = px(1)

  const renderOpening = (opening: Opening): ReactNode => {
    const shape = openingShape(opening, room, wall, px(outsidePx - WALL_PX - 4))
    if (opening.type === 'window') {
      // 창문: 벽 위에 두 줄
      const b = shape.band
      return (
        <g key={opening.id}>
          <rect
            x={b.x}
            y={b.y}
            width={b.width}
            height={b.height}
            fill="var(--color-surface)"
            stroke="var(--color-ink)"
            strokeWidth={px(1)}
          />
          {shape.horizontal ? (
            <line x1={b.x} y1={b.y + b.height / 2} x2={b.x + b.width} y2={b.y + b.height / 2} stroke="var(--color-accent)" strokeWidth={px(1)} />
          ) : (
            <line x1={b.x + b.width / 2} y1={b.y} x2={b.x + b.width / 2} y2={b.y + b.height} stroke="var(--color-accent)" strokeWidth={px(1)} />
          )}
        </g>
      )
    }
    // 문: 열린 문짝 + 4분원
    return (
      <g key={opening.id} fill="none">
        <line
          x1={shape.hinge.x}
          y1={shape.hinge.y}
          x2={shape.closedEnd.x}
          y2={shape.closedEnd.y}
          stroke="var(--color-line-strong)"
          strokeWidth={px(1)}
        />
        <path
          d={`M ${shape.closedEnd.x} ${shape.closedEnd.y} A ${shape.radius} ${shape.radius} 0 0 ${shape.sweep} ${shape.openEnd.x} ${shape.openEnd.y}`}
          stroke="var(--color-muted)"
          strokeWidth={px(1)}
          strokeDasharray={`${px(3)} ${px(3)}`}
        />
        <line
          x1={shape.hinge.x}
          y1={shape.hinge.y}
          x2={shape.openEnd.x}
          y2={shape.openEnd.y}
          stroke="var(--color-ink)"
          strokeWidth={px(1.5)}
        />
      </g>
    )
  }

  return (
    <g pointerEvents="none">
      <rect x={0} y={0} width={room.widthCm} height={room.depthCm} fill="var(--color-surface)" />
      <rect x={0} y={0} width={room.widthCm} height={room.depthCm} fill={floorColor} fillOpacity={0.2} />
      {walls.map((box, index) => (
        <rect key={index} x={box.x} y={box.y} width={box.width} height={box.height} fill="var(--color-ink)" />
      ))}
      {room.openings.map(renderOpening)}

      {/* 방 치수: 벽 바깥 */}
      <g stroke="var(--color-muted)" strokeWidth={dimStroke} fill="none">
        <line x1={0} y1={-dimOffset} x2={room.widthCm} y2={-dimOffset} />
        <line x1={0} y1={-dimOffset - tick} x2={0} y2={-dimOffset + tick} />
        <line x1={room.widthCm} y1={-dimOffset - tick} x2={room.widthCm} y2={-dimOffset + tick} />
        <line x1={-dimOffset} y1={0} x2={-dimOffset} y2={room.depthCm} />
        <line x1={-dimOffset - tick} y1={0} x2={-dimOffset + tick} y2={0} />
        <line x1={-dimOffset - tick} y1={room.depthCm} x2={-dimOffset + tick} y2={room.depthCm} />
      </g>
      <text
        x={room.widthCm / 2}
        y={-dimOffset - px(5)}
        textAnchor="middle"
        fontSize={fontSize}
        fill="var(--color-muted)"
      >
        {`가로 ${room.widthCm} cm`}
      </text>
      <text
        x={-dimOffset - px(5)}
        y={room.depthCm / 2}
        textAnchor="middle"
        fontSize={fontSize}
        fill="var(--color-muted)"
        transform={`rotate(-90 ${-dimOffset - px(5)} ${room.depthCm / 2})`}
      >
        {`세로 ${room.depthCm} cm`}
      </text>
    </g>
  )
})

// ── 작은 아이콘 (가는 선) ───────────────────────────────────────────────
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

// ── 편집기 ──────────────────────────────────────────────────────────────
export default function FloorPlanEditor() {
  const room = useActiveRoom()
  const selectedId = useAppState((state) => state.selectedId)
  const validation = useAppState((state) => state.validation)
  // 휴대폰 틀에서는 도구 막대의 단추가 44px라 막대가 더 높다
  const toolbarPx = useInSheet() ? TOOLBAR_TOUCH_PX : TOOLBAR_PX

  const hostRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const nudgeRef = useRef<{ active: boolean; timer: ReturnType<typeof setTimeout> | undefined }>({
    active: false,
    timer: undefined,
  })
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const [size, setSize] = useState({ w: 640, h: 480 })
  const [gestureKind, setGestureKind] = useState<GestureKind | null>(null)
  const [guides, setGuides] = useState<SnapGuides>(NO_GUIDES)
  const [notice, setNotice] = useState('')
  const hatchId = `fp-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  // 부모가 정한 크기를 잰다. svg는 absolute라서 부모 크기에 영향을 주지 않는다
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const measure = (): void => {
      const box = host.getBoundingClientRect()
      const w = Math.round(box.width)
      const h = Math.round(box.height)
      if (w > 0 && h > 0) setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  // 화면 맞춤: 방 전체 + 바깥 여백(치수 글자 자리)이 항상 보이게 한다
  const compact = size.w < 520
  const outsidePx = compact ? 36 : 46
  const scale = Math.max(
    0.05,
    Math.min((size.w - outsidePx * 2) / room.widthCm, (size.h - outsidePx * 2) / room.depthCm),
  )
  const px = (n: number): number => n / scale
  const vbW = size.w / scale
  const vbH = size.h / scale
  const vbX = -(vbW - room.widthCm) / 2
  const vbY = -(vbH - room.depthCm) / 2

  const showNotice = useCallback((text: string) => {
    setNotice(text)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 4000)
  }, [])

  /** 화면 좌표 → 방 좌표(cm). viewBox가 cm라서 역변환만 하면 된다 */
  const toCm = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current
    const matrix = svg?.getScreenCTM()
    if (!svg || !matrix) return null
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
    return { x: point.x, y: point.y }
  }, [])

  /** 방향키를 누르고 있는 동안의 이동을 실행취소 한 단계로 묶던 것을 끝낸다 */
  const flushNudge = useCallback(() => {
    const nudge = nudgeRef.current
    clearTimeout(nudge.timer)
    if (!nudge.active) return
    nudge.active = false
    actions.endGesture()
  }, [])

  /** 끌기 한 걸음: 마지막 포인터 위치로 가구를 옮기거나 크기를 바꾼다 */
  const applyGesture = useCallback(
    (gesture: Gesture) => {
      if (!gesture.active) {
        const moved = Math.hypot(gesture.lastClientX - gesture.startClientX, gesture.lastClientY - gesture.startClientY)
        if (moved < gesture.slopPx) return
        gesture.active = true
        setGestureKind(gesture.kind)
      }
      const point = toCm(gesture.lastClientX, gesture.lastClientY)
      if (!point) return
      const currentRoom = activeRoomOf(getState().project)
      const item = currentRoom.furniture.find((entry) => entry.id === gesture.id)
      if (!item) return
      let nextGuides: SnapGuides
      if (gesture.kind === 'move') {
        const next = snapMove(currentRoom, item, point.x - gesture.offsetX, point.y - gesture.offsetY)
        if (next.xCm !== item.xCm || next.yCm !== item.yCm) actions.moveFurniture(item.id, next.xCm, next.yCm)
        nextGuides = next.guides
      } else {
        const next = resizeRect(
          currentRoom,
          item,
          gesture.startRect,
          gesture.hx,
          gesture.hy,
          point.x - gesture.offsetX,
          point.y - gesture.offsetY,
        )
        const now = footprint(item)
        const rect = next.rect
        if (
          rect.xCm !== now.xCm ||
          rect.yCm !== now.yCm ||
          rect.widthCm !== now.widthCm ||
          rect.depthCm !== now.depthCm
        ) {
          actions.resizeFurniture(item.id, rect)
        }
        nextGuides = next.guides
      }
      setGuides((prev) => (prev.x === nextGuides.x && prev.y === nextGuides.y ? prev : nextGuides))
    },
    [toCm],
  )

  const startGesture = useCallback(
    (event: ReactPointerEvent<SVGElement>, id: string, kind: GestureKind, hx: Grip, hy: Grip) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      event.stopPropagation()
      if (gestureRef.current) return // 두 번째 손가락은 무시한다
      const svg = svgRef.current
      const point = toCm(event.clientX, event.clientY)
      const item = activeRoomOf(getState().project).furniture.find((entry) => entry.id === id)
      if (!svg || !point || !item) return
      flushNudge()
      actions.select(id)
      actions.beginGesture()
      try {
        svg.setPointerCapture(event.pointerId)
      } catch {
        // 포인터를 잡지 못해도 svg 위에서는 계속 끌 수 있다
      }
      const rect = footprint(item)
      const edgeX = hx === 1 ? rect.xCm + rect.widthCm : rect.xCm
      const edgeY = hy === 1 ? rect.yCm + rect.depthCm : rect.yCm
      gestureRef.current = {
        kind,
        id,
        pointerId: event.pointerId,
        active: false,
        slopPx: event.pointerType === 'mouse' ? 2 : 5,
        startClientX: event.clientX,
        startClientY: event.clientY,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        offsetX: point.x - edgeX,
        offsetY: point.y - edgeY,
        startRect: rect,
        hx,
        hy,
        frame: 0,
      }
    },
    [toCm, flushNudge],
  )

  const onPieceDown = useCallback(
    (event: ReactPointerEvent<SVGGElement>, id: string) => startGesture(event, id, 'move', 0, 0),
    [startGesture],
  )

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gesture.lastClientX = event.clientX
    gesture.lastClientY = event.clientY
    // 한 화면 그리기에 한 번만 계산한다 (끌기가 버벅이지 않게)
    if (gesture.frame !== 0) return
    gesture.frame = requestAnimationFrame(() => {
      gesture.frame = 0
      if (gestureRef.current === gesture) applyGesture(gesture)
    })
  }

  const finishGesture = (event: ReactPointerEvent<SVGSVGElement>, apply: boolean): void => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (gesture.frame !== 0) cancelAnimationFrame(gesture.frame)
    gesture.frame = 0
    if (apply) {
      gesture.lastClientX = event.clientX
      gesture.lastClientY = event.clientY
      applyGesture(gesture)
    }
    gestureRef.current = null
    try {
      svgRef.current?.releasePointerCapture(gesture.pointerId)
    } catch {
      // 이미 풀린 경우
    }
    actions.endGesture()
    setGestureKind(null)
    setGuides(NO_GUIDES)
  }

  const paste = useCallback(() => {
    const result = actions.pasteClipboard()
    if (result && !result.placed) showNotice('빈 자리가 없어서 가운데에 놓았어요. 끌어서 옮겨 주세요.')
  }, [showNotice])

  // 단축키: 창 전체에서 듣고, 글자를 넣는 중이면 무시한다
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return
      if (isTypingTarget(event.target)) return
      if (gestureRef.current) return
      const state = getState()
      const id = state.selectedId
      if (event.ctrlKey || event.metaKey) {
        if (event.altKey) return
        if (event.code === 'KeyZ') {
          event.preventDefault()
          flushNudge()
          if (event.shiftKey) actions.redo()
          else actions.undo()
        } else if (event.code === 'KeyY' && !event.shiftKey) {
          event.preventDefault()
          flushNudge()
          actions.redo()
        } else if (event.code === 'KeyC' && !event.shiftKey && id !== null && !hasTextSelection()) {
          event.preventDefault()
          actions.copySelected()
        } else if (event.code === 'KeyV' && !event.shiftKey && state.hasClipboard) {
          event.preventDefault()
          flushNudge()
          paste()
        }
        return
      }
      if (event.altKey || id === null) return
      if (event.key === 'Escape') {
        event.preventDefault()
        flushNudge()
        actions.select(null)
        const focused = document.activeElement
        if (focused instanceof SVGElement && svgRef.current?.contains(focused)) focused.blur()
        return
      }
      if (event.code === 'KeyR') {
        event.preventDefault()
        flushNudge()
        actions.rotateFurniture(id)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        flushNudge()
        actions.removeFurniture(id)
        return
      }
      const arrow = ARROWS[event.key]
      if (arrow && !usesArrowKeys(event.target)) {
        event.preventDefault()
        const step = event.shiftKey ? 1 : 5
        const nudge = nudgeRef.current
        // 키를 누르고 있는 동안의 이동은 실행취소 한 단계로 묶는다
        if (!nudge.active) {
          nudge.active = true
          actions.beginGesture()
        }
        actions.nudgeFurniture(id, arrow[0] * step, arrow[1] * step)
        clearTimeout(nudge.timer)
        nudge.timer = setTimeout(flushNudge, 700)
      }
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key in ARROWS) flushNudge()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', flushNudge)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', flushNudge)
    }
  }, [flushNudge, paste])

  // 화면에서 사라질 때 하던 동작을 마무리한다
  useEffect(() => {
    const nudge = nudgeRef.current
    return () => {
      const gesture = gestureRef.current
      if (gesture) {
        if (gesture.frame !== 0) cancelAnimationFrame(gesture.frame)
        gestureRef.current = null
        actions.endGesture()
      }
      clearTimeout(nudge.timer)
      if (nudge.active) {
        nudge.active = false
        actions.endGesture()
      }
      clearTimeout(noticeTimer.current)
    }
  }, [])

  // 피드백: 문제에 걸린 가구와 제안에만 걸린 가구
  const statusById = useMemo(() => {
    const map = new Map<string, Status>()
    for (const tip of validation.tips) for (const id of tip.furnitureIds) map.set(id, 'tip')
    for (const error of validation.errors) for (const id of error.furnitureIds) map.set(id, 'error')
    return map
  }, [validation])

  // 매트는 맨 아래에 그린다. 순서를 끌기 중에 바꾸지 않아야 포커스가 유지된다
  const ordered = useMemo(
    () => [
      ...room.furniture.filter((item) => item.category === 'mat'),
      ...room.furniture.filter((item) => item.category !== 'mat'),
    ],
    [room.furniture],
  )

  const selected = selectedId === null ? null : (room.furniture.find((item) => item.id === selectedId) ?? null)
  const selectedRect = selected ? footprint(selected) : null
  const selectedFront = selected ? frontZone(selected) : null
  const frontClip = selectedFront ? clipToRoom(selectedFront, room) : null
  const matZone = validation.matZone

  // 크기 글자 자리: 아래 → 위 → 안쪽 순서로 빈 곳에 둔다
  let sizeLabelY = 0
  let sizeLabelSide: 'below' | 'above' | 'inside' = 'below'
  if (selectedRect) {
    const bottom = selectedRect.yCm + selectedRect.depthCm
    if (bottom + px(22) <= room.depthCm) {
      sizeLabelY = bottom + px(15)
    } else if (selectedRect.yCm - px(22) >= 0) {
      sizeLabelSide = 'above'
      sizeLabelY = selectedRect.yCm - px(8)
    } else {
      sizeLabelSide = 'inside'
      sizeLabelY = bottom - px(10)
    }
  }

  // 떠 있는 도구 막대 자리(px). 좁은 화면에서는 가운데에 두되, 고른 가구와 위쪽 치수선을 가리지 않는 쪽(아래 또는 위)에 둔다
  let toolbarLeft = size.w / 2
  let toolbarTop = 8
  if (selectedRect && compact) {
    const topPx = (selectedRect.yCm - vbY) * scale
    const bottomPx = (selectedRect.yCm + selectedRect.depthCm - vbY) * scale
    const stageBottom = Math.max(8, size.h - toolbarPx - 2)
    const roomForBottom = bottomPx + (sizeLabelSide === 'below' ? 22 : 0) + 6 <= stageBottom
    const roomForTop = topPx - (sizeLabelSide === 'above' ? 20 : 0) - 6 >= 8 + toolbarPx - 6
    // 아래에 자리가 있으면 아래, 없으면 위, 둘 다 없으면 가구를 덜 가리는 쪽
    if (roomForBottom) toolbarTop = stageBottom
    else if (roomForTop) toolbarTop = 8
    else toolbarTop = size.h - bottomPx > topPx ? stageBottom : 8
  }
  if (selectedRect && !compact) {
    const centerPx = (selectedRect.xCm + selectedRect.widthCm / 2 - vbX) * scale
    const topPx = (selectedRect.yCm - vbY) * scale
    const bottomPx = (selectedRect.yCm + selectedRect.depthCm - vbY) * scale
    const half = Math.min(TOOLBAR_HALF_PX, size.w / 2 - 6)
    toolbarLeft = Math.max(half + 6, Math.min(size.w - half - 6, centerPx))
    const above = topPx - toolbarPx - (sizeLabelSide === 'above' ? 20 : 0)
    const below = bottomPx + 10 + (sizeLabelSide === 'below' ? 22 : 0)
    if (above >= 4) toolbarTop = above
    else if (below + toolbarPx - 6 <= size.h - 4) toolbarTop = below
    else toolbarTop = Math.max(4, Math.min(size.h - toolbarPx + 2, topPx + 8))
  }

  const duplicate = (): void => {
    flushNudge()
    actions.copySelected()
    paste()
  }

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden" style={{ minHeight: 0 }}>
      <svg
        ref={svgRef}
        role="application"
        aria-label="방 평면도 편집기. 가구를 끌어서 옮기고, 방향키로 5cm씩 옮길 수 있어요."
        className="absolute inset-0 block h-full w-full select-none"
        style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={(event) => {
          // 가구와 손잡이는 stopPropagation 하므로 여기까지 오면 빈 곳을 누른 것이다
          if (event.pointerType === 'mouse' && event.button !== 0) return
          if (gestureRef.current) return
          flushNudge()
          actions.select(null)
        }}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finishGesture(event, true)}
        onPointerCancel={(event) => finishGesture(event, false)}
        onLostPointerCapture={(event) => {
          if (event.target === event.currentTarget) finishGesture(event, false)
        }}
      >
        <defs>
          <pattern id={hatchId} width={px(7)} height={px(7)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={px(7)} stroke="var(--color-accent)" strokeWidth={px(1.2)} strokeOpacity={0.55} />
          </pattern>
        </defs>

        <RoomLayer
          widthCm={room.widthCm}
          depthCm={room.depthCm}
          openings={room.openings}
          floorColor={room.style.floorColor}
          scale={scale}
          outsidePx={outsidePx}
        />

        {room.furniture.length === 0 && room.widthCm * scale >= 200 && (
          <text
            x={room.widthCm / 2}
            y={room.depthCm / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={px(13)}
            fill="var(--color-muted)"
            pointerEvents="none"
          >
            가구 탭에서 가구를 추가해 보세요
          </text>
        )}

        {/* 매트 추천 구역 (영유아 가족 모드) */}
        {matZone && (
          <g pointerEvents="none">
            <rect
              x={matZone.xCm}
              y={matZone.yCm}
              width={matZone.widthCm}
              height={matZone.depthCm}
              rx={px(3)}
              fill="var(--color-ok)"
              fillOpacity={0.1}
              stroke="var(--color-ok)"
              strokeWidth={px(1)}
              strokeDasharray={`${px(5)} ${px(4)}`}
            />
            {matZone.widthCm * scale >= 92 && matZone.depthCm * scale >= 22 && (
              <text
                x={matZone.xCm + matZone.widthCm / 2}
                y={matZone.yCm + px(14)}
                textAnchor="middle"
                fontSize={px(11)}
                fontWeight={600}
                fill="var(--color-ok)"
              >
                매트 추천 구역
              </text>
            )}
          </g>
        )}

        {ordered.map((item) => (
          <Piece
            key={item.id}
            item={item}
            status={statusById.get(item.id) ?? 'none'}
            scale={scale}
            compact={compact}
            onDown={onPieceDown}
          />
        ))}

        {/* 붙은 자리 안내선 */}
        {guides.x !== null && (
          <line x1={guides.x} y1={0} x2={guides.x} y2={room.depthCm} stroke="var(--color-accent)" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} pointerEvents="none" />
        )}
        {guides.y !== null && (
          <line x1={0} y1={guides.y} x2={room.widthCm} y2={guides.y} stroke="var(--color-accent)" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} pointerEvents="none" />
        )}

        {/* 선택한 가구: 정면 사용 공간, 테두리, 크기, 손잡이 */}
        {selected && selectedRect && (
          <g>
            {frontClip && (
              <g pointerEvents="none">
                <rect x={frontClip.xCm} y={frontClip.yCm} width={frontClip.widthCm} height={frontClip.depthCm} fill="var(--color-accent)" fillOpacity={0.06} />
                <rect x={frontClip.xCm} y={frontClip.yCm} width={frontClip.widthCm} height={frontClip.depthCm} fill={`url(#${hatchId})`} />
              </g>
            )}
            <rect
              x={selectedRect.xCm}
              y={selectedRect.yCm}
              width={selectedRect.widthCm}
              height={selectedRect.depthCm}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={px(1.5)}
              pointerEvents="none"
            />
            <text
              x={selectedRect.xCm + selectedRect.widthCm / 2}
              y={sizeLabelY}
              textAnchor="middle"
              fontSize={px(12)}
              fontWeight={600}
              fill="var(--color-accent-strong)"
              stroke="var(--color-surface)"
              strokeWidth={px(3.5)}
              strokeLinejoin="round"
              paintOrder="stroke"
              pointerEvents="none"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {`${selectedRect.widthCm} × ${selectedRect.depthCm} cm`}
            </text>
            {HANDLES.map((handle) => {
              const hxPos = selectedRect.xCm + ((handle.hx + 1) / 2) * selectedRect.widthCm
              const hyPos = selectedRect.yCm + ((handle.hy + 1) / 2) * selectedRect.depthCm
              // 누르는 자리: 바깥으로는 넉넉하게, 안쪽으로는 가구를 다 덮지 않게 (가운데는 옮기기용으로 남긴다)
              const out = px(HANDLE_HIT_PX / 2)
              // 모서리를 따라서는 이만큼 넓게 잡힌다
              const alongX = Math.min(out, selectedRect.widthCm / 4)
              const alongY = Math.min(out, selectedRect.depthCm / 4)
              // 가구 안쪽으로 들어오는 깊이. 손가락 화면에서는 0: 가구 위를 누르면 늘 옮기기가 되게 한다 (손잡이는 바깥쪽에서 잡는다)
              const inX = COARSE ? 0 : alongX
              const inY = COARSE ? 0 : alongY
              const left = hxPos - (handle.hx === -1 ? out : handle.hx === 1 ? inX : alongX)
              const right = hxPos + (handle.hx === 1 ? out : handle.hx === -1 ? inX : alongX)
              const top = hyPos - (handle.hy === -1 ? out : handle.hy === 1 ? inY : alongY)
              const bottom = hyPos + (handle.hy === 1 ? out : handle.hy === -1 ? inY : alongY)
              const half = px(HANDLE_PX / 2)
              return (
                <g
                  key={`${handle.hx},${handle.hy}`}
                  style={{ cursor: handle.cursor }}
                  onPointerDown={(event) => startGesture(event, selected.id, 'resize', handle.hx, handle.hy)}
                >
                  <rect x={left} y={top} width={right - left} height={bottom - top} fill="transparent" />
                  <rect
                    x={hxPos - half}
                    y={hyPos - half}
                    width={half * 2}
                    height={half * 2}
                    rx={px(2)}
                    fill="var(--color-surface)"
                    stroke="var(--color-accent)"
                    strokeWidth={px(1.5)}
                  />
                </g>
              )
            })}
          </g>
        )}
      </svg>

      {/* 선택한 가구 옆 도구 막대: 터치로도 회전·복사·삭제를 할 수 있게 한다 */}
      {selected && gestureKind === null && (
        <div
          role="toolbar"
          aria-label={`${selected.name} 도구`}
          className="card absolute z-10 flex items-center gap-0.5 p-1 whitespace-nowrap shadow-sm"
          style={{ left: toolbarLeft, top: toolbarTop, transform: 'translateX(-50%)' }}
        >
          <button
            type="button"
            className="btn btn-quiet px-2.5"
            aria-label="선택한 가구 90도 회전"
            onClick={() => {
              flushNudge()
              actions.rotateFurniture(selected.id)
            }}
          >
            <Icon>
              <path d="M13 8a5 5 0 1 1-1.6-3.7" />
              <path d="M13.2 2.4v2.4h-2.4" />
            </Icon>
            회전
          </button>
          <button type="button" className="btn btn-quiet px-2.5" aria-label="선택한 가구 복사해서 하나 더 놓기" onClick={duplicate}>
            <Icon>
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
              <path d="M10.5 3.5v-.2A1.3 1.3 0 0 0 9.2 2H3.8A1.3 1.3 0 0 0 2.5 3.3v5.4A1.3 1.3 0 0 0 3.8 10H4" />
            </Icon>
            복사
          </button>
          <button
            type="button"
            className="btn btn-quiet px-2.5 text-danger"
            aria-label="선택한 가구 삭제"
            onClick={() => {
              flushNudge()
              actions.removeFurniture(selected.id)
            }}
          >
            <Icon>
              <path d="M3 4.5h10" />
              <path d="M6.5 4.5V3h3v1.5" />
              <path d="M4.5 4.5l.6 8.2a1 1 0 0 0 1 .8h3.8a1 1 0 0 0 1-.8l.6-8.2" />
            </Icon>
            삭제
          </button>
        </div>
      )}

      <p
        aria-live="polite"
        className={
          notice
            ? 'chip chip-tip pointer-events-none absolute bottom-2 left-1/2 z-10 max-w-[92%] -translate-x-1/2 whitespace-normal'
            : 'sr-only'
        }
      >
        {notice}
      </p>
    </div>
  )
}

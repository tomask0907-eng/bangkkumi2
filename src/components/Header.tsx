// 위쪽 고정 헤더: 이름, [처음부터] [실행취소] [다시실행] [저장/공유]. PC 틀이 쓴다.
// 휴대폰 틀에는 머리줄이 따로 없고, 같은 기능을 무대 도구 줄(2D/3D 옆)에 둔다: [실행취소] [다시실행] [더보기](저장/공유, 처음부터).
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { EMBEDDED } from '../lib/embed.ts'
import { actions, getState, useAppState } from '../state/store.ts'
import { downloadDae } from '../lib/downloadDae.ts'
import Icon from './Icon.tsx'

/** 지금 프로젝트를 JSON 파일로 내려받는다 */
function downloadProject(): boolean {
  try {
    const text = JSON.stringify(getState().project, null, 2)
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `bangkkumi-${new Date().toISOString().slice(0, 10)}.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch {
    return false
  }
}

/** 사이트 주소를 공유한다. 공유 창이 없으면 주소를 복사한다. 돌려주는 글을 메뉴에 보여 준다 */
async function shareLink(): Promise<string> {
  // 방봄 "집 보기" 안에서는 이 화면만의 주소가 아니라 사이트 첫 주소를 알려 준다
  const url = EMBEDDED ? `${window.location.origin}/` : window.location.origin + window.location.pathname
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: '방봄', text: '방 배치를 미리 해 볼 수 있어요.', url })
      return ''
    } catch (error) {
      // 사용자가 공유 창을 닫은 것은 오류가 아니다
      if (error instanceof DOMException && error.name === 'AbortError') return ''
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    return '주소를 복사했어요.'
  } catch {
    return `주소를 직접 복사해 주세요: ${url}`
  }
}

function ResetDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const titleId = useId()
  const textId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-5"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        className="card w-full max-w-sm p-5"
      >
        <h2 id={titleId} className="panel-title">
          처음부터 다시 시작할까요?
        </h2>
        <p id={textId} className="hint mt-2">
          {EMBEDDED
            ? '지금까지 꾸민 배치가 지워지고 이 방의 처음 상태로 돌아가요. 지운 뒤에는 되돌릴 수 없어요.'
            : '지금 방과 가구가 모두 지워지고 시작 화면으로 돌아가요. 지운 뒤에는 되돌릴 수 없어요.'}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>
            취소
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            처음부터 시작
          </button>
        </div>
      </div>
    </div>
  )
}

/** 누르면 열리는 작은 메뉴의 열림 상태. 바깥을 누르거나 Esc를 누르면 닫힌다 */
function usePopover() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent): void {
      if (event.target instanceof Node && !wrapRef.current?.contains(event.target)) setOpen(false)
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return { open, setOpen, wrapRef, menuId }
}

interface SaveShareCardProps {
  id: string
  note: string
  setNote: (text: string) => void
  /** 저장/공유 아래에 더 얹을 항목 (휴대폰의 [처음부터]) */
  children?: ReactNode
}

/** 저장/공유 메뉴의 내용 */
function SaveShareCard({ id, note, setNote, children }: SaveShareCardProps) {
  return (
    <div id={id} className="card absolute top-full right-0 z-40 mt-2 w-[min(18rem,calc(100vw-1.5rem))] p-3">
      <p className="hint px-1">작업한 내용은 이 기기에 자동으로 저장돼요.</p>
      <div className="divider my-2.5" />
      <div className="flex flex-col gap-1">
        <button
          type="button"
          className="btn btn-quiet w-full justify-start"
          onClick={() => setNote(downloadProject() ? '프로젝트 파일을 내려받았어요.' : '파일을 만들지 못했어요.')}
        >
          <Icon name="download" size={18} />
          프로젝트 파일 내려받기
        </button>
        <button
          type="button"
          className="btn btn-quiet w-full justify-start"
          onClick={() => {
            void shareLink().then(setNote)
          }}
        >
          <Icon name="link" size={18} />
          링크 공유하기
        </button>
        <button
          type="button"
          className="btn btn-quiet w-full justify-start"
          onClick={() => {
            try {
              downloadDae(getState().project)
              setNote('스케치업 파일(.dae)을 내려받았어요. 스케치업에서 [파일 > 가져오기]로 열어요.')
            } catch {
              setNote('파일을 만들지 못했어요.')
            }
          }}
        >
          <Icon name="download" size={18} />
          스케치업 파일(.dae) 내려받기
        </button>
      </div>
      <p className="hint mt-2 px-1">링크에는 사이트 주소만 담겨요. 내 방 자료는 파일로 옮길 수 있어요.</p>
      <p className="mt-2 min-h-5 px-1 text-[13px] text-accent max-lg:text-sm" role="status" aria-live="polite">
        {note}
      </p>
      {children}
    </div>
  )
}

function SaveShareMenu() {
  const { open, setOpen, wrapRef, menuId } = usePopover()
  const [note, setNote] = useState('')

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        className="btn btn-quiet px-2 sm:px-3"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen((value) => !value)
          setNote('')
        }}
      >
        <Icon name="share" size={18} />
        저장/공유
      </button>
      {open && <SaveShareCard id={menuId} note={note} setNote={setNote} />}
    </div>
  )
}

/** 휴대폰의 [더보기]: 저장/공유와 처음부터를 한 메뉴에 모은다 */
function MoreMenu({ onReset }: { onReset: () => void }) {
  const { open, setOpen, wrapRef, menuId } = usePopover()
  const [note, setNote] = useState('')

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        className="btn btn-quiet w-11 px-0"
        aria-label="더보기"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen((value) => !value)
          setNote('')
        }}
      >
        <Icon name="more" size={22} />
      </button>
      {open && (
        <SaveShareCard id={menuId} note={note} setNote={setNote}>
          <div className="divider my-2.5" />
          <button
            type="button"
            className="btn btn-quiet w-full justify-start"
            onClick={() => {
              setOpen(false)
              onReset()
            }}
          >
            <Icon name="reset" size={18} />
            처음부터
          </button>
        </SaveShareCard>
      )}
    </div>
  )
}

/** 2D에서는 평면도 편집기가 단축키를 맡는다. 편집기가 없는 3D에서만 여기서 실행취소·다시실행을 듣는다 */
function useHistoryShortcuts(): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (getState().viewMode !== '3d' || event.defaultPrevented || event.isComposing) return
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      if (event.code === 'KeyZ') {
        event.preventDefault()
        if (event.shiftKey) actions.redo()
        else actions.undo()
      } else if (event.code === 'KeyY') {
        event.preventDefault()
        actions.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** 휴대폰 무대 도구 줄의 오른쪽: [실행취소] [다시실행] [더보기]. 누르는 자리는 모두 44px */
export function MobileTools() {
  const canUndo = useAppState((state) => state.canUndo)
  const canRedo = useAppState((state) => state.canRedo)
  const [confirming, setConfirming] = useState(false)
  const cancelReset = useCallback(() => setConfirming(false), [])
  useHistoryShortcuts()

  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        className="btn btn-quiet w-11 px-0"
        disabled={!canUndo}
        aria-label="실행취소"
        onClick={() => actions.undo()}
      >
        <Icon name="undo" size={20} />
      </button>
      <button
        type="button"
        className="btn btn-quiet w-11 px-0"
        disabled={!canRedo}
        aria-label="다시실행"
        onClick={() => actions.redo()}
      >
        <Icon name="redo" size={20} />
      </button>
      <MoreMenu onReset={() => setConfirming(true)} />
      {confirming && (
        <ResetDialog
          onCancel={cancelReset}
          onConfirm={() => {
            setConfirming(false)
            actions.resetAll()
          }}
        />
      )}
    </div>
  )
}

export default function Header() {
  const canUndo = useAppState((state) => state.canUndo)
  const canRedo = useAppState((state) => state.canRedo)
  const [confirming, setConfirming] = useState(false)
  const cancelReset = useCallback(() => setConfirming(false), [])
  useHistoryShortcuts()

  return (
    <header className="relative z-30 shrink-0 border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
      <div className="flex h-12 items-center gap-1 pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] lg:h-14 lg:gap-2 lg:pr-4 lg:pl-5">
        <h1 className="mr-auto flex items-center gap-2 text-[17px] font-semibold tracking-tight text-ink">
          <svg
            width="22"
            height="22"
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="hidden text-accent sm:block"
          >
            <path d="M13 27H6V5h20v22h-6" />
            <path d="M20 27v-7" />
            <path d="M20 20a7 7 0 0 0-7 7" strokeWidth="1.25" />
            <path d="M6 14h9" />
          </svg>
          {EMBEDDED ? '집 꾸미기' : <>방봄 <span className="en text-muted">Bangbom</span></>}
        </h1>

        <button type="button" className="btn btn-quiet px-2 sm:px-3" onClick={() => setConfirming(true)}>
          <Icon name="reset" size={18} />
          처음부터
        </button>
        <button
          type="button"
          className="btn btn-quiet w-9 px-0 sm:w-auto sm:px-3"
          disabled={!canUndo}
          aria-label="실행취소"
          title="실행취소 (Ctrl+Z)"
          onClick={() => actions.undo()}
        >
          <Icon name="undo" size={18} />
          <span className="hidden sm:inline">실행취소</span>
        </button>
        <button
          type="button"
          className="btn btn-quiet w-9 px-0 sm:w-auto sm:px-3"
          disabled={!canRedo}
          aria-label="다시실행"
          title="다시실행 (Ctrl+Y)"
          onClick={() => actions.redo()}
        >
          <Icon name="redo" size={18} />
          <span className="hidden sm:inline">다시실행</span>
        </button>
        <SaveShareMenu />
      </div>

      {confirming && (
        <ResetDialog
          onCancel={cancelReset}
          onConfirm={() => {
            setConfirming(false)
            actions.resetAll()
          }}
        />
      )}
    </header>
  )
}

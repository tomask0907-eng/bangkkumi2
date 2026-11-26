// 가구 패널: 놓인 가구 목록과 고치기, 목록에서 추가, 글로 추가.
// 가구를 추가해도 이미 놓인 가구는 움직이지 않는다 (store가 빈 자리에만 놓는다).
// 휴대폰 시트에서는 세 메뉴가 시트 머리줄의 칩이 되고, 가구 종류는 두 칸 격자로 늘어놓아 길이를 줄인다.
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CATALOG } from '../../data/catalog.js'
import { CATEGORY_LABELS, NOTICES } from '../../data/labels.js'
import { footprint } from '../../engine/geometry.js'
import { requestFurniture } from '../../lib/api.ts'
import { actions, useActiveRoom, useAppState } from '../../state/store.ts'
import type { FurnitureSeed } from '../../state/store.ts'
import type { CatalogItem, FurnitureCategory, FurnitureItem, FurnitureMaterial } from '../../types/schema.ts'
import { SectionTabs } from '../sheet.tsx'
import { useInSheet } from '../sheetContext.ts'
import { Chevron, Fold, Notice, NumberField, sizeText, Switch, TextField } from './shared.tsx'

type TabKey = 'placed' | 'catalog' | 'text'
interface NoticeState {
  text: string
  tone: 'ok' | 'tip'
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'placed', label: '놓인 가구' },
  { key: 'catalog', label: '가구 추가' },
  { key: 'text', label: '글로 추가' },
]
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as FurnitureCategory[]
const MATERIALS: FurnitureMaterial[] = ['wood', 'fabric', 'metal', 'white_matte', 'glass']
const MAX_SIZE_CM = 600

function addedNotice(names: string[], unplacedCount: number): NoticeState {
  const what = names.length === 1 ? `'${names[0]}'` : `가구 ${names.length}개`
  if (unplacedCount > 0) {
    return { tone: 'tip', text: `${what} 추가했어요. 빈 자리가 없어서 방 가운데에 두었으니 직접 옮겨 주세요.` }
  }
  return { tone: 'ok', text: `${what} 빈 자리에 놓았어요. 다른 가구는 그대로예요.` }
}

export default function FurniturePanel() {
  const room = useActiveRoom()
  const selectedId = useAppState((state) => state.selectedId)
  const [tab, setTab] = useState<TabKey>(room.furniture.length > 0 ? 'placed' : 'catalog')
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView({ block: "nearest" })
  }, [notice])
  // 방금 이 패널에서 추가한 가구. 추가 직후에는 탭을 바꾸지 않으려고 기억한다
  const [lastAddedId, setLastAddedId] = useState<string | null>(null)
  const [seenSelectedId, setSeenSelectedId] = useState(selectedId)
  const inSheet = useInSheet()

  // 평면도에서 가구를 고르면 [놓인 가구]를 보여 준다
  if (selectedId !== seenSelectedId) {
    setSeenSelectedId(selectedId)
    if (selectedId !== null && selectedId !== lastAddedId) setTab('placed')
  }

  function addSeeds(seeds: FurnitureSeed[]): void {
    let unplaced = 0
    let lastId: string | null = null
    for (const seed of seeds) {
      const result = actions.addFurniture(seed)
      lastId = result.id
      if (!result.placed) unplaced += 1
    }
    if (lastId === null) return
    setLastAddedId(lastId)
    setNotice(addedNotice(seeds.map((seed) => seed.name), unplaced))
  }

  return (
    <div className="space-y-4 max-lg:space-y-3">
      <h2 className="panel-title max-lg:sr-only">가구</h2>

      {inSheet ? (
        <SectionTabs
          label="가구 메뉴"
          tabs={TABS.map((entry) => ({
            key: entry.key,
            label: entry.label,
            count: entry.key === 'placed' ? room.furniture.length : undefined,
          }))}
          value={tab}
          onChange={(key) => {
            setTab(key)
            setNotice(null)
          }}
        />
      ) : (
        <div role="tablist" aria-label="가구 메뉴" className="flex gap-1 rounded-lg bg-sunken p-1">
          {TABS.map((entry) => {
            const active = entry.key === tab
            return (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={active}
                className={`h-9 min-w-0 flex-1 cursor-pointer rounded-md px-1 text-[13px] font-medium transition-colors ${
                  active ? 'bg-surface text-ink' : 'text-muted hover:text-ink'
                }`}
                onClick={() => {
                  setTab(entry.key)
                  setNotice(null)
                }}
              >
                {entry.label}
                {entry.key === 'placed' ? <span className="ml-1 tabular-nums">{room.furniture.length}</span> : null}
              </button>
            )
          })}
        </div>
      )}

      {/* 목록을 내려 둔 채 [추가]를 눌러도 보이게, 알림이 바뀌면 알림까지 올려 보여 준다 */}
      {notice ? <div ref={noticeRef}><Notice tone={notice.tone}>{notice.text}</Notice></div> : null}

      {tab === 'placed' ? (
        <PlacedList furniture={room.furniture} selectedId={selectedId} onGoAdd={() => setTab('catalog')} />
      ) : null}
      {tab === 'catalog' ? <CatalogList onAdd={(seed) => addSeeds([seed])} /> : null}
      {tab === 'text' ? <TextAdd onAdd={addSeeds} /> : null}
    </div>
  )
}

// ── 놓인 가구 ────────────────────────────────────────────────────────────
function PlacedList({
  furniture,
  selectedId,
  onGoAdd,
}: {
  furniture: FurnitureItem[]
  selectedId: string | null
  onGoAdd: () => void
}) {
  const selectedRow = useRef<HTMLLIElement | null>(null)

  // 평면도에서 고른 가구가 목록 밖에 있으면 보이는 곳으로 옮긴다
  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  if (furniture.length === 0) {
    return (
      <div className="space-y-3">
        <p className="hint">아직 놓인 가구가 없어요.</p>
        <button type="button" className="btn" onClick={onGoAdd}>
          가구 추가하기
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="hint">가구를 누르면 이름과 크기를 고칠 수 있어요.</p>
      <ul className="space-y-1.5">
        {furniture.map((item) => {
          const selected = item.id === selectedId
          return (
            <li
              key={item.id}
              ref={selected ? selectedRow : undefined}
              className={`card overflow-hidden ${selected ? 'border-accent' : ''}`}
            >
              <button
                type="button"
                className={`flex min-h-12 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left ${
                  selected ? 'bg-accent-soft' : 'hover:bg-sunken'
                }`}
                aria-expanded={selected}
                onClick={() => actions.select(selected ? null : item.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink max-lg:text-[15px] max-lg:whitespace-normal">
                    {item.name}
                  </span>
                  <span className="block text-[12px] text-muted tabular-nums max-lg:text-[13px]">
                    {CATEGORY_LABELS[item.category]} · {sizeText(item.widthCm, item.depthCm, item.heightCm)}
                  </span>
                </span>
                {item.owned ? <span className="chip">보유</span> : null}
                <Chevron open={selected} />
              </button>
              {selected ? <PlacedEditor item={item} /> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PlacedEditor({ item }: { item: FurnitureItem }) {
  /** 가로·깊이(회전 0 기준)를 바꾼다. 지금 놓인 자리의 왼쪽 위는 그대로 둔다 */
  function resize(widthCm: number, depthCm: number): void {
    const spot = footprint(item)
    const turned = item.rotation === 90 || item.rotation === 270
    actions.resizeFurniture(item.id, {
      xCm: spot.xCm,
      yCm: spot.yCm,
      widthCm: turned ? depthCm : widthCm,
      depthCm: turned ? widthCm : depthCm,
    })
  }

  return (
    <div className="space-y-3 border-t border-line px-3 py-3">
      <TextField label="이름" value={item.name} onCommit={(name) => actions.updateFurniture(item.id, { name })} />
      <div className="grid grid-cols-3 gap-2">
        <NumberField
          label="가로"
          unit="cm"
          min={20}
          max={MAX_SIZE_CM}
          value={item.widthCm}
          onCommit={(value) => resize(value, item.depthCm)}
        />
        <NumberField
          label="깊이"
          unit="cm"
          min={20}
          max={MAX_SIZE_CM}
          value={item.depthCm}
          onCommit={(value) => resize(item.widthCm, value)}
        />
        <NumberField
          label="높이"
          unit="cm"
          min={1}
          max={300}
          value={item.heightCm}
          onCommit={(heightCm) => actions.updateFurniture(item.id, { heightCm })}
        />
      </div>
      <Switch label="이미 있어요" checked={item.owned} onChange={() => actions.toggleOwned(item.id)} />
      <div className="flex gap-2">
        <button type="button" className="btn flex-1" onClick={() => actions.rotateFurniture(item.id)}>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M13 8a5 5 0 1 1-1.5-3.6" />
            <path d="M13 2.5V5h-2.5" />
          </svg>
          회전
        </button>
        <button type="button" className="btn btn-danger flex-1" onClick={() => actions.removeFurniture(item.id)}>
          삭제
        </button>
      </div>
    </div>
  )
}

// ── 목록에서 추가 ────────────────────────────────────────────────────────
function seedFromCatalog(entry: CatalogItem): FurnitureSeed {
  return {
    name: entry.name,
    category: entry.category,
    widthCm: entry.widthCm,
    depthCm: entry.depthCm,
    heightCm: entry.heightCm,
    color: entry.color,
    material: entry.material,
    clearanceFrontCm: entry.clearanceFrontCm,
    hasSharpCorner: entry.hasSharpCorner,
    estimatedKrw: entry.estimatedKrw,
    priceSource: 'estimated',
  }
}

function CatalogList({ onAdd }: { onAdd: (seed: FurnitureSeed) => void }) {
  const catalog: readonly CatalogItem[] = CATALOG
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    entries: catalog.filter((entry) => entry.category === category),
  })).filter((group) => group.entries.length > 0)
  const [openCategory, setOpenCategory] = useState<FurnitureCategory | null>(groups[0]?.category ?? null)
  const inSheet = useInSheet()

  if (groups.length === 0) return <p className="hint">고를 수 있는 가구가 아직 없어요. [글로 추가]를 써 주세요.</p>

  return (
    // 휴대폰: 종류 제목을 두 칸 격자로 놓고, 펼친 종류의 가구는 그 아래 한 줄을 다 쓴다
    <div className={inSheet ? 'grid grid-flow-dense grid-cols-2 gap-1.5' : 'space-y-1'}>
      <p className="hint col-span-full pb-1">종류를 눌러 펼친 뒤 [추가]를 누르면 빈 자리에 놓아요.</p>
      {groups.map((group) => (
        <Fold
          key={group.category}
          tile={inSheet}
          title={CATEGORY_LABELS[group.category]}
          badge={<span className="text-[12px] text-muted tabular-nums max-lg:text-[13px]">{group.entries.length}</span>}
          open={openCategory === group.category}
          onToggle={() => setOpenCategory(openCategory === group.category ? null : group.category)}
        >
          <ul className="card divide-y divide-line">
            {group.entries.map((entry) => (
              <li key={entry.key} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink max-lg:text-[15px]">{entry.name}</span>
                  <span className="block text-[12px] text-muted tabular-nums max-lg:text-[13px]">
                    {sizeText(entry.widthCm, entry.depthCm, entry.heightCm)}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn"
                  aria-label={`${entry.name} 추가`}
                  onClick={() => onAdd(seedFromCatalog(entry))}
                >
                  추가
                </button>
              </li>
            ))}
          </ul>
        </Fold>
      ))}
    </div>
  )
}

// ── 글로 추가 ────────────────────────────────────────────────────────────
interface Draft {
  key: number
  include: boolean
  seed: FurnitureSeed
}
interface TextResult {
  drafts: Draft[]
  note: string
  isFallback: boolean
}

function numberOr(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** 서버가 준 가구를 추가할 수 있는 모양으로 채운다. 빠진 값은 무난한 기본값 */
function toDraft(raw: Partial<FurnitureItem>, key: number): Draft {
  const category = CATEGORY_ORDER.find((entry) => entry === raw.category) ?? 'other'
  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim().slice(0, 40) : '새 가구'
  const seed: FurnitureSeed = {
    name,
    category,
    widthCm: numberOr(raw.widthCm, 60, 20, MAX_SIZE_CM),
    depthCm: numberOr(raw.depthCm, 60, 20, MAX_SIZE_CM),
    heightCm: numberOr(raw.heightCm, 60, 1, 300),
    estimatedKrw: numberOr(raw.price?.estimatedKrw, 0, 0, 999_999_999),
    priceSource: 'estimated',
  }
  if (typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color)) seed.color = raw.color
  const material = MATERIALS.find((entry) => entry === raw.material)
  if (material) seed.material = material
  if (typeof raw.clearanceFrontCm === 'number') seed.clearanceFrontCm = numberOr(raw.clearanceFrontCm, 0, 0, 200)
  if (typeof raw.hasSharpCorner === 'boolean') seed.hasSharpCorner = raw.hasSharpCorner
  if (raw.owned === true) seed.owned = true
  return { key, include: true, seed }
}

function TextAdd({ onAdd }: { onAdd: (seeds: FurnitureSeed[]) => void }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TextResult | null>(null)
  const [failed, setFailed] = useState(false)
  const requestNo = useRef(0)

  useEffect(
    () => () => {
      requestNo.current += 1 // 패널이 닫힌 뒤에 온 답은 버린다
    },
    [],
  )

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const query = text.trim()
    if (query === '' || loading) return
    const mine = (requestNo.current += 1)
    setLoading(true)
    setFailed(false)
    try {
      const response = await requestFurniture({ text: query })
      if (mine !== requestNo.current) return
      const items: Partial<FurnitureItem>[] = Array.isArray(response.items) ? response.items : []
      setResult({
        drafts: items.slice(0, 15).map((item, index) => toDraft(item, index)),
        note: typeof response.note === 'string' ? response.note : '',
        isFallback: response.isFallback === true,
      })
    } catch {
      if (mine !== requestNo.current) return
      setResult(null)
      setFailed(true)
    }
    setLoading(false)
  }

  function changeDraft(key: number, change: (draft: Draft) => Draft): void {
    setResult((current) =>
      current ? { ...current, drafts: current.drafts.map((draft) => (draft.key === key ? change(draft) : draft)) } : current,
    )
  }

  const chosen = result ? result.drafts.filter((draft) => draft.include) : []

  return (
    <div className="space-y-3">
      <form className="space-y-2" onSubmit={submit}>
        <label htmlFor="furniture-text" className="label">
          넣고 싶은 가구를 글로 적어 주세요
        </label>
        <input
          id="furniture-text"
          className="input"
          autoComplete="off"
          maxLength={200}
          placeholder="예: 슈퍼싱글 침대, 1200 책상"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
        <button type="submit" className="btn btn-primary w-full" disabled={loading || text.trim() === ''}>
          {loading ? '찾는 중이에요…' : '가구 찾기'}
        </button>
      </form>

      {failed ? <Notice tone="tip">가구를 찾지 못했어요. 잠시 뒤에 다시 해 주세요.</Notice> : null}

      {result ? (
        <div className="space-y-3" aria-live="polite">
          {result.isFallback ? <span className="chip chip-tip whitespace-normal">{NOTICES.fallback}</span> : null}
          {/* 칩이나 아래 안내와 같은 문장이면 한 번만 보여 준다 */}
          {result.note && result.note !== NOTICES.fallback && result.note !== NOTICES.aiEstimate ? (
            <p className="hint">{result.note}</p>
          ) : null}

          {result.drafts.length === 0 ? (
            <p className="hint">알아볼 수 있는 가구가 없었어요. 가구 이름을 쉼표로 나눠 다시 적어 주세요.</p>
          ) : (
            <>
              <p className="hint">
                {result.isFallback ? '크기를 확인하고 고친 뒤 추가해 주세요.' : `${NOTICES.aiEstimate}해요.`}
              </p>
              <ul className="space-y-2">
                {result.drafts.map((draft) => (
                  <li key={draft.key} className={`card space-y-2 p-3 ${draft.include ? '' : 'opacity-60'}`}>
                    <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm font-medium text-ink max-lg:min-h-11 max-lg:text-[15px]">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-accent max-lg:h-5 max-lg:w-5"
                        checked={draft.include}
                        onChange={() => changeDraft(draft.key, (current) => ({ ...current, include: !current.include }))}
                      />
                      <span className="min-w-0 flex-1 truncate max-lg:whitespace-normal">{draft.seed.name}</span>
                      <span className="chip">{CATEGORY_LABELS[draft.seed.category]}</span>
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <NumberField
                        label="가로"
                        unit="cm"
                        min={20}
                        max={MAX_SIZE_CM}
                        value={draft.seed.widthCm}
                        onCommit={(widthCm) =>
                          changeDraft(draft.key, (current) => ({ ...current, seed: { ...current.seed, widthCm } }))
                        }
                      />
                      <NumberField
                        label="깊이"
                        unit="cm"
                        min={20}
                        max={MAX_SIZE_CM}
                        value={draft.seed.depthCm}
                        onCommit={(depthCm) =>
                          changeDraft(draft.key, (current) => ({ ...current, seed: { ...current.seed, depthCm } }))
                        }
                      />
                      <NumberField
                        label="높이"
                        unit="cm"
                        min={1}
                        max={300}
                        value={draft.seed.heightCm}
                        onCommit={(heightCm) =>
                          changeDraft(draft.key, (current) => ({ ...current, seed: { ...current.seed, heightCm } }))
                        }
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn btn-primary w-full"
                disabled={chosen.length === 0}
                onClick={() => {
                  onAdd(chosen.map((draft) => draft.seed))
                  setResult(null)
                  setText('')
                }}
              >
                고른 가구 {chosen.length}개 추가
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

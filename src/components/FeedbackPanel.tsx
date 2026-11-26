// 3단계 피드백: 확실한 문제 / 개선 제안 / 좋은 점, 그리고 [AI 해설 듣기].
// 숫자 평가는 어디에도 없다. 판정은 코드(validator)가 했고, AI는 말로 풀어 주기만 한다.
// 휴대폰 시트에서는 칩 넷(문제 / 제안 / 좋은 점 / AI 해설)으로 나눠 한 번에 한 항목만 보여 준다.
import { useEffect, useRef, useState } from 'react'
import { NOTICES } from '../data/labels.js'
import { requestAdvice } from '../lib/api.ts'
import { actions, useActiveRoom, useAppState } from '../state/store.ts'
import type { AdviceResponse, ValidationError, ValidationResult, ValidationTip } from '../types/schema.ts'
import { Fold } from './panels/shared.tsx'
import { SectionTabs } from './sheet.tsx'
import { useInSheet } from './sheetContext.ts'

type SectionKey = 'errors' | 'tips' | 'strengths'
/** 휴대폰 시트의 칩 */
type FeedbackTab = SectionKey | 'advice'

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry !== '') : []
}

/** 문제·제안 한 줄. 관련 가구가 있으면 누를 수 있고, 누르면 첫 번째 가구를 고른다 */
function FeedbackItem({ item, selectedId }: { item: ValidationError | ValidationTip; selectedId: string | null }) {
  const isError = item.severity === 'error'
  const targetId = item.furnitureIds[0]
  const related = selectedId !== null && item.furnitureIds.includes(selectedId)
  const body = (
    <>
      <span className="flex flex-wrap items-center gap-1.5">
        <span className={`chip ${isError ? 'chip-danger' : 'chip-tip'}`}>{isError ? '문제' : '제안'}</span>
        {!isError && item.isReferenceValue ? (
          <span className="chip" title={NOTICES.reference}>
            참고값
          </span>
        ) : null}
      </span>
      <span className="mt-1.5 block text-sm leading-snug font-medium text-ink max-lg:text-[15px]">{item.title}</span>
      <span className="mt-0.5 block text-[13px] leading-relaxed text-muted max-lg:text-sm">{item.message}</span>
    </>
  )
  const look = `card block w-full px-3 py-2.5 text-left ${related ? 'border-accent' : ''}`
  if (targetId === undefined) return <div className={look}>{body}</div>
  return (
    <button
      type="button"
      className={`${look} cursor-pointer hover:bg-sunken`}
      aria-label={`${isError ? '문제' : '제안'}: ${item.title}. 누르면 관련 가구를 골라요`}
      onClick={() => actions.select(targetId)}
    >
      {body}
    </button>
  )
}

function ItemList({ items, selectedId }: { items: (ValidationError | ValidationTip)[]; selectedId: string | null }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, index) => (
        <li key={`${item.code}-${item.furnitureIds.join('-')}-${index}`}>
          <FeedbackItem item={item} selectedId={selectedId} />
        </li>
      ))}
    </ul>
  )
}

interface AdviceState {
  response: AdviceResponse
  /** 이 해설을 받을 때의 피드백. 배치가 바뀌면 낡은 해설이라고 알려 준다 */
  basedOn: ValidationResult
}

/** 마지막으로 받은 해설. 휴대폰에서는 다른 메뉴로 가면 이 화면이 닫히므로, 돌아왔을 때 AI를 다시 부르지 않고 보여 준다 */
let keptAdvice: AdviceState | null = null

function AdviceBlock() {
  const room = useActiveRoom()
  const validation = useAppState((state) => state.validation)
  const lifestyle = useAppState((state) => state.project.profile.lifestyle)
  const [loading, setLoading] = useState(false)
  const [advice, setAdviceState] = useState<AdviceState | null>(() => keptAdvice)
  const setAdvice = (next: AdviceState | null) => {
    keptAdvice = next
    setAdviceState(next)
  }
  const [failed, setFailed] = useState(false)
  const requestNo = useRef(0)

  useEffect(
    () => () => {
      requestNo.current += 1 // 화면이 닫힌 뒤에 온 답은 버린다
    },
    [],
  )

  async function ask(): Promise<void> {
    if (loading) return
    const mine = (requestNo.current += 1)
    setLoading(true)
    setFailed(false)
    try {
      const response = await requestAdvice({ room, validationResult: validation, lifestyle })
      if (mine !== requestNo.current) return
      setAdvice({
        response: {
          summary: typeof response.summary === 'string' ? response.summary : '',
          highlights: strings(response.highlights),
          improvements: strings(response.improvements),
          isFallback: response.isFallback === true,
        },
        basedOn: validation,
      })
    } catch {
      if (mine !== requestNo.current) return
      setFailed(true)
    }
    setLoading(false)
  }

  const stale = advice !== null && advice.basedOn !== validation

  return (
    <div className="space-y-3">
      <button type="button" className="btn w-full" disabled={loading} aria-busy={loading} onClick={ask}>
        {loading ? '해설을 준비하고 있어요…' : advice ? 'AI 해설 다시 듣기' : 'AI 해설 듣기'}
      </button>
      <div aria-live="polite" className="space-y-2">
        {failed ? <p className="hint">해설을 가져오지 못했어요. 위 피드백은 그대로 볼 수 있어요.</p> : null}
        {advice ? (
          <div className="card space-y-3 p-3">
            {advice.response.isFallback ? (
              <span className="chip chip-tip whitespace-normal">{NOTICES.fallback}</span>
            ) : null}
            {stale ? <p className="hint">배치가 바뀌었어요. 다시 들으면 지금 배치로 설명해 드려요.</p> : null}
            {advice.response.summary ? (
              <p className="text-sm leading-relaxed text-ink max-lg:text-[15px]">{advice.response.summary}</p>
            ) : null}
            {advice.response.highlights.length > 0 ? (
              <div>
                <h4 className="text-[13px] font-semibold text-ok max-lg:text-sm">잘된 점</h4>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-ink max-lg:text-sm">
                  {advice.response.highlights.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {advice.response.improvements.length > 0 ? (
              <div>
                <h4 className="text-[13px] font-semibold text-tip max-lg:text-sm">이렇게 바꿔 보세요</h4>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-ink max-lg:text-sm">
                  {advice.response.improvements.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function FeedbackPanel() {
  const validation = useAppState((state) => state.validation)
  const selectedId = useAppState((state) => state.selectedId)
  const [closed, setClosed] = useState<Record<SectionKey, boolean>>({ errors: false, tips: false, strengths: false })

  const errors = validation.errors
  const interiorTips = validation.tips.filter((tip) => tip.category !== 'child_safety')
  const safetyTips = validation.tips.filter((tip) => tip.category === 'child_safety')
  const strengths = validation.strengths
  const usesReference = validation.tips.some((tip) => tip.isReferenceValue)

  function toggle(key: SectionKey): void {
    setClosed((current) => ({ ...current, [key]: !current[key] }))
  }

  const inSheet = useInSheet()
  // 휴대폰: 문제가 있으면 문제부터, 없고 제안이 있으면 제안부터 보여 준다
  const [tab, setTab] = useState<FeedbackTab>(errors.length === 0 && validation.tips.length > 0 ? 'tips' : 'errors')

  const errorsBody =
    errors.length === 0 ? (
      <p className="hint px-1">확실한 문제는 찾지 못했어요. 겹치거나 막힌 곳이 없어요.</p>
    ) : (
      <ItemList items={errors} selectedId={selectedId} />
    )

  const tipsBody =
    validation.tips.length === 0 ? (
      <p className="hint px-1">지금은 따로 드릴 제안이 없어요.</p>
    ) : (
      <div className="space-y-3">
        {interiorTips.length > 0 ? <ItemList items={interiorTips} selectedId={selectedId} /> : null}
        {safetyTips.length > 0 ? (
          <div className="space-y-1.5">
            <h3 className="px-1 text-[13px] font-semibold text-tip max-lg:text-sm">{NOTICES.childSafety}</h3>
            <ItemList items={safetyTips} selectedId={selectedId} />
          </div>
        ) : null}
        {usesReference || safetyTips.length > 0 ? <p className="hint px-1">{NOTICES.reference}</p> : null}
      </div>
    )

  const strengthsBody =
    strengths.length === 0 ? (
      <p className="hint px-1">가구를 놓으면 잘된 점을 찾아 드려요.</p>
    ) : (
      <ul className="space-y-1.5 px-1">
        {strengths.map((line, index) => (
          <li key={index} className="flex gap-2 text-[13px] leading-relaxed text-ink max-lg:text-sm">
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="mt-0.5 h-4 w-4 shrink-0 text-ok"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3.5 8.5l3 3 6-7" />
            </svg>
            {line}
          </li>
        ))}
      </ul>
    )

  if (inSheet) {
    return (
      <section aria-label="배치 피드백">
        <h2 className="panel-title sr-only">피드백</h2>
        <SectionTabs
          label="피드백 메뉴"
          tabs={[
            { key: 'errors', label: '문제', count: errors.length, tone: 'danger' },
            { key: 'tips', label: '제안', count: validation.tips.length, tone: 'tip' },
            { key: 'strengths', label: '좋은 점', count: strengths.length },
            { key: 'advice', label: 'AI 해설' },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === 'errors' ? errorsBody : null}
        {tab === 'tips' ? tipsBody : null}
        {tab === 'strengths' ? strengthsBody : null}
        {/* 받아 둔 해설이 칩을 오가도 남아 있게, 지우지 않고 숨기기만 한다 */}
        <div hidden={tab !== 'advice'}>
          <AdviceBlock />
        </div>
      </section>
    )
  }

  return (
    <section aria-label="배치 피드백" className="space-y-2">
      <h2 className="panel-title">피드백</h2>

      <Fold
        title="확실한 문제"
        badge={
          <span className={`chip ${errors.length > 0 ? 'chip-danger' : ''}`}>
            {errors.length > 0 ? `문제 ${errors.length}개` : '없음'}
          </span>
        }
        open={!closed.errors}
        onToggle={() => toggle('errors')}
      >
        {errorsBody}
      </Fold>

      <div className="divider" />

      <Fold
        title="개선 제안"
        badge={
          <span className={`chip ${validation.tips.length > 0 ? 'chip-tip' : ''}`}>
            {validation.tips.length > 0 ? `제안 ${validation.tips.length}개` : '없음'}
          </span>
        }
        open={!closed.tips}
        onToggle={() => toggle('tips')}
      >
        {tipsBody}
      </Fold>

      <div className="divider" />

      <Fold
        title="좋은 점"
        badge={
          <span className={`chip ${strengths.length > 0 ? 'chip-ok' : ''}`}>
            {strengths.length > 0 ? `좋은 점 ${strengths.length}개` : '없음'}
          </span>
        }
        open={!closed.strengths}
        onToggle={() => toggle('strengths')}
      >
        {strengthsBody}
      </Fold>

      <div className="divider" />

      <div className="pt-2">
        <AdviceBlock />
      </div>
    </section>
  )
}

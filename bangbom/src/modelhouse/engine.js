/* ═══════ 판정·실부담 계산 (data/rules_reference.py 그대로 옮김 · 수치는 RULES 한 곳) ═══════ */
const ELIG = "eligible", CHECK = "needs_check", NO = "ineligible";
const ST_KO = { eligible: "요건 충족", needs_check: "확인 필요", ineligible: "미충족" };
const ST_ICON = { eligible: "●", needs_check: "◐", ineligible: "○" };
const LIGHT_KO = { on: "요건 충족", dim: "확인 필요", off: "미충족" };
const LIGHT_ICON = { on: "●", dim: "◐", off: "○" };
/* 일반 반올림(0.05 → 올림). docs/조사/data/calc3.py 의 round(x+1e-9, 1)과 같은 결과 */
const r1 = v => Math.round(v * 10 + 1e-9) / 10;
function wonK(v) { return wonFull(v); }
const wonFull = v => v == null || !isFinite(v) ? "—" : Math.round(v * 10000).toLocaleString("ko-KR") + "원";
function worse(a, b) { const o = { eligible: 0, needs_check: 1, ineligible: 2 }; return o[a] >= o[b] ? a : b; }
const fmtN = n => Number(n).toLocaleString("ko-KR");

function incomeStatus(p, annualMax, monthlyMax, deduction) {
  const est = RULES.income_estimate, gross = p.annual_income_gross;
  if (annualMax != null) {
    if (gross != null) return gross <= annualMax ? [ELIG, "입력한 연소득이 기준 이하"] : [NO, `연소득이 기준(${wonFull(annualMax)}) 초과`];
    const high = p.monthly_income * 12 * est.gross_multiplier_high, low = p.monthly_income * 12;
    if (high <= annualMax) return [ELIG, `월 실수령 기준 추정 연소득이 기준(${wonFull(annualMax)}) 이하`];
    if (low > annualMax) return [NO, `월 실수령만으로도 연소득 기준(${wonFull(annualMax)}) 초과`];
    return [CHECK, "월 실수령만으로는 연소득 기준을 판단할 수 없어요"];
  }
  if (monthlyMax != null) {
    const m = p.monthly_income, low = m * est.gross_multiplier_low * (1 - deduction), high = m * est.gross_multiplier_high * (1 - deduction);
    if (high <= monthlyMax) return [ELIG, "추정 소득인정액이 기준 이하"];
    if (low > monthlyMax) return [NO, `추정 소득인정액이 기준(월 ${wonFull(monthlyMax)}) 초과`];
    return [CHECK, "소득인정액은 복지로 모의계산으로 확인이 필요해요"];
  }
  return [ELIG, ""];
}
function personChecks(p, it) {
  const reasons = []; let status = ELIG;
  if (!(it.age_min <= p.age && p.age <= it.age_max)) return [NO, `만 ${it.age_min}~${it.age_max}세 대상 (입력 만 ${p.age}세)`];
  if (it.homeless && !p.homeless) return [NO, "무주택자만 신청할 수 있어요"];
  if (it.id === "youth_beotimok" && p.assets > 34500) return [NO, "순자산 3.45억 원 초과"];
  if (it.daegu_resident_or_moving && !p.daegu_resident_or_moving) return [NO, "대구 거주 또는 전입 예정자 대상"];
  if (it.lives_apart_from_parents && p.lives_with_parents) return [NO, "부모님과 따로 사는 청년 대상"];
  const [s, r] = incomeStatus(p, it.income_max_annual, it.income_max_monthly_recognized, it.earned_income_deduction || 0);
  status = worse(status, s); if (r) reasons.push(r);
  if (s === NO) return [NO, r];
  (it.always_needs_check || []).forEach(n => { status = worse(status, CHECK); reasons.push(`${n} 확인 필요`); });
  return [status, reasons.join(" · ") || "입력 기준 요건 충족"];
}
/* 소득 구간 금리: 세전 연소득을 넣었으면 그 구간, 없으면 월 실수령으로 추정한 연소득의 높은 쪽(보수적) */
function loanRate(ln, p) {
  if (!ln.rate_tiers) return ln.rate;
  const y = p.annual_income_gross != null ? p.annual_income_gross : p.monthly_income * 12 * RULES.income_estimate.gross_multiplier_high;
  const t = ln.rate_tiers.find(([max]) => y <= max);
  return t ? t[1] : ln.rate;
}
function profileResult(p) {
  const loans = [], policies = [];
  RULES.loans.forEach(ln => { const [s, r] = personChecks(p, ln); loans.push({ id: ln.id, name: ln.name, status: s, max_amount: ln.max_amount, rate: loanRate(ln, p), rate_label: ln.rate_label, reason: r, check_items: ln.check_items || [], always_needs_check: ln.always_needs_check || [], approval_by: ln.approval_by, source_url: ln.source_url, checked_at: ln.checked_at }); });
  const m = RULES.market_loan;
  loans.push({ id: m.id, name: m.name, status: CHECK, max_amount: m.max_amount, rate: m.rate, reason: m.reason, approval_by: m.approval_by, source_url: m.link });
  RULES.policies.forEach(po => { const [s, r] = personChecks(p, po); policies.push({ id: po.id, name: po.name, status: s, reason: r, monthly_amount: po.monthly_amount, support_rate: po.support_rate, approval_by: po.approval_by, source_url: po.source_url, checked_at: po.checked_at, always_needs_check: po.always_needs_check || [] }); });
  return { loans, policies };
}
const interest = (amount, rate) => amount * rate / 100 / 12;
/* 대출 한도 = min(최대 금액, 보증금 × LTV). 대상 보증금을 넘으면 0 */
const loanCap = (ln, c) => ln.deposit_max != null && c.deposit > ln.deposit_max ? 0 : Math.min(ln.max_amount, ln.ltv == null ? Infinity : c.deposit * ln.ltv);
function evaluate(p, c, pr) {
  const loan_needed = Math.max(0, Math.trunc(c.deposit - p.assets));
  const st = {}; [...pr.loans, ...pr.policies].forEach(x => st[x.id] = x.status);
  const pol = {}; RULES.policies.forEach(x => pol[x.id] = x);
  const market = RULES.market_loan, yr = pol.youth_monthly_rent;
  /* 청년월세: 월세가 있는 단지만, 월 min(월세, 20만) */
  const rentSup = yr && c.rent > 0 && st[yr.id] !== NO ? Math.min(c.rent, yr.monthly_amount) : 0, rentStatus = rentSup ? st[yr.id] : null;
  const combos = [], caps = [], base = c.rent + c.mgmt;
  const add = (status, li, label, used, rate, calc) => {
    combos.push({ status, net: r1(base + li), li, label, rate, calc, used, rentSup: 0 });
    if (rentStatus) combos.push({ status: worse(status, rentStatus), net: r1(base + li - rentSup), li, label: label + " + 청년월세지원", rate, calc, used: [...used, yr.id], rentSup });
  };
  const simple = (rate, tag) => `${wonK(loan_needed)} × ${rate}%${tag || ""} ÷ 12`;
  if (loan_needed === 0) add(ELIG, 0, "대출 없이", [], 0, "대출 없음");
  else {
    RULES.loans.forEach(ln => {
      if (!ln.applies_to.includes(c.supply_type) || st[ln.id] === NO) return;
      const cap = loanCap(ln, c); caps.push(cap);
      if (loan_needed <= cap) { const rt = loanRate(ln, p); add(st[ln.id], interest(loan_needed, rt), ln.name, [ln.id], rt, simple(rt, ln.rate_tiers ? (p.annual_income_gross != null ? "(소득 구간)" : "(추정 소득 구간)") : "")); }
    });
    const mcap = loanCap(market, c); caps.push(mcap);
    if (loan_needed <= mcap) {
      add(CHECK, interest(loan_needed, market.rate), "시중 전세대출", [market.id], market.rate, simple(market.rate));
      const di = pol.daegu_interest;
      if (di && st[di.id] !== NO && c.deposit <= di.deposit_max) {
        /* 지원은 min(대출, 보증금×90%, 1억)까지. 남는 대출은 시중금리(방봄 가정) */
        const sup = Math.min(loan_needed, c.deposit * di.support_ltv, di.support_max), own = Math.max(market.rate - di.support_rate, di.min_rate), rest = loan_needed - sup;
        add(CHECK, interest(sup, own) + interest(rest, market.rate), "시중 전세대출 + 대구 청년 이자지원", [market.id, di.id], own,
          `${wonK(sup)} × ${own}%${rest > 0 ? ` + ${wonK(rest)} × ${market.rate}%` : ""} ÷ 12`);
      }
    }
  }
  const elig = combos.filter(x => x.status === ELIG);
  const eBest = elig.length ? elig.reduce((a, b) => b.net < a.net ? b : a) : null;
  const best = combos.length ? combos.reduce((a, b) => b.net < a.net ? b : a) : null;
  const worst = combos.length ? r1(base + interest(loan_needed, market.rate)) : null;
  const maxCap = Math.max(0, ...caps), shortfall = combos.length ? 0 : loan_needed - maxCap;
  const budget = p.monthly_budget;
  let light, reason, chosen;
  if (eBest && eBest.net <= budget) { light = "on"; chosen = eBest; reason = `${eBest.label} 요건 충족 기준으로 월 ${wonFull(eBest.net)}, 예산 안이에요`; }
  else if (best && best.net <= budget) { light = "dim"; chosen = best; reason = `${best.label}(확인 필요)을 받으면 월 ${wonFull(best.net)}으로 예산 안이에요`; }
  else {
    light = "off"; chosen = best;
    reason = !combos.length ? `자기자금이 ${wonK(shortfall)} 부족해요 (보증금 ${wonK(c.deposit)} 중 대출은 최대 ${wonK(maxCap)}까지 기준)`
      : `지원을 모두 받아도 월 ${wonFull(best.net)}으로 예산보다 ${wonFull(best.net - budget)} 많아요`;
  }
  if (c.supply_type === "lh_dundeun") reason += ` · ${RULES.badges.dundeun}`;
  /* 다른 선택: 고른 조합과 다른 대출·지원 묶음 중 가장 낮은 것부터 */
  const key = x => x.used.filter(u => u !== "youth_monthly_rent").join("+");
  const alts = chosen ? combos.filter(x => key(x) !== key(chosen)).sort((a, b) => a.net - b.net).filter((x, i, arr) => arr.findIndex(y => key(y) === key(x)) === i) : [];
  return { id: c.id, loan_needed, shortfall, light, light_reason: reason, net_monthly: eBest ? eBest.net : null, net_monthly_best: best ? best.net : null, net_monthly_worst: worst, financing: chosen ? chosen.label : null, chosen, alts, combos, rentSup };
}
function breakdown(c, ev) {
  const ch = ev.chosen; if (!ch) return null;
  return { rent: c.rent, mgmt: c.mgmt, loan_needed: ev.loan_needed, rate: ch.rate, calc: ch.calc, loan_interest: r1(ch.li), rent_support: ch.rentSup || 0, total: ch.net, financing: ch.label };
}
function appliedLists(c, ev, pr) {
  const all = {}; [...pr.loans, ...pr.policies].forEach(x => all[x.id] = x);
  const used = ev.chosen ? ev.chosen.used : [];
  const applied = used.map(id => all[id]).filter(Boolean);
  const not_applied = [];
  pr.policies.forEach(po => {
    if (used.includes(po.id)) return;
    if (po.status === NO) { not_applied.push({ id: po.id, name: po.name, reason: po.reason }); return; }
    if (po.id === "daegu_interest" && c.deposit > RULES.policies.find(x => x.id === po.id).deposit_max) not_applied.push({ id: po.id, name: po.name, reason: "보증금이 대구 이자지원 기준(250,000,000원)을 넘어요" });
    else if (po.id === "daegu_interest" && (used.includes("youth_beotimok") || used.includes("hf_youth_guarantee"))) not_applied.push({ id: po.id, name: po.name, reason: "버팀목·HF 특례보증과는 둘 중 하나만 받을 수 있어요" });
    else if (po.id === "daegu_interest" && ev.loan_needed === 0) not_applied.push({ id: po.id, name: po.name, reason: "대출이 필요 없어 해당 없음" });
    else if (po.id === "youth_monthly_rent" && c.rent === 0) not_applied.push({ id: po.id, name: po.name, reason: "월세가 없는 전세 단지라 해당 없음" });
    else if (!ev.chosen) not_applied.push({ id: po.id, name: po.name, reason: "자기자금이 모자라 계산하지 못했어요" });
    else not_applied.push({ id: po.id, name: po.name, reason: "더 낮은 조합이 있어 이번 계산에선 빠졌어요" });
  });
  return { applied, not_applied };
}
/* 중개수수료 지원 배지: 월 부담에는 넣지 않음(팀 결정). 거래금액 = 보증금 + 월세×100
   shortcut: 거래금액 5천만 미만이면 ×70 규칙은 생략, 월세 단지가 생기면 보강 */
function brokerageBadge(p, c) {
  const b = RULES.badges.brokerage;
  return !!p && p.daegu_resident_or_moving && p.age >= b.age_min && p.age <= b.age_max && c.deposit + c.rent * 100 <= b.deal_max;
}
/* 전세 안전: 시세·선순위채권이 둘 다 있을 때만 판정, 없으면 null(체크리스트만) */
function safetyCheck(c) {
  if (c.market_price == null || c.senior_debt == null) return null;
  const ratio = (c.deposit + c.senior_debt) / c.market_price;
  return { ratio: r1(ratio * 100), status: ratio > 0.9 ? CHECK : ELIG };
}
/* 매매로 보면: sale_price가 있는 단지만. 생애최초·미혼 단독세대주로 가정하고 그 가정은 확인 필요로 표시 */
function saleCalc(p, c) {
  if (!c.sale_price || !p) return null;
  const R_ = RULES.sale, d = R_.didimdol, b = R_.bogeumjari, price = c.sale_price, first = !!p.homeless;
  const notes = ["생애최초·미혼 단독세대주로 가정했어요(확인 필요)"];
  let [ds, dr] = personChecks(p, Object.assign({}, d, { income_max_annual: first ? d.income_max_first : d.income_max_annual }));
  if (ds !== NO && (c.area_m2 > d.area_max || price > d.price_max)) [ds, dr] = [NO, `${d.area_max}㎡·평가액 ${wonK(d.price_max)} 이하 주택만 돼요`];
  else if (ds !== NO && p.age >= 30 && (c.area_m2 > d.single30_area || price > d.single30_price)) [ds, dr] = [NO, `만 30세 이상 미혼 단독세대주는 ${d.single30_area}㎡·${wonK(d.single30_price)} 이하만 돼요`];
  else if (ds !== NO && p.age < 30) [ds, dr] = [worse(ds, CHECK), "만 30세 미만 단독세대주는 부양 요건을 확인해야 해요"];
  const dRate = Math.max(d.rate_top - Math.min(d.unsold_pref + (first ? d.first_pref : 0), d.pref_cap), d.rate_floor);
  const tax = price * R_.tax_rate / 100;
  const unsoldCut = c.area_m2 <= R_.unsold_tax_area && price <= R_.unsold_tax_price ? Math.min(tax * R_.unsold_tax_cut, R_.unsold_tax_cap) : 0, firstCut = first ? Math.min(tax, R_.first_tax_cap) : 0;
  const cut = Math.max(unsoldCut, firstCut);
  const cutLabel = !cut ? "감면 없음" : unsoldCut >= firstCut ? "대구 준공 후 미분양 감면 · 한도 적용 여부 확인 필요, 분양사에게서 처음 살 때만" : "생애최초 감면 · 미분양 감면과 중복 여부가 정해지지 않아 큰 쪽 하나만 넣었어요";
  let loanP = null;
  if (ds !== NO) loanP = { id: d.id, name: d.name, status: ds, reason: dr, rate: dRate, rate_label: `${d.rate_label} → 계산 ${dRate}%(최대 기준 − 우대)`, cap: Math.min(price * (first ? d.ltv_first : d.ltv), first ? d.limit_first : d.limit) };
  else if (price <= b.price_max) loanP = { id: b.id, name: b.name, status: CHECK, reason: "금리·한도는 한국주택금융공사 심사로 정해져요", rate: b.rate, rate_label: `${b.rate_label} → 계산 ${b.rate}%(최대 기준)`, cap: Math.min(price * (first ? b.ltv_first : b.ltv), first ? b.limit_first : b.limit) };
  const loan = loanP ? Math.min(loanP.cap, Math.max(0, price + tax - cut - p.assets)) : 0;
  const own_needed = price + tax - cut - loan, shortfall = Math.max(0, own_needed - p.assets);
  const r = loanP ? loanP.rate / 100 / 12 : 0, n = R_.years * 12, pmt = loan && r ? loan * r / (1 - Math.pow(1 + r, -n)) : 0;
  return { price, source: c.sale_source, source_url: c.sale_source_url, didimdol: { status: ds, reason: dr }, loanP, loan: Math.round(loan), pmt: r1(pmt), monthly: r1(pmt + c.mgmt), tax: r1(tax), cut: r1(cut), cutLabel, own_needed: Math.round(own_needed), shortfall: Math.round(shortfall), notes };
}

/* ═══════ 가까운 시설 (카테고리마다 가장 가까운 1곳) ═══════ */
function haversine(a, b) { const R = 6371, t = Math.PI / 180, dLa = (b.lat - a.lat) * t, dLo = (b.lng - a.lng) * t; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
const CATS = ["subway", "hospital", "mall", "culture", "university", "park", "office"];
function nearbyOf(c) {
  return CATS.map(cat => {
    let best = null;
    INFRA.filter(i => i.category === cat).forEach(i => { const km = haversine(c, i) * 1.3; if (!best || km < best.km) best = { i, km }; });
    if (!best) return null;
    const km = Math.round(best.km * 10) / 10, walk = km <= 1.5 ? Math.round(km * 15) : null, drive = km > 1.5 ? Math.round(km * 3 + 3) : null;
    return { infra_id: best.i.id, name: best.i.name, category: cat, distance_km: km, walk_min: walk, drive_min: drive, map_x: best.i.map_x, map_z: best.i.map_z };
  }).filter(Boolean);
}
if (typeof module !== "undefined") module.exports = { profileResult, evaluate, breakdown, appliedLists, saleCalc, safetyCheck, brokerageBadge };

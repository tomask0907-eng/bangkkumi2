{
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const HAS3D = typeof window.THREE !== "undefined";
const T3 = window.THREE;
const isMobile = () => innerWidth < 768;
/* 휴대폰 화면(폭 820px 이하). mobile_app.css 의 @media 와 같은 기준이다 */
const PHONE = matchMedia("(max-width:820px)");
const isPhone = () => PHONE.matches;
const won = n => Math.round(n).toLocaleString("ko-KR");
const man1 = n => n == null ? "—" : (Math.round(n * 10) / 10).toFixed(1);
function toast(m) { const t = $("#mhToast"); t.textContent = m; t.classList.add("is-on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("is-on"), 2400); }

/* ─── 상태 ─── */
const PERSONA = { age: 27, monthly_income: 250, annual_income_gross: null, assets: 4500, homeless: true, lives_with_parents: false, daegu_resident_or_moving: true, monthly_budget: 60, priorities: [] };
const S = { mode: "browse", profile: null, pr: null, evals: {}, sel: null, hover: null, chk: {} };
try { const raw = localStorage.getItem("mh-profile"); if (raw) { S.profile = JSON.parse(raw); } } catch (e) {}
const COMPLEX = COMPLEXES.map(c => Object.assign({}, c, { nearby: nearbyOf(c) }));
function recompute() {
  if (!S.profile) { S.pr = null; S.evals = {}; return; }
  S.pr = profileResult(S.profile); S.evals = {};
  COMPLEX.forEach(c => { S.evals[c.id] = evaluate(S.profile, c, S.pr); });
}
function counts() { const n = { on: 0, dim: 0, off: 0 }; Object.values(S.evals).forEach(e => n[e.light]++); return n; }
function minNet() { const v = Object.values(S.evals).map(e => e.net_monthly).filter(x => x != null); return v.length ? Math.min(...v) : null; }
recompute();

/* ─── 라우팅: 방봄 셸이 #input #map #house 일 때 호출 ─── */
let VIEW = null;
/* 적던 값이 있으면(formDirty) 입력 화면을 나갔다 와도 지우지 않는다. 제출하면 다시 저장된 조건으로 채운다 */
let formDirty = false;
/* 지도를 못 그릴 때 지도 자리에 넣는 안내. 위 막대와 요약 줄에 가려지지 않게 화면 가운데에 둔다 (모양은 build.py 의 .map-fail) */
const mapFail = why => { $("#mapWrap").innerHTML = `<p class="map-fail"><span>${why}</span></p>`; };
function route(v) {
  /* 화면이 바뀌면 상담 서랍을 닫는다. 휴대폰에서는 서랍이 화면 전체를 덮어서, 안 닫으면 옮겨 간 화면이 보이지 않는다 */
  if (v !== VIEW) Consult.close(true);
  VIEW = v;
  $("#mh").hidden = !v;
  /* 휴대폰에서 집 보기·조건 입력은 아래 탭 막대를 숨기고 그 자리까지 쓴다 (mobile_app.css) */
  document.body.classList.toggle("house-mode", v === "house");
  document.body.classList.toggle("input-mode", v === "input");
  if (!v) { House.close(); return; }
  /* WebGL 을 못 쓰는 브라우저에서는 three.js 가 오류를 던진다. 지도 자리만 안내로 바꾸고 조건 입력·집 보기·상담은 그대로 쓰게 한다 */
  if (!MapView.ok && !MapView.dead) { try { MapView.init(); } catch (e) { MapView.dead = true; mapFail("이 브라우저에서는 3D 지도를 그릴 수 없어요. 조건 입력과 집 보기, 상담은 그대로 쓸 수 있어요. 홈의 평면 카드에서 집을 골라 보세요."); } }
  if (v === "house" && !S.sel) S.sel = "c01";
  $("#vInput").hidden = v !== "input";
  const house = v === "house";
  $("#houseView").classList.toggle("is-on", house);
  house ? House.open(S.sel) : House.close();
  if (v === "input" && !formDirty) { fillForm(S.profile || null); Step.go(0, false); }
  if (v !== "map") Consult.fit();
  renderTop(v); renderPanels();
}

/* ─── 상단 ─── */
function renderTop(v) {
  const per = {}; COMPLEX.forEach(c => per[c.district] = (per[c.district] || 0) + 1);
  $("#dnav").innerHTML = v === "house" || !MapView.ok ? "" : DISTRICTS.filter(d => per[d[0]]).map(d => `<button data-dx="${d[1]}" data-dz="${d[2]}">${d[0]}<b>${per[d[0]]}</b></button>`).join("");
  $$("#dnav button").forEach(b => b.addEventListener("click", () => { if (location.hash !== "#map") location.hash = "#map"; MapView.fly(+b.dataset.dx, +b.dataset.dz, 40); }));
  $("#topRight").innerHTML = v === "house" ? "" : S.profile && S.mode === "match"
    ? `<button class="btn btn--ghost btn--sm" id="tEdit">조건 바꾸기</button><button class="btn btn--ghost btn--sm" id="tBrowse">둘러보기 모드</button>`
    : `<button class="btn btn--sm" id="tMatch">${S.profile ? "내 조건으로 보기" : "정보 입력하기"}</button>`;
  const e = $("#tEdit"), b = $("#tBrowse"), m = $("#tMatch");
  if (e) e.onclick = () => location.hash = "#input";
  if (b) b.onclick = () => setMode("browse");
  if (m) m.onclick = () => S.profile ? setMode("match") : (location.hash = "#input");
}
function setMode(m) { S.mode = m; MapView.applyMode(true); renderTop("map"); renderPanels(); if (location.hash !== "#map") location.hash = "#map"; }

/* ─── 왼쪽 패널 / 범례 / 숫자 알약 ─── */
let jpOpen = false, plOpen = true;
function syncPl() { const b = $("#plToggle"); /* 휴대폰에서는 한 줄 요약이라 접기 단추(−) 없이 늘 보여 준다 */ const vis = VIEW === "map" && (plOpen || isPhone()) && !document.body.classList.contains("card-open"); $("#panelL").hidden = !vis; b.hidden = VIEW !== "map"; b.textContent = plOpen ? "−" : "+"; b.setAttribute("aria-expanded", plOpen); b.setAttribute("aria-label", plOpen ? "패널 닫기" : "패널 열기"); }

function renderPanels() {
  const v = VIEW || "map";
  const onMap = v === "map";
  $("#legend").hidden = !onMap; $("#mapHint").hidden = !onMap || !MapView.ok; $("#pillsR").hidden = true;
  /* 지도를 떠나면 카드를 닫고, 고른 단지의 선과 주변 시설 이름표도 지운다 (돌아왔을 때 닫힌 카드와 어긋나지 않게). S.sel 은 집 보기가 쓰므로 둔다 */
  if (!onMap) { closeCard(); if (MapView.ok) MapView.showLines(null); }
  if (S.mode === "match" && S.pr) {
    const n = counts(), tot = n.on + n.dim + n.off || 1;
    const row = x => `<div class="jp-row" role="button" tabindex="0"><span class="ico ${x.status}">${ST_ICON[x.status]}</span><span class="nm">${esc(x.name)}</span><span class="st st--${x.status}">${ST_KO[x.status]}</span>
      <span class="jp-more">${esc(x.reason)}${x.rate_label ? `<br>금리 ${esc(x.rate_label)}` : ""}${x.check_items && x.check_items.length ? `<br>직접 확인할 것: ${esc(x.check_items.join(", "))}` : ""}<br>최종 결정: ${esc(x.approval_by)}${x.source_url ? ` · <a href="${esc(x.source_url)}" target="_blank" rel="noopener" style="pointer-events:auto">출처</a>` : ""}${x.checked_at ? ` · 확인일 ${esc(x.checked_at)}` : " · 기준일 확인 전(시연용)"}</span></div>`;
    $("#panelL").innerHTML = `<button class="x pl-x" aria-label="패널 닫기"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 3l10 10M13 3L3 13"/></svg></button><div class="jp${jpOpen ? " is-open" : ""}"><button class="jp-line m-only" id="jpLine" aria-expanded="${jpOpen}"><span>요건 충족 <b>${n.on}</b> · 확인 필요 <b>${n.dim}</b> · 미충족 <b>${n.off}</b></span><i>${jpOpen ? "접기" : "펼치기"}</i></button><span class="eyebrow-s">Your result</span><div class="jp-head"><h2>내 조건 판정</h2><button class="jp-fold" id="jpFold">${jpOpen ? "접기" : "대출·지원 보기"}</button></div>
      <div class="jp-list" ${jpOpen ? "" : "hidden"}>
        <p class="jp-date">기준 ${esc(RULES.version)} · 공고 확인값 + 가정치(시중금리 4.5% 등)</p>
        <p class="jp-sec">대출</p>${S.pr.loans.map(row).join("")}
        <p class="jp-sec">지원</p>${S.pr.policies.map(row).join("")}
      </div>
      <div class="bar3" aria-hidden="true"><span style="width:${n.on / tot * 100}%;background:var(--teal)"></span><span style="width:${n.dim / tot * 100}%;background:var(--glow)"></span><span style="width:${n.off / tot * 100}%;background:#CFCAC1"></span></div>
      <p class="bar3-txt"><b style="color:var(--green)">●</b> 요건 충족 ${n.on} · ◐ 확인 필요 ${n.dim} · <span class="muted">○ 미충족 ${n.off}</span></p>
      <div class="jp-btns"><button class="btn btn--ghost btn--sm m-only" id="jpEdit">조건 바꾸기</button><button class="btn btn--ghost btn--sm m-only" id="jpBrowse">둘러보기 모드</button><button class="btn btn--sm" id="jpConsult">상담 이어가기 →</button></div></div>`;
    $$(".jp-row").forEach(r => { const t = () => r.classList.toggle("is-open"); r.addEventListener("click", t); r.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); t(); } }); });
    /* 패널을 새로 그려도 누른 단추에 초점이 남게 한다 (키보드로 쓸 때 초점이 사라지지 않게) */
    $("#jpFold").onclick = $("#jpLine").onclick = e => { const id = e.currentTarget.id; jpOpen = !jpOpen; renderPanels(); $("#" + id).focus({ preventScroll: true }); };
    $("#jpEdit").onclick = () => location.hash = "#input"; $("#jpBrowse").onclick = () => setMode("browse");
    $("#panelL").dataset.mode = "match";
    $("#jpConsult").onclick = () => { Consult.open(); Consult.ask("내 판정 결과 쉽게 설명해 줘"); };
    const mn = minNet();
    $("#pillsR").innerHTML = `<span class="pill-n">모은 돈 <b>${wonFull(S.profile.assets)}</b></span><span class="pill-n">월 예산 <b>${wonFull(S.profile.monthly_budget)}</b></span>${mn != null ? `<span class="pill-n">지원 반영 최저 <b>월 ${wonFull(mn)}</b></span>` : ""}`;
    $("#legend").innerHTML = "";
  } else {
    $("#panelL").innerHTML = `<button class="x pl-x" aria-label="패널 닫기"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 3l10 10M13 3L3 13"/></svg></button><div class="jp jp--browse"><span class="eyebrow-s">Browse</span><h2>대구 미분양 ${COMPLEX.length}곳</h2><p class="muted small" style="margin-top:4px">${MapView.ok ? "단지를 누르면 주변 시설과 집 정보가 보여요" : "조건을 넣으면 대출·지원 판정은 볼 수 있어요"}</p><p class="muted small" style="margin-top:4px"><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#c99a6b;margin-right:6px"></i>작은 점 ${UNSOLD_LIST.length}곳: 대구시 공개 미분양 목록(2026.9.30) + 언론 보도 단지, 판정 없음</p>
      <div class="jp-btns"><button class="btn btn--sm" id="bMatch">${S.profile ? "내 조건으로 보기" : "내 조건 넣고 불 켜기"} →</button></div></div>`;
    $("#bMatch").onclick = () => S.profile ? setMode("match") : (location.hash = "#input");
    $("#panelL").dataset.mode = "browse";
    $("#legend").innerHTML = "";
  }
  bindPl();
}
function bindPl() { const x = $("#panelL .pl-x"); if (x) x.onclick = () => { plOpen = false; syncPl(); }; syncPl(); }
function legendCats() { return Object.keys(CAT_KO).map(k => `<span class="cat"><i style="background:${CAT_LIGHT[k]}"></i>${CAT_KO[k]}</span>`).join(""); }

/* ─── 단지 카드 ─── */
function whyLine(c) {
  const w = WHY[c.id]; if (!w) return "";
  const built = w.built ? `${w.built}년 준공${c.is_sample ? "(예시)" : ""}` : "준공 연도 확인 중";
  return `<p class="why-line"><b>왜 이 집?</b> ${built} · ${LANDLORD_KO[c.supply_type]} · ${w.note ? esc(w.note) : `주변 시세 대비 약 ${w.below}% 낮음(예시)`}</p>`;
}
/* ─── 단지 카드 ───
   PC 는 접는 목록 그대로다. 휴대폰(폭 820px 이하)은 같은 내용을 아래 시트에 넣고 칩으로 한 번에 한 항목만 보여 준다.
   칩 줄(.cc-chips)과 data-pane 은 PC 에서 쓰지 않는다 (mobile_app.css) */
function cardHTML(id) {
  const c = COMPLEX.find(x => x.id === id), ev = S.evals[id], match = S.mode === "match" && ev;
  const pr = (S.profile && S.profile.priorities) || [], near = c.nearby.slice().sort((a, b) => pr.includes(b.category) - pr.includes(a.category)).map(n => `<li><span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${CAT_DARK[n.category]};margin-right:6px"></i>${esc(n.name)} · ${n.walk_min != null ? `도보 ${n.walk_min}분` : `차 ${n.drive_min}분`}</span></li>`).join("");
  const mg = c.mgmt_known ? `${wonFull(c.mgmt)}` : `미확인 (추정 ${wonFull(c.mgmt)})`;
  const noteText = c.room_id === "room_84a" && c.area_m2 !== 84 ? `집 보기는 ${c.area_m2}㎡ 평면이 아직 없어 84㎡ 구조로 대신 보여줘요.` : "";
  const roomNote = noteText ? `<p class="small muted pc-only" style="margin-top:6px">${noteText}</p>` : "", roomNoteM = noteText ? `<p class="small muted m-only" style="margin-top:10px">${noteText}</p>` : "";
  const bd = match ? breakdown(c, ev) : null;
  const panes = [["sum", "요약"], bd && ["calc", "계산 내역"], match && ["sup", "지원"], match && ["chk", "체크리스트"], ["safe", "전세 안전"], c.sale_price && ["sale", "매매"], ["near", "주변 시설"], match && ["link", "링크"], ["plan", "평면"]].filter(Boolean);
  let head = `<div class="cc-plan" data-pane="plan">${planSVG(buildLayout(c.room_id || "room_84a"))}<span class="cc-plan-tag">평면 예시 · ${c.area_m2}㎡</span></div><div class="cc-top"><div><span class="eyebrow-s">${c.is_sample ? "Sample complex" : "Complex"}</span>${match ? `<span class="st st--${ev.light}">${LIGHT_ICON[ev.light]} ${LIGHT_KO[ev.light]}</span>` : ""}<h2 style="margin-top:${match ? 8 : 0}px">${esc(c.name)}</h2>
    <div class="tags"><span class="tag">${SUPPLY_KO[c.supply_type]}</span><span class="tag">${esc(c.district)}</span><span class="tag">${c.area_m2}㎡</span>${c.supply_type === "lh_dundeun" ? '<span class="tag">공고·추첨</span>' : ""}${c.is_sample ? '<span class="sample">예시</span>' : ""}${match && brokerageBadge(S.profile, c) ? `<span class="tag">${esc(RULES.badges.brokerage.text)}</span>` : ""}</div>${!c.is_sample && c.source_url ? `<p class="small muted" style="margin-top:6px">보증금 출처: <a href="${esc(c.source_url)}" target="_blank" rel="noopener">${esc(c.source)}</a> · 확인일 ${esc(c.checked_at)}</p>` : ""}${whyLine(c)}</div>
    <button class="x" id="ccX" aria-label="카드 닫기"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 3l10 10M13 3L3 13"/></svg></button></div>
    <div class="cc-chips m-only" role="tablist" aria-label="단지 정보 항목">${panes.map(p => `<button type="button" class="chip" role="tab" data-tab="${p[0]}">${p[1]}</button>`).join("")}</div>`;
  let body = `<div class="cc-panes">`;
  if (match) {
    const al = appliedLists(c, ev, S.pr);
    const main = ev.net_monthly != null ? ev.net_monthly : ev.net_monthly_best;
    body += ev.shortfall ? `<div class="cc-sum" data-pane="sum"><p class="big">자기자금이 모자라요<b class="is-off">${wonK(ev.shortfall)} 부족</b>보증금 ${wonK(c.deposit)} − 모은 돈 ${wonK(S.profile.assets)} = 필요 대출 ${wonK(ev.loan_needed)}</p>`
      : `<p class="big">지원 반영 후 월 부담<b class="${ev.light === "off" ? "is-off" : ""}">월 ${wonFull(main)}</b>
      ${ev.net_monthly == null && ev.net_monthly_best != null ? "요건 충족 지원만으로는 어려워요 · 확인 필요까지 받을 때 기준<br>" : ""}지원 모두 받으면 ${wonFull(ev.net_monthly_best)} · 하나도 못 받으면 ${wonFull(ev.net_monthly_worst)}</p>
      ${ev.alts.length ? `<p class="small muted" style="margin-top:6px">다른 선택: ${ev.alts.slice(0, 2).map(a => `${esc(a.label)} 월 ${wonFull(a.net)}(${ST_KO[a.status]})`).join(" · ")}</p>` : ""}`;
    body += `<p class="why">${esc(ev.light_reason)}</p>${roomNoteM}</div>`;
    if (bd) body += `<details class="fold" data-pane="calc"><summary>계산 내역</summary><table class="calc"><tbody>
      <tr><td>월세</td><td>${wonFull(bd.rent)}</td></tr><tr><td>관리비${c.mgmt_known ? "" : " (추정)"}</td><td>${wonFull(bd.mgmt)}</td></tr>
      <tr><td>보증금 대출이자<br><span class="muted">${esc(bd.calc)}</span></td><td>${wonFull(bd.loan_interest)}</td></tr>
      <tr><td>월세 지원</td><td class="neg">−${wonFull(bd.rent_support)}</td></tr>
      <tr class="tot"><td>월 실부담 · ${esc(bd.financing)}</td><td>${wonFull(bd.total)}</td></tr></tbody></table>
      <p class="small muted" style="margin-top:6px">실부담 = 월세 + 관리비 + 보증금 대출이자 − 월세지원 − 이자지원 (이자지원은 금리에서 빼서 계산). 중개수수료 지원은 1회라 월 부담에 넣지 않고 배지로만 보여줘요.</p></details>`;
    body += `<details class="fold" data-pane="sup"><summary>적용 지원 · 빠진 지원</summary><ul class="lst">${al.applied.map(a => `<li><span>${esc(a.name)}</span><span class="st st--${a.status}">${ST_KO[a.status]}</span></li>`).join("") || "<li><span>대출·지원 없이 계산</span><span></span></li>"}
      ${al.not_applied.map(a => `<li><span class="muted">${esc(a.name)}</span><span style="white-space:normal;text-align:right">${esc(a.reason)}</span></li>`).join("")}</ul></details>`;
    body += `<details class="fold" data-pane="chk"><summary>계약 전 체크리스트</summary><ul class="chk">${RULES.fixed_checklist.concat(["등기부등본으로 소유자·근저당 확인", "전세보증보험 가입 가능 여부 확인"]).map((t, i) => `<li><label><input type="checkbox" data-ck="${c.id}-${i}"${S.chk[c.id + "-" + i] ? " checked" : ""}>${esc(t)}</label></li>`).join("")}</ul></details>`;
    const links = [...(APPLY_LINKS[c.supply_type] || []), ...al.applied.map(a => ({ label: a.name.replace("(시연용)", "") + " 안내", url: a.source_url }))];
    body += `<details class="fold" data-pane="link"><summary>신청·문의 링크</summary><div class="links">${links.map(l => l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>` : `<span>${esc(l.label)} · 공고 확인 중</span>`).join("")}</div></details>`;
  } else {
    body += `<div class="cc-sum" data-pane="sum"><p class="big">보증금<b>${wonK(c.deposit)}</b>${c.rent ? `월세 ${wonFull(c.rent)}` : "월세 없음 (전세)"} · 관리비 ${mg}</p><p class="why">내 조건을 넣으면 대출·지원을 반영한 실제 월 부담을 계산해 드려요.</p>${roomNoteM}</div>`;
  }
  body += safetyHTML(c) + saleHTML(c, match ? (ev.shortfall ? null : (ev.net_monthly != null ? ev.net_monthly : ev.net_monthly_best)) : null);
  body += `<details class="fold" data-pane="near"><summary>가까운 시설</summary><p class="pane-h m-only">가까운 시설</p><ul class="lst">${near}</ul><p class="small muted" style="margin-top:6px">거리는 직선거리 × 1.3으로 추정했어요. 시설 위치는 실제 위치예요(OpenStreetMap·Wikidata).</p></details>`;
  body += roomNote;
  body += `<p class="small muted" style="margin-top:10px">실제 평면도는 <a class="link" href="https://www.zigbang.com/home/apt/" target="_blank" rel="noopener">직방에서 이 단지 찾아보기 ↗</a> (새 창)</p></div><div class="cc-btns"><a href="#house" class="btn" id="ccHouse">집 보기 →</a>${match ? `<button class="btn btn--ghost" id="ccConsult">이 단지 상담하기</button>` : `<button class="btn btn--ghost" id="ccMatch">내 조건으로 보기</button>`}</div>`;
  return `<div class="cc">${head}${body}</div>`;
}
/* 휴대폰 시트에서 칩으로 고른 항목 하나만 보여 준다. 접는 목록(details)은 고른 것만 펼친다 */
function setTab(t) {
  const cc = $("#panelR .cc"); if (!cc) return;
  if (!$(`.cc-chips [data-tab="${t}"]`, cc)) t = "sum";
  S.tab = t; cc.dataset.tab = t;
  $$(".cc-chips button", cc).forEach(b => { const on = b.dataset.tab === t; b.classList.toggle("is-on", on); b.setAttribute("aria-selected", on); });
  if (!isPhone()) return;
  const d = $(`details[data-pane="${t}"]`, cc); if (d) d.open = true;
  $(".cc-panes", cc).scrollTop = 0;
  const on = $(".cc-chips .is-on", cc), row = on.parentElement;
  if (row.scrollWidth > row.clientWidth) row.scrollTo({ left: on.offsetLeft - 16, behavior: REDUCED ? "auto" : "smooth" });
}
function safetyHTML(c) {
  const sc = safetyCheck(c);
  return `<details class="fold" data-pane="safe"><summary>전세 안전 확인</summary>${sc ? `<p class="small" style="margin-bottom:8px"><span class="st st--${sc.status}">${ST_KO[sc.status]}</span> 보증금 + 선순위채권이 시세의 ${sc.ratio}%예요</p>` : `<p class="small muted" style="margin-bottom:8px">이 단지는 시세·선순위채권 자료가 없어 판정하지 않고 체크리스트만 보여줘요.</p>`}
    <ul class="lst">${RULES.safety_checklist.map(t => `<li><span>${esc(t)}</span></li>`).join("")}<li><span>${esc(RULES.badges.guarantee_fee.text)} <a href="${esc(RULES.badges.guarantee_fee.source_url)}" target="_blank" rel="noopener">출처</a></span></li></ul>
    <p class="small muted" style="margin-top:6px">대구 전세사기 피해 결정 1,013건(국토부 2026.10 발표 누적), 대구경북 피해자 76%가 40세 미만(경북매일 2026.9.7)</p></details>`;
}
function saleHTML(c, jeonse) {
  if (!c.sale_price) return "";
  const src = `<p class="small muted" style="margin-top:6px">가격 출처: <a href="${esc(c.sale_source_url)}" target="_blank" rel="noopener">${esc(c.sale_source)}</a></p>`;
  const sc = S.mode === "match" && S.profile ? saleCalc(S.profile, c) : null;
  if (!sc) return `<details class="fold" data-pane="sale"><summary>매매로 보면</summary><p class="big">할인가<b>${wonK(c.sale_price)}</b></p><p class="why">내 조건을 넣으면 디딤돌·보금자리론과 취득세를 반영해 계산해 드려요.</p>${src}</details>`;
  const lp = sc.loanP;
  return `<details class="fold" data-pane="sale"><summary>매매로 보면</summary>
    ${sc.shortfall ? `<p class="big">사려면 자기자금이 모자라요<b class="is-off">${wonK(sc.shortfall)} 부족</b>필요한 자기자금 ${wonK(sc.own_needed)} · 모은 돈 ${wonK(S.profile.assets)}</p>` : ""}
    <p class="why">전세로 살 때 월 ${jeonse != null ? man1(jeonse) + "만" : "—"} / 사서 살 때 월 ${wonFull(sc.monthly)}(원리금+관리비)</p>
    <p class="small" style="margin-top:8px">지방 준공 후 미분양이라 금리 0.2%p 우대 대상이에요</p>
    <table class="calc"><tbody>
      <tr><td>디딤돌대출</td><td><span class="st st--${sc.didimdol.status}">${ST_KO[sc.didimdol.status]}</span></td></tr>
      <tr><td colspan="2" class="muted small" style="text-align:left">${esc(sc.didimdol.reason)}</td></tr>
      ${lp ? `<tr><td>계산에 쓴 대출 · ${esc(lp.name)}<br><span class="muted">${esc(lp.rate_label)}</span></td><td>${wonK(sc.loan)}</td></tr>
      <tr><td>월 원리금 (${RULES.sale.years}년)</td><td>${wonFull(sc.pmt)}</td></tr>` : `<tr><td>정책 대출</td><td>해당 없음</td></tr>`}
      <tr><td>관리비${c.mgmt_known ? "" : " (추정)"}</td><td>${wonFull(c.mgmt)}</td></tr>
      <tr><td>취득세 1.1%</td><td>${wonK(sc.tax)}</td></tr>
      <tr><td>감면<br><span class="muted">${esc(sc.cutLabel)}</span></td><td class="neg">−${wonK(sc.cut)}</td></tr>
    </tbody></table>
    <p class="small muted" style="margin-top:6px">${esc(sc.notes.join(" · "))}. 보금자리론은 상태가 늘 확인 필요예요. 최종 대출 한도·금리는 은행과 기관이 정해요.</p>${src}</details>`;
}
/* 공개 목록 단지의 최근 실거래가(국토부) + 그 가격으로 본 매매 대출 요건(참고) */
const eok = n => wonFull(n);
const ymTxt = ym => `${ym.slice(0, 4)}.${ym.slice(4)}`;
function unsoldPriceHTML(u) {
  const e = typeof UNSOLD_PRICE !== "undefined" && UNSOLD_PRICE[u.name];
  if (!e) return `<p class="small muted" style="margin-top:12px">최근 2년 실거래가를 찾지 못했어요. 가격은 분양사에 직접 확인해 주세요.</p>`;
  const KO = { trade: "매매", silv: "분양권" };
  const rows = ["trade", "silv"].filter(k => e[k]).flatMap(k => e[k].bands.filter(b => b.n >= 1).map(b => ({ k, b })));
  const main = (e.trade || e.silv).bands.reduce((a, b) => (b.n > a.n ? b : a));
  let judge = "";
  if (S.mode === "match" && S.profile) {
    const sc = saleCalc(S.profile, { sale_price: main.median, area_m2: main.area, mgmt: 0, sale_source: "국토부 실거래가 중간값" });
    if (sc) judge = `<table class="calc" style="margin-top:8px"><tbody>
      <tr><td>디딤돌대출 · 전용 ${main.area}㎡ ${eok(main.median)} 기준</td><td><span class="st st--${sc.didimdol.status}">${ST_KO[sc.didimdol.status]}</span></td></tr>
      <tr><td colspan="2" class="muted small" style="text-align:left">${esc(sc.didimdol.reason)}</td></tr>
      ${sc.loanP ? `<tr><td>계산에 쓴 대출 · ${esc(sc.loanP.name)}</td><td>${wonK(sc.loan)}</td></tr><tr><td>월 원리금 (${RULES.sale.years}년)</td><td>${wonFull(sc.pmt)}</td></tr>` : `<tr><td>정책 대출</td><td>해당 없음</td></tr>`}
      <tr><td>자기자금</td><td${sc.shortfall ? ' class="neg"' : ""}>${sc.shortfall ? wonK(sc.shortfall) + " 부족" : "모은 돈으로 돼요"}</td></tr>
    </tbody></table><p class="small muted" style="margin-top:6px">실거래 중간값으로 계산한 참고값이에요. 관리비는 빼고 계산했어요. 최종 대출 한도·금리는 은행과 기관이 정해요.</p>`;
  } else judge = `<p class="why" style="margin-top:8px">내 조건을 넣으면 이 가격으로 디딤돌·보금자리론 요건을 따져 봐요.</p>`;
  return `<details class="fold" open style="margin-top:12px"><summary>최근 실거래가</summary>
    <table class="calc"><tbody>${rows.map(({ k, b }) => `<tr><td>${KO[k]} · 전용 ${b.area}㎡<br><span class="muted small">${b.n}건 · 최근 ${ymTxt(b.latest)}${b.n > 1 ? ` · ${eok(b.min)}~${eok(b.max)}` : ""}</span></td><td>${eok(b.median)}</td></tr>`).join("")}</tbody></table>
    ${judge}
    <p class="small muted" style="margin-top:6px">출처: ${esc(UNSOLD_PRICE_META.source)} · ${esc(UNSOLD_PRICE_META.range)} · 중간값. ${esc(UNSOLD_PRICE_META.note)}</p></details>`;
}
/* 대구시 공개 미분양 목록 점: 판정 없이 출처만 */
function openUnsold(k) {
  const u = UNSOLD_LIST[k], p = $("#panelR"); S.sel = null;
  p.innerHTML = `<div class="cc"><div class="cc-top"><div><span class="eyebrow-s">Public list</span><h2>${esc(u.name)}</h2><div class="tags"><span class="tag">${esc(u.gu)} ${esc(u.dong)}</span></div></div>
    <button class="x" id="ccX" aria-label="카드 닫기"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 3l10 10M13 3L3 13"/></svg></button></div>
    <p class="why">${/언론/.test(u.source) ? "언론 보도로 확인된 단지" : "대구시 공개 미분양 목록"} · 현재 계약 가능 여부는 확인 필요</p>
    <p class="small muted" style="margin-top:12px">${esc(u.source)} · ${esc(u.as_of)} 기준</p>
    <div class="links" style="margin-top:8px"><a href="${esc(UNSOLD_SRC_URL)}" target="_blank" rel="noopener">대구시 원자료 ↗</a></div>
    ${unsoldPriceHTML(u)}
    ${u.approx ? `<p class="small muted" style="margin-top:8px">지도 위치는 동 중심 근사예요.</p>` : `<p class="small muted" style="margin-top:8px">지도 위치: ${esc(u.geo_src || "OpenStreetMap 단지 위치")}</p>`}</div>`;
  p.classList.add("is-open"); p.scrollTop = 0;
  $("#ccX").onclick = () => { closeCard(); MapView.select(null); };
  document.body.classList.add("card-open"); syncPl();
}
function openCard(id) {
  if (S.tabFor !== id) { S.tab = "sum"; S.tabFor = id; }
  S.sel = id; const p = $("#panelR"); p.innerHTML = cardHTML(id); p.classList.add("is-open"); p.scrollTop = 0;
  const shut = () => { closeCard(); MapView.select(null); };
  $("#ccX").onclick = shut;
  const cm = $("#ccMatch"); if (cm) cm.onclick = () => S.profile ? setMode("match") : (location.hash = "#input");
  const cc = $("#ccConsult"); if (cc) cc.onclick = () => { Consult.open(); Consult.ask("이 단지 월 부담은 어떻게 계산했어요?"); };
  $$("[data-ck]").forEach(i => i.addEventListener("change", () => S.chk[i.dataset.ck] = i.checked));
  $$(".cc-chips button", p).forEach(b => b.onclick = () => setTab(b.dataset.tab));
  setTab(S.tab);
  /* 휴대폰: 시트 머리를 아래로 끌면 닫힌다 (단추 위에서는 끌지 않는다) */
  const top = $(".cc-top", p); let y0 = null, dy = 0;
  top.addEventListener("pointerdown", e => { if (!isPhone() || e.target.closest("button,a")) return; y0 = e.clientY; dy = 0; try { top.setPointerCapture(e.pointerId); } catch (er) {} p.style.transition = "none"; });
  top.addEventListener("pointermove", e => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); p.style.transform = `translateY(${dy}px)`; });
  const end = () => { if (y0 == null) return; y0 = null; p.style.transition = ""; p.style.transform = ""; if (dy > 70) shut(); };
  top.addEventListener("pointerup", end); top.addEventListener("pointercancel", end);
  document.body.classList.add("card-open"); syncPl();
}
function closeCard() {
  const p = $("#panelR"), was = p.classList.contains("is-open");
  document.body.classList.remove("card-open"); p.classList.remove("is-open"); p.style.transform = ""; syncPl();
}

/* ─── S1 입력 ─── */
const fval = { homeless: 1, lives_with_parents: 0, daegu_resident_or_moving: 1 };
let prio = [];
/* 입력 칸은 원, 저장·계산은 만 원 */
const toWon = v => v == null || v === "" ? "" : Math.round(v * 10000);
function fillForm(p) {
  p = p || {};
  $("#f-age").value = p.age ?? ""; $("#f-income").value = toWon(p.monthly_income); $("#f-gross").value = toWon(p.annual_income_gross);
  $("#f-assets").value = toWon(p.assets); $("#f-budget").value = toWon(p.monthly_budget);
  fval.homeless = p.homeless === false ? 0 : 1; fval.lives_with_parents = p.lives_with_parents ? 1 : 0; fval.daegu_resident_or_moving = p.daegu_resident_or_moving === false ? 0 : 1;
  prio = [...(p.priorities || [])]; syncSeg(); renderPrio(); $$(".err").forEach(e => e.textContent = "");
}
function syncSeg() { $$("#form .seg").forEach(g => $$("button", g).forEach(b => b.classList.toggle("is-on", String(fval[g.dataset.k]) === b.dataset.v))); }
$$("#form .seg").forEach(g => $$("button", g).forEach(b => b.addEventListener("click", () => { fval[g.dataset.k] = +b.dataset.v; syncSeg(); formDirty = true; })));
function renderPrio() {
  if (!$("#prioChips")) return;
  $("#prioChips").innerHTML = Object.entries(CAT_KO).map(([k, v]) => `<button type="button" class="chip${prio.includes(k) ? " is-on" : ""}" data-p="${k}" aria-pressed="${prio.includes(k)}">${v}</button>`).join("");
  $$("#prioChips button").forEach(b => b.addEventListener("click", () => { const k = b.dataset.p; prio = prio.includes(k) ? prio.filter(x => x !== k) : [...prio, k]; renderPrio(); formDirty = true; }));
}

/* 칸을 고치면 그 칸의 빨간 알림을 바로 지운다 (다음을 다시 누를 때까지 남아 있으면 맞게 적어도 틀린 것처럼 보인다) */
$$("#form input").forEach(i => i.addEventListener("input", () => { formDirty = true; const e = $("#e-" + i.id.slice(2)); if (e) e.textContent = ""; }));
$("#formBack").onclick = () => { S.mode = "browse"; location.hash = "#map"; };
const num = id => { const v = $("#" + id).value.trim().replace(/[,\s원]/g, ""); if (v === "") return null; return id === "f-age" ? Number(v) : Number(v) / 10000; };
function readForm() {
  return { age: num("f-age"), monthly_income: num("f-income"), annual_income_gross: num("f-gross"), assets: num("f-assets"), monthly_budget: num("f-budget"),
    homeless: !!fval.homeless, lives_with_parents: !!fval.lives_with_parents, daegu_resident_or_moving: !!fval.daegu_resident_or_moving, priorities: prio };
}
/* 틀린 첫 칸의 이름을 돌려준다 */
function checkForm(p) {
  const errs = { age: p.age == null || p.age < 19 || p.age > 70 ? "19~70 사이로 넣어주세요" : "", income: p.monthly_income == null || p.monthly_income < 0 ? "월 실수령을 넣어주세요" : "",
    assets: p.assets == null || p.assets < 0 ? "모은 돈을 넣어주세요 (없으면 0)" : "", budget: p.monthly_budget == null || p.monthly_budget <= 0 ? "월 예산을 넣어주세요" : "" };
  let bad = null;
  Object.entries(errs).forEach(([k, v]) => { $("#e-" + k).textContent = v; if (v && !bad) bad = k; });
  return bad;
}
/* 한 문항씩 넘기는 입력 (PC·휴대폰 같음): 다음을 누를 때 지금 칸만 검사 */
const Step = {
  i: 0,
  fields() { return $$("#form .fgrid > .f"); },
  check(f) {
    const inp = $("input", f); if (!inp || !inp.required) return true;
    const v = inp.value.trim(), n = Number(v.replace(/[,\s원]/g, "")), err = $(".err", f);
    let msg = "";
    if (v === "") msg = inp.id === "f-assets" ? "없으면 0을 넣어주세요" : "값을 넣어주세요";
    else if (inp.id === "f-age" && (n < 19 || n > 70)) msg = "19~70 사이로 넣어주세요";
    else if (inp.id === "f-budget" && n <= 0) msg = "0보다 큰 금액을 넣어주세요";
    if (err) err.textContent = msg;
    if (msg) inp.focus();
    return !msg;
  },
  go(k, focus = true) {
    const fs = this.fields(), n = fs.length; this.i = clamp(k, 0, n - 1);
    fs.forEach((f, j) => f.classList.toggle("is-cur", j === this.i));
    $("#stpNo").textContent = `${this.i + 1} / ${n}`; $("#stpFill").style.width = ((this.i + 1) / n * 100) + "%";
    $("#stPrev").disabled = this.i === 0;
    const last = this.i === n - 1; $("#stNext").hidden = last; $("#stSubmit").hidden = !last;
    const inp = $("input", fs[this.i]); if (focus && inp && !isMobile()) setTimeout(() => inp.focus(), 60);
  },
  next() { const f = this.fields()[this.i]; if (this.check(f)) this.go(this.i + 1); }
};
$("#form").classList.add("is-step");
$("#stNext").onclick = () => Step.next();
$("#stPrev").onclick = () => Step.go(Step.i - 1);
$$("#form .fgrid input").forEach(inp => inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); if (Step.i < Step.fields().length - 1) Step.next(); else $("#form").requestSubmit(); } }));
$$("#form .seg button").forEach(b => b.addEventListener("click", () => setTimeout(() => { if (Step.i < Step.fields().length - 1) Step.go(Step.i + 1); }, 220)));
Step.go(0, false);
$("#fillPersona").onclick = () => { fillForm(PERSONA); formDirty = true; Step.go(Step.fields().length - 1); };
$("#fillShort").onclick = () => { fillForm(Object.assign({}, PERSONA, { assets: 1000 })); formDirty = true; Step.go(Step.fields().length - 1); };
$("#form").addEventListener("submit", e => {
  e.preventDefault();
  const p = readForm(), bad = checkForm(p);
  if (bad) { Step.go(Step.fields().findIndex(f => f.contains($("#f-" + bad)))); return; }
  S.profile = p; try { localStorage.setItem("mh-profile", JSON.stringify(p)); } catch (er) {}
  recompute(); S.mode = "match"; jpOpen = false; formDirty = false; location.hash = "#map"; MapView.applyMode(true);
});

/* ═══════════════ 3D 공통 ═══════════════ */
const matCache = {};
function mat(hex, o = {}) { const k = hex + JSON.stringify(o); if (matCache[k]) return matCache[k]; const m = new T3.MeshStandardMaterial(Object.assign({ color: new T3.Color(hex).convertSRGBToLinear(), roughness: .9, metalness: 0 }, o)); return matCache[k] = m; }
function box(w, h, d, m) { const b = new T3.Mesh(new T3.BoxGeometry(w, h, d), m); b.castShadow = true; b.receiveShadow = true; return b; }
function rbox(w, h, d, r, m) {
  r = Math.max(.002, Math.min(r, w / 2 - .01, d / 2 - .01)); const bev = Math.min(.018, h / 4), iw = w - bev * 2, id = d - bev * 2, x = -iw / 2, y = -id / 2, rr = Math.max(.001, Math.min(r, iw / 2 - .001, id / 2 - .001));
  const s = new T3.Shape(); s.moveTo(x + rr, y); s.lineTo(x + iw - rr, y); s.quadraticCurveTo(x + iw, y, x + iw, y + rr); s.lineTo(x + iw, y + id - rr); s.quadraticCurveTo(x + iw, y + id, x + iw - rr, y + id); s.lineTo(x + rr, y + id); s.quadraticCurveTo(x, y + id, x, y + id - rr); s.lineTo(x, y + rr); s.quadraticCurveTo(x, y, x + rr, y);
  const g = new T3.ExtrudeGeometry(s, { depth: Math.max(.002, h - bev * 2), bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 4 }); g.rotateX(-Math.PI / 2); g.translate(0, bev, 0);
  const m2 = new T3.Mesh(g, m); m2.castShadow = true; m2.receiveShadow = true; return m2;
}
function ribbon(pts, width, m, y) {
  const curve = new T3.CatmullRomCurve3(pts.map(p => new T3.Vector3(p[0], y, p[1])), false, "catmullrom", .2);
  const n = Math.max(24, pts.length * 16), sp = curve.getSpacedPoints(n), pos = [], idx = [];
  sp.forEach((p, i) => { const a = sp[Math.max(0, i - 1)], b = sp[Math.min(n, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * width / 2, nz = dx / l * width / 2; pos.push(p.x + nx, y, p.z + nz, p.x - nx, y, p.z - nz); if (i < n) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3); });
  const g = new T3.BufferGeometry(); g.setAttribute("position", new T3.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const me = new T3.Mesh(g, m); me.receiveShadow = true; return me;
}
function inPoly(x, z, p) { let o = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, zi] = p[i], [xj, zj] = p[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) o = !o; } return o; }
function segD(x, z, [ax, az], [bx, bz]) { const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz, t = clamp(((x - ax) * vx + (z - az) * vz) / l2, 0, 1); return Math.hypot(x - ax - vx * t, z - az - vz * t); }
function inGeo(x, z, polys) { return polys.some(p => inPoly(x, z, p[0]) && !p.slice(1).some(h => inPoly(x, z, h))); }
function seeded(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ h >>> 15, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }
function renderer(canvas) {
  const r = new T3.WebGLRenderer({ canvas, antialias: true });
  r.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); r.outputEncoding = T3.sRGBEncoding; r.toneMapping = T3.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
  r.shadowMap.enabled = true; r.shadowMap.type = T3.PCFSoftShadowMap; return r;
}
function dragInput(el, h) {
  const pts = new Map(); let pinch = 0, moved = 0, sx = 0, sy = 0, downT = 0;
  el.addEventListener("pointerdown", e => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; sx = e.clientX; sy = e.clientY; downT = performance.now(); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } h.down && h.down(e); });
  el.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId)) { h.hover && h.hover(e); return; }
    const p = pts.get(e.pointerId), dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved = Math.max(moved, Math.hypot(e.clientX - sx, e.clientY - sy));
    if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) h.zoom && h.zoom(d / pinch); pinch = d; }
    else h.drag && h.drag(dx, dy, e);
  });
  const up = e => { if (pts.has(e.pointerId) && pts.size === 1) { if (moved < 6 && h.tap) h.tap(e); h.up && h.up(e, moved); } pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", e => { pts.delete(e.pointerId); pinch = 0; h.up && h.up(e, 99); });
  el.addEventListener("pointerleave", e => { if (!pts.size) h.leave && h.leave(e); });
  el.addEventListener("wheel", e => { e.preventDefault(); h.zoom && h.zoom(Math.exp(-e.deltaY * .0015)); }, { passive: false });
}
function ndc(el, e) { const r = el.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }; }
function badgeTexture(cat) {
  const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d");
  x.fillStyle = "#fff"; x.beginPath(); x.arc(64, 64, 60, 0, Math.PI * 2); x.fill(); x.lineWidth = 4; x.strokeStyle = "rgba(0,0,0,.08)"; x.stroke();
  x.fillStyle = CAT_LIGHT[cat]; x.beginPath(); x.arc(64, 64, 44, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#fff"; x.strokeStyle = "#fff"; x.lineWidth = 7; x.lineCap = "round"; x.lineJoin = "round";
  const P = new Path2D();
  if (cat === "subway") { x.strokeRect(46, 40, 36, 40); x.beginPath(); x.moveTo(50, 92); x.lineTo(56, 82); x.moveTo(78, 92); x.lineTo(72, 82); x.stroke(); }
  else if (cat === "hospital") { x.fillRect(57, 40, 14, 48); x.fillRect(40, 57, 48, 14); }
  else if (cat === "mall") { x.strokeRect(44, 52, 40, 36); x.beginPath(); x.arc(64, 52, 10, Math.PI, 0); x.stroke(); }
  else if (cat === "culture") { x.strokeRect(42, 46, 44, 36); x.beginPath(); x.moveTo(42, 58); x.lineTo(86, 58); x.stroke(); }
  else if (cat === "university") { x.beginPath(); x.moveTo(36, 60); x.lineTo(64, 46); x.lineTo(92, 60); x.lineTo(64, 74); x.closePath(); x.fill(); x.fillRect(52, 70, 24, 12); }
  else if (cat === "park") { x.beginPath(); x.arc(64, 56, 16, 0, Math.PI * 2); x.fill(); x.fillRect(60, 64, 8, 22); }
  else { x.strokeRect(50, 38, 28, 50); x.beginPath(); x.moveTo(58, 50); x.lineTo(70, 50); x.moveTo(58, 62); x.lineTo(70, 62); x.stroke(); }
  const t = new T3.CanvasTexture(c); t.encoding = T3.sRGBEncoding; return t;
}
function windowTexture(seed, frac, lit) {
  const c = document.createElement("canvas"); c.width = 64; c.height = 256; const x = c.getContext("2d"), rnd = seeded(seed);
  x.fillStyle = lit ? "#000" : "#FFF1D6"; x.fillRect(0, 0, 64, 256);
  for (let r = 0; r < 16; r++) for (let k = 0; k < 4; k++) {
    const on = rnd() < frac;
    if (lit) { if (on) { x.fillStyle = "#fff"; x.fillRect(4 + k * 15, 6 + r * 16, 11, 8); } }
    else { x.fillStyle = "#EFE1C4"; x.fillRect(4 + k * 15, 6 + r * 16, 11, 8); }
  }
  const t = new T3.CanvasTexture(c); t.encoding = T3.sRGBEncoding; return t;
}

/* ═══════════════ 2.5D 미분양 지도 ═══════════════ */
const MapView = {
  ok: false, units: {}, target: HAS3D ? new T3.Vector3((innerWidth < 768 ? 14 : 18) * MAP_K, 0, (innerWidth < 768 ? 18 : 16) * MAP_K) : null, zoom: (innerWidth < 768 ? 17 : 26) / MAP_K * 1.4, fly0: null, lines: null, lineFor: null, lineT: 0, touchArmed: null,
  init() {
    if (!HAS3D) { mapFail("3D 지도를 불러오지 못했어요. 새로 고침을 해 보세요. 조건 입력과 집 보기, 상담은 그대로 쓸 수 있어요."); return; }
    const cv = $("#mapCanvas"); this.cv = cv; this.r = renderer(cv); this.r.setClearColor(new T3.Color("#e4e2dc"), 1);
    const sc = this.scene = new T3.Scene();
    this.cam = new T3.OrthographicCamera(-1, 1, 1, -1, -200, 400);
    this.hemi = new T3.HemisphereLight(0xfffaf2, 0xd8d2c6, .8); sc.add(this.hemi); this.night = 0; this.nightT = 0;
    const sun = this.sun = new T3.DirectionalLight(0xfff0da, 1.35); sun.castShadow = true; sun.shadow.mapSize.set(isMobile() ? 1024 : 2048, isMobile() ? 1024 : 2048); sun.shadow.bias = -.0005; sun.shadow.radius = 6;
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 80 }); sun.shadow.camera.updateProjectionMatrix(); sc.add(sun); sc.add(sun.target);
    this.decor = new T3.Group(); sc.add(this.decor); this.buildGround();
    this.buildCity(); this.buildLandmarks(); this.buildUnits(); this.buildUnsold();
    this.lines = new T3.Group(); sc.add(this.lines);
    this.ray = new T3.Raycaster();
    const hits = () => Object.values(this.units).map(u => u.hit);
    dragInput(cv, {
      down: () => { this.fly0 = null; },
      drag: (dx, dy) => { const s = 1 / this.zoom, e = Math.asin(1 / Math.sqrt(3)); const right = new T3.Vector3(1, 0, -1).normalize(), fwd = new T3.Vector3(-1, 0, -1).normalize(); this.target.addScaledVector(right, -dx * s).addScaledVector(fwd, dy * s / Math.sin(e)); this.clampT(); },
      zoom: k => { this.zoom = clamp(this.zoom * k, 4.5 / MAP_K, 90); this.fly0 = null; },
      hover: e => { if (e.pointerType !== "mouse") return; this.ray.setFromCamera(ndc(cv, e), this.cam); const h = this.ray.intersectObjects(hits())[0]; const id = h ? h.object.userData.id : null; cv.style.cursor = id ? "pointer" : "grab"; if (id !== S.hover) { S.hover = id; this.lift(); } },
      leave: () => { if (S.hover) { S.hover = null; this.lift(); } },
      tap: e => {
        this.ray.setFromCamera(ndc(cv, e), this.cam); const h = this.ray.intersectObjects(hits())[0];
        const hu = this.ray.intersectObjects(this.uHits)[0];
        if (!h && !hu) { return; }
        if (!h || (hu && hu.distance < h.distance)) { this.selectUnsold(hu.object.userData.uk); return; }
        const id = h.object.userData.id;
        this.select(id, true);
      }
    });
    new ResizeObserver(() => this.resize()).observe($("#mapWrap"));
    this.resize(); this.applyMode(false); this.ok = true; this.overview(false);
    let t0 = performance.now();
    const loop = t => { const dt = Math.min(.05, (t - t0) / 1000); t0 = t; this.tick(dt, t / 1000); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  },
  clampT() { this.target.x = clamp(this.target.x, -18 * MAP_K, 64 * MAP_K); this.target.z = clamp(this.target.z, -76 * MAP_K, 62 * MAP_K); },
  /* 크기를 바꾸면 그림이 지워져 검게 남는다. 지도를 그리지 않는 화면(조건 입력·집 보기)에서도 반투명한 위 막대 뒤로 비치므로 한 장은 바로 그려 둔다 */
  resize() { const w = innerWidth, h = innerHeight; this.r.setSize(w, h, false); Object.assign(this.cam, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 }); this.cam.updateProjectionMatrix(); this.tick(0, performance.now() / 1000, true); },
  blocked(x, z, pad) {
    if (!inGeo(x, z, GEO.outline)) return true;
    for (const c of COMPLEX) if (Math.abs(x - c.map_x) < 2.0 + pad && Math.abs(z - c.map_z) < 1.8 + pad) return true;
    for (const i of INFRA) if (Math.hypot(x - i.map_x, z - i.map_z) < (i.category === "park" ? 1.4 : .9)) return true;
    if (GEO.lakes.some(([lx, lz, rx, rz]) => ((x - lx) / (rx + .5)) ** 2 + ((z - lz) / (rz + .5)) ** 2 < 1)) return true;
    const near = (list, extra) => list.some(r => { for (let k = 0; k < r.pts.length - 1; k++) if (segD(x, z, r.pts[k], r.pts[k + 1]) < r.w / 2 + extra) return true; return false; });
    return near(GEO.roads, .4) || near(GEO.rivers, .55);
  },
  buildGround() {
    /* 대구 9개 구·군 실제 경계 위에 지형을 얹어요 */
    const D = this.decor, rnd = seeded("ground-v5");
    const shapeOf = poly => { const sh = new T3.Shape(poly[0].map(([x, z]) => new T3.Vector2(x, z))); poly.slice(1).forEach(h => sh.holes.push(new T3.Path(h.map(([x, z]) => new T3.Vector2(x, z))))); return sh; };
    const flat = (sh, color, y) => { const g = new T3.ShapeGeometry(sh, 8); g.rotateX(Math.PI / 2); const m = new T3.Mesh(g, mat(color, { side: T3.DoubleSide })); m.position.y = y; m.receiveShadow = true; D.add(m); return m; };
    const ell = (x, z, rx, rz) => { const s = new T3.Shape(); s.absellipse(x, z, rx, rz, 0, Math.PI * 2, false, 0); return s; };
    /* 판: 대구 외곽선을 두께 있는 판으로 */
    GEO.outline.forEach(p => { const g = new T3.ExtrudeGeometry(shapeOf(p), { depth: .7, bevelEnabled: false }); g.rotateX(Math.PI / 2); const m = new T3.Mesh(g, mat("#cfcabf")); m.position.y = 0; m.receiveShadow = true; this.scene.add(m); });
    /* 구·군 면: 도심은 밝게, 군 지역은 연한 초록 */
    const tone = { 중구: "#f8f7f3", 서구: "#f6f5f0", 남구: "#f7f6f1", 북구: "#f5f4ef", 동구: "#f4f3ed", 수성구: "#f6f5f0", 달서구: "#f5f4ef", 달성군: "#eaeee4", 군위군: "#e8ede2" };
    Object.entries(GEO.gu).forEach(([k, ps]) => ps.forEach(p => flat(shapeOf(p), tone[k] || "#efede7", .004)));
    /* 산: 실제 산 위치에 숲 덩어리 (도심 밖만) */
    const trees = [];
    GEO.mounts.forEach(([mx, mz, r]) => { for (let k = 0; k < r * r * 7; k++) { const a = rnd() * 6.283, d = Math.sqrt(rnd()) * r, x = mx + Math.cos(a) * d, z = mz + Math.sin(a) * d; if (!inGeo(x, z, GEO.outline) || inGeo(x, z, GEO.urban)) continue; const hgt = 1 - d / r; trees.push([x, z, .34 + rnd() * .26, .2 + hgt * .9 + rnd() * .15, rnd()]); } });
    /* 군 지역 들판·마을 조각 */
    for (let k = 0; k < 2600 * MAP_K; k++) { const x = (-20 + rnd() * 87) * MAP_K, z = (-79 + rnd() * 144) * MAP_K; if (!inGeo(x, z, GEO.outline) || inGeo(x, z, GEO.urban)) continue; if (rnd() < .22) trees.push([x, z, .25 + rnd() * .2, .16 + rnd() * .2, rnd()]); }
    /* 호수 · 공원 · 강 · 도로 */
    GEO.lakes.forEach(([x, z, rx, rz]) => { flat(ell(x, z, rx + .3, rz + .25), "#e3e2d8", .006); flat(ell(x, z, rx, rz), "#a9c9cb", .008); });
    INFRA.filter(i => i.category === "park").forEach(i => { flat(ell(i.map_x, i.map_z, 1.25, 1.0), "#dbe5d6", .007); for (let k = 0; k < 9; k++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * .9; trees.push([i.map_x + Math.cos(a) * d * 1.15, i.map_z + Math.sin(a) * d * .9, .2 + rnd() * .1, .16, rnd()]); } });
    GEO.rivers.forEach(r => { D.add(ribbon(r.pts, r.w + .8, mat("#dfe6dc"), .009)); D.add(ribbon(r.pts, r.w, mat("#a9c9cb", { roughness: .3 }), .011)); });
    GEO.roads.forEach(r => { D.add(ribbon(r.pts, r.w + .36, mat("#f7f5f1"), .012)); D.add(ribbon(r.pts, r.w, mat("#d0ccc3"), .014)); if (r.w >= .6) D.add(ribbon(r.pts, .04, mat("#f6f4ef"), .016)); });
    const geo = new T3.IcosahedronGeometry(1, 0); geo.translate(0, .55, 0);
    const im = new T3.InstancedMesh(geo, new T3.MeshStandardMaterial({ roughness: 1, flatShading: true }), trees.length), m = new T3.Matrix4(), q = new T3.Quaternion();
    const pal = ["#b9cbb2", "#aec4a8", "#c4d3bc", "#a6bd9f"].map(h => new T3.Color(h).convertSRGBToLinear());
    trees.forEach((t, i) => { m.compose(new T3.Vector3(t[0], 0, t[1]), q, new T3.Vector3(t[2], t[3], t[2])); im.setMatrixAt(i, m); im.setColorAt(i, pal[Math.floor(t[4] * pal.length)]); });
    im.receiveShadow = true; D.add(im);
    /* 구·군 이름: 바닥에 눕힌 글씨 */
    this.guLabels = [];
    const mk = () => Object.entries(GEO.label).forEach(([k, [x, z]]) => {
      const c = document.createElement("canvas"); c.width = 512; c.height = 160; const t = c.getContext("2d");
      t.font = '600 92px "PretendardLocal", sans-serif'; t.fillStyle = "rgba(31,38,34,.34)"; t.textAlign = "center"; t.textBaseline = "middle"; t.fillText(k, 256, 84);
      const tex = new T3.CanvasTexture(c); tex.encoding = T3.sRGBEncoding; tex.anisotropy = 8;
      const big = k === "달성군" || k === "군위군", w = (big ? 9 : k === "중구" ? 3.2 : 5) * MAP_K * .8;
      const g = new T3.PlaneGeometry(w, w * 160 / 512); g.rotateX(-Math.PI / 2); g.rotateY(Math.PI / 4);
      const me = new T3.Mesh(g, new T3.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })); me.position.set(x, .03, z); me.renderOrder = 4; this.scene.add(me); this.guLabels.push(me);
    });
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(mk);
  },
  buildCity() {
    /* 도심 격자 블록 (예시, 실제 건물 아님): 미분양 단지보다 낮고 무채색으로 */
    const rnd = seeded("daegu-v5"), apt = [], low = [], field = [], CW = 2.0 * MAP_K / 1.5, CD = 1.7 * MAP_K / 1.5;
    for (let gx = Math.floor(-22 * MAP_K / CW); gx < Math.ceil(68 * MAP_K / CW); gx++) for (let gz = Math.floor(-20.4 * MAP_K / CD); gz < Math.ceil(68 * MAP_K / CD); gz++) {
      const cx = gx * CW + CW / 2, cz = gz * CD + CD / 2;
      if (!inGeo(cx, cz, GEO.urban) || rnd() < .3 || rnd() < .5) continue;
      const free = (x, z, pad) => !this.blocked(x, z, pad) && inGeo(x, z, GEO.urban);
      const kind = rnd(), dense = Math.max(0, 1 - Math.hypot(cx - 18 * MAP_K, cz - 13 * MAP_K) / (22 * MAP_K));
      if (kind < .36 + dense * .2) {
        const rows = 2 + Math.floor(rnd() * 2), hgt = (.3 + rnd() * .28 + dense * .2) * .6;
        for (let r = 0; r < rows; r++) { const z = cz - CD * .3 + r * (CD * .6 / Math.max(1, rows - 1)); for (const x of [cx - .45, cx + .45]) if (free(x, z, .15)) apt.push([x, z, .78, .24, hgt * (.85 + rnd() * .3)]); }
      } else if (kind < .9) {
        for (let k = 0; k < 7; k++) { const x = cx + (rnd() - .5) * CW * .8, z = cz + (rnd() - .5) * CD * .8; if (free(x, z, .1)) low.push([x, z, .22 + rnd() * .2, .2 + rnd() * .18, (.08 + rnd() * .1) * .7]); }
      } else if (free(cx, cz, .5)) { field.push([cx - .25, cz]); apt.push([cx + .55, cz, .26, .9, .18]); }
    }
    const inst = (arr, color) => {
      const geo = new T3.BoxGeometry(1, 1, 1); geo.translate(0, .5, 0);
      const im = new T3.InstancedMesh(geo, mat(color, { roughness: 1 }), arr.length), m = new T3.Matrix4(), q = new T3.Quaternion();
      arr.forEach((b, i) => { m.compose(new T3.Vector3(b[0], 0, b[1]), q, new T3.Vector3(b[2], b[4], b[3])); im.setMatrixAt(i, m); });
      im.castShadow = true; im.receiveShadow = true; this.decor.add(im);
    };
    inst(apt, "#eeeeec"); inst(low, "#ebeae7");
    field.forEach(([x, z]) => { const f = rbox(1.0, .02, 1.1, .3, mat("#e2d9c8")); f.position.set(x, 0, z); f.castShadow = false; this.decor.add(f); });
  },
  buildLandmarks() {
    this.marks = [];
    INFRA.forEach(i => {
      const g = new T3.Group(); g.position.set(i.map_x, 0, i.map_z);
      const wall = mat("#e9e7e2");
      if (i.category === "subway") { const p = rbox(1.2, .12, .7, .1, wall); g.add(p); const cn = box(1.0, .05, .5, mat("#D8DAD6")); cn.position.y = .36; g.add(cn); [-.4, .4].forEach(x => { const c = box(.05, .3, .05, wall); c.position.set(x, .2, 0); g.add(c); }); }
      else if (i.category === "park") { const p = rbox(1.4, .05, 1.1, .2, mat("#DCE6DE")); g.add(p); [[-.35, -.2], [.3, .15], [0, .3]].forEach(([x, z]) => { const t = new T3.Mesh(new T3.SphereGeometry(.2, 12, 8), mat("#C9D8CC")); t.position.set(x, .3, z); t.castShadow = true; g.add(t); }); }
      else if (i.category === "university") { [[-.35, 0], [.4, .1]].forEach(([x, z]) => { const b = rbox(.6, .5, .5, .05, wall); b.position.set(x, 0, z); g.add(b); }); }
      else if (i.category === "mall") g.add(rbox(1.5, .35, 1.0, .06, wall));
      else if (i.category === "culture") { g.add(rbox(1.0, .42, .8, .05, wall)); const a = box(.8, .04, .25, mat("#D8DAD6")); a.position.set(0, .3, .5); g.add(a); }
      else if (i.category === "office") g.add(rbox(.7, .7, .7, .05, wall));
      else { g.add(rbox(1.0, .55, .8, .05, wall)); }
      const sp = new T3.Sprite(new T3.SpriteMaterial({ map: badgeTexture(i.category), transparent: true, depthTest: false })); sp.scale.set(.55, .55, 1); sp.position.y = 1.1; sp.renderOrder = 5; g.add(sp);
      g.userData = { i, sp }; this.scene.add(g); this.marks.push(g);
    });
  },
  buildUnits() {
    COMPLEX.forEach(c => {
      const g = new T3.Group(); g.position.set(c.map_x, 0, c.map_z); this.scene.add(g);
      const rimM = mat("#d9e8de").clone(); const rim = rbox(3.3, .03, 2.8, .3, rimM); g.add(rim); const site = rbox(3.1, .05, 2.6, .25, mat("#f7f2e8")); g.add(site);
      const rnd = seeded(c.id), n = 3 + (rnd() > .5 ? 1 : 0), L = rnd() > .5;
      const wallTex = windowTexture(c.id, 1, false);
      const em = { browse: windowTexture(c.id, .4, true), on: windowTexture(c.id, .7, true), dim: windowTexture(c.id, .3, true) };
      const wallM = new T3.MeshStandardMaterial({ color: 0xffffff, map: wallTex, roughness: .9, emissive: new T3.Color("#FFC46B").convertSRGBToLinear(), emissiveMap: em.browse, emissiveIntensity: 1.2 });
      const roofM = new T3.MeshStandardMaterial({ color: new T3.Color("#FFF1D6").convertSRGBToLinear(), roughness: .9 });
      const bandM = new T3.MeshStandardMaterial({ color: new T3.Color("#1f6b4f").convertSRGBToLinear(), roughness: .8 });
      const blds = new T3.Group(); g.add(blds); let top = 0;
      for (let k = 0; k < n; k++) {
        const h = (2.7 + rnd() * 1.1) * 1.3, x = L && k === n - 1 ? .95 : -1.05 + k * (2.1 / (n - (L ? 2 : 1) || 1)), z = L && k === n - 1 ? .45 : -.4;
        const b = new T3.Mesh(new T3.BoxGeometry(.62, h, 1.0), [wallM, wallM, roofM, roofM, wallM, wallM]); b.castShadow = true; b.receiveShadow = true;
        if (L && k === n - 1) b.rotation.y = Math.PI / 2;
        b.position.set(clamp(x, -1.05, 1.05), h / 2 + .05, z); blds.add(b); top = Math.max(top, h);
        const t = .06, y = h + .07, bw = .62, bd = 1.0, rot = b.rotation.y;
        const band = new T3.Group(); band.position.set(b.position.x, y, b.position.z); band.rotation.y = rot;
        [[0, -bd / 2 + t / 2, bw, t], [0, bd / 2 - t / 2, bw, t], [-bw / 2 + t / 2, 0, t, bd], [bw / 2 - t / 2, 0, t, bd]].forEach(([px, pz, w, d]) => { const m = new T3.Mesh(new T3.BoxGeometry(w, .05, d), bandM); m.position.set(px, 0, pz); band.add(m); });
        blds.add(band);
        const crown = new T3.Mesh(new T3.BoxGeometry(bw * .55, .22, bd * .4), bandM); crown.position.set(b.position.x, h + .16, b.position.z); crown.rotation.y = rot; blds.add(crown);
      }
      const beam = new T3.Mesh(new T3.CylinderGeometry(1.3, 1.55, 22, 32, 1, true), new T3.MeshBasicMaterial({ map: beamTex(), color: 0xffc46b, transparent: true, opacity: 0, blending: T3.AdditiveBlending, depthWrite: false, side: T3.DoubleSide })); beam.position.y = 11; beam.renderOrder = 3; g.add(beam);
      const glow = new T3.Sprite(new T3.SpriteMaterial({ map: glowTex(), color: 0xffc46b, blending: T3.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 })); glow.scale.set(6.5, 6.5, 1); glow.position.y = 1.4; g.add(glow);
      const ring = new T3.Mesh(new T3.RingGeometry(1.75, 1.88, 48), new T3.MeshBasicMaterial({ color: new T3.Color("#1f6b4f").convertSRGBToLinear(), transparent: true, opacity: 0, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = .05; g.add(ring);
      const ring0 = new T3.Mesh(new T3.RingGeometry(1.75, 1.95, 48), new T3.MeshBasicMaterial({ color: new T3.Color("#1f6b4f").convertSRGBToLinear(), transparent: true, opacity: 0, depthWrite: false })); ring0.rotation.x = -Math.PI / 2; ring0.position.y = .06; g.add(ring0);
      const sq = new T3.LineSegments(new T3.EdgesGeometry(new T3.PlaneGeometry(3.5, 3.0)), new T3.LineDashedMaterial({ color: new T3.Color("#9a6a1f").convertSRGBToLinear(), dashSize: .14, gapSize: .1, transparent: true, opacity: 0 })); sq.rotation.x = -Math.PI / 2; sq.position.y = .05; sq.computeLineDistances(); g.add(sq);
      /* 클릭 대상: 동 묶음 전체를 덮는 보이지 않는 박스 */
      const hit = new T3.Mesh(new T3.BoxGeometry(3.6, top + 1, 3.2), new T3.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); hit.position.y = (top + 1) / 2; hit.userData.id = c.id; g.add(hit);
      const lbl = document.createElement("button"); lbl.className = "clabel"; lbl.setAttribute("aria-label", c.name + " 카드 열기");
      lbl.addEventListener("click", () => this.select(c.id, true)); $("#lblLayer").appendChild(lbl);
      this.units[c.id] = { c, g, blds, wallM, roofM, bandM, rimM, em, glow, beam, ring, ring0, top, sq, hit, lbl, cur: 1.2, tgt: 1.2, delay: 0, light: "browse", lift: 0 };
    });
  },
  buildUnsold() {
    /* 대구시 공개 미분양 목록: 작은 회색-주황 점. 판정 없음, 마우스 올림 라벨 없음(클릭만) */
    const m = mat("#c99a6b"), geo = new T3.CylinderGeometry(.32, .32, .22, 16); geo.translate(0, .11, 0);
    const hg = new T3.CylinderGeometry(.6, .6, .8, 8); hg.translate(0, .4, 0);
    const same = {}; /* 동 중심 근사로 같은 자리에 겹친 점은 작은 원으로 벌려 각각 누를 수 있게 */
    this.uPos = UNSOLD_LIST.map(u => { const key = u.lat + "," + u.lng, i = same[key] = (same[key] || 0) + 1, a = i * 2.4, r = i > 1 ? .75 * Math.sqrt(i - 1) : 0;
      let x = PX(u.lng) + Math.cos(a) * r, z = PZ(u.lat) + Math.sin(a) * r;
      const c = COMPLEX.find(c => Math.abs(x - c.map_x) < 2.2 && Math.abs(z - c.map_z) < 2.0); if (c) z = c.map_z + (z >= c.map_z ? 2.0 : -2.0); /* 판정 단지 건물에 가려지지 않게 */
      return [x, z]; });
    this.uHits = UNSOLD_LIST.map((u, k) => {
      const [x, z] = this.uPos[k], d = new T3.Mesh(geo, m); d.position.set(x, 0, z); d.castShadow = true; this.decor.add(d);
      const hit = new T3.Mesh(hg, new T3.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); hit.position.set(x, 0, z); hit.userData.uk = k; this.scene.add(hit); return hit;
    });
  },
  selectUnsold(k) {
    const [x, z] = this.uPos[k];
    S.sel = null; this.lift(); this.showLines(null);
    openUnsold(k); this.paintSel(); this.flyTo(x, .3, z);
  },
  applyMode(animate) {
    if (!this.ok && !this.units.c01) return;
    const order = ["on", "dim", "off"];
    const ids = Object.keys(this.units);
    const ranked = ids.slice().sort((a, b) => order.indexOf((S.evals[a] || {}).light) - order.indexOf((S.evals[b] || {}).light));
    ranked.forEach((id, k) => {
      const u = this.units[id], light = S.mode === "match" && S.evals[id] ? S.evals[id].light : "browse";
      u.light = light; u.delay = animate && !REDUCED ? performance.now() / 1000 + k * .1 : 0;
      u.wallM.emissiveMap = light === "off" ? u.em.browse : u.em[light]; u.wallM.needsUpdate = true;
      u.tgt = { browse: 1.0, on: 3.0, dim: 1.0, off: 0 }[light];
      if (animate && light !== "browse") u.cur = 0;
      const off = light === "off";
      u.baseWall = off ? "#c3c6c4" : "#ffffff"; u.baseBand = off ? "#9DB5B1" : "#1f6b4f";
      const ev = S.evals[id];
      u.lbl.className = "clabel" + (light === "on" ? " is-on" : light === "dim" ? " is-dim" : light === "off" ? " is-off" : "");
      u.lbl.innerHTML = (light !== "browse" ? `<i>${LIGHT_ICON[light]}</i>` : `<i class="b">●</i>`) + esc(u.c.name.replace("(예시)", ""));
    });
    this.nightT = S.mode === "match" ? 1 : 0; this.paintSel();
    if (S.sel && $("#panelR").classList.contains("is-open")) openCard(S.sel);
  },
  /* 구마다 같은 선택 색 (서로 잘 구분되게): [벽, 띠·바닥·라벨] */
  GU_PAL: { 달서구: ["#ffb36b", "#d9600f"], 북구: ["#7fb8ff", "#1d5fd1"], 동구: ["#c39bff", "#7034d6"], 수성구: ["#6fe0b0", "#0d8f5c"], 서구: ["#ff8fa8", "#d12e5a"], 중구: ["#ffe066", "#b38600"], 남구: ["#6fd9e8", "#0b8a9c"], 달성군: ["#c8d97a", "#6b7f12"], 군위군: ["#e0b98f", "#8a5a2b"] },
  paintSel() {
    const cardOn = document.body.classList.contains("card-open");
    Object.entries(this.units).forEach(([id, u]) => {
      const sel = id === S.sel, hide = !!S.sel && cardOn && !sel;
      u.g.visible = !hide; u.lbl.style.display = (hide || (sel && cardOn)) ? "none" : "";
      const pal = this.GU_PAL[u.c.district] || ["#8fd6ad", "#0f7a4a"];
      u.wallM.color.set(new T3.Color(sel ? pal[0] : (u.baseWall || "#ffffff")).convertSRGBToLinear());
      u.bandM.color.set(new T3.Color(sel ? pal[1] : (u.baseBand || "#1f6b4f")).convertSRGBToLinear());
      u.rimM.color.set(new T3.Color(sel ? pal[1] : "#d9e8de").convertSRGBToLinear());
      u.lbl.style.background = sel ? pal[1] : ""; u.lbl.style.color = sel ? "#fff" : "";
    });
  },
  /* P(월드 좌표)가 화면 (dx, dy)에 오도록 하는 카메라 target */
  placeAt(P, Z, dx, dy) {
    const W = innerWidth, H = innerHeight, cam = this.cam;
    const save = { p: cam.position.clone(), q: cam.quaternion.clone() };
    cam.position.copy(P).add(new T3.Vector3(20, 20, 20)); cam.lookAt(P); cam.updateMatrixWorld();
    const r = new T3.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), u = new T3.Vector3().setFromMatrixColumn(cam.matrixWorld, 1), d = new T3.Vector3(-1, -1, -1).normalize();
    cam.position.copy(save.p); cam.quaternion.copy(save.q);
    const T = P.clone().addScaledVector(r, (W / 2 - dx) / Z).addScaledVector(u, (dy - H / 2) / Z);
    return T.addScaledVector(d, -T.y / d.y);
  },
  /* 카드에 가리지 않는 지도 영역의 가운데로 옮기며 줌인 (휴대폰은 아래 시트 위쪽) */
  flyTo(x, y, z) {
    const W = innerWidth, H = innerHeight, Z = clamp(Math.max(this.zoom, 36), 36, 44), pr = $("#panelR");
    let dx = W / 2, dy = (140 + H) / 2;
    if (isMobile()) { const top = pr.offsetTop || H * .5; dy = (150 + Math.min(top, H * .6)) / 2; }
    else if (pr.offsetWidth) dx = Math.max(160, pr.offsetLeft / 2);
    const T = this.placeAt(new T3.Vector3(x, y, z), Z, dx, dy);
    this.fly(T.x, T.z, Z);
  },
  /* 판정 단지 8곳이 모두 보이게 줌아웃 (왼쪽 패널·위 막대를 피해서) */
  overview(animate) {
    const W = innerWidth, H = innerHeight, pl = $("#panelL"), mob = isMobile();
    const left = !mob && pl && !pl.hidden && pl.offsetWidth ? pl.getBoundingClientRect().right + 24 : 24, right = W - 24;
    const top = mob ? (pl && !pl.hidden && pl.offsetHeight ? pl.getBoundingClientRect().bottom + 16 : 190) : 150, bottom = H - (mob ? 130 : 90);
    const sx = c => (c.map_x - c.map_z) / Math.SQRT2, sy = c => -(c.map_x + c.map_z) / Math.sqrt(6);
    const xs = COMPLEX.map(sx), ys = COMPLEX.map(sy), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const hTop = 5.5 * Math.sqrt(2 / 3);
    const Z = clamp(Math.min((right - left) / (x1 - x0 + 4), (bottom - top) / (y1 - y0 + hTop + 3)), 4.5 / MAP_K, 40);
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + hTop / 2;
    const P = new T3.Vector3((Math.SQRT2 * mx - Math.sqrt(6) * my) / 2, 0, (-Math.SQRT2 * mx - Math.sqrt(6) * my) / 2);
    const T = this.placeAt(P, Z, (left + right) / 2, (top + bottom) / 2);
    if (animate) this.fly(T.x, T.z, Z); else { this.target.set(T.x, 0, T.z); this.zoom = Z; this.fly0 = null; }
  },
  lift() { Object.entries(this.units).forEach(([id, u]) => u.liftT = (id === S.hover || id === S.sel) ? .05 : 0); },
  fly(x, z, zoom) { this.fly0 = { x, z, zoom: zoom || this.zoom, t: 0, fx: this.target.x, fz: this.target.z, fzoom: this.zoom }; },
  select(id, fly) {
    S.sel = id; this.lift(); this.showLines(id);
    if (!id) { this.paintSel(); if (this.ok && fly !== false) this.overview(true); return; }
    if (location.hash !== "#map") location.hash = "#map";
    const u = this.units[id];
    openCard(id); this.paintSel();
    if (fly) this.flyTo(u.c.map_x, u.top * .5, u.c.map_z);
  },
  showLines(id) {
    while (this.lines.children.length) { const o = this.lines.children.pop(); o.geometry && o.geometry.dispose(); }
    $$(".ilabel", $("#lblLayer")).forEach(e => e.remove());
    this.lineFor = id; this.lineT = 0;
    this.marks.forEach(m => { m.userData.sp.scale.setScalar(.48); m.userData.sp.material.opacity = id ? .35 : .7; });
    if (!id) return;
    const u = this.units[id], c = u.c, top = Math.max(...u.blds.children.filter(b => b.geometry && b.geometry.parameters && b.geometry.parameters.height > 1).map(b => b.geometry.parameters.height)) + .2;
    c.nearby.forEach(n => {
      const a = new T3.Vector3(c.map_x, top, c.map_z), b = new T3.Vector3(n.map_x, 1.1, n.map_z), mid = a.clone().lerp(b, .5); mid.y = Math.max(a.y, b.y) + 1.0;
      const curve = new T3.QuadraticBezierCurve3(a, mid, b), tube = new T3.TubeGeometry(curve, 40, .04, 6, false);
      const m = new T3.Mesh(tube, new T3.MeshBasicMaterial({ color: new T3.Color(CAT_DARK[n.category]).convertSRGBToLinear() })); m.userData.count = tube.index.count; tube.setDrawRange(0, 0); this.lines.add(m);
      const mk = this.marks.find(g => g.userData.i.id === n.infra_id); if (mk) { mk.userData.sp.scale.setScalar(.72); mk.userData.sp.material.opacity = 1; }
      const el = document.createElement("span"); el.className = "ilabel"; el.innerHTML = `<i style="background:${CAT_DARK[n.category]}"></i>${esc(n.name)} · ${n.walk_min != null ? "도보 " + n.walk_min + "분" : "차 " + n.drive_min + "분"}`; el.style.opacity = 0; el._p = b.clone(); $("#lblLayer").appendChild(el);
    });
  },
  project(v) { const p = v.clone().project(this.cam); return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight }; },
  tick(dt, time, force) {
    /* 지도가 완전히 가려진 동안(불투명한 조건 입력 화면, 휴대폰의 전체 화면 상담 서랍)에는 그리지 않는다. force 는 크기가 바뀐 직후의 한 장 */
    if (!force && (VIEW !== "map" || (Consult.isOpen && isPhone()))) return;
    if (this.fly0) { const f = this.fly0; f.t = Math.min(1, f.t + dt / .6); const k = 1 - Math.pow(1 - f.t, 3); this.target.set(f.fx + (f.x - f.fx) * k, 0, f.fz + (f.z - f.fz) * k); this.zoom = f.fzoom + (f.zoom - f.fzoom) * k; if (f.t >= 1) this.fly0 = null; }
    const off = new T3.Vector3(20, 20, 20); this.cam.position.copy(this.target).add(off); this.cam.lookAt(this.target); this.cam.zoom = this.zoom; this.cam.updateProjectionMatrix();
    this.sun.position.copy(this.target).add(new T3.Vector3(10, 15, 3)); this.sun.target.position.copy(this.target);
    const now = performance.now() / 1000;
    this.night += (this.nightT - this.night) * Math.min(1, dt * 2.5); const n = this.night;
    this.hemi.intensity = .8 - .42 * n; this.sun.intensity = 1.35 - .8 * n;
    if (!this._c0) { this._c0 = new T3.Color("#e4e2dc"); this._c1 = new T3.Color("#cdd1d0"); this._cc = new T3.Color(); }
    this.r.setClearColor(this._cc.copy(this._c0).lerp(this._c1, n), 1);
    Object.values(this.units).forEach(u => {
      if (now >= u.delay) u.cur += (u.tgt - u.cur) * Math.min(1, dt * 6);
      const isSel = S.sel === u.c.id && document.body.classList.contains("card-open");
      let e = u.cur;
      if (u.light === "dim") e = .75;
      if (isSel) e = Math.min(e, .7);
      u.wallM.emissiveIntensity = e * (now >= u.delay ? 1 : 0);
      u.beam.material.opacity = u.light === "on" && !isSel ? .2 * Math.min(1, u.cur / 3) : 0;
      u.glow.material.opacity = isSel ? 0 : u.light === "on" ? .55 * Math.min(1, u.cur / 3) : u.light === "dim" ? .18 : u.light === "browse" ? .12 : 0;
      u.ring.material.opacity = u.light === "on" && !isSel ? .45 : 0;
      u.ring0.material.opacity = 0;
      u.sq.material.opacity = u.light === "dim" ? .5 : 0;
      u.lift = (u.lift || 0) + ((u.liftT || 0) - (u.lift || 0)) * Math.min(1, dt * 10); u.blds.position.y = u.lift;
      const p = this.project(new T3.Vector3(u.c.map_x, u.top + .6, u.c.map_z)); const far = this.zoom < 18 / MAP_K; u.lbl.classList.toggle("is-sel", S.sel === u.c.id && document.body.classList.contains("card-open"));
      u.lbl.style.left = p.x + "px"; u.lbl.style.top = p.y + "px"; u.lbl.classList.toggle("is-dot", far); const focus = this.lineFor && S.sel; u.lbl.classList.toggle("is-faint", !!focus && focus !== u.c.id);
    });
    const near = this.zoom >= 30;
    this.lines.visible = near;
    if (this.lineFor) {
      if (!this.fly0) this.lineT = Math.min(1, this.lineT + dt / .4); /* 줌인이 끝난 뒤에 선을 그려요 */
      this.lines.children.forEach(m => m.geometry.setDrawRange(0, Math.floor(m.userData.count * this.lineT / 3) * 3));
    }
    /* 시설 라벨: 겹치면 위아래로 밀어내요 */
    const placed = [];
    $$(".ilabel", $("#lblLayer")).map(el => ({ el, p: this.project(el._p), w: el.offsetWidth + 6, h: el.offsetHeight + 4 })).sort((a, b) => a.p.y - b.p.y).forEach(o => {
      let y = o.p.y;
      for (let k = 0; k < placed.length; k++) { const q = placed[k]; if (Math.abs(o.p.x - q.x) < (o.w + q.w) / 2 && Math.abs(y - q.y) < (o.h + q.h) / 2) { y = q.y + (o.h + q.h) / 2 + 1; k = -1; } } /* +1: 소수점 오차로 같은 자리에서 다시 겹치지 않게 */
      placed.push({ x: o.p.x, y, w: o.w, h: o.h });
      const el = o.el; el.style.left = o.p.x + "px"; el.style.top = y + "px"; el.style.opacity = near && this.lineT >= 1 ? 1 : 0; el.style.visibility = near ? "visible" : "hidden";
    });
    this.r.render(this.scene, this.cam);
  }
};
let _beam = null;
function beamTex() { if (_beam) return _beam; const c = document.createElement("canvas"); c.width = 4; c.height = 128; const x = c.getContext("2d"); const g = x.createLinearGradient(0, 128, 0, 0); g.addColorStop(0, "rgba(255,255,255,.9)"); g.addColorStop(.35, "rgba(255,255,255,.35)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 4, 128); _beam = new T3.CanvasTexture(c); return _beam; }
let _glow = null;
function glowTex() { if (_glow) return _glow; const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d"); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(.4, "rgba(255,255,255,.35)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return _glow = new T3.CanvasTexture(c); }

/* [house_view.js] 집 보기(House)는 house_view.js 에 있다. build.py 가 이 줄 자리에 끼워 넣는다 */

/* ═══════════════ S6 24시간 상담 (규칙이 답을 만들고 AI가 쉽게 풀어 쓴다) ═══════════════ */
const QUICK = ["내 판정 결과 쉽게 설명해 줘", "확인 필요는 어떻게 확인해요?", "신청은 어디서, 뭐가 필요해요?", "이 단지 월 부담은 어떻게 계산했어요?", "계약 전에 꼭 확인할 것은?"];
const Consult = {
  init() {
    $("#fab").onclick = () => this.open(); $("#drClose").onclick = () => this.close();
    $("#drQuick").innerHTML = QUICK.map(q => `<button data-q="${esc(q)}">${esc(q)}</button>`).join("");
    $$("#drQuick button").forEach(b => b.onclick = () => this.ask(b.dataset.q));
    $("#drForm").addEventListener("submit", e => { e.preventDefault(); const v = $("#drIn").value.trim(); if (v) { $("#drIn").value = ""; this.ask(v); } });
    this.say("안녕하세요. 대구 집 찾기와 대출·지원 요건을 안내해 드려요. 아래 질문을 눌러보거나 직접 물어보세요.", []);
    if (window.visualViewport) { visualViewport.addEventListener("resize", () => this.fit()); visualViewport.addEventListener("scroll", () => this.fit()); }
  },
  isOpen: false, from: null,
  open() { if (!this.isOpen) this.from = document.activeElement; this.isOpen = true; $("#drawer").classList.add("is-open"); $("#drawer").setAttribute("aria-hidden", "false"); this.fit(); if (!isPhone()) setTimeout(() => { if (this.isOpen) $("#drIn").focus(); }, 250); },
  /* 닫으면 서랍을 연 단추로 초점을 돌려준다. 화면이 바뀌어서 닫는 때(quiet)는 그 단추가 없을 수 있어 돌리지 않는다 */
  close(quiet) {
    if (!this.isOpen) return; this.isOpen = false;
    const d = $("#drawer"), inside = d.contains(document.activeElement);
    d.classList.remove("is-open"); d.setAttribute("aria-hidden", "true"); $("#drIn").blur(); this.fit();
    if (!quiet && inside && this.from && this.from.isConnected) this.from.focus({ preventScroll: true });
  },
  /* 휴대폰: 화면 키보드가 올라오면 서랍을 실제로 보이는 높이에 맞춰 입력 칸이 가려지지 않게 한다 */
  fit() {
    const d = $("#drawer"), vv = window.visualViewport;
    if (!vv || !isPhone() || !d.classList.contains("is-open")) { d.style.height = d.style.top = ""; return; }
    d.style.height = vv.height + "px"; d.style.top = vv.offsetTop + "px"; $("#drBody").scrollTop = 1e6;
  },
  say(text, links, me) {
    const d = document.createElement("div"); d.className = "msg " + (me ? "me" : "ai"); d.textContent = text;
    if (links && links.length) { const l = document.createElement("div"); l.className = "links"; l.innerHTML = links.map(x => x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)} ↗</a>` : x.action ? `<a href="${esc(x.action)}">${esc(x.label)}</a>` : `<span>${esc(x.label)}</span>`).join(""); d.appendChild(l); }
    $("#drBody").appendChild(d); $("#drBody").scrollTop = 1e6; return d;
  },
  ask(q) {
    this.say(q, null, true);
    const [t, l] = this.answer(q);
    /* 개인정보(번호)가 섞인 질문이나 파일로 바로 연 화면에서는 서버를 부르지 않고 규칙이 만든 답을 바로 보여 준다 */
    if (/주민(?:등록)?\s?번호|계좌\s?번호|비밀번호|여권\s?번호|카드\s?번호|\d{6}\s*-?\s*\d{7}/.test(q) || !/^https?:$/.test(location.protocol)) { setTimeout(() => this.say(t, l), 250); return; }
    const wait = this.say("답을 쓰고 있어요…", []);
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
    const tidy = s => String(s || "").replace(/\s*\(입력 만 \d+세\)/g, "");
    /* 판정·숫자·링크는 규칙이 만든 것을 그대로 쓰고, AI는 말만 쉽게 푼다. 실패하면 규칙 답을 보여 준다 */
    fetch("/api/consult", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q.slice(0, 500), draft: tidy(t), facts: tidy(this.facts()) }), signal: ctl.signal })
      .then(r => r.ok ? r.json() : null).catch(() => null)
      .then(d => {
        clearTimeout(timer);
        const ai = d && d.isFallback === false && typeof d.answer === "string" ? d.answer.trim() : "";
        const m = this.say(ai || t, l);
        if (ai) { const n = document.createElement("small"); n.className = "msg-note"; n.textContent = "AI가 쉽게 풀어 쓴 답이에요. 판정과 숫자는 규칙이 계산했어요."; m.appendChild(n); }
        /* 답은 기다리던 말풍선 자리에 넣는다 (질문을 연달아 보내도 질문과 답의 짝이 맞게) */
        wait.replaceWith(m); $("#drBody").scrollTop = 1e6;
      });
  },
  /* AI에 보내는 자료: 규칙이 계산한 판정, 고른 단지의 월 부담 내역, 공고 요약. 나이·소득 같은 입력값 자체는 넣지 않는다 */
  facts() {
    const L = ["[규칙 판정 결과] (규칙으로 계산한 값이에요. 바꾸지 마세요)"];
    if (!S.pr) L.push("없음 (조건을 입력하지 않았어요)");
    else [...S.pr.loans, ...S.pr.policies].forEach(x => L.push(`- ${x.name}: ${ST_KO[x.status]} · 이유: ${x.reason} · 최종 결정: ${x.approval_by}`));
    const c = S.sel && COMPLEX.find(x => x.id === S.sel), ev = c && S.evals[c.id];
    if (c) {
      L.push("", "[선택한 단지]", `- 이름: ${c.name} · ${SUPPLY_KO[c.supply_type]} · ${c.area_m2}㎡ · 보증금 ${wonK(c.deposit)} · 관리비 ${wonFull(c.mgmt)}${c.mgmt_known ? "" : "(추정)"}`);
      if (ev) {
        L.push(`- 이 단지 판정: ${LIGHT_KO[ev.light]} · ${ev.light_reason}`);
        const bd = breakdown(c, ev);
        if (bd) L.push(`- 월 부담 내역: 월세 ${wonFull(bd.rent)}, 관리비 ${wonFull(bd.mgmt)}, 대출이자 ${wonFull(bd.loan_interest)}(${wonK(bd.loan_needed)} × ${bd.rate}% ÷ 12), 월세지원 -${wonFull(bd.rent_support)}, 합계 월 ${wonFull(bd.total)} (${bd.financing} 기준)`);
      } else L.push("- 월 부담: 조건을 입력하지 않아 계산하지 않았어요");
    }
    L.push("", "[공고 요약] (시연용 요약이에요. 여기에 없는 내용은 공고에서 확인이 필요해요)");
    Object.keys(POLICY_DOCS).forEach(k => { const d = POLICY_DOCS[k], n = (RULES.loans.concat(RULES.policies).find(x => x.id === k) || RULES.market_loan).name; L.push(`<${n}> 담당: ${d.agency} · ${d.apply}`); });
    L.push("", "[계약 전 체크리스트]");
    RULES.fixed_checklist.concat(["등기부등본으로 소유자·근저당 확인", "전세보증보험 가입 가능 여부 확인"]).forEach(x => L.push("- " + x));
    return L.join("\n");
  },
  polLinks(ids) { return ids.map(id => POLICY_DOCS[id]).filter(Boolean).filter(d => d.info_url).map(d => ({ label: d.agency + " 안내", url: d.info_url })).filter((x, i, a) => a.findIndex(y => y.url === x.url) === i); },
  answer(q) {
    const needP = () => ["판정은 기본정보를 넣어야 정확히 알려드릴 수 있어요. 30초면 돼요.", [{ label: "정보 입력하기", action: "#input" }]];
    if (/주민(?:등록)?\s?번호|계좌\s?번호|비밀번호|여권\s?번호|카드\s?번호|\d{6}\s*-?\s*\d{7}/.test(q)) return ["그런 정보는 여기 입력하지 마세요. 상담에는 필요 없어요.", []];
    if (/같이|중복|둘 다|함께/.test(q) && /(버팀목|이자)/.test(q)) return ["대구 청년 이자지원은 주택도시기금 전세대출(버팀목 등) 이용자는 제외되고, HF 청년 특례전세보증과도 같이 받지 않아요. 그래서 버팀목·HF 특례보증·대구 이자지원은 더하지 않고, 하나씩 따로 계산해서 월 부담이 낮은 쪽을 기본으로 보여줘요. 어느 쪽이 유리한지는 단지 카드의 계산 내역에서 볼 수 있어요.", this.polLinks(["daegu_interest", "youth_beotimok", "hf_youth_guarantee"])];
    if (/대출\s*(돼|되|가능)|받을 수 있/.test(q)) { if (!S.pr) return needP(); const y = S.pr.loans[0]; return [`입력하신 조건 기준으로 ${y.name.replace("(시연용)", "")}은 ${ST_KO[y.status]}이에요. 실제 대출 여부와 한도는 ${y.approval_by}이(가) 심사로 정해요. 계약금을 내기 전에 은행 사전 상담부터 받아보세요.`, this.polLinks(["youth_beotimok"])]; }
    if (/설명|결과|판정/.test(q)) {
      if (!S.pr) return needP();
      const lines = [...S.pr.loans, ...S.pr.policies].map(x => `${x.name.replace("(시연용)", "")}: ${ST_KO[x.status]}. ${x.reason}`);
      const n = counts();
      return [lines.join("\n") + `\n\n지도에서는 ● ${n.on}곳 · ◐ ${n.dim}곳 · ○ ${n.off}곳이에요. 확인 필요 항목은 '확인 필요는 어떻게 확인해요?'를 눌러 보세요.`, this.polLinks(["youth_beotimok", "daegu_interest", "youth_monthly_rent"])];
    }
    if (/확인 필요|어떻게 확인/.test(q)) {
      if (!S.pr) return needP();
      const ck = [...S.pr.loans, ...S.pr.policies].filter(x => x.status === "needs_check");
      if (!ck.length) return ["확인 필요로 나온 항목이 없어요.", []];
      return [ck.map(x => { const d = POLICY_DOCS[x.id] || {}; return `${x.name.replace("(시연용)", "")}: ${(x.always_needs_check && x.always_needs_check.length ? x.always_needs_check.join(", ") : x.reason)} → ${d.agency || x.approval_by}에 문의`; }).join("\n") + "\n\n먼저 은행 사전 상담에서 대출 한도부터 확인해 보세요.", this.polLinks(ck.map(x => x.id))];
    }
    if (/신청|서류|어디서/.test(q)) {
      const ids = S.pr ? [...S.pr.loans, ...S.pr.policies].filter(x => x.status !== "ineligible").map(x => x.id) : Object.keys(POLICY_DOCS);
      return [ids.map(id => POLICY_DOCS[id] && `${(RULES.loans.concat(RULES.policies).find(x => x.id === id) || RULES.market_loan).name.replace("(시연용)", "")}: ${POLICY_DOCS[id].apply}`).filter(Boolean).join("\n\n") + "\n\n(시연용 요약이에요. 신청 전 공고 원문을 꼭 확인하세요.)", this.polLinks(ids)];
    }
    if (/월 부담|계산|얼마/.test(q)) {
      if (!S.pr) return needP();
      const id = S.sel || Object.keys(S.evals)[0], c = COMPLEX.find(x => x.id === id), ev = S.evals[id], bd = breakdown(c, ev);
      if (!bd) return [`${c.name}은 ${ev.light_reason}`, []];
      return [`${c.name} 기준이에요.\n관리비 ${wonFull(bd.mgmt)}${bd.rent ? ` + 월세 ${wonFull(bd.rent)}` : ""} + 대출이자 ${wonFull(bd.loan_interest)}(${bd.calc})${bd.rent_support ? ` − 월세지원 ${wonFull(bd.rent_support)}` : ""} = 월 ${wonFull(bd.total)} (${bd.financing}).\n${ev.light === "on" ? "요건 충족 지원만으로 계산한 값이에요." : "확인 필요 지원까지 받을 때 값이에요."} 다른 단지를 보려면 지도에서 단지를 눌러 주세요.`, []];
    }
    if (/계약|특약|전에/.test(q)) return ["계약 전에 꼭 확인하세요.\n1. 계약금 내기 전 은행 대출 사전 상담\n2. 대출 불가 시 계약 해제 특약 확인\n3. 등기부등본으로 소유자·근저당 확인\n4. 전세보증보험 가입 가능 여부 확인\n먼저 1번부터 해보세요.", []];
    return ["그 질문은 아직 답을 준비하지 못했어요. 관련 기관 상담으로 연결해 드릴게요.", this.polLinks(["youth_beotimok", "daegu_interest", "youth_monthly_rent"])];
  }
};

/* ─── 평면 그림 (홈 갤러리용) ─── */
function planSVG(L) {
  const pad = .5, s = 100, vw = (L.W + pad * 2) * s, vh = (L.D + pad * 2) * s;
  const rooms = L.rooms.map(r => `<rect x="${(r.x + pad) * s}" y="${(r.z + pad) * s}" width="${r.w * s}" height="${r.d * s}" fill="${r.type === "bath" ? "#e6e8e4" : r.type === "kitchen" ? "#efe7da" : r.type === "hall" || r.type === "dress" ? "#ece8e0" : "#f4ede1"}"/><text x="${(r.x + r.w / 2 + pad) * s}" y="${(r.z + r.d / 2 + pad) * s}" font-size="${Math.min(30, r.w * 11)}" text-anchor="middle" dominant-baseline="middle" fill="#71746f" font-family="Pretendard, sans-serif">${esc(r.name)}</text>`).join("");
  const walls = L.pieces.filter(p => p.kind === "solid" || p.kind === "sill").map(p => p.axis === "x" ? `<line x1="${(p.a + pad) * s}" y1="${(p.c + pad) * s}" x2="${(p.b + pad) * s}" y2="${(p.c + pad) * s}"/>` : `<line x1="${(p.c + pad) * s}" y1="${(p.a + pad) * s}" x2="${(p.c + pad) * s}" y2="${(p.b + pad) * s}"/>`).join("");
  return `<svg viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(L.name)} 평면도"><rect width="100%" height="100%" fill="#fcfbf9"/>${rooms}<g stroke="#1f6b4f" stroke-width="13" stroke-linecap="square">${walls}</g></svg>`;
}

/* ─── 시작 ─── */
Consult.init();
/* 화면 폭이 휴대폰 기준(820px)을 넘나들면 패널과 카드를 그 화면에 맞게 다시 맞춘다 */
PHONE.addEventListener("change", () => { if (!VIEW) return; syncPl(); setTab(S.tab || "sum"); Consult.fit(); });
/* Escape: 메뉴가 열려 있으면 메뉴만 닫히고(shell.js), 아니면 상담 서랍 → 단지 카드 순서로 닫는다 */
addEventListener("keydown", e => {
  if (e.key !== "Escape" || !VIEW || document.body.classList.contains("menu-open")) return;
  const p = $("#panelR");
  if (Consult.isOpen) Consult.close();
  else if (p.classList.contains("is-open")) { const u = MapView.units[S.sel], back = p.contains(document.activeElement); closeCard(); MapView.select(null); if (back && u) u.lbl.focus({ preventScroll: true }); }
});
$("#plToggle").onclick = () => { plOpen = !plOpen; if (plOpen && document.body.classList.contains("card-open")) { closeCard(); MapView.select(null); } syncPl(); };
window.MH = {
  route(v) { if (v === "map" && S.profile && S.mode !== "match" && !route.seen) S.mode = "match"; route.seen = true; route(v); if (v === "map" && MapView.ok) MapView.applyMode(false); },
  browse() { S.mode = "browse"; if (location.hash === "#map") { route("map"); MapView.applyMode(false); } else location.hash = "#map"; },
  openHouse(cid) { S.sel = cid; location.hash = "#house"; },
  /* 지도에서 이 단지를 누른 것과 같게 연다 (집찾기 대화의 [지도에서 보기]). 지도를 못 그리면 카드만 연다 */
  /* 공개 미분양 점(k = UNSOLD_LIST 순번)을 지도에서 연다 */
  openUnsold(k) { if (!UNSOLD_LIST[k]) return; if (location.hash !== "#map") location.hash = "#map"; const go = n => MapView.ok ? MapView.selectUnsold(k) : n > 0 ? setTimeout(() => go(n - 1), 150) : openUnsold(k); setTimeout(() => go(20), 50); },
  openMap(cid) { if (!COMPLEX.some(c => c.id === cid)) return; S.sel = cid; if (location.hash !== "#map") location.hash = "#map"; const go = n => MapView.ok ? MapView.select(cid, true) : n > 0 ? setTimeout(() => go(n - 1), 150) : openCard(cid); setTimeout(() => go(20), 50); },
  /* 눈높이로 집 보기: "child"(아이) 나 "adult"(어른). 다음에 집 보기를 열 때 room.html 에 view=3d&eye=<mode> 를 붙인다 (한 번 쓰고 지운다).
     이미 집 보기 화면이면 바로 다시 연다. 눈높이 화면 자체는 방 배치 도구(room.html)가 그린다 */
  setEye(mode) {
    House.eye = mode === "child" || mode === "adult" ? mode : null;
    if (House.eye && VIEW === "house") House.open(S.sel);
  },
  galleryCards() {
    return COMPLEX.map(c => { const L = buildLayout(c.room_id || "room_84a");
      return `<button class="plan-card" data-cid="${c.id}" aria-label="${esc(c.name)} 집 보기"><div class="plan-card__media">${planSVG(L)}<span class="tag-example">${c.is_sample ? "예시 단지" : "공개 보도 단지"}</span></div>
        <p class="plan-card__name">${esc(c.name)}</p><p class="plan-card__meta">${esc(c.district)} · ${SUPPLY_KO[c.supply_type]} · ${c.area_m2}㎡ · 보증금 ${wonK(c.deposit)}</p></button>`; }).join("");
  }
};
}

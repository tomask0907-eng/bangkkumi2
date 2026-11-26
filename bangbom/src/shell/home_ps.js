/* ═══════ 홈 해결 1(지원 찾기)과 해결 2(칩으로 바꿔 보기) ═══════
   해결 1: 이 브라우저에 저장된 내 조건(mh-profile)이 있으면 판정 코드(engine.js 의 profileResult·evaluate·appliedLists)로 실제 결과를,
   없으면 숫자 없이 "어떻게 따지는지"만 보여 준다. 예시 페르소나 숫자는 쓰지 않는다. 판정·개수는 이 파일에서 만들지 않는다 */
(() => {
  const sup = document.getElementById("homeSupport");
  const h = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LK = { on: "요건 충족", dim: "확인 필요", off: "미충족" }, SK = { eligible: "요건 충족", needs_check: "확인 필요", ineligible: "미충족" };
  const ST_JD = { eligible: "on", needs_check: "dim", ineligible: "off" }, ORDER = { on: 0, dim: 1, off: 2 };
  const jd = (k, label) => `<span class="jd jd--${k}"><i aria-hidden="true"></i>${h(label || LK[k])}</span>`;
  const house = (k, title) => `<svg class="hi hi--${k}" viewBox="0 0 24 24" role="img" aria-label="${h(title)}">${k === "dim" ? `<path class="hi__half" d="M3.5 11 12 4.2V20H3.5z"/>` : ""}<path d="M3.5 11 12 4.2l8.5 6.8V20h-17z"/></svg>`;
  const won = man => Math.round(man * 10000).toLocaleString("ko-KR") + "원";
  const profile = () => { try { const p = JSON.parse(localStorage.getItem("mh-profile") || "null"); return p && typeof p.age === "number" && typeof p.monthly_income === "number" ? p : null; } catch (e) { return null; } };
  /* 같이 못 받는 지원: 규칙(RULES)에 적힌 "둘 중 하나" 짝 */
  const pairRule = () => { const p = RULES.policies.find(x => Array.isArray(x.exclusive_with) && x.exclusive_with.length); if (!p) return null; const other = RULES.loans.find(l => l.id === p.exclusive_with[0]); return other ? { kept: other.name, drop: p.name } : null; };

  function fillSupport() {
    if (!sup) return;
    const P = profile();
    if (!P) {
      const names = [...RULES.loans, RULES.market_loan, ...RULES.policies].map(x => x.name);
      const pr = pairRule();
      sup.innerHTML = `
      <div class="sf reveal is-in">
        <div class="sf__step"><div class="sf__h"><span class="sf__no">01</span><b>조건만 넣으면</b></div>
          <ul class="sf__chips" aria-label="넣는 조건"><li>나이</li><li>월 실수령</li><li>모은 돈</li><li>월 예산</li></ul>
          <p class="sf__note">여덟 가지 질문에 하나씩 답해요. 입력값은 이 브라우저에만 저장해요.</p></div>
        <span class="sf__arrow" aria-hidden="true"></span>
        <div class="sf__step"><div class="sf__h"><span class="sf__no">02</span><b>하나씩 따져서</b></div>
          <ul class="sf__list">${names.map(n => `<li><span>${h(n)}</span></li>`).join("")}</ul>
          <p class="sf__note">${jd("on")} ${jd("dim")} ${jd("off")} 중 하나로 알려 줘요.</p></div>
        <span class="sf__arrow" aria-hidden="true"></span>
        <div class="sf__step"><div class="sf__h"><span class="sf__no">03</span><b>같이 못 받는 건 걸러요</b></div>
          ${pr ? `<div class="sf__pair"><p class="sf__keep">${h(pr.kept)}</p><p class="sf__or"><span>둘 중 하나</span></p><p class="sf__drop"><s>${h(pr.drop)}</s><em>빠짐</em></p></div>` : ""}
          <p class="sf__note">빠진 쪽은 월 부담 계산에 넣지 않아요.</p></div>
      </div>
      <div class="sf-result reveal is-in">
        <p class="sf-result__t">대구 단지 ${COMPLEXES.length}곳 중 들어갈 수 있는 곳에 불이 켜져요</p>
        <div class="sf-result__houses" aria-hidden="true">${COMPLEXES.map(() => house("off", "")).join("")}</div>
      </div>
      <p class="sf-foot reveal is-in">모르는 건 AI 상담에 물어보세요. <a href="#input" class="link">내 조건 넣기 →</a></p>`;
      return;
    }
    const pr = profileResult(P), evs = COMPLEXES.map(c => ({ c, e: evaluate(P, c, pr) }));
    const n = { on: 0, dim: 0, off: 0 }; evs.forEach(x => n[x.e.light]++);
    const items = [...pr.loans, ...pr.policies].map((x, i) => ({ x, k: ST_JD[x.status], i })).sort((a, b) => ORDER[a.k] - ORDER[b.k] || a.i - b.i);
    let clash = null;
    for (const { c, e } of evs) {
      const al = appliedLists(c, e, pr), na = al.not_applied.find(x => /하나만/.test(x.reason));
      const kept = na && al.applied.find(x => x.id === "youth_beotimok" || x.id === "hf_youth_guarantee");
      if (na && kept) { clash = { kept, drop: na }; break; }
    }
    const lights = evs.slice().sort((a, b) => ORDER[a.e.light] - ORDER[b.e.light]);
    const chips = [`${P.age}세`, `월 실수령 ${won(P.monthly_income)}`, `모은 돈 ${won(P.assets)}`, `월 예산 ${won(P.monthly_budget)}`];
    sup.innerHTML = `
      <div class="sf reveal is-in">
        <div class="sf__step"><div class="sf__h"><span class="sf__no">01</span><b>넣은 조건</b></div>
          <ul class="sf__chips" aria-label="넣은 조건">${chips.map(t => `<li>${h(t)}</li>`).join("")}</ul>
          <p class="sf__note">이 브라우저에 저장된 내 조건이에요. <a href="#input" class="link">바꾸기</a></p></div>
        <span class="sf__arrow" aria-hidden="true"></span>
        <div class="sf__step"><div class="sf__h"><span class="sf__no">02</span><b>하나씩 따져서</b></div>
          <ul class="sf__list">${items.map(({ x, k }) => `<li><span>${h(x.name)}</span>${jd(k, SK[x.status])}</li>`).join("")}</ul></div>
        <span class="sf__arrow" aria-hidden="true"></span>
        <div class="sf__step"><div class="sf__h"><span class="sf__no">03</span><b>같이 못 받는 건 걸러요</b></div>
          ${clash ? `<div class="sf__pair"><p class="sf__keep">${h(clash.kept.name)}</p><p class="sf__or"><span>둘 중 하나</span></p><p class="sf__drop"><s>${h(clash.drop.name)}</s><em>빠짐</em></p></div>
          <p class="sf__note">빠진 쪽은 월 부담 계산에 넣지 않아요.</p>` : `<p class="sf__note">이 조건에서는 같이 못 받는 지원이 없어요.</p>`}</div>
      </div>
      <div class="sf-result reveal is-in">
        <p class="sf-result__t">대구 단지 ${COMPLEXES.length}곳 중</p>
        <div class="sf-result__houses">${lights.map(({ c, e }) => house(e.light, `${c.name.replace("(예시)", "").trim()} · ${LK[e.light]}`)).join("")}</div>
        <p class="sf-result__n"><span><i class="jd-dot jd-dot--on" aria-hidden="true"></i>${LK.on} <b>${n.on}</b></span><span><i class="jd-dot jd-dot--dim" aria-hidden="true"></i>${LK.dim} <b>${n.dim}</b></span><span><i class="jd-dot jd-dot--off" aria-hidden="true"></i>${LK.off} <b>${n.off}</b></span></p>
      </div>
      <p class="sf-foot reveal is-in">판정은 규칙이 계산하고, 최종 결정은 각 기관이 해요. <a href="#map" class="link">지도에서 보기 →</a></p>`;
  }
  fillSupport();
  addEventListener("hashchange", () => { if (location.hash === "#home" || location.hash === "") fillSupport(); });

  /* 해결 2: 칩을 누르면 설명과 그림을 바꾼다. 보이는 영상만 재생된다(shell.js 의 영상 관찰) */
  const tabs = Array.from(document.querySelectorAll(".s2-tab"));
  tabs.forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.s2;
    tabs.forEach(t => { const on = t === b; t.classList.toggle("is-on", on); t.setAttribute("aria-selected", on); });
    document.querySelectorAll("[data-s2p]").forEach(p => { p.hidden = p.dataset.s2p !== k; });
    document.querySelectorAll("[data-s2m]").forEach(m => { m.hidden = m.dataset.s2m !== k; m.classList.toggle("is-on", m.dataset.s2m === k); });
  }));
})();

/* ═════════ 시작 화면(이름)과 튜토리얼 ═════════
   처음 온 사람이 집 찾기 흐름(#input · #map · #house)에 들어오면 시작 화면 → 튜토리얼을 한 번만 보여 준다. 홈과 이용 안내는 그냥 볼 수 있다.
   - 이름: localStorage "bangbom.user.v1" = {"name","since"}. 계정이 아니다. 이 브라우저에만 두고 요청·주소·상담 질문 어디에도 넣지 않는다
   - 튜토리얼을 본 기록: localStorage "bangbom.tutorial.v1" = "done"
   - 주소에 tutorial=0 이 있으면 둘 다 저절로 뜨지 않는다(자동 검사용). tutorial=1 이면 튜토리얼을 다시 연다
   - app_bb.js 의 { } 밖이라 window.MH 와 화면(DOM), location 만 쓴다. 이름은 textContent·value 로만 넣어서 HTML 로 읽히지 않게 한다 */
(function () {
  "use strict";
  const K_USER = "bangbom.user.v1", K_TUT = "bangbom.tutorial.v1", MAX = 12;
  const APP = ["input", "map", "house"];
  /* mobile_app.css 와 같은 휴대폰 기준 */
  const PHONE = matchMedia("(max-width:820px)");
  const MH = window.MH || (window.MH = {});
  /* 창(dialog)을 못 여는 오래된 브라우저에서는 시작 화면과 튜토리얼만 건너뛴다. 나머지 화면은 그대로 쓴다 */
  const CAN = typeof HTMLDialogElement === "function" && typeof HTMLDialogElement.prototype.showModal === "function";

  /* ── 저장: 저장소가 막힌 브라우저에서는 이 탭이 열려 있는 동안만 기억한다 ── */
  const mem = {};
  const read = k => { try { const v = localStorage.getItem(k); if (v != null) return v; } catch (e) {} return k in mem ? mem[k] : null; };
  const write = (k, v) => { try { localStorage.setItem(k, v); delete mem[k]; } catch (e) { mem[k] = v; } };
  const drop = k => { delete mem[k]; try { localStorage.removeItem(k); } catch (e) {} };

  /* 이름 다듬기: 앞뒤 빈칸을 떼고 가운데 빈칸은 하나로. 글자 수는 눈에 보이는 글자 단위로 센다(어느 나라 글자든) */
  const tidy = v => { let s = String(v == null ? "" : v); try { s = s.normalize("NFC"); } catch (e) {} return s.replace(/\s+/g, " ").trim(); };
  const count = s => Array.from(s).length;
  const user = {
    /* 깨진 값은 없는 것으로 본다 */
    get() {
      try {
        const o = JSON.parse(read(K_USER) || "null");
        if (!o || typeof o !== "object" || typeof o.name !== "string") return null;
        return { name: Array.from(tidy(o.name)).slice(0, MAX).join("").trim(), since: typeof o.since === "string" ? o.since : "" };
      } catch (e) { return null; }
    },
    /* 빈 이름("")도 저장한다: 시작은 한 것이라 시작 화면이 다시 뜨지 않는다. 12자를 넘으면 저장하지 않는다 */
    set(name) {
      name = tidy(name);
      if (count(name) > MAX) return null;
      const old = user.get(), rec = { name, since: (old && old.since) || new Date().toISOString() };
      write(K_USER, JSON.stringify(rec)); chips();
      return rec;
    },
    clear() { drop(K_USER); drop(K_TUT); chips(); }
  };
  const seen = () => read(K_TUT) === "done";
  /* 주소의 tutorial 값은 물을 때마다 다시 읽는다 (화면을 새로 읽지 않고 주소만 바뀔 수 있다) */
  const param = () => { try { return new URLSearchParams(location.search).get("tutorial"); } catch (e) { return null; } };
  const inApp = () => APP.includes(location.hash.replace("#", ""));

  /* ── 튜토리얼 네 걸음: 그림은 방봄 화면의 모양(불빛·단지 카드·평면·말풍선)을 그대로 줄여 그린 것 ── */
  const svg = inner => `<svg viewBox="0 0 320 132" focusable="false">${inner}</svg>`;
  const wins = (x, y, cols, rows, lit) => { let s = ""; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) s += `<rect x="${x + c * 14}" y="${y + r * 12}" width="8" height="8" rx="1.5" fill="${lit(r, c) ? "#FFC46B" : "#dcd9d1"}"/>`; return s; };
  /* 단지 이름표(지도의 알약)와 그 안의 표시. 표시는 색이 아니라 모양(꽉 참·반·빈 동그라미)으로 가른다 */
  const pin = (cx, y, mark, ink) => `<rect x="${cx - 17}" y="${y}" width="34" height="22" rx="11" fill="${ink ? "#141714" : "#fff"}" stroke="${ink ? "#141714" : "#cfccc4"}"/><path d="M${cx - 5} ${y + 21.4}l5 5.1 5-5.1" fill="${ink ? "#141714" : "#fff"}" stroke="${ink ? "#141714" : "#cfccc4"}"/>${mark}`;
  const ground = (a, b) => `<path d="M${a} 108.75H${b}" stroke="#cfccc4" stroke-width="1.5" stroke-linecap="round"/>`;
  const STEPS = [
    {
      title: "방봄은 이렇게 써요.",
      body: "조건을 넣으면 대출·지원 요건을 따져서 단지마다 불이 켜져요. 불빛은 세 가지예요.",
      more: '<ul class="bbt__marks"><li class="is-on">● 요건 충족</li><li class="is-dim">◐ 확인 필요</li><li class="is-off">○ 미충족</li></ul>',
      art: svg(ground(22, 298)
        + '<rect x="30" y="92" width="20" height="16" rx="2" fill="#e1dfd8"/><rect x="116" y="96" width="14" height="12" rx="2" fill="#e1dfd8"/><rect x="190" y="90" width="14" height="18" rx="2" fill="#e1dfd8"/><rect x="266" y="94" width="26" height="14" rx="2" fill="#e1dfd8"/>'
        + '<rect x="62" y="64" width="48" height="44" rx="3" fill="#fcfbf9" stroke="#141714" stroke-width="1.5"/>' + wins(70, 72, 3, 3, () => true)
        + pin(86, 28, '<circle cx="86" cy="39" r="5.5" fill="#1f6b4f"/>')
        + '<rect x="136" y="48" width="48" height="60" rx="3" fill="#fcfbf9" stroke="#141714" stroke-width="1.5"/>' + wins(144, 56, 3, 4, (r, c) => (r + c) % 2 === 0)
        + pin(160, 12, '<circle cx="160" cy="23" r="4.75" fill="#fff" stroke="#141714" stroke-width="1.5"/><path d="M160 18.25a4.75 4.75 0 0 0 0 9.5z" fill="#141714"/>')
        + '<rect x="210" y="72" width="48" height="36" rx="3" fill="#eceae4" stroke="#8a8780" stroke-width="1.5"/>' + wins(218, 80, 3, 2, () => false)
        + pin(234, 36, '<circle cx="234" cy="47" r="4.75" fill="#fff" stroke="#8a8780" stroke-width="1.5"/>'))
    },
    {
      title: "불빛을 누르면 월 부담이 보여요",
      body: "단지 카드에서 지원을 반영한 월 부담을 확인해요. 월세·관리비·대출이자에서 지원을 뺀 계산 내역도 같이 보여줘요.",
      art: svg(ground(22, 88)
        + '<rect x="30" y="72" width="40" height="36" rx="3" fill="#fcfbf9" stroke="#141714" stroke-width="1.5"/>' + wins(38, 80, 2, 2, () => true).replace(/width="8"/g, 'width="10"')
        + pin(50, 36, '<circle cx="50" cy="47" r="5.5" fill="#7ED6A8"/>', true)
        + '<path d="M73 47H102" stroke="#141714" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="1 5"/>'
        + '<rect x="108" y="12" width="190" height="108" rx="14" fill="#fff" stroke="#e3e1db" stroke-width="1.5"/>'
        + '<text x="124" y="34" font-size="10.5" fill="#71746f">지원 반영 후 월 부담</text><rect x="124" y="42" width="84" height="14" rx="4" fill="#1f6b4f"/>'
        + '<text x="124" y="78" font-size="11" fill="#141714">월세·관리비</text><rect x="252" y="71" width="30" height="6" rx="3" fill="#cfccc4"/><path d="M124 84.5H282" stroke="#efeeea"/>'
        + '<text x="124" y="94" font-size="11" fill="#141714">대출이자</text><rect x="258" y="87" width="24" height="6" rx="3" fill="#cfccc4"/><path d="M124 100.5H282" stroke="#efeeea"/>'
        + '<text x="124" y="110" font-size="11" fill="#1f6b4f">지원</text><path d="M244 106h6" stroke="#1f6b4f" stroke-width="1.5" stroke-linecap="round"/><rect x="256" y="103" width="26" height="6" rx="3" fill="#1f6b4f"/>')
    },
    {
      title: "집 보기에서 집 안을 미리 봐요",
      body: "집 전체 구조를 보고 방을 골라 가구를 놓아봐요. 아이 눈높이(90cm, 참고값)로도 둘러볼 수 있어요.",
      more: '<p class="bbt__small">평면은 표준 구조를 단순하게 그린 예시예요.</p>',
      art: svg('<rect x="30" y="20" width="56" height="40" fill="#efe7da"/><rect x="86" y="20" width="32" height="40" fill="#e6e8e4"/><rect x="30" y="60" width="88" height="52" fill="#f4ede1"/><rect x="118" y="20" width="58" height="92" fill="#e2efe7"/>'
        + '<rect x="134" y="30" width="32" height="42" rx="3" fill="#fff" stroke="#141714" stroke-width="1.2"/><path d="M134 42.5h32" stroke="#141714" stroke-width="1.2"/><rect x="128" y="94" width="40" height="10" rx="2" fill="#fff" stroke="#141714" stroke-width="1.2"/>'
        + '<rect x="48" y="70" width="26" height="12" rx="2" fill="#fff" stroke="#141714" stroke-width="1.2"/><rect x="40" y="92" width="42" height="12" rx="3" fill="#fff" stroke="#1f6b4f" stroke-width="1.5" stroke-dasharray="3 3"/>'
        + '<path d="M30 20H176V112H30ZM118 20V70M118 88V112M30 60H52M70 60H118M86 20V34M86 48V60" fill="none" stroke="#1f6b4f" stroke-width="4" stroke-linecap="square"/>'
        + ground(204, 294)
        + '<path d="M244 48V108M239.5 48h9M239.5 108h9" fill="none" stroke="#141714"/><text x="253" y="83" font-size="12" fill="#141714">90cm</text>'
        + '<path d="M210 48q12-10 24 0q-12 10-24 0z" fill="#fff" stroke="#141714" stroke-width="1.3"/><circle cx="222" cy="48" r="3.2" fill="#141714"/>')
    },
    {
      title: "궁금한 건 AI 상담에 물어봐요",
      body: "판정과 숫자는 정해진 규칙이 계산하고, AI 상담은 그 결과를 쉬운 말로 풀어 주고, 맞는 집도 대화로 찾아 줘요. 최종 결정은 각 기관이 해요.",
      art: svg('<rect x="136" y="14" width="154" height="32" rx="16" fill="#141714"/><text x="213" y="34.5" font-size="11.5" text-anchor="middle" fill="#fff">월 부담은 어떻게 나와요?</text>'
        + '<rect x="30" y="58" width="158" height="58" rx="16" fill="#fff" stroke="#e3e1db" stroke-width="1.5"/><rect x="46" y="73" width="118" height="5" rx="2.5" fill="#cfccc4"/><rect x="46" y="84" width="94" height="5" rx="2.5" fill="#cfccc4"/><rect x="46" y="96" width="60" height="10" rx="5" fill="#e2efe7"/>'
        + '<rect x="204" y="84" width="92" height="30" rx="15" fill="#141714"/><circle cx="220" cy="99" r="4" fill="#7ED6A8"/><text x="230" y="103" font-size="11.5" fill="#fff">24시간 상담</text>')
    }
  ];

  /* ── 창 하나(<dialog>)를 시작 화면과 튜토리얼이 같이 쓴다: 둘 사이에 뒤 화면이 깜빡이지 않는다 ── */
  let dlg = null, mode = null, step = 0, back = null;
  function box() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.className = "bbt"; dlg.id = "bbt";
    dlg.setAttribute("aria-modal", "true"); dlg.setAttribute("aria-labelledby", "bbtTitle");
    dlg.addEventListener("click", onClick);
    dlg.addEventListener("keydown", onKey);
    dlg.addEventListener("submit", onSubmit);
    dlg.addEventListener("input", onInput);
    /* 휴대폰의 뒤로 가기처럼 Esc 글쇠가 아닌 닫기 요청도 같은 길로 보낸다 */
    dlg.addEventListener("cancel", e => { e.preventDefault(); leave(); });
    /* 브라우저가 스스로 닫은 경우에도(뒤로 가기를 거듭 누름 등) 뒷정리를 한다 */
    dlg.addEventListener("close", () => { if (mode && !dlg.open) shut(); });
    dlg.addEventListener("wheel", hold, { passive: false });
    dlg.addEventListener("touchmove", hold, { passive: false });
    document.body.appendChild(dlg);
    return dlg;
  }
  /* 창이 떠 있는 동안 뒤 화면(홈·이용 안내)이 휠·손가락·글쇠로 따라 움직이지 않게 한다.
     body 의 overflow 를 바꾸면 세로 막대가 사라지면서 화면이 옆으로 밀리므로, 움직임만 막는다. 카드 안이 넘칠 때는 카드만 움직인다.
     두 손가락으로 화면을 키우는 동작은 막지 않는다 */
  function hold(e) {
    if (e.touches && e.touches.length > 1) return;
    const c = dlg.querySelector(".bbt__card");
    if (!c || !c.contains(e.target) || c.scrollHeight <= c.clientHeight) e.preventDefault();
  }
  const MOVE_KEYS = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "];
  /* 휴대폰: 화면 키보드가 올라오면 실제로 보이는 높이에 맞춰 시트가 키보드 위에 오게 한다 (상담 서랍과 같은 방법) */
  function fit() {
    if (!dlg) return;
    const vv = window.visualViewport;
    if (!vv || !dlg.open || !PHONE.matches) { dlg.style.height = dlg.style.top = ""; return; }
    dlg.style.height = vv.height + "px"; dlg.style.top = vv.offsetTop + "px";
  }
  function show(m, html, focusSel, prep) {
    box();
    /* 닫으면 돌아갈 자리. 시작 화면에서 튜토리얼로 넘어갈 때는 처음 자리를 그대로 둔다 */
    if (!dlg.open) back = document.activeElement;
    mode = m; dlg.dataset.mode = m; dlg.innerHTML = html;
    dlg.setAttribute("aria-describedby", m === "tour" ? "bbtBody" : "bbtNote");
    prep();
    const f = dlg.querySelector(focusSel);
    if (f) f.setAttribute("autofocus", "");
    if (!dlg.open) {
      try { dlg.showModal(); } catch (e) { mode = null; back = null; return false; }
    }
    fit();
    if (f) f.focus({ preventScroll: true });
    return true;
  }
  function shut() {
    if (!dlg || !mode) return;
    const m = mode, b = back; mode = null; back = null;
    /* 튜토리얼은 어떻게 닫든(끝까지 봄·건너뛰기·Esc) 본 것으로 적어서 다시 저절로 뜨지 않게 한다 */
    if (m === "tour") write(K_TUT, "done");
    if (dlg.open) dlg.close();
    fit(); dlg.innerHTML = ""; chips();
    /* 열기 전에 있던 자리로 커서를 돌려준다 */
    if (b && b.isConnected && typeof b.focus === "function") b.focus({ preventScroll: true });
  }
  /* Esc: 처음 뜬 시작 화면에서는 '이름 없이 둘러보기'와 같고, 그 밖에는 닫는다 */
  function leave() { if (mode === "start") { user.set(""); tour(); } else shut(); }

  /* ── 시작 화면 (이름 바꾸기도 같은 화면) ── */
  const WARN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.75v3.9M8 11.2v.05"/></svg>';
  function start(rename) {
    if (!CAN) return false;
    const u = user.get(), name = rename && u ? u.name : "";
    const ok = show(rename ? "rename" : "start", `<form class="bbt__card bbt__card--start" method="dialog" novalidate>
<h2 class="bbt__title" id="bbtTitle" tabindex="-1">${name ? "이름을 바꿔요" : "어떻게 불러 드릴까요?"}</h2>
<div class="bbt__field">
<label class="bbt__label" for="bbtName">이름 <small>별명도 좋아요 · ${MAX}자까지</small></label>
<input class="bbt__input" id="bbtName" type="text" autocomplete="nickname" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="예: 봄이" aria-describedby="bbtErr bbtNote">
<p class="bbt__err" id="bbtErr" role="alert" hidden></p>
<p class="bbt__note" id="bbtNote">이름은 이 브라우저에만 저장해요. 계정이 아니고 서버로 보내지 않아요.</p>
</div>
<div class="bbt__btns"><button class="btn" type="submit">${rename ? "저장하기" : "시작하기"}</button><button class="bbt__quiet" type="button" data-act="${rename ? "close" : "noname"}">${rename ? "취소" : "이름 없이 둘러보기"}</button></div>
</form>`, PHONE.matches ? "#bbtTitle" : "#bbtName", () => { dlg.querySelector("#bbtName").value = name; });
    /* PC 에서 이름을 바꿀 때는 적혀 있던 이름을 통째로 골라 두어 바로 새로 칠 수 있게 한다 */
    if (ok && name && !PHONE.matches) dlg.querySelector("#bbtName").select();
    return ok;
  }
  function judge(raw) {
    const name = tidy(raw), n = count(name);
    return { name, err: !n ? "이름을 한 글자 이상 적어 주세요." + (mode === "start" ? " 적지 않으려면 아래 '이름 없이 둘러보기'를 눌러요." : "") : n > MAX ? `이름은 ${MAX}자까지예요. 지금 ${n}자라서 ${n - MAX}자를 줄여 주세요.` : "" };
  }
  function warn(msg) {
    const i = dlg.querySelector("#bbtName"), p = dlg.querySelector("#bbtErr");
    p.innerHTML = msg ? WARN + "<span></span>" : ""; if (msg) p.lastChild.textContent = msg;
    p.hidden = !msg;
    msg ? i.setAttribute("aria-invalid", "true") : i.removeAttribute("aria-invalid");
  }
  function onSubmit(e) {
    /* 주소로 보내는 기본 동작을 막는다: 이름이 주소나 요청에 실리지 않는다 */
    e.preventDefault();
    const i = dlg.querySelector("#bbtName"); if (!i) return;
    const first = mode === "start", r = judge(i.value);
    if (r.err) { warn(r.err); i.focus(); return; }
    user.set(r.name);
    first ? tour() : shut();
  }
  /* 알림이 떠 있는 동안에는 고치는 대로 알림도 바꾼다 */
  function onInput(e) { const p = dlg.querySelector("#bbtErr"); if (p && !p.hidden && e.target.id === "bbtName") warn(judge(e.target.value).err); }

  /* ── 튜토리얼 ── */
  function tour() {
    if (!CAN) return false;
    step = 0;
    return show("tour", `<div class="bbt__card bbt__card--tour">
<div class="bbt__top"><p class="bbt__count" id="bbtCount"></p><button class="bbt__quiet" type="button" data-act="skip">건너뛰기</button></div>
<div class="bbt__art" id="bbtArt" aria-hidden="true"></div>
<div class="bbt__text" aria-live="polite" aria-atomic="true"><h2 class="bbt__title" id="bbtTitle"></h2><p class="bbt__body" id="bbtBody"></p><div id="bbtMore"></div></div>
<div class="bbt__btns"><button class="btn btn--line" type="button" data-act="prev">이전</button><button class="btn" type="button" data-act="next" id="bbtNext"></button></div>
</div>`, "#bbtNext", paint);
  }
  function paint() {
    const s = STEPS[step], u = user.get(), q = x => dlg.querySelector(x), prev = q('[data-act="prev"]'), next = q("#bbtNext");
    /* 첫 걸음으로 돌아오면 [이전]이 사라진다. 커서가 거기 있었으면 [다음]으로 옮긴다 */
    const lost = step === 0 && document.activeElement === prev;
    q("#bbtCount").textContent = (step + 1) + " / " + STEPS.length;
    q("#bbtArt").innerHTML = s.art;
    q("#bbtTitle").textContent = (step === 0 && u && u.name ? u.name + "님, " : "") + s.title;
    q("#bbtBody").textContent = s.body;
    q("#bbtMore").innerHTML = s.more || "";
    prev.hidden = step === 0;
    next.textContent = step === STEPS.length - 1 ? "시작하기" : "다음";
    if (lost) next.focus();
  }
  function onClick(e) {
    const b = e.target.closest ? e.target.closest("[data-act]") : null; if (!b) return;
    const a = b.dataset.act;
    if (a === "noname") { user.set(""); tour(); }
    else if (a === "prev") { step = Math.max(0, step - 1); paint(); }
    else if (a === "next" && step < STEPS.length - 1) { step++; paint(); }
    else shut(); /* 건너뛰기 · 마지막 걸음의 시작하기 · 취소 */
  }
  function onKey(e) {
    /* Esc 를 여기서 처리하고 위로 올리지 않는다: 뒤에 열려 있는 메뉴 패널까지 같이 닫히지 않게 */
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); leave(); return; }
    /* 뒤 화면을 움직이는 글쇠는 막는다. 이름 칸 안의 커서 옮기기와 단추의 스페이스(누르기)는 그대로 둔다 */
    if (MOVE_KEYS.includes(e.key) && !e.target.matches("input") && !(e.key === " " && e.target.matches("button"))) { e.preventDefault(); return; }
    if (e.key !== "Tab") return;
    /* 커서(포커스)가 창 밖으로 나가지 않게 처음과 끝을 잇는다 */
    const f = Array.from(dlg.querySelectorAll("button, input")).filter(el => !el.hidden && !el.disabled);
    const i = f.indexOf(document.activeElement);
    if (f.length && (e.shiftKey ? i <= 0 : i === f.length - 1)) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
  }
  /* 처음 온 사람(이름도, 본 기록도 없음)이 집 찾기 흐름 안에 있을 때만 연다 */
  function maybeStart() {
    if (!CAN || mode || param() === "0" || !inApp() || user.get() || seen()) return false;
    return start(false);
  }

  /* ── 이름 칩: PC 는 위 막대의 메뉴 단추 옆, 휴대폰은 자리가 없어서 메뉴 패널 안 ── */
  const SLOTS = [["nav", "#menuOpen", "beforebegin"], ["panel", "#panel .panel__list", "afterend"]];
  const chip = {};
  function chips() {
    const u = user.get(), on = !!u || seen(), named = !!(u && u.name);
    SLOTS.forEach(([where, sel, pos]) => {
      let w = chip[where];
      if (!on) { if (w) { w.remove(); chip[where] = null; } return; }
      if (!w) {
        const at = document.querySelector(sel); if (!at) return;
        w = chip[where] = document.createElement("div"); w.className = "bbu bbu--" + where;
        w.innerHTML = `<button class="btn btn--ghost bbu__chip" type="button" aria-expanded="false" aria-controls="bbuMenu-${where}"><span class="bbu__name"></span><span class="sr-only"> 메뉴</span></button>
<div class="bbu__menu" id="bbuMenu-${where}" hidden>
<div class="bbu__items"><button class="bbu__item" type="button" data-bbu="rename"></button><button class="bbu__item" type="button" data-tutorial="open">사용법 다시 보기</button><button class="bbu__item" type="button" data-bbu="ask">이 브라우저에서 지우기</button></div>
<div class="bbu__ask" hidden><p>이름과 튜토리얼을 본 기록을 이 브라우저에서 지울까요?</p><div><button class="bbu__yes" type="button" data-bbu="clear">지우기</button><button class="bbu__no" type="button" data-bbu="cancel">취소</button></div></div>
</div>`;
        w.addEventListener("click", onChip); w.addEventListener("keydown", onChipKey);
        at.insertAdjacentElement(pos, w);
      }
      w.querySelector(".bbu__name").textContent = named ? u.name + "님" : "이름 정하기";
      w.querySelector('[data-bbu="rename"]').textContent = named ? "이름 바꾸기" : "이름 정하기";
    });
    lift();
  }
  /* 집 보기 틀이 위 막대와 같은 높이(z-index)라서 펼친 메뉴를 덮는다. 메뉴가 열린 동안만 위 막대를 한 칸 올린다 */
  function lift() { const nav = document.getElementById("nav"); if (nav) nav.classList.toggle("bbu-open", !!chip.nav && !chip.nav.querySelector(".bbu__menu").hidden); }
  function menu(w, open) {
    const m = w.querySelector(".bbu__menu");
    w.querySelector(".bbu__chip").setAttribute("aria-expanded", String(open)); m.hidden = !open;
    m.querySelector(".bbu__items").hidden = false; m.querySelector(".bbu__ask").hidden = true;
    lift();
  }
  function shutMenus(keep) { SLOTS.forEach(([where]) => { const w = chip[where]; if (w && !w.querySelector(".bbu__menu").hidden && !(keep instanceof Node && w.contains(keep))) menu(w, false); }); }
  function say(msg) { const t = document.getElementById("toast"); if (!t) return; t.textContent = msg; t.classList.add("is-on"); clearTimeout(say.t); say.t = setTimeout(() => t.classList.remove("is-on"), 2600); }
  function onChip(e) {
    const w = e.currentTarget, b = e.target.closest ? e.target.closest("button") : null; if (!b) return;
    const head = w.querySelector(".bbu__chip"), m = w.querySelector(".bbu__menu"), act = b.dataset.bbu;
    if (b === head) menu(w, m.hidden);
    else if (act === "ask") { m.querySelector(".bbu__items").hidden = true; m.querySelector(".bbu__ask").hidden = false; m.querySelector('[data-bbu="cancel"]').focus(); }
    else if (act === "cancel") { menu(w, true); m.querySelector('[data-bbu="ask"]').focus(); }
    else if (act === "clear") {
      /* 칩이 사라지므로 커서는 바로 옆 단추(메뉴 열기·닫기)로 옮긴다 */
      const next = document.getElementById(w.classList.contains("bbu--panel") ? "menuClose" : "menuOpen");
      user.clear(); if (next) next.focus();
      say("이름과 튜토리얼 기록을 이 브라우저에서 지웠어요.");
    } else {
      /* 이름 바꾸기 · 사용법 다시 보기: 창을 닫으면 칩으로 돌아오게 칩에 커서를 두고 연다 */
      menu(w, false); head.focus();
      if (act === "rename") start(true);
    }
  }
  function onChipKey(e) {
    const w = e.currentTarget;
    if (e.key !== "Escape" || w.querySelector(".bbu__menu").hidden) return;
    e.stopPropagation(); menu(w, false); w.querySelector(".bbu__chip").focus();
  }
  document.addEventListener("click", e => {
    shutMenus(e.target);
    /* 어디에 있든 data-tutorial="open" 을 누르면 튜토리얼을 다시 연다 */
    if (e.target instanceof Element && e.target.closest('[data-tutorial="open"]')) { e.preventDefault(); tour(); }
  });
  document.addEventListener("focusin", e => shutMenus(e.target));
  /* 집 보기의 방 배치 도구(iframe) 안을 누르면 이 문서에는 누름이 오지 않는다. 창이 커서를 잃을 때도 메뉴를 접는다 */
  addEventListener("blur", () => shutMenus(null));
  /* 다른 탭에서 이름을 바꾸거나 지우면 이 탭의 칩도 맞춘다 */
  addEventListener("storage", e => { if (!e.key || e.key === K_USER || e.key === K_TUT) chips(); });
  if (window.visualViewport) { visualViewport.addEventListener("resize", fit); visualViewport.addEventListener("scroll", fit); }

  MH.user = { get: () => user.get(), set: name => user.set(name), clear: () => user.clear() };
  MH.tutorial = { open: () => tour(), maybeStart, reset() { drop(K_TUT); chips(); } };

  chips();
  /* shell.js 가 화면을 바꾼 다음에 판단하도록, 문서를 다 읽은 뒤에 듣기 시작한다 */
  function boot() {
    addEventListener("hashchange", () => {
      /* 시작 화면이 떠 있는데 홈·이용 안내로 나가면 그냥 닫는다(저장하지 않는다). 다음에 들어올 때 다시 묻는다 */
      if (mode === "start" && !inApp()) { shut(); return; }
      maybeStart();
    });
    if (!maybeStart() && param() === "1") tour();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();

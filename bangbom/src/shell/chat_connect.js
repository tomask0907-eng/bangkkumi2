/* ═══════ 24시간 상담 → 집찾기 대화(vendor/bangbom-chat) ═══════
   단지 자료는 이 페이지의 COMPLEXES 를 그대로 쓴다(id 유지, 만 원·㎡ 단위가 같다). 샘플 단지는 추천에서 뺀다.
   [지도에서 보기]는 지도에서 단지를 누를 때와 같은 함수(MH.openMap → MapView.select)로, [평면도 보기]는 MH.openHouse 로 연다.
   판정 설명 단추(지원 판정 쉽게 설명, 이 단지 상담하기)는 예전 상담(규칙 답)을 그대로 쓴다. */
(() => {
  const B = window.BangbomChat;
  /* 주소에 chat=0 이 있으면 바꾸지 않는다 (예전 상담 서랍을 검사하는 자동 검사용) */
  if (!B || !B.mount || !window.MH || /[?&]chat=0(&|$)/.test(location.search)) return; /* 위젯 파일을 못 받으면 예전 상담이 그대로 남는다 */
  const rows = COMPLEXES.map(c => ({
    id: c.id, name: c.name, district: c.district, depositMan: c.deposit, areaM2: c.area_m2,
    lease: c.rent === 0 ? "전세" : "반전세", sample: !!c.is_sample, source: c.source || "방봄 단지 자료"
  }));
  if (!B.engine.catalog(rows).length) return; /* 쓸 만한 전세 단지가 하나도 없으면 예시 목록으로 바꾸지 않고 예전 상담을 둔다 */
  /* 서버 AI 해석: 이용자가 대화창에서 켰을 때만 그 문장을 보낸다. 서버에 열쇠가 없거나 실패하면 위젯이 자기 규칙으로 다시 제안한다 */
  const remote = location.protocol !== "file:";
  const chat = B.mount({
    catalog: rows, includeSamples: false, showLauncher: false,
    interpretEndpoint: remote ? "/api/bangbom-interpret" : undefined,
    onMap: async ({ id }) => { chat.close(); MH.openMap(id); },
    onFloorplan: async ({ id, viewIntent }) => { chat.close(); if (viewIntent === "childView") MH.setEye("child"); MH.openHouse(id); },
    onProfile: async () => { chat.close(); location.hash = "#input"; },
    /* 전세 후보와 섞지 않는 참고: 같은 구의 공개 미분양 아파트(매매). 구를 안 골랐으면 첫 후보의 구. 준공 후 단지를 먼저 */
    related: (p, matches) => { const gu = p.district || (matches[0] && matches[0].district); if (!gu || typeof UNSOLD_LIST === "undefined") return [];
      return UNSOLD_LIST.map((u, k) => ({ u, k })).filter(x => x.u.gu === gu).sort((a, b) => Number(!!b.u.completed) - Number(!!a.u.completed)).slice(0, 2)
        .map(({ u, k }) => ({ name: u.name, district: u.gu + " " + (u.dong || ""), note: (u.completed ? "준공 후 미분양" : "분양 중") + " · " + (u.source || "대구시 공개 미분양 목록") + " · 계약 가능 여부는 확인 필요", onMap: () => { chat.close(); MH.openUnsold(k); } })); }
  });
  MH.chat = chat;
  const fab = document.getElementById("fab");
  if (fab) { fab.onclick = () => chat.open(); fab.removeAttribute("aria-controls"); }
  const form = document.getElementById("homeAsk");
  if (form) form.addEventListener("submit", e => { e.preventDefault(); const t = String(new FormData(form).get("preference") || "").trim(); chat.open(t || undefined); });
})();

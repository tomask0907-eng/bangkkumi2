/* ═══════ #rent 원룸·투룸·오피스텔 전월세 실거래 ═══════
   자료: data/daegu_rent.json (bangbom/src/tools/collect_daegu_rent.py 가 국토교통부 전월세 실거래가 3종으로 만든다).
   처음 #rent 에 들어올 때 한 번만 받는다. 자료가 없거나 모양이 다르면 "자료 준비 중"을 보여 준다(가짜 자료로 채우지 않는다).
   금액은 자료가 만 원 단위라 화면에서는 원으로 바꿔 보여 준다. */
(() => {
  const page = document.getElementById("page-rent"); if (!page) return;
  const q = s => page.querySelector(s), qa = s => Array.from(page.querySelectorAll(s));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  /* collect_daegu_rent.py 의 SITE_COLS 와 같은 순서 */
  const COLS = ["cat", "gu", "dong", "name", "area", "floor", "year", "deposit", "rent", "date", "ctype"];
  const CAT = { r: "연립/다세대", d: "단독/다가구", o: "오피스텔" };
  /* 방 개수는 자료에 없어서 면적으로 나눈 추정: 33㎡ 이하 원룸, 60㎡ 이하 투룸 */
  const roomOf = x => x.cat === "o" ? "officetel" : x.area == null ? "unknown" : x.area <= 33 ? "one" : x.area <= 60 ? "two" : "three";
  const ROOM_KO = { one: "원룸", two: "투룸", three: "쓰리룸 이상", officetel: "오피스텔", unknown: "면적 모름" };
  const won = man => (Math.round(man * 10000)).toLocaleString("ko-KR") + "원";
  const PAGE = 30;
  const f = { room: "all", gu: "", type: "", dep: null, mon: null, sort: "latest" };
  let rows = null, meta = null, loading = null, shown = PAGE;

  function load() {
    if (loading) return loading;
    loading = fetch("data/daegu_rent.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null).then(d => {
      if (!d || !Array.isArray(d.rows) || !Array.isArray(d.cols) || d.cols.join() !== COLS.join()) { rows = []; meta = null; return; }
      meta = d.meta || {};
      rows = d.rows.filter(r => Array.isArray(r) && CAT[r[0]] && typeof r[7] === "number" && typeof r[8] === "number").map(r => {
        const x = {}; COLS.forEach((k, i) => { x[k] = r[i]; });
        x.area = typeof x.area === "number" ? x.area : null; x.room = roomOf(x); x.kind = x.rent > 0 ? "월세" : "전세";
        return x;
      });
    });
    return loading;
  }
  function pick() {
    const list = rows.filter(x => (f.room === "all" || x.room === f.room) && (!f.gu || x.gu === f.gu) && (!f.type || x.kind === f.type)
      && (f.dep == null || x.deposit <= f.dep) && (f.mon == null || x.rent <= f.mon));
    const by = { latest: (a, b) => String(b.date).localeCompare(String(a.date)), depositAsc: (a, b) => a.deposit - b.deposit, monthlyAsc: (a, b) => a.rent - b.rent || a.deposit - b.deposit, areaDesc: (a, b) => (b.area || 0) - (a.area || 0) }[f.sort];
    return list.sort(by);
  }
  function card(x) {
    const py = x.area != null ? ` (${(x.area / 3.305785).toFixed(1)}평)` : "";
    const sub = [`${x.gu} ${x.dong}`, x.area != null ? `${x.area}㎡${py}${x.cat === "d" ? " 계약면적" : ""}` : "", x.floor ? `${x.floor}층` : "", x.year ? `${x.year}년 준공` : ""].filter(Boolean).join(" · ");
    const price = x.kind === "전세" ? `전세 ${won(x.deposit)}` : `월 ${won(x.rent)}<small>보증금 ${won(x.deposit)}</small>`;
    return `<li class="rent-card"><div class="rent-tags"><span class="rent-tag is-type">${ROOM_KO[x.room]}${x.room === "one" || x.room === "two" || x.room === "three" ? " (추정)" : ""}</span><span class="rent-tag">${CAT[x.cat]}</span><span class="rent-tag">${x.kind}</span></div>
<p class="rent-price">${price}</p><p class="rent-name">${esc(x.name)}</p><p class="rent-sub">${esc(sub)}</p>
<p class="rent-foot">계약 ${esc(x.date)}${x.ctype ? ` · ${esc(x.ctype)}` : ""} · 국토교통부 실거래 신고</p></li>`;
  }
  function render() {
    if (!rows) return;
    const empty = !rows.length;
    q("#rentEmpty").hidden = !empty; q("#rentBar").hidden = empty;
    if (meta && meta.sources) q("#rentSrc").innerHTML = `출처: ${meta.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(String(s.name).replace("국토교통부_", ""))}</a>`).join(", ")} · ${esc((meta.months || []).map(m => `${String(m).slice(0, 4)}.${String(m).slice(4)}`).join("~").replace(/~.*~/, "~"))} 계약`;
    if (empty) { q("#rentList").innerHTML = ""; q("#rentCount").textContent = ""; q("#rentMore").hidden = true; return; }
    const list = pick();
    q("#rentCount").innerHTML = `조건에 맞는 계약 <b>${list.length.toLocaleString("ko-KR")}건</b>`;
    q("#rentList").innerHTML = list.slice(0, shown).map(card).join("") || `<li class="rent-empty" style="grid-column:1/-1"><b>조건에 맞는 계약이 없어요</b><p>금액 상한을 올리거나 구·군을 넓혀 보세요.</p></li>`;
    q("#rentMore").hidden = list.length <= shown;
  }
  const money = el => { const d = el.value.replace(/[^\d]/g, ""); return d ? Number(d) / 10000 : null; };
  qa(".rent-chip").forEach(b => b.addEventListener("click", () => {
    f.room = b.dataset.room; shown = PAGE;
    qa(".rent-chip").forEach(x => { const on = x === b; x.classList.toggle("is-on", on); x.setAttribute("aria-pressed", on); });
    render();
  }));
  ["#rentGu", "#rentType", "#rentSort"].forEach(s => q(s).addEventListener("change", () => { f.gu = q("#rentGu").value; f.type = q("#rentType").value; f.sort = q("#rentSort").value; shown = PAGE; render(); }));
  ["#rentDep", "#rentMon"].forEach(s => q(s).addEventListener("input", e => {
    const el = e.target, d = el.value.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, ""); el.value = d ? Number(d).toLocaleString("ko-KR") : "";
    f.dep = money(q("#rentDep")); f.mon = money(q("#rentMon")); shown = PAGE; render();
  }));
  q("#rentMore").addEventListener("click", () => { shown += PAGE; render(); });
  const go = () => { if (location.hash === "#rent") load().then(render); };
  addEventListener("hashchange", go); go();
})();

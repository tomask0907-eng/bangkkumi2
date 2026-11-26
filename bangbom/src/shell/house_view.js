/* ═══════════════ S4 집 보기 = 집 전체 구조 → 방 하나(방꾸미 화면) ═══════════════
   주소가 정한다: #house 는 집 전체 구조(평면도에서 꾸밀 방을 고른다), #house/<방> 은 그 방의 방꾸미 화면(room.html).
   가구 배치·문제와 제안·배치안·비용·리포트는 room.html 이 맡고(겹치는 기능은 방꾸미 것을 쓴다), 여기서는 방의 크기와 문·창문만 넘겨준다.
   방마다 꾸민 배치는 이 브라우저의 저장소(localStorage "bangkkumi2.project.<단지>-<방>")에 따로 남고, 전체 구조는 그것을 읽어 가구 자리만 그린다. */
const House = {
  ok: false, cid: null, room: null, loaded: null, eye: null,
  /* on: 집 보기 안에 있는지, shown: 지금 보이는 방의 저장 칸 이름(전체 구조면 null) */
  on: false, shown: null,
  init() {
    if (this.ok) return; this.ok = true;
    $("#hvBack").onclick = () => { location.hash = "#map"; };
    /* 집 보기 화면이 24시간 상담 단추를 가리므로 위쪽 줄에 상담 단추를 따로 둔다 */
    $("#hvConsult").onclick = () => (window.MH && MH.chat ? MH.chat.open() : Consult.open());
    /* [전체 구조]: 전체 구조에서 들어온 방이면 뒤로 가기와 같다. 방 주소로 바로 들어왔으면 돌아갈 기록이 없어서 주소만 바꾼다 */
    $("#hvPlan").onclick = () => { if (history.state && history.state.mhOver) history.back(); else this.go("#house", false); };
    /* 평면도와 목록의 방 단추: 새 기록을 쌓아서 뒤로 가면 전체 구조로 돌아온다 */
    $("#hvOver").addEventListener("click", e => { const b = e.target.closest("button[data-room]"); if (b) this.go("#house/" + b.dataset.room, true); });
    $("#hvOver").addEventListener("click", e => {
      if (e.target.closest("#hvoPick")) $("#hvoFile").click();
      if (e.target.closest("#hvoReset")) { try { localStorage.removeItem("bangbom.plan." + this.cid); } catch (er) {} this.open(this.cid); }
      if (e.target.closest("#hvoApply")) this.applySizes();
    });
    $("#hvOver").addEventListener("change", e => { if (e.target.id === "hvoFile" && e.target.files && e.target.files[0]) this.readPhoto(e.target.files[0]); });
  },
  /* 집 보기 안에서 주소를 바꾸고 다시 그린다 (이렇게 바꾸면 hashchange 가 오지 않는다). push 면 새 기록, 아니면 지금 기록을 바꾼다 */
  go(hash, push) {
    if (push) history.pushState({ mhOver: 1 }, "", hash); else history.replaceState(hash === "#house" ? null : history.state, "", hash);
    this.open(this.cid);
  },
  /* 거실, 안방, 나머지 방 순서로 보여 준다 */
  rooms(L) { const rank = r => r.type === "living" ? 0 : r.name === "안방" ? 1 : 2; return L.rooms.filter(r => r.type === "living" || r.type === "bed").sort((p, q) => rank(p) - rank(q) || p.name.localeCompare(q.name, "ko")); },
  /* 방 테두리에 걸친 문·창문을 "종류:벽:벽 끝에서 거리(cm):너비(cm)"로 적는다 */
  openings(L, r) {
    const out = [], near = (p, q) => Math.abs(p - q) < .03;
    L.open.forEach(o => {
      const hz = o.axis === "x";
      const wall = hz ? (near(o.c, r.z) ? "top" : near(o.c, r.z + r.d) ? "bottom" : null) : (near(o.c, r.x) ? "left" : near(o.c, r.x + r.w) ? "right" : null);
      if (!wall) return;
      const s0 = hz ? r.x : r.z, s1 = s0 + (hz ? r.w : r.d), a = Math.max(o.a, s0), b = Math.min(o.b, s1);
      if (b - a < .3) return;
      out.push(`${o.kind}:${wall}:${Math.round((a - s0) * 100)}:${Math.round((b - a) * 100)}`);
    });
    return out.join(",");
  },
  /* 저장해 둔 방을 평면도에 그릴 수 있게 읽는다: { w, d (방 크기 cm), items [{ x, y, w, d, rot }] }.
     가구 자리는 회전을 반영한 바닥 차지 영역의 왼쪽 위(cm)이고, 방의 위쪽 벽은 z 가 작은 쪽이다. 없거나 모양이 다르면 null (오류를 내지 않는다) */
  saved(key) {
    try {
      const p = JSON.parse(localStorage.getItem("bangkkumi2.project." + key) || "null"), num = v => typeof v === "number" && isFinite(v);
      const room = p && Array.isArray(p.rooms) ? p.rooms.find(x => x && x.id === p.activeRoomId) || p.rooms[0] : null;
      if (!room || !num(room.widthCm) || !num(room.depthCm) || room.widthCm <= 0 || room.depthCm <= 0 || !Array.isArray(room.furniture)) return null;
      const items = room.furniture.filter(f => f && [f.xCm, f.yCm, f.widthCm, f.depthCm].every(num) && f.widthCm > 0 && f.depthCm > 0).slice(0, 60);
      return { w: room.widthCm, d: room.depthCm, items: items.map(f => ({ x: f.xCm, y: f.yCm, w: f.widthCm, d: f.depthCm, rot: num(f.rotation) ? f.rotation : 0, h: num(f.heightCm) ? f.heightCm : null, cat: typeof f.category === "string" ? f.category : "", color: typeof f.color === "string" && /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : null })) };
    } catch (e) { return null; }
  },
  open(cid) {
    this.init();
    const c = COMPLEX.find(x => x.id === cid) || COMPLEX[0], L = buildLayout(this.layoutKey(c)), rooms = this.rooms(L), ev = S.evals[c.id];
    const living = (rooms.find(r => r.type === "living") || rooms[0]).id;
    /* 이 단지의 집 보기에 들어올 때 한 번만 알린다 (이용 통계가 듣는다) */
    if (!this.on || this.cid !== c.id) document.dispatchEvent(new CustomEvent("mh:house", { detail: { complexId: c.id } }));
    this.on = true;
    if (this.cid !== c.id || !rooms.some(r => r.id === this.room)) { this.cid = c.id; this.room = living; }
    $("#hvTitle").innerHTML = `<span class="eyebrow-s">Model house</span><b><i class="hv-name">${esc(c.name)}</i><i class="hv-type"> · ${esc(L.name)}</i></b><span>${SUPPLY_KO[c.supply_type]} · ${c.area_m2}㎡${c.area_m2 !== L.area && !this.photo ? ` (${L.area}㎡ 구조로 대신 보기)` : ""} · ${this.photo ? "평면도 사진에서 읽은 추정값" : "표준 구조 단순화, 공고 평면도 원본 미사용"}${ev && S.mode === "match" ? ` · ${LIGHT_ICON[ev.light]} ${LIGHT_KO[ev.light]}` : ""}</span>`;
    /* #house 는 전체 구조, #house/<방> 은 그 방. 이 집에 없는 방이면 전체 구조로 고친다 */
    let want = location.hash.startsWith("#house/") ? location.hash.slice(7) : "";
    if (want && !rooms.some(r => r.id === want)) { want = ""; history.replaceState(null, "", "#house"); }
    /* 눈높이(MH.setEye)로 들어오면 전체 구조를 건너뛰고 거실을 연다. 기록을 하나 더 쌓아서 뒤로 가면 전체 구조가 나온다 */
    if (!want && this.eye) { want = living; history.pushState({ mhOver: 1 }, "", "#house/" + want); }
    if (want) this.showRoom(c, L, rooms, want); else this.showOver(c, L, rooms);
  },
  /* 전체 구조와 방 화면 가운데 하나만 보인다. 방 칩과 [전체 구조]는 방 화면에서만 쓴다 */
  mode(room) {
    $("#houseView").classList.toggle("is-room", room);
    $("#hvOver").hidden = room; $("#kkumiFrame").hidden = !room; $("#hvRooms").hidden = !room; $("#hvPlan").hidden = !room;
  },
  /* iframe 을 새로 끼운다 (src 가 비면 방꾸미 화면을 닫는다). 주소만 바꾸면 뒤로 가기 기록이 쌓여서, 뒤로 가기가 앞의 방으로 간다 */
  swap(src) {
    const old = $("#kkumiFrame"), frame = old.cloneNode(false);
    /* 바꾸기 전에 지금 방의 기다리던 저장을 바로 하게 한다 (방꾸미는 pagehide 때 저장한다) */
    try { old.contentWindow.dispatchEvent(new Event("pagehide")); } catch (e) {}
    if (src) frame.src = src; else frame.removeAttribute("src");
    frame.hidden = !src;
    old.replaceWith(frame);
  },
  /* 방꾸미 화면(iframe)이 그려지기 전까지 빈 화면 대신 고른 단지 평면 예시와 "집을 짓는 중이에요", 진행 표시를 보여 준다.
     iframe 안 #root 에 내용이 생기면 닫는다. 15초가 넘으면 "다시 시도"와 "평면도만 먼저 보기"를 보여 준다 */
  loadShow(c, L, r) {
    let el = $("#hvLoad");
    if (!el) { el = document.createElement("div"); el.id = "hvLoad"; el.className = "hv-load"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); $("#houseView").appendChild(el); }
    el.innerHTML = `<div class="hv-load__plan" aria-hidden="true">${planSVG(L)}</div><p class="hv-load__t">집을 짓는 중이에요</p><p class="hv-load__s">${esc(c.name.replace("(예시)", "").trim())} · ${esc(r.name)}</p><div class="hv-load__bar" aria-hidden="true"><i></i></div>
      <div class="hv-load__slow" hidden><p>조금 오래 걸려요</p><div><button type="button" class="btn btn--sm" data-act="retry">다시 시도</button><button type="button" class="btn btn--ghost btn--sm" data-act="plan">평면도만 먼저 보기</button></div></div>`;
    el.hidden = false; el.classList.remove("is-slow");
    $('[data-act="retry"]', el).onclick = () => { const f = $("#kkumiFrame"), src = f.getAttribute("src"); if (src) { this.swap(src); this.loadWatch(); } };
    $('[data-act="plan"]', el).onclick = () => { this.loadHide(); $("#hvPlan").click(); };
    this.loadWatch();
  },
  loadWatch() {
    const el = $("#hvLoad"); if (!el) return;
    clearInterval(this.loadT); const t0 = performance.now(), bar = $(".hv-load__bar i", el), slow = $(".hv-load__slow", el);
    el.hidden = false; el.classList.remove("is-slow"); slow.hidden = true;
    this.loadT = setInterval(() => {
      const f = $("#kkumiFrame"); let ok = false;
      try { const d = f.contentDocument, root = d && d.querySelector("#root"); ok = !!d && d.readyState === "complete" && !!root && root.children.length > 0; } catch (e) { ok = true; }
      const f0 = $("#kkumiFrame"); el.style.top = f0.offsetTop + "px";
      if (ok) { this.loadHide(); return; }
      const sec = (performance.now() - t0) / 1000;
      bar.style.width = Math.min(92, 8 + sec / 15 * 84) + "%";
      if (sec > 15 && slow.hidden) { slow.hidden = false; el.classList.add("is-slow"); }
    }, 200);
  },
  loadHide() { clearInterval(this.loadT); const el = $("#hvLoad"); if (el) el.hidden = true; },
  showRoom(c, L, rooms, id) {
    const r = rooms.find(x => x.id === id), key = this.sb + "-" + r.id;
    /* 방 단추를 누른 초점이 사라지지 않게, 화면을 바꾼 뒤 그 방의 칩으로 옮긴다 */
    const focused = $("#hvOver").contains(document.activeElement) || $("#hvRooms").contains(document.activeElement);
    this.room = id;
    $("#hvRooms").innerHTML = rooms.map(x => `<button data-room="${x.id}" aria-pressed="${x.id === id}"${x.id === id ? ' class="is-on"' : ""}>${esc(x.name)}</button>`).join("");
    /* 칩으로 방을 바꿀 때는 지금 기록을 바꾼다 (뒤로 가기가 앞의 방이 아니라 전체 구조로 가게) */
    $$("#hvRooms button").forEach(b => b.onclick = () => this.go("#house/" + b.dataset.room, false));
    this.mode(true);
    if (focused) $("#hvRooms .is-on").focus({ preventScroll: true });
    if (this.shown !== key) { this.shown = key; document.dispatchEvent(new CustomEvent("mh:room", { detail: { complexId: c.id, roomId: r.id } })); }
    /* 눈높이(MH.setEye)가 정해져 있으면 한 번만 쓰고 지운다. 같은 방이 열려 있어도 3D 눈높이로 다시 연다 */
    const eye = this.eye; this.eye = null;
    if (this.loaded === key && !eye) return;
    this.loaded = key;
    const q = new URLSearchParams({ embed: "1", slot: key, w: String(Math.round(r.w * 100)), d: String(Math.round(r.d * 100)), kind: r.type === "living" ? "living" : r.name === "안방" ? "master" : "bed", name: `${c.name.replace("(샘플)", "")} ${r.name}`, op: this.openings(L, r) });
    if (eye) { q.set("view", "3d"); q.set("eye", eye); }
    this.loadShow(c, L, r);
    this.swap("room.html?" + q.toString());
  },
  showOver(c, L, rooms) {
    const left = this.shown ? this.room : null;
    /* 방에서 나왔으면 방꾸미 화면을 닫는다. 닫으면서 기다리던 저장을 바로 하게 해서 방금 놓은 가구가 평면도에 보인다 */
    if (this.loaded) { this.loaded = null; this.swap(""); }
    this.loadHide();
    this.shown = null;
    $("#hvOver").innerHTML = this.overHTML(c, L, rooms);
    this.mode(false); this.sync3d(L, rooms);
    /* 방에서 돌아왔으면 그 방 단추에 초점을 둔다 (키보드로 이어서 고를 수 있게) */
    const b = left && $(`#hvOver .hvo-room[data-room="${left}"]`);
    if (b && (document.activeElement === document.body || $("#houseView").contains(document.activeElement))) b.focus({ preventScroll: true });
  },
  /* 집 전체 구조: 평면도(벽·문 자리·창문·입구·방 이름과 크기·놓아 둔 가구 자리)와 꾸밀 방 목록.
     그림은 단지 카드의 작은 평면도와 같은 planArt 를 쓴다(1 = 1cm). 꾸밀 수 있는 방만 단추이고 나머지는 조용한 글자다 */
  overHTML(c, L, rooms) {
    const pad = .5, s = 100, vw = (L.W + pad * 2) * s, vh = (L.D + pad * 2) * s;
    const P = v => Math.round((v + pad) * s), len = v => Math.round(v * s), pc = v => (v * 100).toFixed(2) + "%", n1 = v => Math.round(v * 10) / 10;
    const size = r => `${r.w.toFixed(1)} × ${r.d.toFixed(1)}m`;
    const box = r => `left:${pc(P(r.x) / vw)};top:${pc(P(r.z) / vh)};width:${pc(len(r.w) / vw)};height:${pc(len(r.d) / vh)}`;
    const mine = {}; rooms.forEach(r => { mine[r.id] = this.saved(this.sb + "-" + r.id); });
    const count = r => mine[r.id] ? mine[r.id].items.length : 0;
    /* 방마다 저장된 방 크기(cm)를 그대로 좌표로 쓰는 작은 그림을 끼운다. 방 밖으로 나간 부분은 잘린다 */
    const furs = rooms.map(r => count(r) ? `<svg data-fur="${r.id}" x="${P(r.x)}" y="${P(r.z)}" width="${len(r.w)}" height="${len(r.d)}" viewBox="0 0 ${n1(mine[r.id].w)} ${n1(mine[r.id].d)}" preserveAspectRatio="none">${mine[r.id].items.map(f => {
      const turned = Math.abs(Math.round(f.rot / 90)) % 2 === 1, cx = f.x + (turned ? f.d : f.w) / 2, cy = f.y + (turned ? f.w : f.d) / 2;
      return `<rect x="${n1(cx - f.w / 2)}" y="${n1(cy - f.d / 2)}" width="${n1(f.w)}" height="${n1(f.d)}" rx="3" transform="rotate(${n1(f.rot)} ${n1(cx)} ${n1(cy)})"/>`;
    }).join("")}</svg>` : "").join("");
    /* 입구: 현관문 바깥에서 집 안쪽을 가리키는 세모 */
    const e = L.entry, m = P(e.m), out = e.side === "N" || e.side === "W" ? -1 : 1, tip = P(e.c) + out * 10, base = tip + out * 34;
    const tri = e.axis === "z" ? `${tip},${m} ${base},${m - 24} ${base},${m + 24}` : `${m},${tip} ${m - 24},${base} ${m + 24},${base}`;
    const labels = L.rooms.map(r => r.id in mine
      ? `<button type="button" class="hvo-rm" data-room="${r.id}" style="${box(r)}" aria-label="${esc(r.name)} ${size(r)} 꾸미기"><span class="hvo-tag"><b>${esc(r.name)}</b><i>${size(r)}</i></span></button>`
      : `<span class="hvo-q${r.w < 2.2 ? " is-sm" : ""}" data-room="${r.id}" style="${box(r)}"><b>${esc(r.name)}</b><i>${size(r)}</i></span>`).join("");
    const list = rooms.map(r => `<li><button type="button" class="hvo-room" data-room="${r.id}"><b>${esc(r.name)}</b><span class="hvo-sz">${size(r)}</span><span class="hvo-st${count(r) ? " is-done" : ""}">${count(r) ? `가구 ${count(r)}개` : "아직 꾸미지 않았어요"}</span></button></li>`).join("");
    const key = (d, t) => `<span><svg viewBox="0 0 20 14" aria-hidden="true">${d}</svg>${t}</span>`;
    return `<div class="hvo">
<h2 class="hvo-lead">꾸미고 싶은 방을 눌러 주세요.</h2>
<div class="hvo-fig" style="--ar:${(vw / vh).toFixed(4)}">
${HAS3D ? `<div class="hv3-bar" role="group" aria-label="보는 방법"><button type="button" class="hv3-b" data-v3="plan">평면도</button><button type="button" class="hv3-b" data-v3="bird">3D 위에서</button><button type="button" class="hv3-b" data-v3="walk">3D 안에서 걷기</button></div>` : ""}
<div class="hvo-plan" role="group" aria-label="${esc(L.name)} 평면도 (${this.photo ? "사진에서 읽은 추정값" : "표준 구조 단순화"})">
<svg viewBox="0 0 ${vw} ${vh}" aria-hidden="true" focusable="false">${planArt(L, `<g class="hvo-fur" fill="#fffaf2" stroke="#9a8f79" stroke-width="3">${furs}</g>`)}<polygon class="hvo-entry" points="${tri}" fill="#141714"/></svg>
${labels}
</div>
<p class="hvo-key">${key('<path d="M4 7 16 1v12z" fill="#141714"/>', "입구")}${key('<rect x="1.5" y="4" width="17" height="6" fill="#fff" stroke="#2b302c" stroke-width="1.5"/><path d="M1.5 7h17" stroke="#2b302c"/>', "창문")}${key('<path d="M3 13V3a10 10 0 0 1 10 10" fill="none" stroke="#8b8f8a" stroke-dasharray="2.5 2"/>', "문")}${rooms.some(count) ? key('<rect x="2.5" y="1.5" width="15" height="11" rx="1.5" fill="#f1e6d3" stroke="#9a8f79"/>', "놓아 둔 가구") : ""}</p>
</div>
<ul class="hvo-list">${list}</ul>
${this.photo ? `<p class="hvo-note">평면도 사진에서 읽은 추정값이에요. 실제 치수와 다를 수 있어요. 방 크기는 아래에서 고칠 수 있고, 꾸민 배치는 이 브라우저에만 저장돼요.</p>` : `<p class="hvo-note">표준 구조로 단순화한 평면이에요.${c.area_m2 !== L.area ? ` 이 단지는 ${c.area_m2}㎡인데 ${L.area}㎡ 구조로 대신 보여 드려요.` : ""} 공고 평면도 원본이 아니고, 방 크기도 실제와 다를 수 있어요. 꾸민 배치는 이 브라우저에만 저장돼요.</p>`}${this.photoHTML(L)}
</div>`;
  },
  /* 3D 보기: view3d 가 "bird" | "walk" 이면 평면도 자리에 3D 그림을 끼운다. 다시 그려도(innerHTML) 같은 그림을 다시 붙인다 */
  sync3d(L, rooms) {
    const fig = $("#hvOver .hvo-fig"), plan = fig && $(".hvo-plan", fig); if (!fig) return;
    $$("#hvOver [data-v3]").forEach(b => { const on = b.dataset.v3 === (this.view3d || "plan"); b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", on); });
    $$("#hvOver [data-v3]").forEach(b => b.onclick = () => { this.view3d = b.dataset.v3 === "plan" ? null : b.dataset.v3; this.sync3d(L, rooms); });
    if (!this.view3d || !Whole3D.init()) { this.view3d = null; if (Whole3D.cv) Whole3D.cv.remove(); const rb = $("#hvOver .hv3-rooms"); if (rb) rb.remove(); if (plan) plan.hidden = false; fig.classList.remove("is-3d"); return; }
    if (plan) plan.hidden = true; fig.classList.add("is-3d");
    if (Whole3D.cv.parentNode !== fig) { const bar = $(".hv3-bar", fig); if (bar) bar.after(Whole3D.cv); else fig.prepend(Whole3D.cv); }
    const mine = {}; rooms.forEach(r => { mine[r.id] = this.saved(this.sb + "-" + r.id); });
    Whole3D.build(L, r => mine[r.id] ? mine[r.id].items : null);
    if (Whole3D.view !== this.view3d || this.view3d === "walk") Whole3D.setView(this.view3d === "walk" ? "walk" : "bird");
    let rb = $("#hvOver .hv3-rooms");
    if (this.view3d === "walk") {
      if (!rb) { rb = document.createElement("div"); rb.className = "hv3-rooms"; rb.setAttribute("role", "group"); rb.setAttribute("aria-label", "서 있을 방"); fig.append(rb); }
      rb.innerHTML = L.rooms.filter(r => r.type !== "hall").map(r => `<button type="button" class="hv3-b${Whole3D.room === r.id ? " is-on" : ""}" data-w3="${r.id}">${esc(r.name)}</button>`).join("");
      $$("[data-w3]", rb).forEach(b => b.onclick = () => { Whole3D.goRoom(b.dataset.w3); $$("[data-w3]", rb).forEach(x => x.classList.toggle("is-on", x === b)); });
    } else if (rb) rb.remove();
    requestAnimationFrame(() => Whole3D.resize());
  },
  /* 이 단지에 저장된 사진 구조가 있으면 그것을, 없으면 표준 구조를 쓴다. 저장된 값이 망가졌으면 지운다 */
  layoutKey(c) {
    const std = c.room_id || "room_84a", k = "photo_" + c.id;
    this.photo = false; this.sb = c.id;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem("bangbom.plan." + c.id) || "null"); } catch (e) {}
    if (!saved || !saved.fromPhoto || !Array.isArray(saved.rooms) || !saved.rooms.length) return std;
    ROOMS[k] = saved;
    try { if (!this.rooms(buildLayout(k)).length) throw 0; } catch (e) { delete ROOMS[k]; try { localStorage.removeItem("bangbom.plan." + c.id); } catch (er) {} return std; }
    this.photo = true; this.sb = c.id + "-p";
    return k;
  },
  /* 사진 올리기 단추, 사진 구조일 때는 방 크기 고치기와 표준 구조로 되돌리기 */
  photoHTML(L) {
    const rows = this.photo ? L.rooms.map(r => `<li><span>${esc(r.name)}</span><label>가로 <input type="number" inputmode="numeric" min="100" max="3000" step="5" data-fix="${r.id}" data-k="w" value="${Math.round(r.w * 100)}"></label><label>세로 <input type="number" inputmode="numeric" min="100" max="3000" step="5" data-fix="${r.id}" data-k="d" value="${Math.round(r.d * 100)}"></label></li>`).join("") : "";
    return `<div class="hvo-photo"><p class="hvo-photo-lead">${this.photo ? "다른 사진으로 다시 읽거나 표준 구조로 돌아갈 수 있어요." : "부동산 앱에서 본 실제 평면도를 캡처해 올리면, 방 자리와 크기를 읽어 이 집 구조로 바꿔요."}</p>
<div class="hvo-photo-btns"><button type="button" class="btn btn--ghost btn--sm" id="hvoPick">평면도 사진으로 실제 구조 만들기</button>${this.photo ? '<button type="button" class="btn btn--ghost btn--sm" id="hvoReset">표준 구조로 되돌리기</button>' : ""}</div>
<input type="file" id="hvoFile" accept="image/png,image/jpeg,image/webp" hidden>
<p class="small muted" id="hvoMsg" role="status" aria-live="polite"></p>
${this.photo ? `<details class="hvo-fix"><summary>방 크기 고치기 (cm)</summary><ul>${rows}</ul><button type="button" class="btn btn--sm" id="hvoApply">고친 크기 적용</button></details>` : ""}
<p class="small muted">사진은 방 구조를 읽는 데만 쓰고 저장하지 않아요.</p></div>`;
  },
  /* 사진을 줄여서(긴 변 1600px) 서버에 보내고, 읽은 구조를 이 단지의 구조로 저장한다. 실패하면 표준 구조를 그대로 둔다 */
  async readPhoto(file) {
    const msg = t => { const m = $("#hvoMsg"); if (m) m.textContent = t; };
    msg("사진을 읽고 있어요. 20초쯤 걸릴 수 있어요.");
    try {
      const url = URL.createObjectURL(file), img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
      const k = Math.min(1, 1600 / Math.max(img.width, img.height)), cv = document.createElement("canvas");
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 40000);
      const res = await fetch("/api/homeplan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageBase64: cv.toDataURL("image/jpeg", .85) }), signal: ctl.signal });
      clearTimeout(timer);
      const data = await res.json();
      if (!res.ok || !data.layout) { msg((data && (data.note || (data.error && data.error.message))) || "사진에서 집 구조를 읽지 못했어요."); return; }
      localStorage.setItem("bangbom.plan." + this.cid, JSON.stringify(data.layout));
      this.open(this.cid);
      msg(data.note);
    } catch (e) { msg("사진을 읽지 못했어요. 인터넷 연결을 확인하고 다시 해 보세요."); }
  },
  /* 고친 크기(cm)를 집 안에 들어가게 맞춰 저장한다 */
  applySizes() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem("bangbom.plan." + this.cid) || "null"); } catch (e) {}
    if (!saved) return;
    $$("#hvOver input[data-fix]").forEach(i => {
      const r = saved.rooms.find(x => x.id === i.dataset.fix), v = Math.round(Number(i.value) / 5) * 5 / 100;
      if (!r || !Number.isFinite(v)) return;
      const max = i.dataset.k === "w" ? saved.W - r.x : saved.D - r.z;
      r[i.dataset.k] = Math.max(1, Math.min(max, v));
    });
    try { localStorage.setItem("bangbom.plan." + this.cid, JSON.stringify(saved)); } catch (e) {}
    this.open(this.cid);
  },
  /* 집 보기를 떠난다. 열어 둔 방은 그대로 두어서 뒤로 가기로 돌아오면 바로 보인다 */
  close() { this.on = false; this.shown = null; }
};

/* ═══════ 집 전체 3D (전체 구조 화면 안): 위에서 돌려 보기 · 방 안에서 둘러보기 ═══════
   벽·창문은 buildLayout 의 조각(pieces)을 그대로 세우고, 방마다 방꾸미에서 꾸민 가구(저장소)를 그 방 자리에 놓는다.
   가구 크기·자리는 저장된 값(cm)을 그대로 쓰고 새로 계산하지 않는다. 3D를 못 쓰면 단추를 숨기고 평면도만 둔다 */
const Whole3D = {
  ok: false, L: null, view: "bird", orbit: { th: .7, ph: .9, r: .74 }, look: { x: 0, z: 0, yaw: 0, pitch: -.12 },
  init() {
    if (this.ok) return true; if (!HAS3D) return false; this.ok = true;
    const cv = this.cv = document.createElement("canvas"); cv.className = "hv3-cv"; cv.setAttribute("aria-label", "집 전체 3D. 끌어서 돌려 보고, 휠이나 두 손가락으로 확대해요");
    this.r = renderer(cv); this.r.setClearColor(new T3.Color("#f3f1ec"), 1);
    const sc = this.scene = new T3.Scene();
    this.cam = new T3.PerspectiveCamera(40, 1, .05, 200); this.cam.rotation.order = "YXZ";
    sc.add(new T3.HemisphereLight(0xfffaf2, 0xd9d2c4, .75));
    const sun = new T3.DirectionalLight(0xfff3e2, 1.15); sun.position.set(6, 12, 9); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 }); sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -.0004; sc.add(sun);
    dragInput(cv, {
      drag: (dx, dy) => {
        if (this.view === "bird") { this.orbit.th -= dx * .006; this.orbit.ph = clamp(this.orbit.ph - dy * .005, .35, 1.25); }
        else { this.look.yaw -= dx * .005; this.look.pitch = clamp(this.look.pitch - dy * .004, -.9, .6); }
      },
      zoom: k => { if (this.view === "bird") this.orbit.r = clamp(this.orbit.r / k, .55, 1.8); else { this.cam.fov = clamp(this.cam.fov / k, 40, 85); this.cam.updateProjectionMatrix(); } }
    });
    new ResizeObserver(() => this.resize()).observe(cv);
    const loop = () => { if (cv.isConnected && House.on && House.view3d) this.tick(); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    return true;
  },
  build(L, furnOf) {
    this.L = L;
    if (this.root) { this.scene.remove(this.root); this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    const root = this.root = new T3.Group(); root.position.set(-L.W / 2, 0, -L.D / 2); this.scene.add(root);
    const base = box(L.W + .5, .2, L.D + .5, mat("#e4e0d8")); base.position.set(L.W / 2, -.105, L.D / 2); root.add(base);
    const floorC = r => r.type === "bath" ? "#dfe4e5" : r.type === "kitchen" ? "#ebe6dc" : r.type === "hall" || r.type === "dress" ? "#dcd7ce" : "#d4b48c";
    L.rooms.forEach(r => { const f = new T3.Mesh(new T3.PlaneGeometry(r.w, r.d), mat(floorC(r), { roughness: .75 })); f.rotation.x = -Math.PI / 2; f.position.set(r.x + r.w / 2, .004, r.z + r.d / 2); f.receiveShadow = true; root.add(f); });
    this.walls = new T3.Group(); this.front = new T3.Group(); root.add(this.walls, this.front);
    const wm = mat("#f6f3ee"), glass = new T3.MeshStandardMaterial({ color: 0xcfe0dc, transparent: true, opacity: .28, depthWrite: false });
    L.pieces.forEach(p => {
      const len = p.b - p.a, hh = p.y1 - p.y0, th = p.kind === "glass" ? .03 : .15, mid = (p.a + p.b) / 2;
      const b = box(p.axis === "x" ? len : th, hh, p.axis === "x" ? th : len, p.kind === "glass" ? glass : wm);
      b.position.set(p.axis === "x" ? mid : p.c, p.y0 + hh / 2, p.axis === "x" ? p.c : mid); (p.front ? this.front : this.walls).add(b);
    });
    /* 꾸민 가구: 자리(x, y)는 회전을 반영한 바닥 차지 영역의 왼쪽 위(cm) */
    L.rooms.forEach(r => (furnOf(r) || []).forEach(f => {
      const turned = Math.abs(Math.round(f.rot / 90)) % 2 === 1, fw = (turned ? f.d : f.w) / 100, fd = (turned ? f.w : f.d) / 100, h = clamp((f.h || 70) / 100, .03, 2.4);
      const g = new T3.Group(), m = mat(f.color || "#d9cdb8", { roughness: .8 });
      if (f.cat === "bed") { g.add(Object.assign(rbox(f.w / 100, .3, f.d / 100, .04, mat("#b88b5e")), {})); const top = rbox(f.w / 100 - .06, .18, f.d / 100 - .08, .06, mat("#f4f1ea")); top.position.y = .3; g.add(top); }
      else if (f.cat === "mat") g.add(rbox(f.w / 100, .02, f.d / 100, .02, m));
      else g.add(rbox(f.w / 100, h, f.d / 100, .03, m));
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      g.rotation.y = -f.rot * Math.PI / 180; g.position.set(r.x + f.x / 100 + fw / 2, 0, r.z + f.y / 100 + fd / 2); root.add(g);
    }));
  },
  setView(v) {
    this.view = v; const L = this.L;
    if (v === "walk" && L) { const r = L.rooms.find(x => x.type === "living") || L.rooms[0]; this.goRoom(r.id); }
    this.cam.fov = v === "walk" ? 70 : 40; this.cam.updateProjectionMatrix();
  },
  /* 방의 한쪽 끝(벽에서 40cm)에 서서 긴 쪽을 바라본다. 카메라는 yaw 0 일 때 -z 를 본다 */
  goRoom(id) { const r = this.L.rooms.find(x => x.id === id); if (!r) return; const m = Math.min(.4, r.w / 4, r.d / 4); this.look = r.w >= r.d ? { x: r.x + m, z: r.z + r.d / 2, yaw: -Math.PI / 2, pitch: -.15 } : { x: r.x + r.w / 2, z: r.z + r.d - m, yaw: 0, pitch: -.15 }; this.room = id; },
  resize() { if (!this.cv) return; const w = this.cv.clientWidth, h = this.cv.clientHeight; if (!w || !h) return; this.r.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); },
  tick() {
    const L = this.L; if (!L) return; const cam = this.cam;
    this.front.scale.y = this.view === "walk" ? 1 : .4; this.walls.scale.y = this.view === "walk" ? 1 : .62;
    if (this.view === "bird") {
      const o = this.orbit, fit = (Math.hypot(L.W, L.D) / 2 + .6) / Math.sin(Math.min(cam.fov * Math.PI / 180, 2 * Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect)) / 2), r = fit * o.r;
      cam.position.set(r * Math.sin(o.ph) * Math.sin(o.th), r * Math.cos(o.ph), r * Math.sin(o.ph) * Math.cos(o.th)); cam.up.set(0, 1, 0); cam.lookAt(0, .3, 0);
    } else { cam.position.set(this.look.x - L.W / 2, 1.6, this.look.z - L.D / 2); cam.rotation.set(this.look.pitch, this.look.yaw, 0); }
    this.r.render(this.scene, cam);
  }
};

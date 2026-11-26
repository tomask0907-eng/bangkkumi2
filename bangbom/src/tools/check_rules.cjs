// 판정 규칙 자체 점검: node bangbom/src/tools/check_rules.cjs bangbom/src/modelhouse/
// 페르소나 김지훈(250/4,500/예산 60)과 부족 금액 예시(250/1,000)의 단지별 판정·월 부담 표를 찍고, 기대값을 assert 해요.
const fs = require("fs"), M = process.argv[2] || "src/modelhouse/";
const src = ["data.js", "data2.js", "engine.js"].map(f => fs.readFileSync(M + f, "utf8")).join("\n").replace(/if \(typeof module[^\n]*/, "");
const out = new Function(src + "\nreturn { RULES, COMPLEXES, profileResult, evaluate, saleCalc, r1 };")();
const base = { age: 27, monthly_income: 250, annual_income_gross: null, homeless: true, lives_with_parents: false, daegu_resident_or_moving: true, monthly_budget: 60, priorities: [] };
const ICON = { on: "●", dim: "◐", off: "○" }, res = {};
for (const assets of [4500, 1000]) {
  const P = Object.assign({}, base, { assets }), pr = out.profileResult(P);
  console.log(`\n### 월 실수령 250 · 모은 돈 ${assets.toLocaleString()} · 예산 60\n판정: ` + [...pr.loans, ...pr.policies].map(x => `${x.name} ${x.status}`).join(" / "));
  console.log("| 단지 | 보증금 | 필요 대출 | 불빛 | 고른 조합 | 월 부담 | 지원 모두 | 못 받으면 | 부족액 |\n|---|---:|---:|---|---|---:|---:|---:|---:|");
  res[assets] = {};
  out.COMPLEXES.forEach(c => {
    const e = out.evaluate(P, c, pr), main = e.net_monthly ?? e.net_monthly_best; res[assets][c.id] = e;
    console.log(`| ${c.name} | ${c.deposit} | ${e.loan_needed} | ${ICON[e.light]} | ${e.financing || "-"} | ${main ?? "-"} | ${e.net_monthly_best ?? "-"} | ${e.net_monthly_worst ?? "-"} | ${e.shortfall || "-"} |`);
    const s = out.saleCalc(P, c); if (s) console.log(`  └ 매매(${c.name}): ${s.loanP ? s.loanP.name + " " + s.loanP.rate + "%" : "대출 없음"} · 대출 ${s.loan} · 원리금 ${s.pmt} · 월 ${s.monthly} · 취득세 ${s.tax}−${s.cut} · 자기자금 ${s.own_needed} · 부족 ${s.shortfall}`);
  });
}
const cnt = a => Object.values(res[a]).reduce((n, e) => (n[e.light]++, n), { on: 0, dim: 0, off: 0 });
const A = (ok, m) => { if (!ok) { console.error("FAIL " + m); process.exitCode = 1; } };
A(out.r1(90.25) === 90.3 && out.r1(56.25) === 56.3 && out.r1(39.66) === 39.7, "반올림");
const n = cnt(4500); A(n.on === 3 && n.dim === 1 && n.off === 4, "4500 개수 " + JSON.stringify(n));
A(res[4500].c01.light === "off" && res[4500].c01.net_monthly_best === 63.4, "상인 4500 " + res[4500].c01.net_monthly_best);
A(res[4500].c02.net_monthly === 38.6 && res[4500].c06.light === "dim" && res[4500].c06.net_monthly_best === 55.9, "c02/c06");
A(res[1000].c01.shortfall === 1220 && res[1000].c01.light === "off", "상인 1000 부족액 " + res[1000].c01.shortfall);
console.log("\n점검 " + (process.exitCode ? "실패" : "통과"));

// 금지어 검사: 화면에 나가는 원본(src/home, src/shell, src/modelhouse 의 .html·.js)에 쓰면 안 되는 표현이 있는지 본다. 하나라도 있으면 종료 코드 1
// 기준: docs/인수인계_혜원.md 3번 "쓰면 안 되는 표현", bangbom/CLAUDE.md 데이터 규칙·디자인 시스템 금지 문구
const path = require("path");
const BANNED = [
  ["안전매물", "확인할 것이 다 보이는 집"], ["안전 매물", "확인할 것이 다 보이는 집"], ["보증금 안전", "공급 주체·보증 안내 표시"], ["전세 안전", "보증·권리 확인"],
  ["전세 가능", "요건 충족 / 확인 필요 / 미충족"], ["대출 가능", "요건 충족 / 확인 필요 / 미충족"],
  ["시세보다 확실히", "근거와 기준일을 같이 적은 비교"], ["소비의 도시", "근거가 오래돼서(2004년 기사) 뺌"],
  ["유출을 막", "결정을 돕는다"], ["미분양을 줄", "결정을 돕는다"], ["미분양을 해소", "결정을 돕는다"],
  ["직방", "\"일반 부동산 앱\" (경쟁사 이름은 발표 자료에만)"], ["혁신적인", "AI 문구 금지"], ["단순한 ", null]
];
const SRC = path.join(M, "..");
const files = ["home", "shell", "modelhouse"].flatMap(d => fs.readdirSync(path.join(SRC, d)).filter(f => /\.(html|js)$/.test(f)).map(f => path.join(SRC, d, f)));
let bad = 0;
for (const f of files) {
  fs.readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => {
    /* 화면에 나가지 않는 주석 줄은 건너뛴다 (판정 파일 engine.js 의 주석처럼 UI 쪽에서 고칠 수 없는 곳이 있다) */
    if (/^\s*(\/\*|\/\/|\*|<!--|#)/.test(line)) return;
    for (const [w, alt] of BANNED) {
      if (w === "단순한 ") { if (!/단순한 [^\s]+[을를] 넘어/.test(line)) continue; }
      else if (!line.includes(w)) continue;
      bad++; console.log(`금지어 "${w.trim()}" ${path.relative(SRC, f)}:${i + 1}` + (alt ? ` → ${alt}` : ""));
    }
  });
}
console.log(bad ? `금지어 ${bad}곳` : `금지어 없음 (${files.length}개 파일)`);
if (bad) process.exitCode = 1;

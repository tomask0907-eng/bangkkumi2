import re, sys
import os
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,HERE)
from cssprefix import prefix
B=os.path.join(HERE,'../home/'); M=os.path.join(HERE,'../modelhouse/')
def R(s,a,b,cnt=0):
    assert a in s,(a[:80]); return s.replace(a,b) if cnt==0 else s.replace(a,b,cnt)

# ---------- HEAD ----------
h=open(B+'p1_head.html',encoding='utf-8').read()
h=h.replace('content="width=device-width, initial-scale=1, viewport-fit=cover"','content="width=device-width, initial-scale=1"')
ff=''.join(f'@font-face{{font-family:"PretendardLocal";font-weight:{w};font-style:normal;font-display:swap;src:url("fonts/Pretendard-{n}.woff2") format("woff2")}}\n' for w,n in [(400,'Regular'),(500,'Medium'),(600,'SemiBold'),(700,'Bold')])
h=R(h,'/* ═════════ 디자인 토큰 ═════════ */','/* Pretendard: CDN(로컬 실행) + fonts/(아티팩트) */\n'+ff+'/* ═════════ 디자인 토큰 ═════════ */')
h=R(h,'--kr:"Pretendard","Pretendard Variable",','--kr:"Pretendard","PretendardLocal","Pretendard Variable",')
h=R(h,'<meta name="description" content="대구 노후주택, 고쳐 살까 이사 갈까? 우리 가구 그대로 3D로 미리 배치해 보고 리모델링 견적과 이사 비용, 집수리 지원금까지 한 번에 비교해요. 내 조건으로 들어갈 수 있는 대구 미분양 집도 지도에서 찾아줘요.">',
      '<meta name="description" content="방봄 · 온라인 모델하우스. 대구로 오는 사람이 가 보지 않고도 집을 골라요. 내 조건으로 대출·지원 요건을 따져 대구 미분양 지도에 불을 켜고, 집 안을 3D로 둘러보며 가구까지 놓아봐요.">')
h=R(h,'<meta name="theme-color" content="#f3f2ee">','<meta name="theme-color" content="#f3f2ee">\n<link rel="icon" type="image/svg+xml" href="favicon.svg">')
mcss=open(M+'head.html',encoding='utf-8').read().split('<style>')[1].split('</style>')[0]
mscoped=prefix(mcss,'#mh')
over='''
/* ═════════ 모델하우스 흐름 · 방봄 디자인 시스템으로 통일 ═════════ */
#mh{--bg:#f3f2ee;--card:#fcfbf9;--card-line:#e3e1db;--ink:#141714;--sub:#71746f;--line:#e3e1db;--teal:#1f6b4f;--teal-soft:#e2efe7;--glow:#FFC46B;--orange:#141714;--orange-soft:#ffffff;--off:#8a8780;--off-soft:#efeeea;--tag:#141714;--shadow:0 10px 30px rgba(20,23,20,.07);--r:16px;--kr:"Pretendard","PretendardLocal",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-family:var(--kr);color:var(--ink);font-size:16px;line-height:1.65;letter-spacing:-.01em}
body.app-mode{overflow:hidden}
body.app-mode .nav{background:rgba(243,242,238,.82);color:var(--ink);-webkit-backdrop-filter:blur(16px) saturate(140%);backdrop-filter:blur(16px) saturate(140%);border-bottom:1px solid rgba(20,23,20,.06)}

/* 공통 컴포넌트 = 방봄 */
#mh .eyebrow,#mh .eyebrow-s{display:block;font-family:var(--en);font-style:italic;font-weight:400;letter-spacing:0;color:var(--green);line-height:1.2}
#mh .eyebrow{font-size:22px;margin-bottom:16px}
#mh .eyebrow-s{font-size:18px;margin-bottom:6px}
#mh .title{font-weight:600;letter-spacing:-.045em;line-height:1.25;font-size:clamp(30px,3.2vw,44px)}
#mh .lead{color:var(--sub);margin-top:16px;max-width:640px}
#mh .card{background:var(--card);border:1px solid var(--card-line);border-radius:16px;box-shadow:var(--shadow)}
#mh .btn{height:48px;padding:0 24px;border-radius:999px;background:var(--ink);color:#fff;font-weight:600;font-size:15px;letter-spacing:-.02em}
#mh .btn:hover{background:#000;filter:none}
#mh .btn--sm{height:40px;padding:0 16px;font-size:14px}
#mh .btn--ghost{background:#fff;color:var(--ink);border:1px solid var(--card-line)}
#mh .btn--ghost:hover{background:var(--gray)}
#mh .btn--dark{background:var(--ink)}
#mh .chip{height:38px;padding:0 14px;border-radius:999px;border:1px solid var(--card-line);background:#fff;font-size:14px;font-weight:500}
#mh .chip.is-on{background:var(--ink);color:#fff;border-color:var(--ink)}
#mh .st{height:26px;padding:0 10px;font-size:12px;font-weight:600;gap:6px}
#mh .st::before{display:none}
#mh .st--eligible,#mh .st--on{background:var(--green-soft);color:var(--green)}
#mh .st--needs_check,#mh .st--dim{background:#fff;color:var(--ink);border:1px dashed #b9b7b0}
#mh .st--ineligible,#mh .st--off{background:var(--gray);color:var(--sub)}
#mh .sample{background:var(--gray);color:var(--sub);font-size:11px}
#mh .x{width:40px;height:40px;border:1px solid var(--line);background:#fff}
#mh .x:hover{background:var(--gray)}
#mh .glass,#mh .dnav button,#mh .pill-n,#mh .legend span,#mh .notice{background:rgba(255,255,255,.74);border:1px solid rgba(20,23,20,.08);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:none}

/* 상단 바 (방봄 네비 아래) */
#mh .top{top:72px;height:60px;justify-content:center;padding:0 var(--pad-x)}
#mh .top-right{position:absolute;right:var(--pad-x);gap:8px}
#mh .dnav{gap:6px}
#mh .dnav button{height:36px;padding:0 14px;font-size:13px;font-weight:600;color:var(--ink)}
#mh .dnav button b{color:var(--green);margin-left:4px}
#mh .dnav button:hover{background:#fff}

/* 지도 위 카드 */
#mh .panel-l{left:var(--pad-x);top:144px;width:300px;max-height:calc(100vh - 214px)}
#mh .panel-l.mpad{padding:18px 20px}
#mh .panel-l .jp h2{font-size:19px}
#mh .panel-l .bar3{margin-top:14px}
#mh .panel-l .jp-btns{margin-top:14px}
#mh .panel-r{right:var(--pad-x);top:144px;width:360px;max-height:calc(100vh - 236px)}
#mh .pills-r{right:var(--pad-x);top:144px}
body.card-open #mh .pills-r{display:none}
#mh .mpad{padding:24px}
#mh .jp h2,#mh .cc h2{font-size:22px;font-weight:600;letter-spacing:-.045em;line-height:1.3}
#mh .jp-head{align-items:baseline}
#mh .jp-fold{font-size:13px;color:var(--sub);font-weight:600;text-decoration:underline;text-underline-offset:4px}
#mh .jp-date{font-size:13px;margin-top:2px}
#mh .jp-sec{margin-top:20px;font-size:13px;font-weight:600;color:var(--sub);letter-spacing:0}
#mh .jp-row{padding:12px 0;border-bottom:1px solid var(--line);gap:10px}
#mh .jp-row .nm{font-size:15px;font-weight:600;letter-spacing:-.02em}
#mh .jp-more{font-size:13px;padding:4px 0 2px 26px;line-height:1.6}
#mh .ico{font-size:14px}
#mh .ico.eligible{color:var(--green)}#mh .ico.needs_check{color:var(--ink)}#mh .ico.ineligible{color:#b9b7b0}
#mh .bar3{height:8px;margin-top:20px;background:var(--gray)}
#mh .bar3-txt{font-size:14px;margin-top:8px}
#mh .jp-btns{margin-top:20px;gap:8px}
#mh .pill-n{height:36px;padding:0 14px;font-size:13px;color:var(--sub)}
#mh .pill-n b{color:var(--ink);font-weight:600;margin-left:2px}
#mh .legend{display:none}
#mh .legend span{height:32px;padding:0 12px;font-size:12px;font-weight:500;color:var(--ink)}
#mh .notice{bottom:16px;font-size:11px;color:var(--sub);padding:6px 12px}
#mh .fab{right:var(--pad-x);bottom:56px;height:52px;padding:0 22px;background:var(--ink);font-weight:600;font-size:15px;box-shadow:0 10px 30px rgba(20,23,20,.22)}
#mh .fab i{background:#7ED6A8;box-shadow:0 0 0 4px rgba(126,214,168,.25)}

/* 단지 카드 */
#mh .tags{gap:6px;margin-top:12px}
#mh .tag{font-size:12px;font-weight:600;padding:5px 10px;border:1px solid var(--line);background:#fff}
#mh .kv{margin-top:20px;font-size:15px;gap:10px 16px}
#mh .kv dd{font-weight:600}
#mh .big{margin-top:20px;font-size:13px;line-height:1.6}
#mh .big b{font-size:clamp(34px,3vw,44px);font-weight:600;letter-spacing:-.045em;color:var(--green);margin:4px 0 6px}
#mh .big b.is-off{color:var(--sub)}
#mh .why{margin-top:14px;padding:14px 16px;border-radius:12px;background:#fff;border:1px solid var(--line);font-size:14px}
#mh details.fold{margin-top:16px;border-top:1px solid var(--line);padding-top:14px}
#mh details.fold summary{font-size:15px;font-weight:600;letter-spacing:-.02em}
#mh .calc{font-size:14px;margin-top:10px}
/* 줄 사이 선은 아래 줄의 위쪽 선으로 긋는다. 합계 줄 위의 선만 진하게 하려는 것인데, 위아래 칸이 선을 함께 가지면 브라우저가 위 칸의 연한 선을 고른다 */
#mh .calc td{padding:10px 0;border-bottom:0;border-top:1px solid var(--line)}
#mh .calc tr:first-child td{border-top:0}
#mh .calc .neg{color:var(--green)}
#mh .calc tr.tot td{font-size:16px;padding-top:14px;border-top-color:var(--ink)}
/* 합계 줄의 이름(.tot)이 아래 "합계 상자"(#mh .tot, display:flex)와 같아서 표의 줄이 상자로 바뀌어 금액 칸이 어긋났다. 표의 줄로 되돌린다 */
#mh .calc tr.tot{display:table-row;margin:0;padding:0;border-top:0}
#mh .calc td:first-child{padding-right:10px}
#mh .lst{font-size:14px}
#mh .lst li{padding:10px 0;border-bottom:1px solid var(--line)}
#mh .chk label{padding:12px 14px;font-size:14px;border:1px solid var(--line);border-radius:12px}
#mh .chk li:first-child label,#mh .chk li:nth-child(2) label{border-color:var(--ink)}
#mh .chk input{accent-color:var(--green)}
#mh .links a,#mh .links span{font-size:13px;padding:8px 12px;border:1px solid var(--line)}
#mh .links a:hover{border-color:var(--ink);color:var(--ink)}
#mh .cc-btns{margin-top:24px;gap:8px}

/* 지도 라벨 */
#mh .clabel{background:var(--ink);font-size:12px;font-weight:600;padding:6px 11px;letter-spacing:-.01em;box-shadow:0 4px 12px rgba(20,23,20,.18)}
#mh .clabel.is-on i{color:#7ED6A8}#mh .clabel.is-dim i{color:#FFD48A}
#mh .clabel.is-off{background:#5f625d}
#mh .ilabel{background:rgba(255,255,255,.94);border:1px solid rgba(20,23,20,.08);font-size:11px;padding:4px 9px;box-shadow:0 4px 12px rgba(20,23,20,.08);transition:opacity .2s}

/* 정보 입력 = 방봄 페이지 */
#mh #vInput{background:var(--bg);-webkit-backdrop-filter:none;backdrop-filter:none;display:block;padding:calc(72px + 48px) var(--pad-x) 96px;z-index:40}
#mh .form-wrap{max-width:880px;margin:0 auto}
#mh .form-head{margin-bottom:32px}
#mh .form{width:100%;padding:32px;box-shadow:none}
#mh .persona{gap:8px}
#mh .fgrid{gap:20px 24px;margin-top:24px}
#mh .f label,#mh .f .lb{font-size:14px;font-weight:600;margin-bottom:8px}
#mh .f label small,#mh .f .lb small{font-size:12px}
#mh .in input{height:48px;border-radius:12px;border:1px solid var(--line);padding:0 14px}
#mh .in input:focus{border-color:var(--green);box-shadow:0 0 0 3px var(--green-soft)}
#mh .seg{background:var(--gray);padding:3px}
#mh .seg button{height:42px;font-size:14px}
#mh .seg button.is-on{color:var(--ink);font-weight:600}
#mh .form-btns{margin-top:32px;padding-top:24px;border-top:1px solid var(--line)}
#mh .err{color:var(--warn)}

/* 상담 서랍 */
#mh .drawer{z-index:80;width:min(420px,100%);background:var(--card);border-left:1px solid var(--line);box-shadow:-20px 0 40px rgba(20,23,20,.08)}
#mh .dr-head{height:auto;padding:20px 24px;border-bottom:1px solid var(--line);align-items:flex-start}
#mh .dr-head b{font-size:22px;font-weight:600;letter-spacing:-.045em}
/* 닫힌 서랍은 화면 밖으로 밀어 두기만 해서 그림자가 화면 오른쪽 끝에 비치고, Tab 이 보이지 않는 단추에 멈췄다. 닫히면 숨긴다 (메뉴 .panel 과 같은 방식) */
#mh .drawer{visibility:hidden;transition:transform .32s cubic-bezier(.2,.8,.2,1),visibility 0s .32s}
#mh .drawer.is-open{visibility:visible;transition:transform .32s cubic-bezier(.2,.8,.2,1)}
/* 안내 문구: 회색 띠 위의 보조 글자는 대비가 4.08:1 이라 카드 바탕(4.58:1)에 두고 선으로 나눈다 */
#mh .dr-note{font-size:12px;padding:10px 24px;background:var(--card);border-bottom:1px solid var(--line);color:var(--sub)}
#mh .dr-body{padding:20px 24px;gap:12px}
#mh .msg{font-size:14px;line-height:1.65;padding:12px 14px;border-radius:16px}
#mh .msg.me{background:var(--ink)}
#mh .msg.ai{background:#fff;border:1px solid var(--line)}
#mh .quick{padding:12px 24px;gap:6px;border-top:1px solid var(--line)}
#mh .quick button{font-size:13px;padding:8px 12px;border:1px solid var(--line);border-radius:999px;background:#fff}
#mh .quick button:hover{border-color:var(--ink)}
#mh .dr-input{padding:12px 24px 24px}
#mh .dr-input input{height:48px;border:1px solid var(--line)}

/* 집 보기 */
#mh #houseView{top:72px;background:radial-gradient(120% 90% at 40% 40%,#fbfaf7 0%,#eceae4 62%,#e2e0d9 100%)}
#mh .hv-top{left:var(--pad-x);right:var(--pad-x);top:16px}
#mh .hv-title{padding:0;background:none;border:0;box-shadow:none}
#mh .hv-title b{font-size:clamp(20px,1.8vw,26px);font-weight:600;letter-spacing:-.045em;line-height:1.3}
#mh .hv-title span:not(.eyebrow-s){font-size:13px;color:var(--sub);display:block;max-width:560px}
#mh .segw{padding:3px;background:rgba(255,255,255,.6);border:1px solid rgba(20,23,20,.08);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
#mh .segw button{height:36px;padding:0 16px;font-size:14px;font-weight:600}
#mh .segw button.is-on{background:var(--ink);color:#fff}
#mh .hv-hint{left:var(--pad-x);top:auto;bottom:24px;font-size:12px;background:rgba(255,255,255,.74);border:1px solid rgba(20,23,20,.08)}
#mh .hv-side{right:var(--pad-x);top:120px;bottom:24px;width:380px}
#mh .hv-tabs button{padding:14px 4px 12px;font-size:14px;font-weight:600;line-height:1.3}
#mh .hv-tabs button i{display:block;font-family:var(--en);font-style:italic;font-weight:400;font-size:17px;letter-spacing:0}
#mh .hv-tabs button.is-on i{color:var(--green)}
#mh .hv-body{padding:20px 24px}
#mh .hv-body h3{font-size:15px;font-weight:600;letter-spacing:-.02em;margin:24px 0 12px}
#mh .hv-body h3:first-child{margin-top:0}
#mh .pal{gap:8px}
#mh .pal button{padding:0 0 12px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff;transition:border-color .15s}
#mh .pal button:hover{border-color:var(--ink)}
#mh .pal-img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:var(--gray);margin-bottom:10px}
#mh .pal button b,#mh .pal button span{padding:0 12px}
#mh .pal button b{font-size:14px;font-weight:600}
#mh .buy li{grid-template-columns:72px 1fr auto;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
#mh .buy-img{width:72px;height:54px;object-fit:cover;border-radius:10px;background:var(--gray)}
#mh .buy-txt{display:flex;flex-direction:column;gap:2px;min-width:0}
#mh .buy-txt b{font-size:14px}
#mh .buy li .p{font-size:14px}
#mh .tot{border-top:1px solid var(--ink);padding:16px 0 4px;margin-top:16px}
#mh .tot b{font-size:24px;font-weight:600;letter-spacing:-.04em;color:var(--green)}
#mh .budget input{height:48px;border:1px solid var(--line)}
#mh .sel-bar{background:var(--ink);padding:6px;bottom:24px}
#mh .rooms-bar{left:var(--pad-x);bottom:24px}
#mh .rlabel{font-size:12px;font-weight:600;background:rgba(255,255,255,.88);border-radius:999px;padding:3px 9px}
#mh .dimlabel{color:var(--green);background:transparent;font-weight:600}
#mh .toast{background:var(--ink)}
#mh .why-line{margin-top:10px;font-size:13px;color:var(--sub);line-height:1.5}
#mh .why-line b{color:var(--green);font-weight:600;margin-right:4px}
#mh .hv-side-open{position:absolute;right:var(--pad-x);top:120px;z-index:4;display:none}
#mh #houseView.side-closed .hv-side{display:none}
#mh #houseView.side-closed .hv-side-open{display:inline-flex;align-items:center}
#mh #houseView.side-closed .rooms-bar{max-width:calc(100% - 32px)}


/* ── 2차 디렉팅 ── */
#mh .clabel{background:#fff;color:var(--ink);border:1px solid rgba(20,23,20,.1);font-size:12px;font-weight:600;padding:6px 12px 6px 10px;box-shadow:0 6px 16px rgba(20,23,20,.12);gap:6px;transform:translate(-50%,calc(-100% - 6px))}
#mh .clabel::after{content:"";position:absolute;left:50%;bottom:-5px;width:8px;height:8px;margin-left:-4px;background:inherit;border-right:1px solid rgba(20,23,20,.1);border-bottom:1px solid rgba(20,23,20,.1);transform:rotate(45deg)}
#mh .clabel i{font-size:11px;color:var(--green)}
#mh .clabel i.b{color:#e3b35f}
#mh .clabel.is-on i{color:var(--green)}#mh .clabel.is-dim i{color:var(--ink)}
#mh .clabel.is-off{background:#f1f0ec;color:var(--sub)}#mh .clabel.is-off i{color:#b9b7b0}
#mh .clabel.is-sel{background:var(--ink);color:#fff;border-color:var(--ink)}#mh .clabel.is-sel i{color:#7ED6A8}
#mh .clabel.is-dot{width:14px;height:14px;padding:0;background:var(--green);border:2px solid #fff}#mh .clabel.is-dot::after{display:none}
#mh .map-hint{position:fixed;left:50%;bottom:52px;transform:translateX(-50%);z-index:18;font-size:13px;font-weight:600;color:var(--ink);background:rgba(255,255,255,.82);border:1px solid rgba(20,23,20,.08);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);padding:9px 16px;border-radius:999px;white-space:nowrap;pointer-events:none;transition:opacity .25s}
body.card-open #mh .map-hint,#mh .map-hint.is-gone{opacity:0}
#mh .cc-plan{position:relative;margin:-24px -24px 20px;aspect-ratio:16/10;background:#fcfbf9;border-bottom:1px solid var(--line);border-radius:16px 16px 0 0;overflow:hidden}
#mh .cc-plan svg{position:absolute;inset:0;width:100%;height:100%;padding:14px}
#mh .cc-plan-tag{position:absolute;left:14px;bottom:12px;font-size:12px;font-weight:600;padding:5px 10px;border-radius:999px;background:rgba(255,255,255,.92);border:1px solid var(--line);color:var(--sub)}
#mh .panel-r .x{position:absolute;top:14px;right:14px;z-index:2;background:rgba(255,255,255,.92)}
#mh .panel-r{overflow:auto;padding-bottom:0}
/* 닫힌 단지 카드도 투명하게만 두면 Tab 이 그 안의 단추에 멈추고 눌리기까지 한다. 닫히면 숨긴다 */
#mh .panel-r{visibility:hidden;transition:transform .3s,opacity .3s,visibility 0s .3s}
#mh .panel-r.is-open{visibility:visible;transition:transform .3s,opacity .3s}
/* 지도를 못 그릴 때의 안내 (app_bb.js 의 mapFail). 왼쪽 패널과 겹치지 않게 폭을 좁혀 화면 가운데에 둔다 */
#mh .map-fail{position:absolute;inset:0;display:grid;place-items:center;padding:24px var(--pad-x);text-align:center}
#mh .map-fail span{max-width:300px}
#mh .cc-btns{position:sticky;bottom:0;background:var(--card);margin:20px -24px 0;padding:14px 24px 20px;border-top:1px solid var(--line);z-index:1}
#mh .form-wrap{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:clamp(32px,5vw,80px);align-items:start;max-width:1200px}
#mh .form-head{position:sticky;top:120px;margin:0}
#mh .gets{list-style:none;padding:0;margin:32px 0 0;border-top:1px solid var(--line)}
#mh .gets li{display:grid;grid-template-columns:48px 1fr;gap:12px;padding:18px 0;border-bottom:1px solid var(--line)}
#mh .gets i{font-family:var(--en);font-style:italic;font-size:26px;line-height:1;color:var(--green);letter-spacing:0}
#mh .gets b{display:block;font-weight:600;letter-spacing:-.02em}
#mh .gets span{font-size:14px;color:var(--sub)}
#mh .gets-note{margin-top:16px}
@media (max-width:980px){#mh .form-wrap{grid-template-columns:minmax(0,1fr)}#mh .form-head{position:static}#mh .gets{display:none}}
@media (max-width:820px){body.app-mode #mh .map-hint{bottom:108px;font-size:12px}}

#mh .pl-toggle{position:fixed;left:var(--pad-x);top:144px;z-index:22;width:44px;height:44px;border-radius:12px;background:var(--ink);color:#fff;font-size:22px;font-weight:500;line-height:1;display:grid;place-items:center;box-shadow:0 6px 16px rgba(20,23,20,.18)}
#mh .pl-toggle:hover{background:#000}
#mh .panel-l{top:196px;max-height:calc(100vh - 266px)}
#mh .panel-l .pl-x{position:absolute;top:12px;right:12px;width:32px;height:32px}
#mh .panel-l .jp{padding-right:28px}
#mh .map-hint{right:auto}
@media (max-width:820px){#mh .pl-toggle{top:172px;width:40px;height:40px}#mh .panel-l{top:220px}}
/* 폭 821~860px(세로로 든 태블릿): 가운데 정렬한 구 칩이 오른쪽 단추와 겹친다. 칩을 왼쪽에 붙인다 */
@media (min-width:821px) and (max-width:860px){#mh .top{justify-content:flex-start}}
@media (max-width:900px){
  #mh .hv-side{top:auto;left:0;right:0;bottom:0;width:auto;height:46vh;border-radius:20px 20px 0 0}
  #mh .hv-hint{display:none}
  #mh .rooms-bar,#mh .sel-bar{bottom:calc(46vh + 12px)}
}
@media (max-width:820px){
  #mh .top{top:72px;justify-content:flex-start;height:52px}
  #mh .top-right{position:static}
  #mh .dnav{top:124px;padding:0 var(--pad-x)}
  #mh .panel-l{top:172px;left:var(--pad-x);right:auto;width:min(300px,calc(100% - 36px));max-height:40vh}
  #mh #vInput{padding:calc(72px + 24px) var(--pad-x) 120px}
  #mh .form{padding:20px}
  body.app-mode #mh .notice{bottom:76px}
  body.app-mode #mh .legend{bottom:112px;left:var(--pad-x)}
  body.app-mode #mh .fab{bottom:152px;right:var(--pad-x)}
  body.app-mode #mh .panel-r{top:auto;left:0;right:0;width:auto;bottom:64px;max-height:calc(100vh - 210px);z-index:35;border-radius:20px 20px 0 0}
  #mh #houseView{bottom:64px}
  #mh .hv-title span:not(.eyebrow-s){display:none}
}

/* ── 집 보기 = 방꾸미 화면을 끼워 넣음 (겹치는 기능은 방꾸미 것을 쓴다) ── */
#mh #houseView.is-on{display:flex;flex-direction:column;background:var(--bg)}
#mh #houseView .hv-top{position:static;flex:none;padding:12px var(--pad-x);align-items:center;pointer-events:auto;border-bottom:1px solid var(--line)}
#mh #houseView .hv-title b{font-size:clamp(17px,1.5vw,22px)}
#mh .hv-frame{flex:1;min-height:0;width:100%;border:0;display:block;background:var(--bg)}
#mh .msg-note{display:block;margin-top:8px;font-size:11px;color:var(--sub)}
@media (max-width:820px){
  #mh #houseView .hv-top{padding:8px var(--pad-x);gap:6px}
  #mh #houseView .hv-title .eyebrow-s{display:none}
  #mh #houseView .hv-title b{font-size:15px}
  #mh #houseView .segw button{height:32px;padding:0 12px;font-size:13px}
  /* 휴대폰에서 왼쪽 카드가 접기 단추(−)와 겹치지 않게 단추 아래에 둔다 */
  #mh .panel-l{top:220px}
}
'''
# 휴대폰 화면용 CSS (가장 마지막에 붙여서 위의 규칙을 덮어쓴다). 홈·이용 안내는 mobile_home.css, 입력·지도·집 보기·상담은 mobile_app.css
mobile=''.join(open(os.path.join(HERE,n),encoding='utf-8').read() for n in ('home.css','mobile_home.css','mobile_app.css','step_input.css','house_overview.css','tutorial.css','chat.css'))
h=R(h,'</style>\n</head>', mscoped+over+mobile+'\n</style>\n</head>')

# ---------- BODY ----------
b=open(B+'p2_body.html',encoding='utf-8').read()
lines=b.split('\n')
def find(prefix_):
    for i,l in enumerate(lines):
        if l.startswith(prefix_): return i
    raise Exception(prefix_)
i_map=find('<!-- ═══════════════ #map')
i_guide=find('<!-- ═══════════════ #guide')
b='\n'.join(lines[:i_map]+lines[i_guide:])
# 네비
b=R(b,'''          <li><a class="nav__link" href="#map" data-route="map"><span>집 찾기</span><small>MAP</small></a></li>
          <li><a class="nav__link" href="#sim" data-route="sim"><span>미리 살아보기</span><small>SIMULATOR</small></a></li>
          <li><a class="nav__link" href="#report" data-route="report"><span>비교 리포트</span><small>REPORT</small></a></li>''',
'''          <li><a class="nav__link" href="#map" data-route="map"><span>집 찾기</span><small>MAP</small></a></li>
          <li><a class="nav__link" href="#house" data-route="house"><span>집 보기</span><small>HOUSE</small></a></li>''')
b=R(b,'<a href="#map" class="btn nav__cta">내 조건 넣기</a>','<a href="#input" class="btn nav__cta">내 조건 넣기</a>')
b=R(b,'''      <li><a href="#map" data-route="map"><b>집 찾기</b><i>Map</i></a></li>
      <li><a href="#sim" data-route="sim"><b>미리 살아보기</b><i>Simulator</i></a></li>
      <li><a href="#report" data-route="report"><b>비교 리포트</b><i>Report</i></a></li>''','''      <li><a href="#map" data-route="map"><b>집 찾기</b><i>Map</i></a></li>
      <li><a href="#house" data-route="house"><b>집 보기</b><i>House</i></a></li>''')
b=R(b,'''    <a href="#map" class="btn">내 조건 넣기</a>
    <p class="panel__note">대구에서 고쳐 살지, 이사 갈지 결정을 돕는 서비스예요.</p>''','''    <a href="#input" class="btn">내 조건 넣기</a>
    <p class="panel__note">대구로 오는 사람이 가 보지 않고도 집을 고르는 온라인 모델하우스예요.</p>''')
# 히어로 버튼
b=R(b,'''        <a href="#sim" class="btn btn--white">우리 집 걸어보기 →</a>
        <a href="#guide" class="btn btn--ghost">이용 방법 보기</a>''','''        <a href="#input" class="btn btn--white" data-go="input">기본정보 입력하고 더 알아보기 →</a>
        <a href="#map" class="btn btn--ghost" data-go="browse">그냥 둘러보기</a>
      </div>
      <form class="hero__ask" id="homeAsk" role="search"><label for="homeAskIn">어떤 집을 찾으세요?</label><div><input id="homeAskIn" name="preference" placeholder="달서구, 전세 2억 5천 이하" autocomplete="off" maxlength="200"><button class="btn btn--white" type="submit">찾아보기</button></div></form>
      <div hidden>''')
# 평면 갤러리
b=R(b,'''          <span class="eyebrow">Plans</span>
          <h2 class="title">우리 집과 비슷한 구조부터 골라보세요</h2>
        </div>
        <p class="muted small">표준 구조로 시작하고, 다른 곳만 줄자로 맞춰요.</p>''','''          <span class="eyebrow">Plans</span>
          <h2 class="title">미분양 단지, 평면부터 둘러보세요</h2>
        </div>
        <p class="muted small">누르면 평면도·3D로 집 안을 보고 가구를 놓아볼 수 있어요.</p>''')
# 링크들
b=R(b,'<a href="#sim" class="link" data-go-mode="fix">고친 우리 집 보기 →</a>','<a href="#house" class="link">가구 배치하러 가기 →</a>')
b=R(b,'<a href="#sim" class="link" data-go-mode="move">새 집에 가구 놓아보기 →</a>','<a href="#house" class="link">새 집에 가구 놓아보기 →</a>')
# 아이 눈높이: 집 보기를 열면서 눈높이를 아이(90cm)로 맞춘다. shell.js 가 [data-eye] 를 누르면 MH.setEye(값)을 부른다
b=R(b,'<a href="#sim" class="link" data-go-eye="1">90cm로 걸어보기 →</a>','<a href="#house" class="link" data-eye="child">아이 눈높이 90cm로 보기 →</a>')
# 눈높이 보기가 실제로 하는 일에 맞춘 문장: 아이 얼굴 높이에 오는 가구 모서리에 빨간 점을 찍는다. 안전 표시라 참고용이라고 밝힌다
b=R(b,'부딪히기 쉬운 곳을 빨간 점으로 짚어줘요.</p>','얼굴 높이의 가구 모서리를 빨간 점으로 짚어줘요(참고용).</p>')
b=R(b,'<a href="#map" class="link">내 조건으로 찾아보기 →</a>','<a href="#input" class="link">내 조건으로 찾아보기 →</a>')
b=R(b,'<a href="#sim" class="btn">우리 집부터 같이 걸어봐요 →</a>','<a href="#input" class="btn">내 조건부터 넣어봐요 →</a>')
b=R(b,'<a href="#map" class="btn btn--white">무료로 시작하기 →</a>','<a href="#input" class="btn btn--white">무료로 시작하기 →</a>')
# 이용 안내
b=R(b,'''    <h1 class="title">결정까지 다섯 걸음</h1>
    <p class="lead">상담 받기 전에, 우리 집 상황을 숫자로 정리해 가요.</p>
    <div class="steps5">
      <div class="s5 reveal"><i>1</i><b>집 구조 고르기</b><p>원룸부터 84형 쓰리룸까지. 다른 곳만 줄자로 맞춰요.</p></div>
      <div class="s5 reveal"><i>2</i><b>가족 정보 넣기</b><p>아이, 재택근무, 반려동물까지 배치 조건이 돼요.</p></div>
      <div class="s5 reveal"><i>3</i><b>우리 가구 등록</b><p>사진을 찍으면 비슷한 실제 상품 치수로 맞춰요.</p></div>
      <div class="s5 reveal"><i>4</i><b>두 집 걸어보기</b><p>고친 우리 집과 미분양 새 집을 90cm 시선까지.</p></div>
      <div class="s5 reveal"><i>5</i><b>리포트 받기</b><p>가족용 리포트와 업체용 사양서를 한 번에.</p></div>
    </div>''','''    <h1 class="title">가 보지 않고 집을 고르는 다섯 걸음</h1>
    <p class="lead">대구까지 오지 않아도, 계약 전에 숫자와 집 안을 먼저 확인해요.</p>
    <div class="steps5">
      <div class="s5 reveal"><i>1</i><b>들어가는 방법 고르기</b><p>그냥 둘러보거나, 30초 기본정보를 넣고 더 알아봐요.</p></div>
      <div class="s5 reveal"><i>2</i><b>판정 결과 보기</b><p>대출·지원마다 요건 충족 / 확인 필요 / 미충족과 이유를 봐요.</p></div>
      <div class="s5 reveal"><i>3</i><b>지도에서 불빛 보기</b><p>들어갈 수 있는 단지에 불이 켜지고, 역·병원까지 거리가 보여요.</p></div>
      <div class="s5 reveal"><i>4</i><b>단지 카드·집 보기</b><p>지원 반영 월 부담을 확인하고, 평면도·3D로 가구를 놓아봐요.</p></div>
      <div class="s5 reveal"><i>5</i><b>상담하고 신청하기</b><p>AI 상담과 체크리스트, 공식 신청 링크로 이어가요.</p></div>
    </div>''')
faq_old=b[b.index('<div class="faq">'):b.index('</div>',b.index('무료인가요?'))+6]
faq_new='''<div class="faq">
        <details><summary>"요건 충족"이면 대출이 되는 건가요?<i aria-hidden="true"></i></summary><p>아니에요. 방봄은 입력하신 조건으로 요건만 따져서 요건 충족 / 확인 필요 / 미충족으로 보여줘요. 대출 승인과 지원 선정은 은행과 기관이 정해요. 그래서 체크리스트 맨 위에 "계약금 전 은행 사전 상담"을 넣었어요.</p></details>
        <details><summary>월 부담은 어떻게 계산해요?<i aria-hidden="true"></i></summary><p>월세 + 관리비 + 보증금 대출이자 − 월세지원 − 이자지원이에요. 같이 받을 수 없는 지원(예: 버팀목 대출과 대구 이자지원)은 더하지 않고, "지원 모두 받으면 / 하나도 못 받으면" 범위를 같이 보여줘요.</p></details>
        <details><summary>데이터는 어디서 오나요?<i aria-hidden="true"></i></summary><p>미분양 통계는 국토교통부 주택통계를 쓰고 출처와 기준일을 적어요. 이름 끝에 (예시)가 붙은 단지와 (샘플)이 붙은 시설은 시연용이에요. 대출·지원 기준은 공고에서 확인한 값이고, 시중금리 4.5% 같은 가정치는 화면에 따로 적어요. 작은 주황 점은 대구시 공개 미분양 목록(2026.9.30 기준)이에요.</p></details>
        <details><summary>지도와 평면도는 어디서 가져왔나요?<i aria-hidden="true"></i></summary><p>지도는 실제 배치를 참고해 단순한 블록으로 직접 그렸고, 지도 화면을 복사하지 않았어요. 평면도도 공고 평면도 원본 이미지를 쓰지 않고 표준 구조로 단순화해 그렸어요.</p></details>
        <details><summary>아이 눈높이는 왜 90cm인가요?<i aria-hidden="true"></i></summary><p>만 3~5세 아이의 눈높이가 대략 이 정도라서 잡은 참고값이에요. 법적·안전 기준은 아니에요. 집 보기의 3D에서 [아이 눈높이]를 누르면 그 높이로 방 안을 둘러볼 수 있고, 아이 얼굴 높이에 오는 가구 모서리를 빨간 점으로 짚어줘요. 참고용 안전 체크예요.</p></details>
        <details><summary>AI 상담이 판정하나요?<i aria-hidden="true"></i></summary><p>판정은 규칙이 하고, 상담은 그 결과를 쉬운 말로 설명만 해요. 판정을 바꾸거나 새 숫자를 만들지 않고, 링크는 공식 주소만 붙여요. AI 연결이 안 되면 규칙으로 만든 기본 안내로 답해요.</p></details>
        <details><summary>무료인가요?<i aria-hidden="true"></i></summary><p>네, 지금 시연 버전은 모두 무료예요. 입력한 값은 이 브라우저에만 저장해요. AI 상담에 집 조건이 아닌 질문(판정 설명, 계약 전 확인 등)을 하면 그 질문과 판정 요약만 AI 답변을 만드는 데 보내요. 나이·소득 같은 입력값은 보내지 않아요. 집 조건은 이 화면 안에서 정리하고, 대화창에서 AI 해석을 켰을 때만 그 문장을 보내요.</p></details>
      </div>'''
b=b.replace(faq_old,faq_new)
# 탭바
b=R(b,'''  <a href="#sim" data-route="sim"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></svg>살아보기</a>
  <a href="#report" data-route="report"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>리포트</a>''',
'''  <a href="#house" data-route="house"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></svg>집 보기</a>''')
b=b.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n','')
# 모델하우스 마크업
mb=open(M+'body.html',encoding='utf-8').read()
mb=mb.split('<body>',1)[1]
mb=re.sub(r'<header class="top">\s*<a href="#start".*?</a>','<header class="top">',mb,flags=re.S)
mb=re.sub(r'<!-- S0 시작 -->.*?<!-- S1 정보 입력 -->','<!-- S1 정보 입력 -->',mb,flags=re.S)
mb=mb.replace('<button type="button" class="btn btn--ghost" id="formBack">둘러보기로</button>','<button type="button" class="btn btn--ghost" id="formBack">그냥 둘러보기</button>')
mb=mb.replace('<div class="toast" id="toast" role="status"></div>','<div class="toast" id="mhToast" role="status"></div>')
mb=mb.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>','')
b=b.replace('<footer class="footer">','<div id="mh" hidden>\n'+mb+'\n</div>\n\n<footer class="footer">',1)
b=R(b,'<li>대구광역시 · 공공데이터포털<span>단지 정보 연결 예정</span></li>','<li>단지 공개 보도 · 뉴시스·뉴스1<span>2026.9</span></li>\n          <li>대구광역시 공동주택 미분양 현황(공개 단지)<span>2026.9.30 기준</span></li>')
b=R(b,'<li>국토교통부 건축물 현황<span>2023 기준</span></li>\n','<li>국토교통부 건축물 현황<span>2023 기준</span></li>\n')
# 탭바 4칸
h=h.replace('.tabbar{display:grid;grid-template-columns:repeat(5,1fr);','.tabbar{display:grid;grid-template-columns:repeat(4,1fr);')

# ---------- JS ----------
# 집 보기(House)는 house_view.js 에 따로 있다. app_bb.js 의 표시 줄 자리에 끼워 넣어 같은 범위({ } 안)에서 돌게 한다
HOUSE_MARK='/* [house_view.js] 집 보기(House)는 house_view.js 에 있다. build.py 가 이 줄 자리에 끼워 넣는다 */'
APP_BB=open(os.path.join(HERE,'app_bb.js'),encoding='utf-8').read()
assert APP_BB.count(HOUSE_MARK)==1, 'app_bb.js 에 집 보기 표시 줄이 없어요'
APP_BB=APP_BB.replace(HOUSE_MARK, open(os.path.join(HERE,'house_view.js'),encoding='utf-8').read())
mjs=open(M+'data.js',encoding='utf-8').read()+open(M+'data2.js',encoding='utf-8').read()+open(M+'unsold_list.js',encoding='utf-8').read()+open(M+'unsold_price.js',encoding='utf-8').read()+open(M+'geo.js',encoding='utf-8').read()+open(M+'real_poi.js',encoding='utf-8').read()+open(M+'mapscale.js',encoding='utf-8').read()+open(M+'engine.js',encoding='utf-8').read().replace('if (typeof module !== "undefined") module.exports = { profileResult, evaluate, breakdown, appliedLists };','')+open(M+'house.js',encoding='utf-8').read()+open(os.path.join(HERE,'backend.js'),encoding='utf-8').read().replace('if (typeof module !== "undefined") module.exports = { createBackend };','')+APP_BB+open(os.path.join(HERE,'tutorial.js'),encoding='utf-8').read()+open(os.path.join(HERE,'chat_connect.js'),encoding='utf-8').read()
shell=open(os.path.join(HERE,'shell.js'),encoding='utf-8').read()
tail='<script src="vendor/three.min.js"></script>\n<script src="vendor/bangbom-chat.js"></script>\n<script>\n{\n'+mjs+'\n}\n</script>\n<script>\n'+shell+'\nBB.route();\n</script>\n</body>\n</html>\n'
# 홈: 혜원(B) 풀페이지 5화면으로 통째 교체 (위의 홈 문구 치환은 옛 홈 기준이라 먼저 돌고, 여기서 홈 전체를 바꾼다)
_i=b.index('<section class="page" id="page-home"'); _j=b.index('<!-- ═══════════════ #guide')
b=b[:_i]+open(os.path.join(HERE,'home.html'),encoding='utf-8').read()+b[_j:]
out=h+b.replace('</body>','').replace('</html>','')+tail
open(os.path.join(HERE,'../../index.html'),'w',encoding='utf-8').write(out)
print('ok', len(out))

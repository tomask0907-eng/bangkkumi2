/* Pure JS: host site and Node tests share this exact ranking engine. Money is 만원. */
;(function(r,f){const e=f(); if(typeof module==='object'&&module.exports)module.exports=e; else(r.BangbomChat=r.BangbomChat||{}).engine=e;})(globalThis,()=>{
'use strict';
const districts=['달서구','달성군','수성구','중구','동구','서구','남구','북구','군위군'];
const modes={budget:'보증금 낮은 순',space:'면적 넓은 순',balance:'보증금·면적 균형'};
const base=()=>({maxDeposit:null,district:null,minArea:null,priority:'balance'});
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function sanitize(o){const p={};if(!o||typeof o!=='object')return p;
for(const [k,max] of [['maxDeposit',1e7],['minArea',2000]]) if(own(o,k)&&(o[k]===null||(Number.isFinite(o[k])&&o[k]>0&&o[k]<=max&&(k!=='maxDeposit'||Number.isSafeInteger(o[k])))))p[k]=o[k];
if(own(o,'district')&&(o.district===null||districts.includes(o.district)))p.district=o.district;
if(own(o,'priority')&&own(modes,o.priority))p.priority=o.priority;return p;}
function money(n){const e=Math.floor(n/10000),m=n%10000;return(e?e+'억':'')+(e&&m?' ':'')+(m?m.toLocaleString('ko-KR')+'만':'')+' 원';}
function labels(p){return Object.keys(sanitize(p)).map(k=> k==='district'?(p[k]||'대구 전체'):k==='maxDeposit'?(p[k]===null?'보증금 제한 없음':money(p[k])+' 이하'):k==='minArea'?(p[k]===null?'면적 제한 없음':p[k]+'㎡ 이상'):modes[p[k]]);}
function catalog(rows){if(!Array.isArray(rows))return [];const ids=new Set();return rows.filter(x=>{if(!x||typeof x.id!=='string'||!x.id||ids.has(x.id)||!districts.includes(x.district)||typeof x.name!=='string'||!x.name.trim()||typeof x.lease!=='string'||(!x.lease.includes('전세')||/반전세|월세|매매/.test(x.lease))||typeof x.source!=='string'||!x.source.trim()||typeof x.sample!=='boolean'||!Number.isSafeInteger(x.depositMan)||x.depositMan<=0||!Number.isFinite(x.areaM2)||x.areaM2<=0)return false;ids.add(x.id);return true;}).map(x=>({...x}));}
function rank(rows,profile,includeSamples=false){const p={...base(),...sanitize(profile)};const a=catalog(rows).filter(x=>(includeSamples||!x.sample)&&(!p.district||x.district===p.district)&&(p.maxDeposit===null||x.depositMan<=p.maxDeposit)&&(p.minArea===null||x.areaM2>=p.minArea));if(!a.length)return [];
let lo=Infinity,hi=0,small=Infinity,big=0;for(const x of a){lo=Math.min(lo,x.depositMan);hi=Math.max(hi,x.depositMan);small=Math.min(small,x.areaM2);big=Math.max(big,x.areaM2);}
function cost(x){return hi===lo?0:(x.depositMan-lo)/(hi-lo);}function size(x){return big===small?0:(big-x.areaM2)/(big-small);}function score(x){return p.priority==='budget'?cost(x):p.priority==='space'?size(x):(cost(x)+size(x))/2;}
return a.sort((a,b)=>score(a)-score(b)||(p.priority==='space'?a.depositMan-b.depositMan:p.priority==='budget'?b.areaM2-a.areaM2:0)||Number(a.sample)-Number(b.sample)||a.id.localeCompare(b.id)).map(x=>{const why=[];if(p.district)why.push(p.district+' 조건 일치');if(p.maxDeposit!==null){const diff=p.maxDeposit-x.depositMan;why.push(diff?'보증금 상한보다 '+money(diff)+' 낮아요':'설정한 보증금 상한과 같아요');}if(p.minArea!==null)why.push('최소 '+p.minArea+'㎡ 충족');if(a.length>1&&x.depositMan===lo)why.push('후보 중 가장 낮은 보증금');if(a.length>1&&x.areaM2===big)why.push('후보 중 가장 넓은 면적');if(!why.length)why.push('현재 탐색 범위에 포함된 전세 단지');return {...x,why};});}
// Relax just one constraint, never mutate the user's profile or mix near-misses into matches.
function alternatives(rows,p,include){if(rank(rows,p,include).length)return [];const out=[];if(!include&&rank(rows,p,true).length)out.push({label:'예시 단지도 포함',samples:true});
if(p.district&&rank(rows,{...p,district:null},include).length)out.push({label:'대구 전체로 확대',patch:{district:null}});
if(p.maxDeposit!==null){const a=rank(rows,{...p,maxDeposit:null,priority:'budget'},include);if(a.length)out.push({label:'상한을 '+money(a[0].depositMan)+'으로 변경',patch:{maxDeposit:a[0].depositMan}});}
if(p.minArea!==null){const a=rank(rows,{...p,minArea:null,priority:'space'},include);if(a.length)out.push({label:'최소 면적을 '+a[0].areaM2+'㎡로 변경',patch:{minArea:a[0].areaM2}});}return out;}
const qa={geo:'어느 구에서 살고 싶으세요?',budget:'전세 보증금은 최대 얼마까지 생각하세요?',priority:'두 집이 모두 조건에 맞으면 무엇을 먼저 볼까요?'};
function next(answered){return ['geo','budget','priority'].find(k=>!answered[k])||null;}
function mark(p,a){if(own(p,'district'))a.geo=true;if(own(p,'maxDeposit'))a.budget=true;if(own(p,'priority'))a.priority=true;}
// Conservative offline parser. Compound or ambiguous expressions stay unapplied.
function parse(input,step){const s=String(input).trim().replace(/(?<=\d),(?=\d)/g,'');const patch={};const problem=(note,block=false)=>({patch:{},note,block});
if(!s)return problem('원하는 지역이나 보증금을 알려주세요.');
if(/매매|월세|반전세|매입/.test(s))return problem('지금 연결된 목록은 전세 아파트예요. 매매·월세 결과로 대신 보여드리지는 않아요.',true);
if(/대출|금리|소득|연봉|지원금|자격|승인/.test(s))return problem('대출·지원은 선호 추천과 별개예요. 기존 기본정보 화면에서 요건을 확인해 주세요.',true);
if(/서울|부산|인천|대전|광주|울산|경기도|수도권|경산|제주/.test(s))return problem('현재는 대구 단지만 연결되어 있어요. 다른 지역을 대구로 바꿔 검색하지 않았어요.',true);
if(/말고|빼고|제외|싫|않|아니|아닌|아냐|아님|필요\s*없|미만|초과|[~∼～]|사이|부터|대로\s*가능|\d\s*억\s*대|[가-힣]억|\d\s*평|면적.{0,10}이하|(?:㎡|m2|제곱미터)\s*이하|(?:억|만원?|원)\s*이상/i.test(s))return problem('제외 조건·범위·평 단위는 그대로 적용하지 않았어요. 원하는 구 하나, 보증금 상한(예: 2억 5천 이하), 최소 면적(예: 74㎡ 이상)으로 알려주세요.');
if(/역세권|도보|지하철|학군|학교|통학|출퇴근|병원|주차|층수|남향|신축|관리비|반려|엘리베이터|아이|90\s*cm\s*시선|가구|침대|소파|책상|방\s*[0-9한두세네]|안전|조용|공원/.test(s))return problem('교통·생활환경·가구 적합성은 이 목록에서 검증할 수 없어요. 필수라면 지도·평면도에서 먼저 확인해 주세요. 이 문장은 추천 조건에 반영하지 않았어요.',true);
const tail=s.replace(/달서구/g,'ⓓ');let ds=districts.filter(d=>d==='달서구'?s.includes(d):tail.includes(d));if(ds.length>1)return problem('한 번에 한 지역씩 비교해요. 먼저 볼 구 하나를 골라주세요.');if(ds.length)patch.district=ds[0];else if(/대구\s*전체|지역\s*(무관|상관없|제한\s*없)/.test(s))patch.district=null;
if(/예산\s*(미정|제한\s*없)|보증금\s*제한\s*없/.test(s))patch.maxDeposit=null;
const rest=s.replace(/\d+(?:\.\d+)?\s*(?:㎡|m²|m2|제곱미터)/gi,' ');if(/(?:천|백|만|억|원)\s*(?:이상|넘는)|최소\s*(?:보증금|\d+\s*억)|\d\s*원|[-−]\s*\d|\d+\.\d+\s*(?:천|백|만)|\d+\s*억\s*\d+\s*천\s*\d/.test(rest))return problem('보증금은 상한 기준으로 찾아요. 만 원 단위의 최대 금액 하나만 알려주세요.');
const amounts=[...rest.matchAll(/(\d+(?:\.\d+)?)\s*억(?:\s*(\d+)\s*(천|백)?\s*(?:만\s*원?|원)?)?|(?:(\d+)\s*(천|백)\s*만\s*원?|(\d+)\s*만\s*원?)/g)];
if(amounts.length>1)return problem('금액이 둘 이상이라 상한을 정하지 않았어요. 최대 보증금 하나만 알려주세요.');if(amounts.length){const m=amounts[0];let n;if(m[1]){let sub=m[2]?+m[2]:0;if(m[2]&&!m[3]&&!/만|원/.test(m[0])&&sub<1000)return problem('금액 단위를 확인해 주세요. 예: 2억 5천만 원');n=+m[1]*10000+sub*(m[3]==='천'?1000:m[3]==='백'?100:1);}else n=m[4]?+m[4]*(m[5]==='천'?1000:100):+m[6];patch.maxDeposit=n;}
const area=s.match(/(\d+(?:\.\d+)?)\s*(?:㎡|m²|m2|제곱미터)/i);if(area)patch.minArea=+area[1];if(/면적\s*제한\s*없/.test(s))patch.minArea=null;
const cheap=/저렴|싼\s*집|가성비|보증금\s*(낮|저렴|우선|먼저)|예산\s*우선|부담\s*(적|낮)/.test(s),large=/넓|면적\s*(우선|먼저)|큰\s*집/.test(s);if(/균형|둘\s*다/.test(s)||cheap&&large)patch.priority='balance';else if(cheap)patch.priority='budget';else if(large)patch.priority='space';
if(/^(상관없어요|건너뛰기|아직 몰라요|미정)$/.test(s)){if(step==='geo')patch.district=null;if(step==='budget')patch.maxDeposit=null;if(step==='priority')patch.priority='balance';}
if(Object.keys(patch).length!==Object.keys(sanitize(patch)).length)return problem('숫자 범위를 확인해 주세요. 보증금은 만 원 이상, 면적은 0보다 큰 ㎡ 단위로 입력해요.');
return Object.keys(patch).length?{patch,note:'',block:false}:problem('이 문장에서 확실한 조건을 찾지 못했어요. 아래 선택지를 쓰거나 “달서구, 보증금 2억 5천 이하”처럼 알려주세요.');}
// An explicit request to use a viewing feature is not a housing eligibility or ranking signal.
function viewingIntent(s){if(/말고|싫|필요\s*없|원치|않/.test(s))return null;if(/아이\s*눈높이|90\s*cm\s*시선/i.test(s))return 'childView';if(/가구\s*(배치|놓|놓아|놓고|넣|옮)|(?:소파|침대|책상).{0,7}(배치|놓|들어가)/.test(s))return 'furniture';return null;}
return {viewingIntent,districts,modes,base,money,labels,sanitize,catalog,rank,alternatives,qa,next,mark,parse};});

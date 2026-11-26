/* 방봄 공개 홈의 카드 표기값. 매물 재고·실시간 가격 데이터가 아닙니다. */
;(function(root, make){const a=make(); if(typeof module==='object'&&module.exports) module.exports=a; else (root.BangbomChat=root.BangbomChat||{}).exampleCatalog=a;})(globalThis,()=>[
  ['sangin-centerpark','상인푸르지오 센터파크','달서구',22200,84,'CR리츠 전세',false],
  ['wolseong-demo','월성 든든하우스','달서구',15000,59,'LH 든든전세',true],
  ['chimsan-demo','침산 리버뷰','북구',17000,59,'LH 든든전세',true],
  ['sinam-demo','신암 센트럴','동구',19500,84,'CR리츠 전세',true],
  ['beomeo-demo','범어 파크원','수성구',32000,84,'CR리츠 전세',true],
  ['daegok-demo','대곡 그린시티','달서구',21000,74,'CR리츠 전세',true],
  ['pyeongni-demo','평리 더힐','서구',26000,84,'LH 든든전세',true],
  ['siji-demo','시지 레이크','수성구',42000,84,'CR리츠 전세',true]
].map(([id,name,district,depositMan,areaM2,lease,sample])=>({id,name,district,depositMan,areaM2,lease,sample,source:'방봄 공개 홈 카드 · 2026.11.26 확인'})));

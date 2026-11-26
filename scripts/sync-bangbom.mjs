// 방봄 화면(bangbom/)에서 만든 index.html과 그림·글꼴·영상을 public/으로 옮긴다.
// public/index.html이 사이트의 첫 화면(/)이 되고, 방꾸미 편집 화면은 room.html이다.
// 쓰는 법:  npm run bangbom    (bangbom/src를 고친 뒤. 파이썬 3이 있어야 한다)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const from = path.join(root, 'bangbom')
const to = path.join(root, 'public')

fs.copyFileSync(path.join(from, 'index.html'), path.join(to, 'index.html'))
// vendor: 지도가 쓰는 three.js r128 (CDN이 막혀도 사이트가 멈추지 않게 같이 올린다)
for (const dir of ['img', 'fonts', 'vid', 'vendor']) {
  fs.cpSync(path.join(from, dir), path.join(to, dir), { recursive: true })
}
// data: 전월세 실거래 자료(collect_daegu_rent.py 가 만든다). 아직 없으면 건너뛰고, 화면은 '자료 준비 중'을 보여 준다
if (fs.existsSync(path.join(from, 'data'))) fs.cpSync(path.join(from, 'data'), path.join(to, 'data'), { recursive: true })
// 이용 현황 화면(따로 된 파일 하나)
fs.copyFileSync(path.join(from, 'src', 'dashboard', 'dashboard.html'), path.join(to, 'dashboard.html'))
console.log('방봄 화면을 public/으로 옮겼어요: index.html, img, fonts, vid, vendor')

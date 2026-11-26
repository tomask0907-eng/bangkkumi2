// 3D 장면 엔진. three.js를 쓰는 코드는 이 폴더 안에만 둔다(지연 로딩 묶음으로 따로 나간다).
//
// - 단위는 m, 방 바닥 가운데가 원점, +Y가 위. 가구 위치는 toModelPlacement()로만 바꾼다.
// - 가구 기준 정면은 +z. rotation.y = 회전(도) × π/180 이면 평면도의 정면 약속(0=아래, 90=오른쪽)과 같아진다.
// - 필요할 때만 그린다(조작하거나 상태가 바뀔 때). 계속 도는 60fps 루프가 없다(걷는 동안만 이어서 그린다).
// - 눈높이 보기(방 안에 서서 보기): 설 수 있는 자리·걸어갈 길·빨간 점 위치는 src/engine/eyeLevel.js가 계산하고,
//   여기서는 그 값을 카메라와 표시로 옮기기만 한다. 보는 방향(yaw)도 가구 회전과 같은 약속이다(0=아래, 90=오른쪽).

import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Raycaster,
  RingGeometry,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import {
  EYE_REFERENCE,
  canStandAt,
  eyeHeightCm,
  initialStandSpot,
  nearestStandSpot,
  sharpCornerMarkers,
  walkPath,
} from '../engine/eyeLevel.js'
import { footprint, toModelPlacement } from '../engine/geometry.js'
import type { EyeMode } from '../state/store.ts'
import type { FurnitureItem, FurnitureMaterial, Opening, Room, Wall } from '../types/schema.ts'
import { furnitureParts, partsBounds } from './furnitureShapes.ts'
import type { PartTone } from './furnitureShapes.ts'

export type Quality = 'high' | 'medium' | 'low'
export type ViewPreset = 'bird' | 'top'

/** 눈높이 보기의 지금 상태. 화면 바깥 요소의 data 속성으로 남겨 검사하기 쉽게 한다 */
export interface EyeInfo {
  mode: EyeMode
  /** 서 있는 자리(cm, 반올림). 아직 방 안에 서 본 적이 없으면 null */
  xCm: number | null
  yCm: number | null
  /** 보는 방향(도, 0~359). 0은 평면도의 아래쪽, 90은 오른쪽 */
  yawDeg: number | null
  /** 빨간 점(부딪히기 쉬운 모서리) 개수. 아이 눈높이가 아니면 0 */
  markers: number
}

export interface SceneEngine {
  setRoom(room: Room): void
  setSelected(id: string | null): void
  setQuality(quality: Quality): void
  setView(view: ViewPreset): void
  /** 보기 방식: off는 밖에서 둘러보기, adult·child는 방 안에 서서 보는 눈높이 보기 */
  setEyeMode(mode: EyeMode): void
  /** 지금 보이는 장면을 2400×1500 PNG로 내려받는다. 성공하면 true */
  savePng(fileName: string): boolean
  /** AI 렌더링에 보낼 지금 장면(1600×1000 JPEG data URL). 실패하면 빈 글자 */
  snapshot(): string
  dispose(): void
}

export interface SceneEngineOptions {
  quality: Quality
  /** 그래픽 연결이 끊기거나(true) 돌아왔을 때(false) 알려 준다 */
  onContextLost: (lost: boolean) => void
  /** 눈높이 보기의 상태(방식·자리·방향·빨간 점 수)가 바뀔 때마다 알려 준다 */
  onEyeChange?: (info: EyeInfo) => void
}

const PAPER = '#f3f2ee' // src/index.css --color-paper
const ACCENT = '#1f6b4f' // src/index.css --color-accent
const DANGER = '#c2563a' // src/index.css --color-danger
/** 비스듬히 볼 때의 화각(도) */
const BIRD_FOV = 42
/** 바로 위에서 볼 때의 화각(도). 좁을수록 평면도처럼 반듯하게 보인다 */
const TOP_FOV = 8
const WALL_THICK = 0.1
const LOW_WALL = 0.08
const DOOR_HEIGHT = 2.1
const WINDOW_HEIGHT = 1.2
const SAVE_WIDTH = 2400
const SAVE_HEIGHT = 1500

const ORBIT_NEAR = 0.05
/** 눈높이 보기에서는 벽·가구에 20cm까지 다가가므로, 가까운 면이 잘리지 않게 더 가까이부터 그린다 */
const EYE_NEAR = 0.03
/** 눈높이 보기의 세로 화각(도). 방 안은 좁아서 넓게 본다. 휠·두 손가락으로 40~90도 사이에서 바꾼다 */
const EYE_FOV = 72
const EYE_FOV_MIN = 40
const EYE_FOV_MAX = 90
/** 고개를 위아래로 돌릴 수 있는 한계 (±60도) */
const EYE_PITCH_LIMIT = (60 * Math.PI) / 180
/** 처음에는 고개를 살짝 숙여 바닥과 가구가 잘 보이게 한다 */
const EYE_START_PITCH = (-6 * Math.PI) / 180
/** 걷는 빠르기(cm/초)와 한 번 걸을 때 걸리는 시간 범위(ms) */
const WALK_SPEED = 220
const WALK_MIN_MS = 320
const WALK_MAX_MS = 1500
/** 이만큼(px) 넘게 움직이면 누르기가 아니라 끌기로 본다 */
const TAP_SLOP_MOUSE = 5
const TAP_SLOP_TOUCH = 10
const TAP_MAX_MS = 700
/** 빨간 점 그림의 화면 크기(px). 멀리 있어도 같은 크기로 보인다 */
const MARKER_PX = 22
/** 키보드: 화살표 한 번에 돌리는 각도와 Enter 한 번에 가는 거리 */
const KEY_TURN = (15 * Math.PI) / 180
const KEY_TILT = (10 * Math.PI) / 180
const KEY_STEP_CM = 80

const ORBIT_LABEL = '방을 3D로 본 모습이에요. 끌어서 돌리고 휠이나 두 손가락으로 크기를 바꿔요.'
const EYE_LABEL =
  '방 안에 서서 본 모습이에요. 끌어서 둘러보고, 바닥을 누르면 그 자리로 가요. 화살표 키로 고개를 돌리고 Enter 키로 한 걸음 가요.'

const QUALITY: Record<Quality, { ratio: number; shadow: number }> = {
  high: { ratio: 2, shadow: 2048 },
  medium: { ratio: 1.5, shadow: 1024 },
  low: { ratio: 1, shadow: 512 },
}

const SURFACE: Record<FurnitureMaterial, { roughness: number; metalness: number; opacity: number }> = {
  wood: { roughness: 0.62, metalness: 0, opacity: 1 },
  fabric: { roughness: 0.95, metalness: 0, opacity: 1 },
  metal: { roughness: 0.35, metalness: 0.85, opacity: 1 },
  white_matte: { roughness: 0.8, metalness: 0, opacity: 1 },
  glass: { roughness: 0.08, metalness: 0, opacity: 0.45 },
}

interface WallView {
  /** 벽 바깥쪽 방향 */
  normal: Vector3
  /** 벽 안쪽 면 위의 한 점 */
  point: Vector3
  full: Group
  low: Group
}

interface FurnitureView {
  group: Group
  materials: MeshStandardMaterial[]
  bounds: { w: number; h: number; d: number }
}

interface Spot {
  xCm: number
  yCm: number
}

/** 걸어가는 중인 길. stops는 지금 자리부터 도착하는 곳까지, marks는 각 점까지의 누적 거리(cm) */
interface Walk {
  stops: Spot[]
  marks: number[]
  total: number
  startedAt: number
  duration: number
}

/**
 * 서 있던 자리와 보던 방향. 2D로 갔다 오면 3D 화면이 새로 만들어지므로 여기에 남겨 둔다.
 * 그 사이 가구를 옮겨 자리가 막혔으면 다시 들어올 때 가장 가까운 설 수 있는 자리로 옮긴다.
 */
let rememberedEye: { key: string; xCm: number; yCm: number; yaw: number; pitch: number } | null = null

function roomKey(room: Room): string {
  return `${room.id}|${room.widthCm}|${room.depthCm}`
}

function safeColor(value: string, fallback: string): Color {
  return new Color(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : fallback)
}

function toneColor(hex: string, tone: PartTone): Color {
  const color = safeColor(hex, '#cfcbc2')
  if (tone === 'dark') color.multiplyScalar(0.78)
  else if (tone === 'line') color.multiplyScalar(0.5)
  else if (tone === 'light') color.lerp(new Color('#ffffff'), 0.6)
  else if (tone === 'soft') color.lerp(new Color('#ffffff'), 0.18)
  return color
}

/** 묶음 안의 재질을 모두 버리고 비운다. 도형(geometry)은 같이 쓰는 것이라 여기서 버리지 않는다 */
function emptyGroup(group: Group): void {
  const materials = new Set<MeshStandardMaterial>()
  group.traverse((child) => {
    if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) materials.add(child.material)
  })
  for (const material of materials) material.dispose()
  group.clear()
}

/** 빨간 점 그림: 경고색 동그라미에 흰 테두리, 밝은 벽 위에서도 보이게 바깥에 옅은 선 */
function makeDotTexture(): CanvasTexture {
  const size = 64
  const picture = document.createElement('canvas')
  picture.width = size
  picture.height = size
  const pen = picture.getContext('2d')
  if (pen) {
    const middle = size / 2
    pen.beginPath()
    pen.arc(middle, middle, 28, 0, Math.PI * 2)
    pen.fillStyle = '#ffffff'
    pen.fill()
    pen.lineWidth = 1.5
    pen.strokeStyle = 'rgba(20, 23, 20, 0.28)'
    pen.stroke()
    pen.beginPath()
    pen.arc(middle, middle, 20.5, 0, Math.PI * 2)
    pen.fillStyle = DANGER
    pen.fill()
  }
  const texture = new CanvasTexture(picture)
  texture.colorSpace = SRGBColorSpace
  return texture
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 장면을 만들고 container 안에 캔버스를 넣는다. WebGL을 쓸 수 없으면 오류를 던진다.
 * 돌려준 dispose()를 부르면 캔버스와 GPU 자원이 모두 사라진다.
 */
export function createSceneEngine(container: HTMLElement, options: SceneEngineOptions): SceneEngine {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none'
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', ORBIT_LABEL)
  container.appendChild(canvas)

  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true })
  } catch (error) {
    canvas.remove()
    throw error
  }

  let quality = options.quality
  let disposed = false
  let frame = 0
  let width = Math.max(1, container.clientWidth)
  let height = Math.max(1, container.clientHeight)

  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.93
  renderer.shadowMap.enabled = true
  // three 0.187에는 PCFSoftShadowMap이 없어져서(경고만 나고 PCF로 바뀜) PCF + 그림자 번짐(radius)으로 부드럽게 한다
  renderer.shadowMap.type = PCFShadowMap
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[quality].ratio))
  renderer.setSize(width, height, false)

  const scene = new Scene()
  scene.background = new Color(PAPER)

  const pmrem = new PMREMGenerator(renderer)
  const environment = new RoomEnvironment()
  const environmentTarget = pmrem.fromScene(environment, 0.04)
  environment.dispose()
  scene.environment = environmentTarget.texture
  scene.environmentIntensity = 0.42

  const ambient = new AmbientLight('#ffffff', 0.9)
  const sun = new DirectionalLight('#fff4e6', 2.1)
  sun.castShadow = true
  sun.shadow.mapSize.set(QUALITY[quality].shadow, QUALITY[quality].shadow)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
  sun.shadow.radius = 4
  scene.add(ambient, sun, sun.target)

  const camera = new PerspectiveCamera(BIRD_FOV, width / height, ORBIT_NEAR, 120)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  // 바닥과 나란히만 옮기고, 카메라가 바닥 아래로 내려가지 못하게 한다
  controls.screenSpacePanning = false
  controls.maxPolarAngle = Math.PI / 2 - 0.06
  controls.minDistance = 0.8

  // 같이 쓰는 도형과 선택 표시
  const unitBox = new BoxGeometry(1, 1, 1)
  const unitEdges = new EdgesGeometry(unitBox)
  const outlineMaterial = new LineBasicMaterial({ color: ACCENT })
  const outline = new LineSegments(unitEdges, outlineMaterial)
  outline.visible = false
  const shellGroup = new Group()
  const furnitureGroup = new Group()

  // 눈높이 보기의 표시: 빨간 점(부딪히기 쉬운 모서리)과 "여기로 가요" 고리
  const dotTexture = makeDotTexture()
  const dotMaterial = new SpriteMaterial({
    map: dotTexture,
    // 가려졌는지는 아래 updateMarkers에서 직접 보고 통째로 숨기거나 보여 준다 (반쯤 잘린 점이 생기지 않게)
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
    toneMapped: false,
  })
  const markerGroup = new Group()
  markerGroup.visible = false
  const ringOuterShape = new RingGeometry(0.15, 0.215, 48)
  const ringInnerShape = new RingGeometry(0.166, 0.199, 48)
  const ringWhite = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true, opacity: 0.92, depthWrite: false })
  const ringGreen = new MeshBasicMaterial({ color: ACCENT, toneMapped: false, transparent: true, depthWrite: false })
  const ring = new Group()
  const ringOuter = new Mesh(ringOuterShape, ringWhite)
  const ringInner = new Mesh(ringInnerShape, ringGreen)
  ringOuter.renderOrder = 4
  ringInner.renderOrder = 5
  ringInner.position.z = 0.001
  ring.add(ringOuter, ringInner)
  // 고리 도형은 +z를 보므로 바닥에 눕힌다
  ring.rotation.x = -Math.PI / 2
  ring.visible = false
  scene.add(shellGroup, furnitureGroup, outline, markerGroup, ring)

  let walls: WallView[] = []
  let ceiling: Mesh | null = null
  const furnitureViews = new Map<string, FurnitureView>()
  let shellKey = ''
  let lastFurniture: FurnitureItem[] | null = null
  let selectedId: string | null = null
  let roomSize = { w: 3, d: 4, h: 2.4 }
  let currentView: ViewPreset = 'bird'
  let userMoved = false
  let hasRoom = false
  let currentRoom: Room | null = null

  // 눈높이 보기 상태
  let eyeMode: EyeMode = 'off'
  let eyePlaced = false
  const eye = { xCm: 0, yCm: 0, yaw: 0, pitch: EYE_START_PITCH }
  let eyeFovBase = EYE_FOV
  let walk: Walk | null = null
  let markerSprites: Sprite[] = []
  /** 눈높이 보기로 들어오기 전의 둘러보기 카메라. null이면 나갈 때 보는 방향을 새로 잡는다 */
  let savedOrbit: { position: Vector3; target: Vector3; fov: number; far: number } | null = null
  let lastEyeReport = ''
  const pointers = new Map<number, { x: number; y: number }>()
  let drag: { id: number; startX: number; startY: number; startedAt: number; moved: boolean; slop: number } | null = null
  let pinch: { distance: number; fov: number } | null = null

  const toCamera = new Vector3()
  const lookTarget = new Vector3()
  const toMarker = new Vector3()
  const pointerNdc = new Vector2()
  const raycaster = new Raycaster()
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  function updateWallCut(): void {
    if (ceiling) ceiling.visible = eyeMode !== 'off'
    if (eyeMode !== 'off') {
      // 방 안에서는 네 벽이 모두 보여야 한다
      for (const wall of walls) {
        wall.full.visible = true
        wall.low.visible = false
      }
      return
    }
    // 거의 바로 위에서 볼 때는 평면도처럼 읽히도록 네 벽을 모두 낮춘다
    const offset = toCamera.copy(camera.position).sub(controls.target)
    const fromAbove = offset.y > 0 && Math.hypot(offset.x, offset.z) < offset.y * 0.3
    for (const wall of walls) {
      // 카메라가 벽 바깥쪽에 있으면 그 벽은 낮게 잘라 안이 보이게 한다
      const outside = fromAbove || toCamera.copy(camera.position).sub(wall.point).dot(wall.normal) > 0
      wall.full.visible = !outside
      wall.low.visible = outside
    }
  }

  // ── 눈높이 보기: 카메라 ────────────────────────────────────────────────

  /** 서 있는 자리와 보는 방향을 카메라로 옮긴다 */
  function applyEyeCamera(): void {
    const eyeCm = eyeHeightCm(eyeMode) ?? EYE_REFERENCE.adultEyeCm
    // 세로로 긴 화면(휴대폰)에서는 좌우가 너무 좁아지지 않게 세로 화각을 넓힌다
    const half = Math.tan((eyeFovBase * Math.PI) / 360)
    const fitted = camera.aspect < 1 ? half / Math.sqrt(camera.aspect) : half
    camera.fov = Math.min(100, (Math.atan(fitted) * 360) / Math.PI)
    camera.near = EYE_NEAR
    camera.updateProjectionMatrix()
    camera.position.set(
      eye.xCm / 100 - roomSize.w / 2,
      // 천장이 낮은 방에서는 천장 바로 아래까지만
      Math.min(eyeCm / 100, Math.max(0.3, roomSize.h - 0.15)),
      eye.yCm / 100 - roomSize.d / 2,
    )
    const flat = Math.cos(eye.pitch)
    lookTarget.set(
      camera.position.x + Math.sin(eye.yaw) * flat,
      camera.position.y + Math.sin(eye.pitch),
      camera.position.z + Math.cos(eye.yaw) * flat,
    )
    camera.lookAt(lookTarget)
  }

  /** 빨간 점을 같은 화면 크기로 맞추고, 가구에 가려진 모서리의 점은 숨긴다 */
  function updateMarkers(): void {
    if (!markerGroup.visible || markerSprites.length === 0) return
    const size = (2 * MARKER_PX * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, height)
    scene.updateMatrixWorld()
    for (const sprite of markerSprites) {
      sprite.scale.set(size, size, 1)
      const distance = toMarker.copy(sprite.position).sub(camera.position).length()
      raycaster.set(camera.position, toMarker.normalize())
      raycaster.far = Math.max(0, distance - 0.04)
      sprite.visible = distance > 0.05 && raycaster.intersectObjects(furnitureGroup.children, true).length === 0
    }
    raycaster.far = Infinity
  }

  /** 눈높이 보기의 상태가 바뀌었으면 바깥에 알린다 */
  function reportEye(): void {
    const placed = eyePlaced && currentRoom !== null
    if (placed && currentRoom) {
      rememberedEye = { key: roomKey(currentRoom), xCm: eye.xCm, yCm: eye.yCm, yaw: eye.yaw, pitch: eye.pitch }
    }
    const info: EyeInfo = {
      mode: eyeMode,
      xCm: placed ? Math.round(eye.xCm) : null,
      yCm: placed ? Math.round(eye.yCm) : null,
      yawDeg: placed ? (((Math.round((eye.yaw * 180) / Math.PI) % 360) + 360) % 360) : null,
      markers: eyeMode === 'child' ? markerSprites.length : 0,
    }
    const key = `${info.mode}|${info.xCm}|${info.yCm}|${info.yawDeg}|${info.markers}`
    if (key === lastEyeReport) return
    lastEyeReport = key
    options.onEyeChange?.(info)
  }

  function renderNow(): void {
    if (disposed) return
    if (frame) {
      cancelAnimationFrame(frame)
      frame = 0
    }
    if (eyeMode === 'off') {
      // 감속 중이면 update()가 change를 내서 다음 그리기를 다시 예약한다
      controls.update()
    } else {
      // OrbitControls.update()는 카메라를 다시 돌려놓으므로 눈높이 보기에서는 부르지 않는다
      stepWalk(performance.now())
      applyEyeCamera()
      updateMarkers()
    }
    updateWallCut()
    renderer.render(scene, camera)
    reportEye()
    // 걷는 동안에는 이어서 그린다
    if (walk) requestRender()
  }

  function requestRender(): void {
    if (disposed || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      renderNow()
    })
  }

  // ── 눈높이 보기: 서는 자리와 걷기 ──────────────────────────────────────

  /** 가구를 옮겨 서 있던 자리가 막혔으면 가장 가까운 설 수 있는 자리로 옮긴다 */
  function keepEyeStandable(room: Room): void {
    if (!eyePlaced || canStandAt(room, eye.xCm, eye.yCm)) return
    const spot = nearestStandSpot(room, eye.xCm, eye.yCm)
    walk = null
    if (!spot) return
    eye.xCm = spot.xCm
    eye.yCm = spot.yCm
  }

  /** 처음 서는 자리(문에서 한 걸음 들어온 곳). 이 방에서 서 있던 자리를 기억하고 있으면 그 자리 */
  function placeEye(room: Room): void {
    const remembered = rememberedEye && rememberedEye.key === roomKey(room) ? rememberedEye : null
    if (remembered) {
      eye.xCm = remembered.xCm
      eye.yCm = remembered.yCm
      eye.yaw = remembered.yaw
      eye.pitch = remembered.pitch
    } else {
      const spot = initialStandSpot(room)
      eye.xCm = spot.xCm
      eye.yCm = spot.yCm
      eye.yaw = (spot.yawDeg * Math.PI) / 180
      eye.pitch = EYE_START_PITCH
    }
    eyePlaced = true
    keepEyeStandable(room)
  }

  /** 그 자리에 깔린 매트 윗면 높이(m). 고리가 매트 속에 묻히지 않게 한다 */
  function floorLift(spot: Spot): number {
    let lift = 0
    for (const item of currentRoom?.furniture ?? []) {
      if (item.category !== 'mat' && item.heightCm >= EYE_REFERENCE.walkOverCm) continue
      const body = footprint(item)
      const inside =
        spot.xCm >= body.xCm && spot.yCm >= body.yCm && spot.xCm <= body.xCm + body.widthCm && spot.yCm <= body.yCm + body.depthCm
      if (!inside) continue
      // 매트는 furnitureShapes.ts에서 1.5~5cm 두께로 그린다
      lift = Math.max(lift, item.category === 'mat' ? clamp(item.heightCm / 100, 0.015, 0.05) + 0.002 : item.heightCm / 100)
    }
    return lift
  }

  function showRing(spot: Spot): void {
    ring.position.set(spot.xCm / 100 - roomSize.w / 2, 0.008 + floorLift(spot), spot.yCm / 100 - roomSize.d / 2)
    ring.visible = true
  }

  /** 걸어갈 길을 잡고 걷기 시작한다. 움직임 줄이기 설정이면 바로 옮긴다 */
  function startWalk(target: Spot): void {
    const room = currentRoom
    if (!room) return
    const from = { xCm: eye.xCm, yCm: eye.yCm }
    const stops = [from, ...walkPath(room, from, target).points]
    const marks = [0]
    for (let i = 1; i < stops.length; i += 1) {
      marks.push(marks[i - 1] + Math.hypot(stops[i].xCm - stops[i - 1].xCm, stops[i].yCm - stops[i - 1].yCm))
    }
    const total = marks[marks.length - 1]
    if (total < 1) return
    if (reduceMotion.matches) {
      walk = null
      eye.xCm = target.xCm
      eye.yCm = target.yCm
      ring.visible = false
      requestRender()
      return
    }
    walk = {
      stops,
      marks,
      total,
      startedAt: performance.now(),
      duration: clamp((total / WALK_SPEED) * 1000, WALK_MIN_MS, WALK_MAX_MS),
    }
    showRing(target)
    requestRender()
  }

  /** 걷는 중이면 지금 시각에 맞는 자리로 옮긴다 (천천히 출발해서 천천히 멈춘다) */
  function stepWalk(now: number): void {
    if (!walk) return
    const t = clamp((now - walk.startedAt) / walk.duration, 0, 1)
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    const gone = eased * walk.total
    let index = 1
    while (index < walk.marks.length - 1 && walk.marks[index] < gone) index += 1
    const span = walk.marks[index] - walk.marks[index - 1]
    const part = span > 0 ? clamp((gone - walk.marks[index - 1]) / span, 0, 1) : 1
    const a = walk.stops[index - 1]
    const b = walk.stops[index]
    eye.xCm = a.xCm + (b.xCm - a.xCm) * part
    eye.yCm = a.yCm + (b.yCm - a.yCm) * part
    if (t >= 1) {
      walk = null
      ring.visible = false
    }
  }

  /** 화면의 한 점이 가리키는 바닥(또는 가구)에서 가장 가까운 설 수 있는 자리. 바닥 쪽이 아니면 null */
  function spotUnderPointer(clientX: number, clientY: number): Spot | null {
    const room = currentRoom
    if (!room) return null
    const box = canvas.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) return null
    pointerNdc.set(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1)
    applyEyeCamera()
    camera.updateMatrixWorld()
    scene.updateMatrixWorld()
    raycaster.setFromCamera(pointerNdc, camera)
    raycaster.far = Infinity
    const { origin, direction } = raycaster.ray
    // 천장이나 벽 위쪽을 가리키면 갈 곳이 없다
    if (direction.y > -0.02) return null
    let reach = -origin.y / direction.y
    // 가구를 눌렀으면 그 가구 겉면의 위치를 쓴다 (그 뒤쪽 바닥이 아니라)
    const hit = raycaster.intersectObjects(furnitureGroup.children, true)[0]
    if (hit && hit.distance < reach) reach = hit.distance
    return nearestStandSpot(
      room,
      (origin.x + direction.x * reach + roomSize.w / 2) * 100,
      (origin.z + direction.z * reach + roomSize.d / 2) * 100,
    )
  }

  function turnBy(yaw: number, pitch: number): void {
    const full = Math.PI * 2
    eye.yaw = (((eye.yaw + yaw) % full) + full) % full
    eye.pitch = clamp(eye.pitch + pitch, -EYE_PITCH_LIMIT, EYE_PITCH_LIMIT)
    requestRender()
  }

  function pinchDistance(): number {
    const [a, b] = [...pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  function enterEye(room: Room): void {
    savedOrbit = { position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov, far: camera.far }
    controls.enabled = false
    if (eyePlaced) keepEyeStandable(room)
    else placeEye(room)
    canvas.style.cursor = 'grab'
    // 키보드로 왔을 때 초점 테두리가 캔버스 안쪽에 보이게 한다
    canvas.style.outline = ''
    canvas.style.outlineOffset = '-3px'
    canvas.tabIndex = 0
    canvas.setAttribute('role', 'application')
    canvas.setAttribute('aria-label', EYE_LABEL)
  }

  function exitEye(): void {
    walk = null
    drag = null
    pinch = null
    pointers.clear()
    ring.visible = false
    controls.enabled = true
    camera.near = ORBIT_NEAR
    if (savedOrbit) {
      camera.fov = savedOrbit.fov
      camera.far = savedOrbit.far
      camera.updateProjectionMatrix()
      camera.position.copy(savedOrbit.position)
      controls.target.copy(savedOrbit.target)
      camera.lookAt(controls.target)
      controls.update()
    } else {
      // 눈높이 보기 중에 방이나 화면 크기가 바뀌었으면 보는 방향을 새로 잡는다
      userMoved = false
      applyView(currentView)
    }
    savedOrbit = null
    canvas.style.cursor = ''
    canvas.style.outline = 'none'
    canvas.style.outlineOffset = ''
    canvas.removeAttribute('tabindex')
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', ORBIT_LABEL)
  }

  // ── 둘러보기(밖에서 보기) ──────────────────────────────────────────────

  function fitDistance(): number {
    const vertical = (camera.fov * Math.PI) / 180
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect)
    const radius = 0.5 * Math.hypot(roomSize.w, roomSize.d, roomSize.h * 0.6)
    // 방 전체가 들어오고 아래 버튼 줄과 겹치지 않게 여유를 둔다
    return (radius / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.18
  }

  function applyView(view: ViewPreset): void {
    // 위에서 볼 때는 화각을 좁혀(멀리서 망원으로) 키 큰 가구 윗면이 벽 밖으로 퍼져 보이지 않게 한다
    camera.fov = view === 'top' ? TOP_FOV : BIRD_FOV
    camera.near = ORBIT_NEAR
    camera.updateProjectionMatrix()
    const distance = fitDistance()
    controls.maxDistance = distance * 2.2
    if (view === 'top') {
      // 바닥 전체가 화면에 들어오는 높이
      const halfV = Math.tan((camera.fov * Math.PI) / 360)
      // 위아래 버튼 줄(약 60px씩)에 방이 가리지 않게 화면 높이에 맞춰 여유를 둔다
      const viewH = Math.max(1, canvas.clientHeight)
      const marginV = viewH / Math.max(viewH * 0.5, viewH - 124)
      const topDistance =
        Math.max(((roomSize.d + 0.3) / 2 / halfV) * marginV, ((roomSize.w + 0.3) / 2 / (halfV * camera.aspect)) * 1.12) + 0.4
      controls.maxDistance = Math.max(controls.maxDistance, topDistance * 1.5)
      // 멀리서 보므로 큰 방에서도 잘리지 않게 보이는 거리를 늘린다
      camera.far = Math.max(120, controls.maxDistance + 20)
      camera.updateProjectionMatrix()
      controls.target.set(0, 0, 0)
      // 평면도와 같은 방향(위쪽 벽이 화면 위)
      camera.position.set(0, topDistance, 0.001)
    } else {
      const polar = (52 * Math.PI) / 180
      const azimuth = (35 * Math.PI) / 180
      controls.target.set(0, Math.min(0.6, roomSize.h * 0.25), 0)
      camera.position.set(
        controls.target.x + distance * Math.sin(polar) * Math.sin(azimuth),
        controls.target.y + distance * Math.cos(polar),
        controls.target.z + distance * Math.sin(polar) * Math.cos(azimuth),
      )
    }
    camera.lookAt(controls.target)
    controls.update()
  }

  function addBox(
    parent: Group,
    material: MeshStandardMaterial,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    shadow: { cast: boolean; receive: boolean },
  ): Mesh | null {
    if (w <= 0 || h <= 0 || d <= 0) return null
    const mesh = new Mesh(unitBox, material)
    mesh.position.set(x, y, z)
    mesh.scale.set(w, h, d)
    mesh.castShadow = shadow.cast
    mesh.receiveShadow = shadow.receive
    parent.add(mesh)
    return mesh
  }

  function buildShell(room: Room): void {
    emptyGroup(shellGroup)
    walls = []
    ceiling = null
    const { w, d, h } = roomSize
    const wallShadow = { cast: false, receive: true }
    const noShadow = { cast: false, receive: false }

    const tile = room.style.floorMaterial === 'tile_gray'
    const floorMaterial = new MeshStandardMaterial({
      color: safeColor(room.style.floorColor, '#d9c3a3'),
      roughness: tile ? 0.45 : room.style.floorMaterial === 'linoleum_light' ? 0.6 : 0.72,
      metalness: 0,
    })
    addBox(shellGroup, floorMaterial, 0, -0.03, 0, w + WALL_THICK * 2, 0.06, d + WALL_THICK * 2, wallShadow)

    // 천장은 방 안에 서서 볼 때만 보인다 (밖에서 둘러볼 때는 안이 보여야 하므로 숨긴다). 햇빛을 막지 않게 그림자는 만들지 않는다
    const ceilingMaterial = new MeshStandardMaterial({ color: '#fbfaf7', roughness: 0.95, metalness: 0 })
    ceiling = addBox(shellGroup, ceilingMaterial, 0, h + 0.03, 0, w + WALL_THICK * 2, 0.06, d + WALL_THICK * 2, noShadow)
    if (ceiling) ceiling.visible = eyeMode !== 'off'

    const wallMaterial = new MeshStandardMaterial({
      color: safeColor(room.style.wallColor, '#f7f5f0'),
      roughness: 0.92,
      metalness: 0,
    })
    const doorMaterial = new MeshStandardMaterial({ color: '#b99b77', roughness: 0.6, metalness: 0 })
    const frameMaterial = new MeshStandardMaterial({ color: '#fbfaf7', roughness: 0.5, metalness: 0 })
    const glassMaterial = new MeshStandardMaterial({
      color: '#a9cfe6',
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      opacity: 0.5,
    })
    // 낮게 자른 벽에서도 창문·문 자리를 알아볼 수 있게 바닥 띠로 남긴다
    const windowMarkMaterial = new MeshStandardMaterial({ color: '#8fbcd6', roughness: 0.4, metalness: 0 })

    const wallNames: Wall[] = ['top', 'bottom', 'left', 'right']
    for (const name of wallNames) {
      const horizontal = name === 'top' || name === 'bottom'
      const length = horizontal ? w : d
      // 벽은 방 안쪽 치수 바깥에 세운다
      const across =
        name === 'top' ? -d / 2 - WALL_THICK / 2 : name === 'bottom' ? d / 2 + WALL_THICK / 2 : name === 'left' ? -w / 2 - WALL_THICK / 2 : w / 2 + WALL_THICK / 2
      const full = new Group()
      const low = new Group()
      low.visible = false

      /** 벽을 따라 s0~s1, 높이 y0~y1인 조각 */
      const piece = (
        parent: Group,
        material: MeshStandardMaterial,
        s0: number,
        s1: number,
        y0: number,
        y1: number,
        thick: number,
        shadow: { cast: boolean; receive: boolean },
      ): void => {
        const along = (s0 + s1) / 2 - length / 2
        const len = s1 - s0
        if (horizontal) addBox(parent, material, along, (y0 + y1) / 2, across, len, y1 - y0, thick, shadow)
        else addBox(parent, material, across, (y0 + y1) / 2, along, thick, y1 - y0, len, shadow)
      }
      const solid = (s0: number, s1: number): void => {
        if (s1 - s0 <= 0.001) return
        piece(full, wallMaterial, s0, s1, 0, h, WALL_THICK, wallShadow)
        piece(low, wallMaterial, s0, s1, 0, LOW_WALL, WALL_THICK, wallShadow)
      }

      const openings: Opening[] = room.openings
        .filter((opening) => opening.wall === name)
        .slice()
        .sort((a, b) => a.offsetCm - b.offsetCm)
      // 위·아래 벽은 모서리까지 덮도록 양쪽으로 벽 두께만큼 늘린다
      let cursor = horizontal ? -WALL_THICK : 0
      const end = horizontal ? length + WALL_THICK : length
      for (const opening of openings) {
        const s0 = Math.max(cursor, Math.min(length, opening.offsetCm / 100))
        const s1 = Math.max(s0, Math.min(length, (opening.offsetCm + opening.widthCm) / 100))
        if (s1 - s0 < 0.05) continue
        solid(cursor, s0)
        cursor = s1
        if (opening.type === 'door') {
          const top = Math.min(DOOR_HEIGHT, h - 0.05)
          piece(full, wallMaterial, s0, s1, top, h, WALL_THICK, wallShadow)
          piece(full, doorMaterial, s0 + 0.02, s1 - 0.02, 0, top - 0.02, 0.04, wallShadow)
          piece(low, doorMaterial, s0, s1, 0, 0.012, WALL_THICK, noShadow)
        } else {
          const sill = Math.max(0, Math.min(opening.sillHeightCm / 100, h - 0.4))
          const top = Math.min(sill + WINDOW_HEIGHT, h - 0.15)
          const bar = 0.04
          piece(full, wallMaterial, s0, s1, 0, sill, WALL_THICK, wallShadow)
          piece(full, wallMaterial, s0, s1, top, h, WALL_THICK, wallShadow)
          piece(full, glassMaterial, s0 + bar, s1 - bar, sill + bar, top - bar, 0.012, noShadow)
          // 창틀 네 변 + 가운데 세로 살
          piece(full, frameMaterial, s0, s1, sill, sill + bar, WALL_THICK + 0.02, noShadow)
          piece(full, frameMaterial, s0, s1, top - bar, top, WALL_THICK + 0.02, noShadow)
          piece(full, frameMaterial, s0, s0 + bar, sill + bar, top - bar, WALL_THICK + 0.02, noShadow)
          piece(full, frameMaterial, s1 - bar, s1, sill + bar, top - bar, WALL_THICK + 0.02, noShadow)
          const middle = (s0 + s1) / 2
          piece(full, frameMaterial, middle - bar / 2, middle + bar / 2, sill + bar, top - bar, 0.03, noShadow)
          piece(low, windowMarkMaterial, s0, s1, 0, LOW_WALL + 0.02, WALL_THICK, noShadow)
        }
      }
      solid(cursor, end)

      shellGroup.add(full, low)
      walls.push({
        normal: new Vector3(name === 'left' ? -1 : name === 'right' ? 1 : 0, 0, name === 'top' ? -1 : name === 'bottom' ? 1 : 0),
        point: new Vector3(
          name === 'left' ? -w / 2 : name === 'right' ? w / 2 : 0,
          0,
          name === 'top' ? -d / 2 : name === 'bottom' ? d / 2 : 0,
        ),
        full,
        low,
      })
    }

    // 쓰지 않은 재질이 남지 않게 정리한다(문이나 창문이 없는 방)
    const used = new Set<MeshStandardMaterial>()
    shellGroup.traverse((child) => {
      if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) used.add(child.material)
    })
    for (const material of [doorMaterial, frameMaterial, glassMaterial, windowMarkMaterial, wallMaterial, ceilingMaterial]) {
      if (!used.has(material)) material.dispose()
    }

    // 빛과 그림자 범위를 방 크기에 맞춘다
    const reach = 0.5 * Math.hypot(w, d) + 0.6
    // 기본 조감 방향에서 그림자가 가구 옆으로 보이도록 왼쪽 앞에서 비춘다
    sun.position.set(-(w * 0.45 + 1.4), h + 3.2, d * 0.25 + 1.2)
    sun.target.position.set(0, 0, 0)
    sun.target.updateMatrixWorld()
    const shadowCamera = sun.shadow.camera
    shadowCamera.left = -reach
    shadowCamera.right = reach
    shadowCamera.top = reach
    shadowCamera.bottom = -reach
    shadowCamera.near = 0.5
    shadowCamera.far = h + reach * 2 + 8
    shadowCamera.updateProjectionMatrix()
  }

  function buildFurniture(room: Room): void {
    emptyGroup(furnitureGroup)
    furnitureViews.clear()
    for (const item of room.furniture) {
      const surface = SURFACE[item.material] ?? SURFACE.wood
      const parts = furnitureParts(item)
      const byTone = new Map<PartTone, MeshStandardMaterial>()
      const group = new Group()
      const isMat = item.category === 'mat'
      for (const part of parts) {
        let material = byTone.get(part.tone)
        if (!material) {
          // 유리 가구의 다리·몸통은 비치지 않는 금속 느낌으로 둔다
          const solidPart = item.material === 'glass' && part.tone === 'dark'
          material = new MeshStandardMaterial({
            color: toneColor(item.color, part.tone),
            roughness: solidPart ? 0.4 : surface.roughness,
            metalness: solidPart ? 0.6 : surface.metalness,
            transparent: !solidPart && surface.opacity < 1,
            opacity: solidPart ? 1 : surface.opacity,
          })
          byTone.set(part.tone, material)
        }
        addBox(group, material, part.x, part.y, part.z, part.w, part.h, part.d, { cast: !isMat, receive: true })
      }
      const placement = toModelPlacement(item, room)
      // 매트는 바닥과 겹쳐 깜빡이지 않게 아주 조금 띄운다
      group.position.set(placement.x, isMat ? 0.002 : 0, placement.z)
      group.rotation.y = placement.rotation_y
      furnitureGroup.add(group)
      furnitureViews.set(item.id, { group, materials: [...byTone.values()], bounds: partsBounds(parts) })
    }
  }

  /** 빨간 점을 다시 놓는다. 어디에 찍을지는 eyeLevel.js가 정한다(아이 얼굴 높이의 뾰족한 모서리, 참고용) */
  function buildMarkers(room: Room): void {
    markerGroup.clear()
    markerSprites = []
    for (const marker of sharpCornerMarkers(room)) {
      const sprite = new Sprite(dotMaterial)
      sprite.position.set(marker.xCm / 100 - roomSize.w / 2, marker.heightCm / 100, marker.yCm / 100 - roomSize.d / 2)
      sprite.renderOrder = 10
      markerGroup.add(sprite)
      markerSprites.push(sprite)
    }
  }

  function applySelection(): void {
    for (const [id, view] of furnitureViews) {
      const on = id === selectedId
      for (const material of view.materials) {
        material.emissive.set(on ? ACCENT : '#000000')
        material.emissiveIntensity = on ? 0.22 : 1
      }
    }
    const view = selectedId ? furnitureViews.get(selectedId) : undefined
    outline.visible = Boolean(view)
    if (view) {
      const pad = 0.03
      outline.position.set(view.group.position.x, view.bounds.h / 2 + pad / 2, view.group.position.z)
      outline.rotation.y = view.group.rotation.y
      outline.scale.set(view.bounds.w + pad, view.bounds.h + pad, view.bounds.d + pad)
    }
  }

  function resize(): void {
    if (disposed) return
    const nextWidth = Math.floor(container.clientWidth)
    const nextHeight = Math.floor(container.clientHeight)
    if (nextWidth < 2 || nextHeight < 2) return
    if (nextWidth === width && nextHeight === height) return
    width = nextWidth
    height = nextHeight
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    if (eyeMode === 'off') {
      if (hasRoom && !userMoved) applyView(currentView)
    } else if (!userMoved) {
      // 둘러보기로 돌아갈 때 새 화면 크기에 맞춰 다시 잡는다
      savedOrbit = null
    }
    // 크기를 바꾸면 캔버스가 지워지므로 바로 다시 그린다
    renderNow()
  }

  const onChange = (): void => requestRender()
  const onStart = (): void => {
    userMoved = true
  }
  const onLost = (event: Event): void => {
    event.preventDefault()
    options.onContextLost(true)
  }
  const onRestored = (): void => {
    options.onContextLost(false)
    requestRender()
  }

  // ── 눈높이 보기: 끌어서 둘러보기, 눌러서 걸어가기 (OrbitControls는 꺼 둔다) ──

  const onPointerDown = (event: PointerEvent): void => {
    if (eyeMode === 'off') return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    try {
      canvas.setPointerCapture(event.pointerId)
    } catch {
      // 이미 사라진 손가락이면 그냥 넘어간다
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size === 1) {
      drag = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: performance.now(),
        moved: false,
        slop: event.pointerType === 'mouse' ? TAP_SLOP_MOUSE : TAP_SLOP_TOUCH,
      }
      canvas.style.cursor = 'grabbing'
    } else if (pointers.size === 2) {
      // 두 손가락: 벌리고 오므려 화각을 바꾼다
      drag = null
      pinch = { distance: pinchDistance(), fov: eyeFovBase }
    }
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (eyeMode === 'off') return
    const known = pointers.get(event.pointerId)
    if (!known) {
      // 마우스를 올려만 두었을 때: 누르면 갈 자리를 고리로 보여 준다
      if (event.pointerType === 'mouse' && !walk) {
        const spot = spotUnderPointer(event.clientX, event.clientY)
        if (spot) showRing(spot)
        else ring.visible = false
        requestRender()
      }
      return
    }
    const dx = event.clientX - known.x
    const dy = event.clientY - known.y
    known.x = event.clientX
    known.y = event.clientY
    if (pinch) {
      const distance = pinchDistance()
      if (distance > 0 && pinch.distance > 0) {
        eyeFovBase = clamp((pinch.fov * pinch.distance) / distance, EYE_FOV_MIN, EYE_FOV_MAX)
        requestRender()
      }
      return
    }
    if (!drag || drag.id !== event.pointerId) return
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < drag.slop) return
      drag.moved = true
      if (!walk) ring.visible = false
    }
    // 끈 만큼 장면이 손가락을 따라오게 돌린다 (오른쪽으로 끌면 왼쪽을 보게 된다)
    const perPixel = (camera.fov * Math.PI) / 180 / Math.max(1, height)
    turnBy(dx * perPixel, dy * perPixel)
  }

  const onPointerUp = (event: PointerEvent): void => {
    if (!pointers.delete(event.pointerId)) return
    try {
      canvas.releasePointerCapture(event.pointerId)
    } catch {
      // 이미 풀렸으면 넘어간다
    }
    if (eyeMode === 'off') return
    if (pinch) {
      // 한 손가락을 떼면 남은 손가락은 누르기로 치지 않는다
      if (pointers.size < 2) pinch = null
      return
    }
    const finished = drag && drag.id === event.pointerId ? drag : null
    if (!finished) return
    drag = null
    canvas.style.cursor = 'grab'
    if (event.type !== 'pointerup' || finished.moved || performance.now() - finished.startedAt > TAP_MAX_MS) return
    // 끌지 않고 한 번 누른 것: 그 자리로 걸어간다
    const spot = spotUnderPointer(event.clientX, event.clientY)
    if (spot) startWalk(spot)
  }

  const onPointerLeave = (): void => {
    if (eyeMode === 'off' || walk || !ring.visible) return
    ring.visible = false
    requestRender()
  }

  const onWheel = (event: WheelEvent): void => {
    if (eyeMode === 'off') return
    // 방 안에서는 휠로 페이지가 밀리지 않게 하고 화각만 바꾼다
    event.preventDefault()
    eyeFovBase = clamp(eyeFovBase * Math.exp(clamp(event.deltaY, -200, 200) * 0.0015), EYE_FOV_MIN, EYE_FOV_MAX)
    requestRender()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (eyeMode === 'off' || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowLeft') turnBy(KEY_TURN, 0)
    else if (event.key === 'ArrowRight') turnBy(-KEY_TURN, 0)
    else if (event.key === 'ArrowUp') turnBy(0, KEY_TILT)
    else if (event.key === 'ArrowDown') turnBy(0, -KEY_TILT)
    else if (event.key === 'Enter' || event.key === ' ') {
      // 보는 쪽으로 한 걸음. 막혀 있으면 가장 가까운 설 수 있는 자리까지만 간다
      const room = currentRoom
      const spot = room
        ? nearestStandSpot(room, eye.xCm + Math.sin(eye.yaw) * KEY_STEP_CM, eye.yCm + Math.cos(eye.yaw) * KEY_STEP_CM)
        : null
      if (spot) startWalk(spot)
    } else return
    event.preventDefault()
  }

  controls.addEventListener('change', onChange)
  controls.addEventListener('start', onStart)
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('keydown', onKeyDown)

  const observer = new ResizeObserver(resize)
  observer.observe(container)

  /** 장면을 w×h 로 한 번 그려 그림 글자(data URL)로 읽는다. 실패하면 빈 글자 */
  function capture(w: number, h: number, type: string, quality?: number): string {
    const ratio = renderer.getPixelRatio()
    const outlineWasVisible = outline.visible
    const ringWasVisible = ring.visible
    const markersWereVisible = markerGroup.visible
    let dataUrl = ''
    try {
      outline.visible = false
      ring.visible = false
      // 저장한 그림에는 "참고용" 안내 글이 없으므로 빨간 점은 빼고 그린다
      markerGroup.visible = false
      renderer.setPixelRatio(1)
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      if (eyeMode !== 'off') applyEyeCamera()
      updateWallCut()
      renderer.render(scene, camera)
      // 그린 직후에 바로 읽어야 그림이 남아 있다
      dataUrl = canvas.toDataURL(type, quality)
    } catch {
      dataUrl = ''
    } finally {
      // 원래 크기로 되돌린다
      outline.visible = outlineWasVisible
      ring.visible = ringWasVisible
      markerGroup.visible = markersWereVisible
      renderer.setPixelRatio(ratio)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderNow()
    }
    return dataUrl
  }

  return {
    setRoom(room) {
      if (disposed) return
      const nextSize = { w: room.widthCm / 100, d: room.depthCm / 100, h: room.heightCm / 100 }
      const sizeChanged = nextSize.w !== roomSize.w || nextSize.d !== roomSize.d || nextSize.h !== roomSize.h
      const nextKey = [
        room.widthCm,
        room.depthCm,
        room.heightCm,
        room.style.wallColor,
        room.style.floorColor,
        room.style.floorMaterial,
        JSON.stringify(room.openings),
      ].join('|')
      const first = !hasRoom
      roomSize = nextSize
      hasRoom = true
      currentRoom = room
      if (nextKey !== shellKey) {
        shellKey = nextKey
        buildShell(room)
      }
      if (first || sizeChanged || room.furniture !== lastFurniture) {
        lastFurniture = room.furniture
        buildFurniture(room)
        applySelection()
        buildMarkers(room)
        // 가구가 바뀌면 걷던 길이 막혔을 수 있으니 멈추고, 서 있던 자리가 막혔으면 가장 가까운 자리로 옮긴다
        walk = null
        ring.visible = false
        keepEyeStandable(room)
      }
      if (eyeMode === 'off') {
        if (first || (sizeChanged && !userMoved)) applyView(currentView)
        else if (sizeChanged) controls.maxDistance = fitDistance() * 2.2
      } else if (first) {
        // 주소 옵션으로 바로 눈높이 보기를 열었을 때: 돌아갈 둘러보기 화면을 먼저 잡아 둔다
        applyView(currentView)
        enterEye(room)
      } else if (sizeChanged) {
        savedOrbit = null
      }
      requestRender()
    },

    setSelected(id) {
      if (disposed || id === selectedId) return
      selectedId = id
      applySelection()
      requestRender()
    },

    setQuality(next) {
      if (disposed || next === quality) return
      quality = next
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[quality].ratio))
      sun.shadow.mapSize.set(QUALITY[quality].shadow, QUALITY[quality].shadow)
      // 그림자 그림판을 버리면 다음에 그릴 때 새 크기로 다시 만들어진다
      if (sun.shadow.map) {
        sun.shadow.map.dispose()
        sun.shadow.map = null
      }
      requestRender()
    },

    setView(view) {
      if (disposed) return
      currentView = view
      userMoved = false
      if (eyeMode === 'off') applyView(view)
      else savedOrbit = null
      requestRender()
    },

    setEyeMode(mode) {
      if (disposed || mode === eyeMode) return
      const before = eyeMode
      eyeMode = mode
      markerGroup.visible = mode === 'child'
      if (currentRoom) {
        if (before === 'off') enterEye(currentRoom)
        else if (mode === 'off') exitEye()
      }
      reportEye()
      requestRender()
    },

    snapshot() {
      if (disposed) return ''
      return capture(1600, 1000, 'image/jpeg', 0.88)
    },

    savePng(fileName) {
      if (disposed) return false
      const dataUrl = capture(SAVE_WIDTH, SAVE_HEIGHT, 'image/png')
      const comma = dataUrl.indexOf(',')
      if (!dataUrl.startsWith('data:image/png') || comma < 0) return false
      try {
        const binary = atob(dataUrl.slice(comma + 1))
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
        const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
        const link = document.createElement('a')
        link.href = url
        link.download = fileName
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
        return true
      } catch {
        return false
      }
    },

    dispose() {
      if (disposed) return
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      observer.disconnect()
      controls.removeEventListener('change', onChange)
      controls.removeEventListener('start', onStart)
      controls.dispose()
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('keydown', onKeyDown)
      walk = null
      pointers.clear()
      emptyGroup(shellGroup)
      emptyGroup(furnitureGroup)
      furnitureViews.clear()
      markerGroup.clear()
      markerSprites = []
      walls = []
      ceiling = null
      scene.clear()
      scene.environment = null
      unitBox.dispose()
      unitEdges.dispose()
      outlineMaterial.dispose()
      dotTexture.dispose()
      dotMaterial.dispose()
      ringOuterShape.dispose()
      ringInnerShape.dispose()
      ringWhite.dispose()
      ringGreen.dispose()
      sun.dispose()
      environmentTarget.dispose()
      pmrem.dispose()
      renderer.renderLists.dispose()
      renderer.dispose()
      // 브라우저가 연결(context) 수 제한에 걸리지 않게 바로 놓아 준다
      renderer.forceContextLoss()
      canvas.remove()
    },
  }
}

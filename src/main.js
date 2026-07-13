import * as THREE from "three";
import * as UTIF from "utif";
import {
  Camera,
  ImageUp,
  Maximize2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Video,
  WandSparkles
} from "lucide";
import { createIcons } from "lucide";
import "./styles.css";

const canvas = document.querySelector("#star-canvas");
const readouts = [...document.querySelectorAll("[data-scene-readout]")];
const exportStatus = document.querySelector("#export-status");
const previewStage = document.querySelector("#preview-stage");
const focusPad = document.querySelector("#focus-pad");
const focusTarget = document.querySelector("#focus-target");
const focusReadout = document.querySelector("#focus-readout");

const defaults = Object.freeze({
  maxStars: 18000,
  threshold: 0.14,
  sampleScale: 0.7,
  boostFaintStars: true,
  layerCount: 36,
  depthRange: 1000,
  brightNear: 0.65,
  starScale: 1,
  starBrightness: 1.25,
  starOpacity: 1,
  backgroundBrightness: 1,
  motion: "pushIn",
  fitMode: "contain",
  speed: 0.08,
  parallax: 1.25,
  starDirection: "none",
  directionalDrift: 0.12,
  backgroundDrift: 0.65,
  backgroundMotion: "zoomIn",
  backgroundDirection: "up",
  backgroundSpeed: 0.24,
  backgroundZoom: 1.08,
  motionPreset: "zoomIn",
  starMotionPreset: "zoomIn",
  backgroundMotionPreset: "zoomIn",
  actionZoom: 1.12,
  focusX: 0.5,
  focusY: 0.5,
  rotationAngle: 0,
  rotationDirection: "cw",
  autoPanZoom: true,
  nebulaFadeIn: false,
  nebulaFadeOut: false,
  hyperspaceEffect: false,
  shipEffect: false,
  easedMotion: false,
  smoothInterpolation: false,
  speedRamp: 0,
  masterSpeed: 0.85,
  exportSize: "source",
  recordSeconds: 4,
  exportFps: 30,
  exportFormat: "mp4"
});

const state = {
  ...defaults,
  backgroundImage: null,
  starsImage: null,
  extractedStars: [],
  renderStars: [],
  imageAspect: 2160 / 3105,
  sourceSize: { width: 0, height: 0 },
  language: localStorage.getItem("starfield-language") || "zh",
  isPaused: false,
  isRecording: false
};

const runtime = {
  width: 1,
  height: 1,
  aspect: 1,
  imagePlane: { width: 1, height: 1 },
  nearDepth: 18,
  farDepth: 1018,
  backgroundBaseDepth: 240,
  backgroundTexture: null,
  starsTexture: null,
  fallbackStarsTexture: null,
  placeholderTexture: null,
  mediaRecorder: null,
  recordedChunks: [],
  renderTargetSize: null,
  backgroundBasePosition: new THREE.Vector3(0, 0, -240),
  motionTime: 0,
  recordProgress: null,
  recordStartedAt: null,
  recordDuration: 0,
  outputScale: 1,
  lastStarProgress: 0
};

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x05060a, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 6000);
camera.position.set(0, 0, 0);

const backgroundGeometry = new THREE.PlaneGeometry(1, 1);
const backgroundMaterials = [createBackgroundMaterial(), createBackgroundMaterial()];
const backgroundMeshes = backgroundMaterials.map((material) => {
  const mesh = new THREE.Mesh(backgroundGeometry, material);
  mesh.position.z = -runtime.backgroundBaseDepth;
  mesh.renderOrder = -10;
  scene.add(mesh);
  return mesh;
});
const backgroundMesh = backgroundMeshes[0];

const starGroup = new THREE.Group();
scene.add(starGroup);

const starMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexColors: true,
  uniforms: {
    starTexture: { value: null },
    useStarTexture: { value: 0 },
    pixelRatio: { value: renderer.getPixelRatio() },
    outputScale: { value: 1 },
    opacity: { value: 1 }
  },
  vertexShader: `
    uniform float pixelRatio;
    uniform float outputScale;
    attribute float size;
    attribute float alpha;
    attribute vec4 uvRect;
    varying vec3 vColor;
    varying float vAlpha;
    varying vec4 vUvRect;
    void main() {
      vColor = color;
      vAlpha = alpha;
      vUvRect = uvRect;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      float scaledSize = size * pixelRatio * outputScale * (88.0 / max(8.0, -mvPosition.z));
      gl_PointSize = clamp(scaledSize, 0.7 * outputScale, 22.0 * pixelRatio * outputScale);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform sampler2D starTexture;
    uniform float useStarTexture;
    uniform float opacity;
    varying vec3 vColor;
    varying float vAlpha;
    varying vec4 vUvRect;
    void main() {
      vec2 p = gl_PointCoord - vec2(0.5);
      float d = length(p);
      float core = smoothstep(0.26, 0.0, d);
      float halo = smoothstep(0.5, 0.06, d) * 0.34;
      vec4 texel = texture2D(starTexture, vUvRect.xy + gl_PointCoord * vUvRect.zw);
      float textureAlpha = max(max(texel.r, texel.g), texel.b);
      vec3 textureColor = texel.rgb;
      float proceduralAlpha = core + halo;
      float alphaShape = mix(proceduralAlpha, textureAlpha, useStarTexture);
      vec3 colorOut = mix(vColor, textureColor, useStarTexture);
      gl_FragColor = vec4(colorOut, alphaShape * vAlpha * opacity);
    }
  `
});

let starGeometry = new THREE.BufferGeometry();
let starPoints = new THREE.Points(starGeometry, starMaterial);
starPoints.renderOrder = 20;
starGroup.add(starPoints);

const trailMaterial = new THREE.LineBasicMaterial({
  transparent: true,
  opacity: 0.018,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  depthTest: false,
  vertexColors: true
});
let trailGeometry = new THREE.BufferGeometry();
let starTrails = new THREE.LineSegments(trailGeometry, trailMaterial);
starTrails.renderOrder = 15;
starGroup.add(starTrails);

let starData = createEmptyStarData();
const clock = new THREE.Clock();

runtime.fallbackStarsTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
runtime.fallbackStarsTexture.colorSpace = THREE.SRGBColorSpace;
runtime.fallbackStarsTexture.needsUpdate = true;
starMaterial.uniforms.starTexture.value = runtime.fallbackStarsTexture;

const directionVectors = {
  none: { x: 0, y: 0 },
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  upLeft: normalizeDirection(-1, 1),
  upRight: normalizeDirection(1, 1),
  downLeft: normalizeDirection(-1, -1),
  downRight: normalizeDirection(1, -1)
};

const focusRange = {
  min: -0.5,
  max: 1.5
};

function getMotionAngleRadians() {
  const degrees = Number(state.rotationAngle) || 0;
  const signedDegrees = state.rotationDirection === "ccw" ? -degrees : degrees;
  return THREE.MathUtils.degToRad(signedDegrees);
}

function rotateVector2(vector, radians) {
  if (!vector.x && !vector.y) return vector;
  if (!radians) return vector;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos
  };
}

function getMotionVector(directionKey, rotateWithBackground = false) {
  const vector = directionVectors[directionKey] || directionVectors.none;
  return rotateWithBackground ? rotateVector2(vector, getMotionAngleRadians()) : vector;
}

function getMasterSpeed() {
  return Math.max(0.1, Number(state.masterSpeed) || 1);
}

function getStarTravelBoost() {
  let boost = 1;
  if (state.shipEffect) boost *= 1.18;
  if (state.hyperspaceEffect) boost *= 1.22;
  return boost;
}

function getBackgroundTravelBoost() {
  let boost = state.autoPanZoom ? Math.max(1, Number(state.actionZoom) || 1) : 1;
  if (state.shipEffect) boost *= 1.18;
  if (state.hyperspaceEffect) boost *= 1.22;
  return boost;
}

function getNebulaEnvelope(progress) {
  let envelope = 1;
  if (state.nebulaFadeIn) envelope *= smoothstep(progress / 0.2);
  if (state.nebulaFadeOut) envelope *= 1 - smoothstep((progress - 0.72) / 0.28);
  return clamp(envelope, 0, 1);
}

function getTimelineProgress(time) {
  if (state.isRecording && runtime.recordStartedAt !== null && runtime.recordDuration > 0) {
    return clamp((performance.now() - runtime.recordStartedAt) / (runtime.recordDuration * 1000), 0, 1);
  }
  if (typeof runtime.recordProgress === "number") return clamp(runtime.recordProgress, 0, 1);
  const seconds = Math.max(1, Number(state.recordSeconds) || 4);
  return clamp(time / seconds, 0, 1);
}

function applySpeedRamp(progress) {
  const amount = clamp(Number(state.speedRamp) || 0, -1, 1);
  if (Math.abs(amount) < 0.001) return progress;
  const bend = progress * (1 - progress) * (2 * progress - 1);
  return clamp(progress + amount * bend, 0, 1);
}

function getTransformProgress(time) {
  const progress = applySpeedRamp(getTimelineProgress(time));
  return state.easedMotion ? smootherstep(progress) : progress;
}

function getMotionEnvelope(time) {
  if (!state.shipEffect && !state.easedMotion) return 1;
  const phase = getTimelineProgress(time);
  const eased = state.easedMotion ? smootherstep(phase) : phase;
  const shipCurve = state.shipEffect ? Math.sin(Math.PI * clamp(phase, 0, 1)) * 0.55 : 0;
  return 0.72 + eased * 0.28 + shipCurve;
}

const labels = {
  en: {
    directions: {
      none: "None",
      up: "Up",
      down: "Down",
      left: "Left",
      right: "Right",
      upLeft: "Up-left",
      upRight: "Up-right",
      downLeft: "Down-left",
      downRight: "Down-right"
    },
    backgroundMotion: {
      directional: "Directional",
      drift: "Free drift",
      zoom: "Zoom pulse",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      orbit: "Orbit",
      fixed: "Fixed"
    }
  },
  zh: {
    directions: {
      none: "无",
      up: "上",
      down: "下",
      left: "左",
      right: "右",
      upLeft: "左上",
      upRight: "右上",
      downLeft: "左下",
      downRight: "右下"
    },
    backgroundMotion: {
      directional: "定向",
      drift: "自由漂移",
      zoom: "缩放脉冲",
      zoomIn: "放大",
      zoomOut: "缩小",
      orbit: "环绕",
      fixed: "固定"
    }
  }
};

const translations = {
  en: {
    "readout.waiting": "Upload starless and stars images",
    "dock.title": "Control panel",
    "dock.subtitle": "Grouped to mirror the reference tool layout and export flow",
    "dock.reset": "Reset",
    "dock.rebuild": "Rebuild",
    "section.source": "Upload images",
    "section.stars": "Star controls",
    "section.motion": "Motion type",
    "section.effects": "Special effects",
    "section.output": "Output settings",
    "preview.title": "3D starfield preview",
    "preview.play": "Play",
    "preview.pause": "Pause",
    "preview.replay": "Replay",
    "upload.starless": "Starless image",
    "upload.stars": "Stars image",
    "common.none": "None",
    "source.rotate90": "Rotate 90 deg CW",
    "source.maxStars": "Max stars",
    "source.threshold": "Detection threshold",
    "source.sampleScale": "Sample scale",
    "source.boostFaint": "Boost faint stars",
    "source.build": "Process and build",
    "depth.layers": "Layer count",
    "depth.range": "3D strength",
    "depth.brightNear": "Bright stars near",
    "depth.starRetention": "Bright-star foreground weight",
    "depth.starSize": "Displayed star size",
    "depth.starBrightness": "Star brightness",
    "depth.starOpacity": "Overall star opacity",
    "depth.backgroundBrightness": "Background brightness",
    "motion.starMode": "Star mode",
    "motion.zoomIn": "Zoom in",
    "motion.zoomOut": "Zoom out",
    "motion.eightWay": "8-way drift",
    "motion.floating": "Floating drift",
    "motion.orbit": "Orbit",
    "motion.fitMode": "Fit mode",
    "fit.contain": "Contain",
    "fit.cover": "Cover",
    "motion.flightSpeed": "Authentic star speed",
    "motion.parallax": "Star parallax strength",
    "motion.starDirection": "Star direction",
    "motion.starDirectionSpeed": "Directional drift",
    "motion.backgroundAmplitude": "Background amplitude",
    "motion.backgroundMotion": "Background motion",
    "motion.backgroundDirection": "Background direction",
    "motion.backgroundSpeed": "Starless layer speed",
    "motion.backgroundZoom": "Background base zoom",
    "motion.preset": "Motion preset",
    "motion.starPreset": "Star layer preset",
    "motion.backgroundPreset": "Starless layer preset",
    "preset.fixed": "Fixed",
    "preset.zoomIn": "Fly toward camera",
    "preset.zoomOut": "Pull away",
    "preset.bgZoomIn": "Nebula zoom in",
    "preset.bgZoomOut": "Nebula zoom out",
    "preset.panLeft": "Fly left",
    "preset.panRight": "Fly right",
    "preset.panUp": "Fly up",
    "preset.panDown": "Fly down",
    "preset.panUpLeft": "Fly up-left",
    "preset.panUpRight": "Fly up-right",
    "preset.panDownLeft": "Fly down-left",
    "preset.panDownRight": "Fly down-right",
    "preset.zoomInLeft": "Zoom in + left",
    "preset.zoomInRight": "Zoom in + right",
    "preset.zoomInUp": "Zoom in + up",
    "preset.zoomInDown": "Zoom in + down",
    "preset.zoomInUpLeft": "Zoom in + up-left",
    "preset.zoomInUpRight": "Zoom in + up-right",
    "preset.zoomInDownLeft": "Zoom in + down-left",
    "preset.zoomInDownRight": "Zoom in + down-right",
    "preset.zoomOutLeft": "Zoom out + left",
    "preset.zoomOutRight": "Zoom out + right",
    "preset.zoomOutUp": "Zoom out + up",
    "preset.zoomOutDown": "Zoom out + down",
    "preset.zoomOutUpLeft": "Zoom out + up-left",
    "preset.zoomOutUpRight": "Zoom out + up-right",
    "preset.zoomOutDownLeft": "Zoom out + down-left",
    "preset.zoomOutDownRight": "Zoom out + down-right",
    "preset.drift": "Free drift",
    "preset.zoomPulse": "Zoom pulse",
    "preset.orbit": "Orbit",
    "motion.focus": "Zoom focus",
    "motion.resetFocus": "Reset",
    "motion.rotationAngle": "Rotation angle",
    "motion.clockwise": "Clockwise",
    "motion.counterClockwise": "Counterclockwise",
    "motion.actionZoom": "Starless action zoom",
    "motion.autoPanZoom": "Auto zoom starless layer while panning",
    "dir.none": "None",
    "dir.up": "Up",
    "dir.down": "Down",
    "dir.left": "Left",
    "dir.right": "Right",
    "dir.upLeft": "Up-left",
    "dir.upRight": "Up-right",
    "dir.downLeft": "Down-left",
    "dir.downRight": "Down-right",
    "bg.directional": "Directional",
    "bg.drift": "Free drift",
    "bg.zoomPulse": "Zoom pulse",
    "bg.zoomIn": "Zoom in",
    "bg.zoomOut": "Zoom out",
    "bg.orbit": "Orbit",
    "bg.fixed": "Fixed",
    "output.size": "Output size",
    "output.preview": "Current preview",
    "output.1080p": "1080p portrait",
    "output.sourceHalf": "Source 1/2",
    "output.source": "Source size",
    "output.duration": "Duration (sec)",
    "output.fps": "FPS",
    "output.format": "Format",
    "output.speedScale": "Speed scale",
    "output.downloadVideo": "Download video",
    "output.recalculate": "Recalculate depth",
    "output.reset": "Reset parameters",
    "effects.nebulaFadeIn": "Nebula fade in",
    "effects.nebulaFadeInHelp": "Fade nebula in at the start of the clip",
    "effects.nebulaFadeOut": "Nebula fade out",
    "effects.nebulaFadeOutHelp": "Fade nebula out across the clip",
    "effects.hyperspace": "Hyperspace effect",
    "effects.hyperspaceHelp": "Add stronger motion blur and speed feel",
    "effects.ship": "Ship effect",
    "effects.shipHelp": "Accelerate at the start and slow at the end",
    "effects.ease": "Curved motion",
    "effects.easeHelp": "Add easing changes during travel",
    "effects.smooth": "Bilinear interpolation",
    "effects.smoothHelp": "Blend and scale more smoothly",
    "effects.speedRamp": "Continuous speed curve",
    "status.waiting": "Waiting for images"
  },
  zh: {
    "readout.waiting": "请上传去星图和星点图",
    "dock.title": "控制面板",
    "dock.subtitle": "按参考工具的分组方式整理参数与导出设置",
    "dock.reset": "重置",
    "dock.rebuild": "重算",
    "section.source": "上传图像",
    "section.stars": "星点控制",
    "section.motion": "动作类型",
    "section.effects": "特殊效果",
    "section.output": "输出设置",
    "preview.title": "3D 星场预览",
    "preview.play": "播放",
    "preview.pause": "暂停",
    "preview.replay": "重播",
    "upload.starless": "去星图",
    "upload.stars": "星点图",
    "common.none": "未选择",
    "source.rotate90": "顺时针旋转 90°",
    "source.maxStars": "最大星点数",
    "source.threshold": "提取阈值",
    "source.sampleScale": "采样精度",
    "source.boostFaint": "增强暗星",
    "source.build": "处理并生成",
    "depth.layers": "图层数量",
    "depth.range": "3D 强度",
    "depth.brightNear": "亮星前景权重",
    "depth.starRetention": "亮星前景权重",
    "depth.starSize": "星点显示大小",
    "depth.starBrightness": "星点亮度",
    "depth.starOpacity": "星点整体透明度",
    "depth.backgroundBrightness": "背景亮度",
    "motion.starMode": "星点模式",
    "motion.zoomIn": "放大推进",
    "motion.zoomOut": "缩小拉远",
    "motion.eightWay": "8 方向漂移",
    "motion.floating": "浮动漂移",
    "motion.orbit": "环绕",
    "motion.fitMode": "适配模式",
    "fit.contain": "完整显示",
    "fit.cover": "铺满裁切",
    "motion.flightSpeed": "真实星点速度",
    "motion.parallax": "星层视差强度",
    "motion.starDirection": "星点方向",
    "motion.starDirectionSpeed": "方向漂移",
    "motion.backgroundAmplitude": "背景幅度",
    "motion.backgroundMotion": "背景动作",
    "motion.backgroundDirection": "背景方向",
    "motion.backgroundSpeed": "去星层速度",
    "motion.backgroundZoom": "背景基础缩放",
    "motion.preset": "动作预设",
    "motion.starPreset": "星层动作预设",
    "motion.backgroundPreset": "去星层动作预设",
    "preset.fixed": "固定",
    "preset.zoomIn": "拉近飞过",
    "preset.zoomOut": "拉远退场",
    "preset.bgZoomIn": "星云拉近",
    "preset.bgZoomOut": "星云拉远",
    "preset.panLeft": "向左飞过",
    "preset.panRight": "向右飞过",
    "preset.panUp": "向上飞过",
    "preset.panDown": "向下飞过",
    "preset.panUpLeft": "左上飞过",
    "preset.panUpRight": "右上飞过",
    "preset.panDownLeft": "左下飞过",
    "preset.panDownRight": "右下飞过",
    "preset.zoomInLeft": "拉近 + 向左",
    "preset.zoomInRight": "拉近 + 向右",
    "preset.zoomInUp": "拉近 + 向上",
    "preset.zoomInDown": "拉近 + 向下",
    "preset.zoomInUpLeft": "拉近 + 左上",
    "preset.zoomInUpRight": "拉近 + 右上",
    "preset.zoomInDownLeft": "拉近 + 左下",
    "preset.zoomInDownRight": "拉近 + 右下",
    "preset.zoomOutLeft": "拉远 + 向左",
    "preset.zoomOutRight": "拉远 + 向右",
    "preset.zoomOutUp": "拉远 + 向上",
    "preset.zoomOutDown": "拉远 + 向下",
    "preset.zoomOutUpLeft": "拉远 + 左上",
    "preset.zoomOutUpRight": "拉远 + 右上",
    "preset.zoomOutDownLeft": "拉远 + 左下",
    "preset.zoomOutDownRight": "拉远 + 右下",
    "preset.drift": "自由漂移",
    "preset.zoomPulse": "缩放脉冲",
    "preset.orbit": "环绕",
    "motion.focus": "缩放焦点",
    "motion.resetFocus": "重置",
    "motion.rotationAngle": "旋转角度",
    "motion.clockwise": "顺时针",
    "motion.counterClockwise": "逆时针",
    "motion.actionZoom": "去星层动作放大",
    "motion.autoPanZoom": "去星层平移时自动放大",
    "dir.none": "无",
    "dir.up": "上",
    "dir.down": "下",
    "dir.left": "左",
    "dir.right": "右",
    "dir.upLeft": "左上",
    "dir.upRight": "右上",
    "dir.downLeft": "左下",
    "dir.downRight": "右下",
    "bg.directional": "定向",
    "bg.drift": "自由漂移",
    "bg.zoomPulse": "缩放脉冲",
    "bg.zoomIn": "放大",
    "bg.zoomOut": "缩小",
    "bg.orbit": "环绕",
    "bg.fixed": "固定",
    "output.size": "输出尺寸",
    "output.preview": "当前预览",
    "output.1080p": "1080p 竖版",
    "output.sourceHalf": "原图 1/2",
    "output.source": "原图尺寸",
    "output.duration": "时长（秒）",
    "output.fps": "FPS",
    "output.format": "格式",
    "output.speedScale": "速度倍率",
    "output.downloadVideo": "下载视频",
    "output.recalculate": "重新计算深度",
    "output.reset": "重置参数",
    "effects.nebulaFadeIn": "星云淡入",
    "effects.nebulaFadeInHelp": "视频开始时让星云逐渐出现",
    "effects.nebulaFadeOut": "星云淡出",
    "effects.nebulaFadeOutHelp": "视频结束前让星云逐渐消退",
    "effects.hyperspace": "超空间效果",
    "effects.hyperspaceHelp": "增强运动模糊和穿梭感",
    "effects.ship": "飞船效果",
    "effects.shipHelp": "开头加速、结尾减速",
    "effects.ease": "曲线运动",
    "effects.easeHelp": "让飞行过程带有缓动变化",
    "effects.smooth": "双线性插值",
    "effects.smoothHelp": "让预览和导出更平滑地缩放与混合",
    "effects.speedRamp": "连续变速曲线",
    "status.waiting": "等待上传素材"
  }
};

createIcons({
  icons: {
    Camera,
    ImageUp,
    Maximize2,
    Pause,
    Play,
    RefreshCw,
    RotateCcw,
    Sparkles,
    Video,
    WandSparkles
  },
  attrs: { "aria-hidden": "true" }
});

bindSections();
bindControls();
syncControlsFromState();
applyLanguage();
syncOutputs();
syncReadouts();
createPlaceholderBackground();
syncPreviewAspect();
resize();
renderEmptyScene();
requestAnimationFrame(tick);

window.addEventListener("resize", resize);
if (typeof ResizeObserver !== "undefined" && previewStage) {
  const previewResizeObserver = new ResizeObserver(() => resize());
  previewResizeObserver.observe(previewStage);
}

function bindSections() {
  document.querySelectorAll("[data-toggle-section]").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const name = toggle.dataset.toggleSection;
      const section = document.querySelector(`[data-section="${name}"]`);
      if (!section) return;
      const willOpen = !section.classList.contains("is-open");
      section.classList.toggle("is-open", willOpen);
      toggle.classList.toggle("is-open", willOpen);
    });
  });
}

function bindControls() {
  const languageSelect = document.querySelector("#language-select");
  if (languageSelect) {
    languageSelect.value = state.language;
    languageSelect.addEventListener("change", () => {
      state.language = languageSelect.value;
      localStorage.setItem("starfield-language", state.language);
      applyLanguage();
      syncOutputs();
      if (!starData.count) renderEmptyScene();
    });
  }

  document.querySelectorAll("[data-setting]").forEach((control) => {
    const key = control.dataset.setting;
    const eventName =
      control.type === "checkbox" || control.type === "radio" || control.tagName === "SELECT" ? "change" : "input";
    control.addEventListener(eventName, () => {
      state[key] = readControlValue(control, state[key]);
      syncOutputs();
      handleSettingChange(key);
    });
  });

  document.querySelector("#background-upload").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const nameLabel = document.querySelector("#background-name");
    try {
      assertSupportedImageFile(file);
      nameLabel.removeAttribute("data-i18n");
      nameLabel.textContent = file.name;
      state.backgroundImage = await loadImage(file);
      setSourceSizeFromImage(state.backgroundImage);
      applyBackgroundImage();
      setStatus(state.starsImage ? statusText("starlessLoaded") : statusText("starlessWaiting"));
      if (state.starsImage) processImages();
    } catch (error) {
      event.target.value = "";
      nameLabel.textContent = state.language === "zh" ? "格式不支持" : "Unsupported format";
      setStatus(error.message);
    }
  });

  document.querySelector("#stars-upload").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const nameLabel = document.querySelector("#stars-name");
    try {
      assertSupportedImageFile(file);
      nameLabel.removeAttribute("data-i18n");
      nameLabel.textContent = file.name;
      state.starsImage = await loadImage(file);
      setSourceSizeFromImage(state.starsImage);
      setStatus(statusText("starsLoaded"));
      if (state.backgroundImage) processImages();
    } catch (error) {
      event.target.value = "";
      nameLabel.textContent = state.language === "zh" ? "格式不支持" : "Unsupported format";
      setStatus(error.message);
    }
  });

  document.querySelector("#process-images").addEventListener("click", processImages);
  document.querySelector("#rebuild-depth").addEventListener("click", rebuildDepth);
  document.querySelector("#reset-scene").addEventListener("click", resetParameters);
  document.querySelector("#rotate-source").addEventListener("click", rotateSourceImages);
  document.querySelector("#capture-png").addEventListener("click", exportPng);
  document.querySelector("#record-webm").addEventListener("click", recordWebm);
  document.querySelector("#download-video").addEventListener("click", recordWebm);
  document.querySelector("#fit-toggle").addEventListener("click", toggleFitMode);
  document.querySelector("#preview-play-toggle").addEventListener("click", togglePreviewPlay);
  document.querySelector("#preview-replay-toggle").addEventListener("click", replayPreview);
  document.querySelector("#reset-focus").addEventListener("click", resetFocusTarget);

  if (focusPad) {
    focusPad.addEventListener("pointerdown", setFocusFromEvent);
    focusPad.addEventListener("pointermove", (event) => {
      if (event.buttons === 1) setFocusFromEvent(event);
    });
  }

  document.querySelector("#pause-toggle").addEventListener("click", togglePreviewPlay);

  document.querySelector("#language-select").addEventListener("change", () => syncReadouts());
}

function applyLanguage() {
  document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
}

function t(key) {
  return translations[state.language]?.[key] || translations.en[key] || key;
}

function readControlValue(control, previous) {
  if (control.type === "checkbox") return control.checked;
  if (control.type === "radio") return control.checked ? control.value : previous;
  if (typeof previous === "number") return Number(control.value);
  return control.value;
}

function handleSettingChange(key) {
  if (
    [
      "fitMode",
      "backgroundBrightness",
      "backgroundZoom",
      "focusX",
      "focusY",
      "rotationAngle",
      "actionZoom",
      "autoPanZoom",
      "rotationDirection"
    ].includes(key)
  ) {
    updateBackgroundPlane();
  }

  if (["starScale", "starBrightness", "starOpacity", "boostFaintStars"].includes(key) && state.extractedStars.length) {
    rebuildStarGeometry();
  }

  if (["layerCount", "depthRange", "brightNear"].includes(key) && state.extractedStars.length) {
    rebuildDepth();
  }

  if (key === "starMotionPreset") {
    applyStarMotionPreset(state.starMotionPreset);
  }

  if (key === "backgroundMotionPreset") {
    applyBackgroundMotionPreset(state.backgroundMotionPreset);
  }

  if (key === "motionPreset") {
    applyMotionPreset(state.motionPreset);
  }

  if (["actionZoom", "autoPanZoom", "masterSpeed", "rotationDirection", "easedMotion", "smoothInterpolation"].includes(key)) {
    syncReadouts();
  }

  if (key === "smoothInterpolation") {
    applyTextureFiltering();
  }

  if (["threshold", "sampleScale", "maxStars"].includes(key) && state.starsImage) {
    setStatus(statusText("settingsChanged"));
  }
}

function syncOutputs() {
  setOutput("maxStars", state.maxStars.toLocaleString("en-US"));
  setOutput("threshold", state.threshold.toFixed(2));
  setOutput("sampleScale", `${state.sampleScale.toFixed(2)}x`);
  setOutput("layerCount", state.layerCount);
  setOutput("depthRange", state.depthRange);
  setOutput("brightNear", state.brightNear.toFixed(2));
  setOutput("starScale", state.starScale.toFixed(2));
  setOutput("starBrightness", state.starBrightness.toFixed(2));
  setOutput("starOpacity", `${Math.round(state.starOpacity * 100)}%`);
  setOutput("backgroundBrightness", state.backgroundBrightness.toFixed(2));
  setOutput("speed", `${state.speed.toFixed(2)}x`);
  setOutput("parallax", state.parallax.toFixed(2));
  setOutput("starDirectionLabel", getDirectionLabel(state.starDirection));
  setOutput("directionalDrift", state.directionalDrift.toFixed(2));
  setOutput("backgroundDrift", state.backgroundDrift.toFixed(2));
  setOutput("backgroundMotionLabel", getBackgroundMotionLabel(state.backgroundMotion));
  setOutput("backgroundDirectionLabel", getDirectionLabel(state.backgroundDirection));
  setOutput("backgroundSpeed", `${state.backgroundSpeed.toFixed(2)}x`);
  setOutput("backgroundZoom", state.backgroundZoom.toFixed(2));
  setOutput("rotationAngle", `${Math.round(state.rotationAngle)}°`);
  setOutput("actionZoom", `${Math.round(state.actionZoom * 100)}%`);
  setOutput("recordSeconds", `${state.recordSeconds}s`);
  setOutput("masterSpeed", `${state.masterSpeed.toFixed(2)}x`);
  setOutput("speedRamp", formatSpeedRamp(state.speedRamp));
  setFocusReadout();
}

function setOutput(name, value) {
  const el = document.querySelector(`[data-output="${name}"]`);
  if (el) el.value = value;
}

function formatSpeedRamp(value) {
  const amount = clamp(Number(value) || 0, -1, 1);
  if (Math.abs(amount) < 0.001) return state.language === "zh" ? "线性" : "Linear";
  const prefix = state.language === "zh" ? "平滑曲线" : "Smooth curve";
  return `${prefix} ${amount > 0 ? "+" : ""}${amount.toFixed(2)}`;
}

function setControlValue(name, value) {
  const controls = document.querySelectorAll(`[data-setting="${name}"]`);
  if (!controls.length) return;
  controls.forEach((control) => {
    if (control.type === "checkbox") {
      control.checked = Boolean(value);
    } else if (control.type === "radio") {
      control.checked = control.value === String(value);
    } else {
      control.value = String(value);
    }
  });
}

function syncControlsFromState() {
  document.querySelectorAll("[data-setting]").forEach((control) => {
    const key = control.dataset.setting;
    if (Object.prototype.hasOwnProperty.call(state, key)) {
      if (control.type === "checkbox") control.checked = Boolean(state[key]);
      else if (control.type === "radio") control.checked = control.value === String(state[key]);
      else control.value = String(state[key]);
    }
  });
}

function syncReadouts() {
  const text = statusText(
    "readoutStars",
    starData.count.toLocaleString("en-US"),
    state.sourceSize.width && state.sourceSize.height
      ? `${state.sourceSize.width}x${state.sourceSize.height}`
      : t("readout.waiting")
  );
  readouts.forEach((node) => {
    node.textContent = starData.count ? text : t("readout.waiting");
  });
  setFocusIndicator();
}

function setFocusReadout() {
  if (!focusReadout) return;
  focusReadout.textContent = `当前: [${Math.round(state.focusX * 100)}%, ${Math.round(state.focusY * 100)}%]`;
}

function focusValueToPadRatio(value) {
  return clamp((value - focusRange.min) / (focusRange.max - focusRange.min), 0, 1);
}

function focusPadRatioToValue(value) {
  return focusRange.min + clamp(value, 0, 1) * (focusRange.max - focusRange.min);
}

function setFocusIndicator() {
  if (!focusTarget || !focusPad) return;
  const rect = focusPad.getBoundingClientRect();
  focusTarget.style.left = `${focusValueToPadRatio(state.focusX) * rect.width}px`;
  focusTarget.style.top = `${focusValueToPadRatio(state.focusY) * rect.height}px`;
}

function resetParameters() {
  Object.entries(defaults).forEach(([key, value]) => {
    state[key] = value;
    setControlValue(key, value);
  });
  applyStarMotionPreset(state.starMotionPreset);
  applyBackgroundMotionPreset(state.backgroundMotionPreset);
  updateFocusTarget(state.focusX, state.focusY);
  syncOutputs();
  updateBackgroundPlane();
  if (state.extractedStars.length) rebuildDepth();
  setStatus(statusText("parametersReset"));
}

function toggleFitMode() {
  state.fitMode = state.fitMode === "contain" ? "cover" : "contain";
  setControlValue("fitMode", state.fitMode);
  updateBackgroundPlane();
  setStatus(state.fitMode === "contain" ? statusText("containFit") : statusText("coverFit"));
}

function applyStarMotionPreset(preset) {
  const presets = {
    fixed: { motion: "fixed", starDirection: "none" },
    zoomIn: { motion: "pushIn", starDirection: "none" },
    zoomOut: { motion: "pullBack", starDirection: "none" },
    orbit: { motion: "orbit", starDirection: "none" },
    panLeft: { motion: "directional", starDirection: "left" },
    panRight: { motion: "directional", starDirection: "right" },
    panUp: { motion: "directional", starDirection: "up" },
    panDown: { motion: "directional", starDirection: "down" },
    panUpLeft: { motion: "directional", starDirection: "upLeft" },
    panUpRight: { motion: "directional", starDirection: "upRight" },
    panDownLeft: { motion: "directional", starDirection: "downLeft" },
    panDownRight: { motion: "directional", starDirection: "downRight" },
    zoomInLeft: { motion: "pushIn", starDirection: "left" },
    zoomInRight: { motion: "pushIn", starDirection: "right" },
    zoomInUp: { motion: "pushIn", starDirection: "up" },
    zoomInDown: { motion: "pushIn", starDirection: "down" },
    zoomInUpLeft: { motion: "pushIn", starDirection: "upLeft" },
    zoomInUpRight: { motion: "pushIn", starDirection: "upRight" },
    zoomInDownLeft: { motion: "pushIn", starDirection: "downLeft" },
    zoomInDownRight: { motion: "pushIn", starDirection: "downRight" },
    zoomOutLeft: { motion: "pullBack", starDirection: "left" },
    zoomOutRight: { motion: "pullBack", starDirection: "right" },
    zoomOutUp: { motion: "pullBack", starDirection: "up" },
    zoomOutDown: { motion: "pullBack", starDirection: "down" },
    zoomOutUpLeft: { motion: "pullBack", starDirection: "upLeft" },
    zoomOutUpRight: { motion: "pullBack", starDirection: "upRight" },
    zoomOutDownLeft: { motion: "pullBack", starDirection: "downLeft" },
    zoomOutDownRight: { motion: "pullBack", starDirection: "downRight" }
  };

  const selectedPreset = presets[preset] ? preset : "zoomIn";
  const config = presets[selectedPreset];
  state.starMotionPreset = selectedPreset;
  state.motion = config.motion;
  state.starDirection = config.starDirection;
  setControlValue("starMotionPreset", state.starMotionPreset);
  setControlValue("motion", state.motion);
  setControlValue("starDirection", state.starDirection);
  syncOutputs();
}

function applyBackgroundMotionPreset(preset) {
  const presets = {
    fixed: { backgroundMotion: "fixed", backgroundDirection: "up" },
    zoomIn: { backgroundMotion: "zoomIn", backgroundDirection: "up" },
    zoomOut: { backgroundMotion: "zoomOut", backgroundDirection: "up" },
    drift: { backgroundMotion: "drift", backgroundDirection: "up" },
    zoomPulse: { backgroundMotion: "zoom", backgroundDirection: "up" },
    orbit: { backgroundMotion: "orbit", backgroundDirection: "up" },
    panLeft: { backgroundMotion: "directional", backgroundDirection: "left" },
    panRight: { backgroundMotion: "directional", backgroundDirection: "right" },
    panUp: { backgroundMotion: "directional", backgroundDirection: "up" },
    panDown: { backgroundMotion: "directional", backgroundDirection: "down" },
    panUpLeft: { backgroundMotion: "directional", backgroundDirection: "upLeft" },
    panUpRight: { backgroundMotion: "directional", backgroundDirection: "upRight" },
    panDownLeft: { backgroundMotion: "directional", backgroundDirection: "downLeft" },
    panDownRight: { backgroundMotion: "directional", backgroundDirection: "downRight" }
  };

  const selectedPreset = presets[preset] ? preset : "zoomIn";
  const config = presets[selectedPreset];
  state.backgroundMotionPreset = selectedPreset;
  state.backgroundMotion = config.backgroundMotion;
  state.backgroundDirection = config.backgroundDirection;
  setControlValue("backgroundMotionPreset", state.backgroundMotionPreset);
  setControlValue("backgroundMotion", state.backgroundMotion);
  setControlValue("backgroundDirection", state.backgroundDirection);
  syncOutputs();
  updateBackgroundPlane();
}

function applyMotionPreset(preset) {
  state.motionPreset = preset;
  applyStarMotionPreset(preset);
  applyBackgroundMotionPreset(preset);
}

function setFocusFromEvent(event) {
  if (!focusPad) return;
  const rect = focusPad.getBoundingClientRect();
  const x = focusPadRatioToValue((event.clientX - rect.left) / rect.width);
  const y = focusPadRatioToValue((event.clientY - rect.top) / rect.height);
  updateFocusTarget(x, y);
}

function updateFocusTarget(x, y) {
  state.focusX = clamp(x, focusRange.min, focusRange.max);
  state.focusY = clamp(y, focusRange.min, focusRange.max);
  setControlValue("focusX", state.focusX);
  setControlValue("focusY", state.focusY);
  setFocusReadout();
  setFocusIndicator();
  updateBackgroundPlane();
}

function resetFocusTarget() {
  updateFocusTarget(0.5, 0.5);
}

function togglePreviewPlay() {
  state.isPaused = !state.isPaused;
  syncPlaybackButtons();
}

function replayPreview() {
  clock.start();
  runtime.motionTime = 0;
  runtime.recordProgress = null;
  resetStarDepartureState();
  state.isPaused = false;
  syncPlaybackButtons();
}

function syncPlaybackButtons() {
  const pauseButton = document.querySelector("#pause-toggle");
  if (pauseButton) {
    pauseButton.innerHTML = state.isPaused ? '<i data-lucide="play"></i>' : '<i data-lucide="pause"></i>';
  }

  const previewButton = document.querySelector("#preview-play-toggle");
  if (previewButton) {
    previewButton.innerHTML = state.isPaused
      ? '<i data-lucide="play"></i><span data-i18n="preview.play">播放</span>'
      : '<i data-lucide="pause"></i><span data-i18n="preview.pause">暂停</span>';
  }
  applyLanguage();
  createIcons({ icons: { Pause, Play }, attrs: { "aria-hidden": "true" } });
}

function rotateSourceImages() {
  if (!state.backgroundImage || !state.starsImage) {
    setStatus(statusText("needBothImages"));
    return;
  }

  const rotatedBackground = rotateImage90(state.backgroundImage);
  const rotatedStars = rotateImage90(state.starsImage);
  state.backgroundImage = rotatedBackground;
  state.starsImage = rotatedStars;
  setSourceSizeFromImage(rotatedBackground);
  applyBackgroundImage();
  processImages();
  setStatus(statusText("parametersReset"));
}

function rotateImage90(image) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const canvasEl = document.createElement("canvas");
  canvasEl.width = sourceHeight;
  canvasEl.height = sourceWidth;
  const ctx = canvasEl.getContext("2d");
  ctx.translate(sourceHeight, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(image, 0, 0);
  return canvasEl;
}

function setSourceSizeFromImage(image) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) return;
  state.sourceSize = { width, height };
  state.imageAspect = width / height;
  syncPreviewAspect();
}

function syncPreviewAspect() {
  if (!previewStage) return;
  const width = state.sourceSize.width || 9;
  const height = state.sourceSize.height || 16;
  const aspect = width / height || state.imageAspect || 9 / 16;
  previewStage.style.setProperty("--preview-aspect", `${width} / ${height}`);
  previewStage.style.setProperty("--preview-aspect-scale", String(aspect));
}

function processImages() {
  if (!state.backgroundImage || !state.starsImage) {
    setStatus(statusText("needBothImages"));
    return;
  }

  runtime.motionTime = 0;
  runtime.recordProgress = null;
  setSourceSizeFromImage(state.backgroundImage);
  applyBackgroundImage();
  applyStarsTexture();
  state.extractedStars = extractStarsFromImage(state.starsImage);
  if (!state.extractedStars.length) {
    clearStars();
    setStatus(statusText("noStars"));
    syncReadouts();
    return;
  }

  rebuildDepth();
  setStatus(statusText("extracted", state.extractedStars.length.toLocaleString("en-US")));
}

function rebuildDepth() {
  if (!state.extractedStars.length) {
    setStatus(statusText("buildFirst"));
    return;
  }

  const rng = seededRandom(hashStars(state.extractedStars) + state.layerCount * 97);
  runtime.farDepth = runtime.nearDepth + state.depthRange;
  state.extractedStars.forEach((star, index) => {
    const brightnessDepth = 1 - Math.pow(star.score, 0.55);
    const randomDepth = rng();
    let depth01 = lerp(randomDepth, brightnessDepth, state.brightNear);
    if (state.layerCount > 1) {
      const layer = Math.floor(depth01 * state.layerCount);
      depth01 = (layer + rng() * 0.72) / state.layerCount;
    }
    star.depth = runtime.nearDepth + depth01 * state.depthRange;
    star.phase = rng() * Math.PI * 2;
    star.speed = 0.72 + rng() * 0.64 + star.score * 0.22;
    star.index = index;
  });
  rebuildStarGeometry();
}

function rebuildStarGeometry() {
  starData = buildImageDrivenStarData(state.extractedStars);
  starGroup.remove(starPoints);
  starGroup.remove(starTrails);
  starGeometry.dispose();
  trailGeometry.dispose();
  starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starData.positions, 3).setUsage(THREE.DynamicDrawUsage));
  starGeometry.setAttribute("color", new THREE.BufferAttribute(starData.colors, 3));
  starGeometry.setAttribute("uvRect", new THREE.BufferAttribute(starData.uvRects, 4));
  starGeometry.setAttribute("size", new THREE.BufferAttribute(starData.sizes, 1));
  starGeometry.setAttribute("alpha", new THREE.BufferAttribute(starData.alphas, 1).setUsage(THREE.DynamicDrawUsage));
  starPoints = new THREE.Points(starGeometry, starMaterial);
  starPoints.renderOrder = 20;
  starGroup.add(starPoints);
  trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(starData.trailPositions, 3).setUsage(THREE.DynamicDrawUsage)
  );
  trailGeometry.setAttribute("color", new THREE.BufferAttribute(starData.trailColors, 3));
  starTrails = new THREE.LineSegments(trailGeometry, trailMaterial);
  starTrails.renderOrder = 15;
  starGroup.add(starTrails);
  resetStarDepartureState();
  syncReadouts();
}

function buildImageDrivenStarData(stars) {
  const count = stars.length;
  const positions = new Float32Array(count * 3);
  const basePositions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvRects = new Float32Array(count * 4);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const baseAlphas = new Float32Array(count);
  const depths = new Float32Array(count);
  const anchorDepths = new Float32Array(count);
  const ndcXs = new Float32Array(count);
  const ndcYs = new Float32Array(count);
  const speeds = new Float32Array(count);
  const phases = new Float32Array(count);
  const seeds = new Float32Array(count);
  const departed = new Uint8Array(count);
  const trailPositions = new Float32Array(count * 2 * 3);
  const trailColors = new Float32Array(count * 2 * 3);

  for (let i = 0; i < count; i += 1) {
    const star = stars[i];
    const depth = star.depth || runtime.nearDepth + state.depthRange * 0.5;
    const target = imageToPlaneNdc(star.x, star.y);
    const seed = seededUnit(i, star.x, star.y, star.score);
    const anchorDepth = runtime.farDepth * (0.88 + seed * 0.18);
    const pos = ndcToWorld(target.x, target.y, anchorDepth);
    const idx = i * 3;
    positions[idx] = pos.x;
    positions[idx + 1] = pos.y;
    positions[idx + 2] = -depth;
    basePositions[idx] = pos.x;
    basePositions[idx + 1] = pos.y;
    basePositions[idx + 2] = -depth;
    colors[idx] = star.r;
    colors[idx + 1] = star.g;
    colors[idx + 2] = star.b;
    uvRects[i * 4] = star.uvX || 0;
    uvRects[i * 4 + 1] = star.uvY || 0;
    uvRects[i * 4 + 2] = star.uvW || 1;
    uvRects[i * 4 + 3] = star.uvH || 1;
    sizes[i] = computeStarSize(star);
    alphas[i] = computeStarAlpha(star);
    baseAlphas[i] = alphas[i];
    depths[i] = depth;
    anchorDepths[i] = anchorDepth;
    ndcXs[i] = target.x;
    ndcYs[i] = target.y;
    speeds[i] = star.speed || 1;
    phases[i] = star.phase || 0;
    seeds[i] = seed;
    const trailIdx = i * 6;
    trailPositions[trailIdx] = pos.x;
    trailPositions[trailIdx + 1] = pos.y;
    trailPositions[trailIdx + 2] = -depth;
    trailPositions[trailIdx + 3] = pos.x;
    trailPositions[trailIdx + 4] = pos.y;
    trailPositions[trailIdx + 5] = -depth;
    trailColors[trailIdx] = star.r;
    trailColors[trailIdx + 1] = star.g;
    trailColors[trailIdx + 2] = star.b;
    trailColors[trailIdx + 3] = star.r * 0.12;
    trailColors[trailIdx + 4] = star.g * 0.12;
    trailColors[trailIdx + 5] = star.b * 0.12;
  }

  return {
    positions,
    basePositions,
    colors,
    uvRects,
    sizes,
    alphas,
    baseAlphas,
    depths,
    anchorDepths,
    ndcXs,
    ndcYs,
    speeds,
    phases,
    seeds,
    departed,
    trailPositions,
    trailColors,
    count
  };
}

function clearStars() {
  state.extractedStars = [];
  starData = createEmptyStarData();
  starGroup.remove(starPoints);
  starGroup.remove(starTrails);
  starGeometry.dispose();
  trailGeometry.dispose();
  starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starData.positions, 3));
  starGeometry.setAttribute("uvRect", new THREE.BufferAttribute(starData.uvRects, 4));
  starPoints = new THREE.Points(starGeometry, starMaterial);
  starPoints.renderOrder = 20;
  starGroup.add(starPoints);
  trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute("position", new THREE.BufferAttribute(starData.trailPositions, 3));
  trailGeometry.setAttribute("color", new THREE.BufferAttribute(starData.trailColors, 3));
  starTrails = new THREE.LineSegments(trailGeometry, trailMaterial);
  starTrails.renderOrder = 15;
  starGroup.add(starTrails);
  resetStarDepartureState();
}

function createEmptyStarData() {
  return {
    positions: new Float32Array(),
    basePositions: new Float32Array(),
    colors: new Float32Array(),
    uvRects: new Float32Array(),
    sizes: new Float32Array(),
    alphas: new Float32Array(),
    baseAlphas: new Float32Array(),
    depths: new Float32Array(),
    anchorDepths: new Float32Array(),
    ndcXs: new Float32Array(),
    ndcYs: new Float32Array(),
    speeds: new Float32Array(),
    phases: new Float32Array(),
    seeds: new Float32Array(),
    departed: new Uint8Array(),
    trailPositions: new Float32Array(),
    trailColors: new Float32Array(),
    count: 0
  };
}

function resetStarDepartureState() {
  if (starData.departed?.fill) starData.departed.fill(0);
  runtime.lastStarProgress = 0;
}

function computeStarSize(star) {
  return (1 + Math.pow(star.score, 1.7) * 6.5 + star.radius * 0.45) * state.starScale;
}

function computeStarAlpha(star) {
  const faintBoost = state.boostFaintStars ? 0.22 : 0;
  return clamp((0.32 + star.score * 1.25 + faintBoost) * state.starBrightness * state.starOpacity, 0, 1.7);
}

function createBackgroundMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    depthTest: false
  });
}

function applyBackgroundImage() {
  if (!state.backgroundImage) return;
  if (runtime.backgroundTexture) runtime.backgroundTexture.dispose();
  runtime.backgroundTexture = new THREE.Texture(state.backgroundImage);
  runtime.backgroundTexture.colorSpace = THREE.SRGBColorSpace;
  applyTextureFiltering(runtime.backgroundTexture);
  runtime.backgroundTexture.needsUpdate = true;
  backgroundMaterials.forEach((material) => {
    material.map = runtime.backgroundTexture;
    material.needsUpdate = true;
  });
  updateBackgroundPlane();
}

function applyStarsTexture() {
  if (!state.starsImage) return;
  if (runtime.starsTexture) runtime.starsTexture.dispose();
  runtime.starsTexture = new THREE.Texture(state.starsImage);
  runtime.starsTexture.colorSpace = THREE.SRGBColorSpace;
  runtime.starsTexture.flipY = false;
  runtime.starsTexture.minFilter = THREE.LinearFilter;
  runtime.starsTexture.magFilter = THREE.LinearFilter;
  runtime.starsTexture.generateMipmaps = false;
  runtime.starsTexture.needsUpdate = true;
  starMaterial.uniforms.starTexture.value = runtime.starsTexture;
  starMaterial.uniforms.useStarTexture.value = 1;
}

function createPlaceholderBackground() {
  const c = document.createElement("canvas");
  c.width = 1200;
  c.height = 1600;
  const ctx = c.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, c.width, c.height);
  gradient.addColorStop(0, "#080b12");
  gradient.addColorStop(0.55, "#111018");
  gradient.addColorStop(1, "#05060a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "34px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Upload starless image + stars image", c.width / 2, c.height / 2);
  runtime.placeholderTexture = new THREE.CanvasTexture(c);
  runtime.placeholderTexture.colorSpace = THREE.SRGBColorSpace;
  applyTextureFiltering(runtime.placeholderTexture);
  backgroundMaterials.forEach((material) => {
    material.map = runtime.placeholderTexture;
    material.needsUpdate = true;
  });
}

function applyTextureFiltering(texture = runtime.backgroundTexture) {
  if (!texture) return;
  texture.minFilter = state.smoothInterpolation ? THREE.LinearFilter : THREE.NearestFilter;
  texture.magFilter = state.smoothInterpolation ? THREE.LinearFilter : THREE.NearestFilter;
  texture.needsUpdate = true;
}

function updateBackgroundPlane() {
  backgroundMaterials.forEach((material) => {
    material.color.setScalar(state.backgroundBrightness);
  });
  const { width, height } = getBackgroundPlaneSize(runtime.backgroundBaseDepth);

  runtime.imagePlane = { width, height };
  const focusVector = rotateVector2(
    {
      x: (state.focusX - 0.5) * width,
      y: (0.5 - state.focusY) * height
    },
    getMotionAngleRadians()
  );
  const focusLift = state.autoPanZoom ? Math.max(1, Number(state.actionZoom) || 1) : 1;
  const rotation = getMotionAngleRadians();
  const coverage = getRotationCoverageScale(width, height, rotation, runtime.backgroundBaseDepth);
  runtime.backgroundBasePosition.set(
    focusVector.x * 0.22 * focusLift,
    focusVector.y * 0.22 * focusLift,
    -runtime.backgroundBaseDepth
  );
  backgroundMeshes.forEach((mesh, index) => {
    mesh.visible = index === 0;
    mesh.material.opacity = index === 0 ? 1 : 0;
    mesh.rotation.z = rotation;
    mesh.scale.set(width * state.backgroundZoom * coverage, height * state.backgroundZoom * coverage, 1);
    mesh.position.copy(runtime.backgroundBasePosition);
  });
}

function getRotationCoverageScale(width, height, rotationRadians, depth = runtime.backgroundBaseDepth) {
  const cosine = Math.abs(Math.cos(rotationRadians));
  const sine = Math.abs(Math.sin(rotationRadians));
  const rotatedWidth = width * cosine + height * sine;
  const rotatedHeight = width * sine + height * cosine;
  const viewHeight = viewportHeightAtDepth(depth);
  const viewWidth = viewHeight * runtime.aspect;
  const scaleX = rotatedWidth > 0 ? viewWidth / rotatedWidth : 1;
  const scaleY = rotatedHeight > 0 ? viewHeight / rotatedHeight : 1;
  return Math.max(1, scaleX, scaleY);
}

function getBackgroundPlaneSize(depth) {
  const viewHeight = viewportHeightAtDepth(depth);
  const viewWidth = viewHeight * runtime.aspect;
  const imageAspect = state.imageAspect || runtime.aspect;

  if (state.fitMode === "cover") {
    if (viewWidth / viewHeight > imageAspect) {
      const width = viewWidth;
      return { width, height: width / imageAspect };
    }
    const height = viewHeight;
    return { width: height * imageAspect, height };
  }

  if (viewWidth / viewHeight > imageAspect) {
    const height = viewHeight;
    return { width: height * imageAspect, height };
  }

  const width = viewWidth;
  return { width, height: width / imageAspect };
}

function renderEmptyScene() {
  syncReadouts();
  setStatus(t("status.waiting"));
}

function extractStarsFromImage(image) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = clamp(state.sampleScale, 0.2, 1);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const work = document.createElement("canvas");
  work.width = width;
  work.height = height;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const candidates = [];
  const threshold = state.threshold;
  const stride = 1;
  const cell = Math.max(2, Math.round(3 / scale));

  for (let y = cell; y < height - cell; y += stride) {
    for (let x = cell; x < width - cell; x += stride) {
      const idx = (y * width + x) * 4;
      const r = pixels[idx] / 255;
      const g = pixels[idx + 1] / 255;
      const b = pixels[idx + 2] / 255;
      const lum = luminance(r, g, b);
      if (lum < threshold) continue;

      let localMax = true;
      for (let oy = -1; oy <= 1 && localMax; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) continue;
          const nIdx = ((y + oy) * width + x + ox) * 4;
          const nLum = luminance(pixels[nIdx] / 255, pixels[nIdx + 1] / 255, pixels[nIdx + 2] / 255);
          if (nLum > lum) {
            localMax = false;
            break;
          }
        }
      }
      if (!localMax) continue;

      const patch = measureStarPatch(pixels, width, height, x, y, cell, lum);
      if (patch.score < threshold) continue;
      const sampleRadius = Math.max(3, Math.ceil((patch.radius + 3) / scale));
      const sampleX = clamp(patch.x / width, 0, 1);
      const sampleY = clamp(patch.y / height, 0, 1);
      const sampleW = Math.min(1, (sampleRadius * 2) / sourceWidth);
      const sampleH = Math.min(1, (sampleRadius * 2) / sourceHeight);
      candidates.push({
        x: patch.x / width,
        y: patch.y / height,
        r: clamp(patch.r, 0, 1),
        g: clamp(patch.g, 0, 1),
        b: clamp(patch.b, 0, 1),
        score: patch.score,
        radius: patch.radius / scale,
        uvX: clamp(sampleX - sampleW * 0.5, 0, 1 - sampleW),
        uvY: clamp(sampleY - sampleH * 0.5, 0, 1 - sampleH),
        uvW: sampleW,
        uvH: sampleH
      });
    }
  }

  const deduped = suppressNearbyStars(candidates, Math.max(1.5 / scale, 2), state.maxStars);
  deduped.sort((a, b) => b.score - a.score);
  return deduped.slice(0, state.maxStars);
}

function measureStarPatch(pixels, width, height, cx, cy, radius, centerLum) {
  let weight = 0;
  let xSum = 0;
  let ySum = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;
  const cutoff = Math.max(state.threshold * 0.52, centerLum * 0.38);

  for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      const idx = (y * width + x) * 4;
      const r = pixels[idx] / 255;
      const g = pixels[idx + 1] / 255;
      const b = pixels[idx + 2] / 255;
      const lum = luminance(r, g, b);
      if (lum < cutoff) continue;
      const w = Math.max(0, lum - cutoff) + 0.001;
      weight += w;
      xSum += x * w;
      ySum += y * w;
      rSum += r * w;
      gSum += g * w;
      bSum += b * w;
      count += 1;
    }
  }

  if (weight <= 0) {
    const idx = (cy * width + cx) * 4;
    return {
      x: cx,
      y: cy,
      r: pixels[idx] / 255,
      g: pixels[idx + 1] / 255,
      b: pixels[idx + 2] / 255,
      score: centerLum,
      radius: 1
    };
  }

  return {
    x: xSum / weight,
    y: ySum / weight,
    r: rSum / weight,
    g: gSum / weight,
    b: bSum / weight,
    score: clamp(centerLum * 0.72 + Math.min(1, weight / Math.max(1, count)) * 0.28, 0, 1),
    radius: Math.sqrt(count / Math.PI)
  };
}

function suppressNearbyStars(stars, minDistance, limit) {
  const sorted = stars.sort((a, b) => b.score - a.score);
  const selected = [];
  const occupied = new Set();
  for (const star of sorted) {
    const gx = Math.round(star.x * 10000 / minDistance);
    const gy = Math.round(star.y * 10000 / minDistance);
    let nearby = false;
    for (let y = gy - 1; y <= gy + 1 && !nearby; y += 1) {
      for (let x = gx - 1; x <= gx + 1; x += 1) {
        if (occupied.has(`${x}:${y}`)) {
          nearby = true;
          break;
        }
      }
    }
    if (nearby) continue;
    occupied.add(`${gx}:${gy}`);
    selected.push(star);
    if (selected.length >= limit) break;
  }
  return selected;
}

function tick() {
  const delta = Math.min(clock.getDelta(), 0.05);
  if (!state.isPaused) {
    runtime.motionTime += delta;
    starMaterial.uniforms.opacity.value = getNebulaEnvelope(getTimelineProgress(runtime.motionTime));
    animateStars(delta, runtime.motionTime);
    animateBackground(delta, runtime.motionTime);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

function animateStars(delta, time) {
  const positionAttr = starGeometry.getAttribute("position");
  if (!positionAttr || !starData.count) return;

  const positions = positionAttr.array;
  const alphaAttr = starGeometry.getAttribute("alpha");
  const alphaValues = alphaAttr?.array;
  const trailAttr = trailGeometry.getAttribute("position");
  const trailPositions = trailAttr?.array;
  const motionTime = typeof time === "number" ? time : runtime.motionTime;
  const masterSpeed = getMasterSpeed();
  const progress = getTransformProgress(motionTime);
  const motionEnvelope = getMotionEnvelope(motionTime);
  const departed = starData.departed;
  if (progress <= 0.0001 || progress + 0.001 < runtime.lastStarProgress) {
    resetStarDepartureState();
  }
  runtime.lastStarProgress = Math.max(runtime.lastStarProgress, progress);
  const starSpeed = clamp(Number(state.speed) || 0, 0, 4);
  const baseParallax = clamp(state.parallax / 2, 0, 1);
  const parallaxMix = state.smoothInterpolation ? smoothstep(baseParallax) : baseParallax;
  const starDirection = getMotionVector(state.starDirection, false);
  const usesDirectionalDrift = state.motion === "directional" || state.starDirection !== "none";
  const bounds = getImageNdcBounds();
  const directionalBoost = getStarTravelBoost();
  const depthTravel = state.depthRange * starSpeed * 3.05 * masterSpeed * directionalBoost * motionEnvelope * progress;
  const comboDirectionalDrift =
    state.starDirection !== "none" && (state.motion === "pushIn" || state.motion === "pullBack") ? 0.34 : 0;
  const directionTravelBase =
    progress * (state.directionalDrift + comboDirectionalDrift) * (0.55 + starSpeed * 1.1) * masterSpeed * directionalBoost;
  const passDepth = 2.2;
  const farFadeStart = runtime.farDepth * 0.88;
  const farFadeEnd = runtime.farDepth * 1.9;
  trailMaterial.opacity = clamp(
    (state.hyperspaceEffect ? 0.012 : 0.004) + starSpeed * 0.0045 * masterSpeed * (state.hyperspaceEffect ? 1.1 : 0.65),
    0.003,
    0.075
  );

  for (let i = 0; i < starData.count; i += 1) {
    const idx = i * 3;
    const baseZ = starData.basePositions[idx + 2];
    let z = baseZ;
    let visible = true;

    if (state.motion === "pushIn") {
      z = baseZ + depthTravel * starData.speeds[i];
      if (z > -passDepth) visible = false;
    } else if (state.motion === "pullBack") {
      z = baseZ - depthTravel * starData.speeds[i];
    }

    const depth = Math.max(runtime.nearDepth, Math.abs(z));
    const phase = starData.phases[i];
    let finalNdcX = starData.ndcXs[i];
    let finalNdcY = starData.ndcYs[i];

    if (state.motion === "orbit") {
      const angle = Math.sin(progress * Math.PI) * 0.16 * state.parallax;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const x = finalNdcX;
      const y = finalNdcY;
      finalNdcX = x * cos - y * sin + Math.sin(progress * Math.PI + phase) * 0.012 * state.parallax;
      finalNdcY = x * sin + y * cos + Math.cos(progress * Math.PI + phase) * 0.012 * state.parallax;
    }

    if (usesDirectionalDrift) {
      const travel = directionTravelBase * (0.45 + starData.speeds[i] * 0.75);
      finalNdcX += starDirection.x * travel;
      finalNdcY += starDirection.y * travel;
      if (state.hyperspaceEffect) {
        finalNdcX += Math.sin(progress * Math.PI * 2 + phase) * 0.018 * progress;
        finalNdcY += Math.cos(progress * Math.PI * 2 + phase) * 0.018 * progress;
      }
      if (
        finalNdcX < -bounds.x - 0.28 ||
        finalNdcX > bounds.x + 0.28 ||
        finalNdcY < -bounds.y - 0.28 ||
        finalNdcY > bounds.y + 0.28
      ) {
        visible = false;
      }
    }

    if (!visible && departed) departed[i] = 1;
    if (departed?.[i]) visible = false;

    const flatWorld = ndcToWorld(finalNdcX, finalNdcY, depth);
    const travelWorld = ndcToWorld(finalNdcX, finalNdcY, starData.anchorDepths[i]);
    positions[idx] = lerp(flatWorld.x, travelWorld.x, parallaxMix);
    positions[idx + 1] = lerp(flatWorld.y, travelWorld.y, parallaxMix);
    positions[idx + 2] = z;
    const nearFade = state.motion === "pushIn" ? clamp((Math.abs(z) - passDepth) / 4, 0, 1) : 1;
    const farFade =
      state.motion === "pullBack" ? clamp((farFadeEnd - depth) / Math.max(1, farFadeEnd - farFadeStart), 0, 1) : 1;
    const alphaFactor = nearFade * farFade;
    if (alphaValues) {
      const baseAlpha = starData.baseAlphas[i] || starData.alphas[i] || 0;
      alphaValues[i] = visible ? baseAlpha * alphaFactor : 0;
    }

    if (trailPositions) {
      const trailIdx = i * 6;
      const trailLength = clamp(
        depth * (state.hyperspaceEffect ? 0.012 : 0.006) +
          starSpeed * (state.hyperspaceEffect ? 2.2 : 1.25) +
          starData.speeds[i] * 1.05,
        1.5,
        state.hyperspaceEffect ? 18 : 10
      );
      let tailZ = z;
      let tailNdcX = finalNdcX;
      let tailNdcY = finalNdcY;
      if (state.motion === "pushIn") {
        tailZ = Math.max(-runtime.farDepth, z - trailLength);
      } else if (state.motion === "pullBack") {
        tailZ = Math.min(-runtime.nearDepth, z + trailLength);
      } else if (usesDirectionalDrift) {
        tailNdcX -= starDirection.x * 0.05 * state.directionalDrift * directionalBoost;
        tailNdcY -= starDirection.y * 0.05 * state.directionalDrift * directionalBoost;
      }
      const tailDepth = Math.max(runtime.nearDepth, Math.abs(tailZ));
      const tailFlat = ndcToWorld(tailNdcX, tailNdcY, tailDepth);
      const tailTravel = ndcToWorld(tailNdcX, tailNdcY, starData.anchorDepths[i]);
      const tailX = lerp(tailFlat.x, tailTravel.x, parallaxMix);
      const tailY = lerp(tailFlat.y, tailTravel.y, parallaxMix);
      trailPositions[trailIdx] = positions[idx];
      trailPositions[trailIdx + 1] = positions[idx + 1];
      trailPositions[trailIdx + 2] = z;
      const trailVisible = visible && alphaFactor > 0.03;
      trailPositions[trailIdx + 3] = trailVisible ? tailX : positions[idx];
      trailPositions[trailIdx + 4] = trailVisible ? tailY : positions[idx + 1];
      trailPositions[trailIdx + 5] = trailVisible ? tailZ : z;
    }
  }

  positionAttr.needsUpdate = true;
  if (alphaAttr) alphaAttr.needsUpdate = true;
  if (trailAttr) trailAttr.needsUpdate = true;
}

function animateBackground(delta, time) {
  if (!backgroundMesh.visible) return;
  const motionTime = typeof time === "number" ? time : runtime.motionTime;
  const backgroundSpeed = clamp(Number(state.backgroundSpeed) || 0, 0, 8);
  const backgroundTravelScale = clamp(0.55 + backgroundSpeed * 1.15, 0.45, 4.5);
  const direction = getMotionVector(state.backgroundDirection, true);
  const amplitudeX = runtime.imagePlane.width * Math.max(0.18, state.backgroundDrift * 0.42);
  const amplitudeY = runtime.imagePlane.height * Math.max(0.18, state.backgroundDrift * 0.42);
  const timelineProgress = getTimelineProgress(motionTime);
  const transformProgress = getTransformProgress(motionTime);
  const envelope = getNebulaEnvelope(timelineProgress);
  const travelBoost = getBackgroundTravelBoost();
  const zoomBase = state.backgroundZoom * (state.hyperspaceEffect ? 1.08 : 1);
  let x = 0;
  let y = 0;
  let scale = zoomBase;

  if (state.backgroundMotion === "zoomIn" || state.backgroundMotion === "zoomOut") {
    backgroundMeshes[0].visible = true;
    backgroundMeshes[1].visible = false;
    applyTravelingBackgroundLayer(
      backgroundMeshes[0],
      transformProgress,
      state.backgroundMotion === "zoomIn",
      direction,
      motionTime,
      timelineProgress
    );
    return;
  }

  backgroundMeshes[0].visible = true;
  backgroundMeshes[1].visible = false;

  if (state.backgroundMotion === "directional") {
    x = direction.x * amplitudeX * transformProgress * backgroundTravelScale * travelBoost;
    y = direction.y * amplitudeY * transformProgress * backgroundTravelScale * travelBoost;
  } else if (state.backgroundMotion === "drift") {
    const driftPhase = transformProgress * Math.PI * 2 * clamp(0.5 + backgroundSpeed * 0.55, 0.5, 3.5);
    x = Math.sin(driftPhase) * amplitudeX * 0.82 * backgroundTravelScale;
    y = (1 - Math.cos(driftPhase)) * amplitudeY * 0.32 * backgroundTravelScale;
  } else if (state.backgroundMotion === "zoom") {
    scale *= lerp(1, Math.max(1, state.backgroundZoom), transformProgress);
    x = direction.x * amplitudeX * transformProgress * 0.08 * backgroundTravelScale;
    y = direction.y * amplitudeY * transformProgress * 0.08 * backgroundTravelScale;
  } else if (state.backgroundMotion === "orbit") {
    const angle = transformProgress * Math.PI * 2 * clamp(0.45 + backgroundSpeed * 0.6, 0.45, 3.4);
    x = Math.cos(angle) * amplitudeX * 0.96;
    y = Math.sin(angle) * amplitudeY * 0.96;
    scale *= 1 + Math.sin(transformProgress * Math.PI) * state.backgroundDrift * 0.18;
  }

  scale *= state.autoPanZoom && state.backgroundMotion !== "fixed" ? lerp(1, Math.max(1, state.actionZoom), transformProgress) : 1;
  scale *= 1 + (state.hyperspaceEffect ? 0.08 : 0);
  const rotation = getMotionAngleRadians() * transformProgress;
  const scaledWidth = runtime.imagePlane.width * scale;
  const scaledHeight = runtime.imagePlane.height * scale;
  const coverage = getRotationCoverageScale(scaledWidth, scaledHeight, rotation, runtime.backgroundBaseDepth);
  backgroundMeshes[0].position.x = runtime.backgroundBasePosition.x + x * envelope;
  backgroundMeshes[0].position.y = runtime.backgroundBasePosition.y + y * envelope;
  backgroundMeshes[0].position.z = runtime.backgroundBasePosition.z;
  backgroundMeshes[0].rotation.z = rotation;
  backgroundMeshes[0].scale.set(scaledWidth * coverage, scaledHeight * coverage, 1);
  backgroundMeshes[0].material.opacity = clamp(envelope, 0, 1);
}

function applyTravelingBackgroundLayer(mesh, progress, zoomIn, direction, motionTime, timelineProgress) {
  mesh.visible = true;
  const travel = zoomIn ? progress : 1 - progress;
  const backgroundSpeed = clamp(Number(state.backgroundSpeed) || 0, 0, 8);
  const travelStrength = clamp(0.65 + backgroundSpeed * 1.25, 0.45, 4.5);
  const targetZoom = Math.max(1, state.backgroundZoom) * (state.autoPanZoom ? Math.max(1, state.actionZoom) : 1);
  const zoom = zoomIn ? lerp(1, targetZoom, progress) : lerp(targetZoom, 1, progress);
  const startDepth = zoomIn
    ? runtime.backgroundBaseDepth * (1 + 1.1 * travelStrength)
    : runtime.backgroundBaseDepth / (1 + 1.35 * travelStrength);
  const endDepth = zoomIn
    ? runtime.backgroundBaseDepth / (1 + 1.45 * travelStrength)
    : runtime.backgroundBaseDepth * (1 + 1.1 * travelStrength);
  const pushDepth = lerp(startDepth, endDepth, travel);
  const rotation = getMotionAngleRadians() * progress;
  const planeSize = getBackgroundPlaneSize(pushDepth);
  const coverage = getRotationCoverageScale(planeSize.width * zoom, planeSize.height * zoom, rotation, pushDepth);
  mesh.position.set(runtime.backgroundBasePosition.x, runtime.backgroundBasePosition.y, -pushDepth);
  mesh.rotation.z = rotation;
  mesh.scale.set(planeSize.width * zoom * coverage, planeSize.height * zoom * coverage, 1);
  mesh.material.opacity = getNebulaEnvelope(timelineProgress ?? progress);
}

function resize() {
  const rect = previewStage?.getBoundingClientRect();
  runtime.width = Math.max(1, Math.round(rect?.width || window.innerWidth));
  runtime.height = Math.max(1, Math.round(rect?.height || window.innerHeight));
  runtime.aspect = runtime.width / runtime.height;
  renderer.setSize(runtime.width, runtime.height, false);
  camera.aspect = runtime.aspect;
  camera.updateProjectionMatrix();
  starMaterial.uniforms.pixelRatio.value = renderer.getPixelRatio();
  if (!state.isRecording) {
    runtime.outputScale = 1;
    starMaterial.uniforms.outputScale.value = 1;
  }
  updateBackgroundPlane();
}

function ndcToWorld(ndcX, ndcY, depth) {
  const h = viewportHeightAtDepth(depth);
  return {
    x: ndcX * h * runtime.aspect * 0.5,
    y: ndcY * h * 0.5
  };
}

function worldToNdc(x, y, depth) {
  const h = viewportHeightAtDepth(depth);
  return {
    x: x / (h * runtime.aspect * 0.5),
    y: y / (h * 0.5)
  };
}

function imageToPlaneNdc(x01, y01) {
  const planeDepth = runtime.backgroundBaseDepth;
  const baseImageWidth = runtime.imagePlane.width || 1;
  const baseImageHeight = runtime.imagePlane.height || 1;
  const viewHeight = viewportHeightAtDepth(planeDepth);
  const viewWidth = viewHeight * runtime.aspect;
  return {
    x: (x01 * 2 - 1) * (baseImageWidth / viewWidth),
    y: (1 - y01 * 2) * (baseImageHeight / viewHeight)
  };
}

function viewportHeightAtDepth(depth) {
  return 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * depth;
}

const supportedImageExtensions = new Set(["tif", "tiff", "png", "jpg", "jpeg", "webp", "bmp"]);

function assertSupportedImageFile(file) {
  const extension = file.name?.split(".").pop()?.toLowerCase() || "";
  if (supportedImageExtensions.has(extension)) return;
  const formats = "TIF, TIFF, PNG, JPG, JPEG, WebP, BMP";
  throw new Error(
    state.language === "zh"
      ? `不支持该文件格式。请选择：${formats}`
      : `Unsupported image format. Choose: ${formats}`
  );
}

async function loadImage(file) {
  if (isTiffFile(file)) return loadTiffImage(file);
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  URL.revokeObjectURL(url);
  return img;
}

function isTiffFile(file) {
  return file.type === "image/tiff" || /\.tiff?$/i.test(file.name || "");
}

async function loadTiffImage(file) {
  const buffer = await file.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  if (!ifds.length) throw new Error("No TIFF image data found");
  UTIF.decodeImage(buffer, ifds[0]);
  const rgba = UTIF.toRGBA8(ifds[0]);
  const width = ifds[0].width;
  const height = ifds[0].height;
  const canvasEl = document.createElement("canvas");
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext("2d");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvasEl;
}

function exportPng() {
  renderWithOptionalSize(() => {
    renderer.render(scene, camera);
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `image-starfield-${runtime.width}x${runtime.height}.png`;
    link.click();
    setStatus(statusText("pngExported"));
  });
}

async function recordWebm() {
  if (state.isRecording) return;
  if (!state.backgroundImage || !state.starsImage || !starData.count) {
    setStatus(statusText("uploadBuildFirst"));
    return;
  }
  if (!canvas.captureStream || typeof MediaRecorder === "undefined") {
    setStatus(statusText("recordingUnavailable"));
    return;
  }

  const restore = applyExportSize();
  runtime.motionTime = 0;
  runtime.recordProgress = 0;
  resetStarDepartureState();
  clock.start();
  const seconds = Number(state.recordSeconds) || 4;
  const fps = Number(state.exportFps) || 30;
  runtime.recordDuration = seconds;
  runtime.recordStartedAt = performance.now();
  const stream = canvas.captureStream(fps);
  const actual = chooseRecordingFormat(state.exportFormat);
  if (state.exportFormat === "mp4" && actual.extension !== "mp4") {
    setStatus(statusText("mp4Fallback"));
  }
  const recorderOptions = { videoBitsPerSecond: getVideoBitrate(runtime.width, runtime.height, fps) };
  if (actual.mimeType) recorderOptions.mimeType = actual.mimeType;

  let recorder;
  try {
    recorder = new MediaRecorder(stream, recorderOptions);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    restore();
    runtime.recordProgress = null;
    runtime.recordStartedAt = null;
    runtime.recordDuration = 0;
    setStatus(`${statusText("recordingUnavailable")}: ${error.message}`);
    return;
  }
  runtime.recordedChunks = [];
  runtime.mediaRecorder = recorder;
  state.isRecording = true;
  document.querySelector("#record-webm").classList.add("is-recording");

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) runtime.recordedChunks.push(event.data);
  });

  recorder.addEventListener("stop", () => {
    const blob = new Blob(runtime.recordedChunks, { type: actual.mimeType || recorder.mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `image-starfield-${seconds}s-${state.sourceSize.width}x${state.sourceSize.height}.${actual.extension}`;
    link.click();
    // Electron/Chromium may still be reading the Blob URL after click() returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    state.isRecording = false;
    runtime.recordProgress = null;
    runtime.recordStartedAt = null;
    runtime.recordDuration = 0;
    document.querySelector("#record-webm").classList.remove("is-recording");
    stream.getTracks().forEach((track) => track.stop());
    restore();
    setStatus(statusText("videoExported", actual.extension.toUpperCase()));
  });

  recorder.addEventListener("error", (event) => {
    setStatus(`${statusText("recordingUnavailable")}: ${event.error?.message || "encoder error"}`);
  });

  // Periodic chunks reduce peak memory use for longer recordings.
  recorder.start(1000);
  const start = performance.now();
  const timer = window.setInterval(() => {
    const elapsed = (performance.now() - start) / 1000;
    runtime.recordProgress = getTimelineProgress(runtime.motionTime);
    setStatus(statusText("recording", Math.min(seconds, elapsed).toFixed(1), seconds));
    if (elapsed >= seconds) {
      window.clearInterval(timer);
      recorder.stop();
    }
  }, 120);
}

function renderWithOptionalSize(callback) {
  const restore = applyExportSize();
  callback();
  restore();
}

function applyExportSize() {
  const original = {
    width: runtime.width,
    height: runtime.height,
    pixelRatio: renderer.getPixelRatio(),
    aspect: runtime.aspect,
    fitMode: state.fitMode,
    outputScale: runtime.outputScale
  };
  const size = getExportDimensions();
  if (size) {
    runtime.width = size.width;
    runtime.height = size.height;
    runtime.aspect = size.width / size.height;
    runtime.outputScale = Math.max(1, size.height / Math.max(1, original.height));
    state.fitMode = "cover";
    renderer.setPixelRatio(1);
    renderer.setSize(size.width, size.height, false);
    camera.aspect = runtime.aspect;
    camera.updateProjectionMatrix();
    starMaterial.uniforms.pixelRatio.value = renderer.getPixelRatio();
    starMaterial.uniforms.outputScale.value = runtime.outputScale;
    updateBackgroundPlane();
  }

  return () => {
    runtime.width = original.width;
    runtime.height = original.height;
    runtime.aspect = original.aspect;
    runtime.outputScale = original.outputScale;
    state.fitMode = original.fitMode;
    renderer.setPixelRatio(original.pixelRatio);
    renderer.setSize(original.width, original.height, false);
    camera.aspect = original.aspect;
    camera.updateProjectionMatrix();
    starMaterial.uniforms.pixelRatio.value = renderer.getPixelRatio();
    starMaterial.uniforms.outputScale.value = runtime.outputScale;
    updateBackgroundPlane();
  };
}

function getExportDimensions() {
  if (state.exportSize === "preview") return null;
  const source = state.sourceSize.width && state.sourceSize.height ? state.sourceSize : { width: 1080, height: 1553 };
  if (state.exportSize === "source") return { width: source.width, height: source.height };
  if (state.exportSize === "sourceHalf") {
    return { width: Math.round(source.width / 2), height: Math.round(source.height / 2) };
  }
  if (state.exportSize === "1080p") {
    return { width: 1080, height: Math.round(1080 / (source.width / source.height)) };
  }
  return null;
}

function getVideoBitrate(width, height, fps) {
  const pixelsPerSecond = Math.max(1, width) * Math.max(1, height) * Math.max(1, fps);
  // Scale bitrate with output workload while keeping browser encoders in a practical range.
  return Math.round(clamp(pixelsPerSecond * 0.12, 6_000_000, 48_000_000));
}

function chooseRecordingFormat(format) {
  const mp4Candidates = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4;codecs=h264",
    "video/mp4"
  ];
  const webmCandidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];

  const candidates = format === "mp4" ? mp4Candidates : webmCandidates;
  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return { mimeType, extension: format === "mp4" ? "mp4" : "webm" };
    }
  }

  for (const mimeType of webmCandidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return { mimeType, extension: "webm" };
    }
  }

  return { mimeType: "", extension: "webm" };
}

function getImageNdcBounds() {
  const planeDepth = runtime.backgroundBaseDepth;
  const viewHeight = viewportHeightAtDepth(planeDepth);
  const viewWidth = viewHeight * runtime.aspect;
  return {
    x: (runtime.imagePlane.width || viewWidth) / viewWidth,
    y: (runtime.imagePlane.height || viewHeight) / viewHeight
  };
}

function normalizeDirection(x, y) {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function wrapToRange(value, min, max) {
  const span = max - min;
  if (span <= 0) return value;
  let wrapped = value;
  while (wrapped < min) wrapped += span;
  while (wrapped > max) wrapped -= span;
  return wrapped;
}

function getDirectionLabel(direction) {
  return labels[state.language]?.directions[direction] || labels.en.directions[direction] || direction;
}

function getBackgroundMotionLabel(motion) {
  return labels[state.language]?.backgroundMotion[motion] || labels.en.backgroundMotion[motion] || motion;
}

function statusText(key, ...values) {
  const messages = {
    en: {
      starlessLoaded: "Starless image loaded",
      starlessWaiting: "Starless image loaded; waiting for stars image",
      starsLoaded: "Stars image loaded; extracting real stars",
      settingsChanged: "Extraction settings changed; rebuild the star field",
      parametersReset: "Parameters reset",
      containFit: "Contain fit enabled",
      coverFit: "Cover fit enabled",
      needBothImages: "Upload both starless and stars images first",
      noStars: "No stars detected; lower the threshold",
      noStarsShort: "No stars detected",
      extracted: `Extracted ${values[0]} real stars`,
      buildFirst: "Build the star field from both images first",
      readoutStars: `${values[0]} real stars · ${values[1]}`,
      pngExported: "PNG exported",
      uploadBuildFirst: "Upload both images and build the star field first",
      recordingUnavailable: "Recording is not available in this browser",
      videoExported: `${values[0]} exported`,
      recording: `Recording ${values[0]}s / ${values[1]}s`,
      mp4Fallback: "MP4 recording is not supported here; exporting WebM instead"
    },
    zh: {
      starlessLoaded: "去星图已载入",
      starlessWaiting: "去星图已载入，等待星点图",
      starsLoaded: "星点图已载入，正在提取真实星点",
      settingsChanged: "参数已改变，请重新生成星场",
      parametersReset: "参数已恢复",
      containFit: "完整显示原图",
      coverFit: "铺满裁切画面",
      needBothImages: "请先同时上传去星图和星点图",
      noStars: "没有提取到星点，请降低阈值",
      noStarsShort: "未检测到星点",
      extracted: `已从星点图提取 ${values[0]} 颗真实星点`,
      buildFirst: "请先根据两张图生成星场",
      readoutStars: `${values[0]} 颗真实星点 · ${values[1]}`,
      pngExported: "PNG 已导出",
      uploadBuildFirst: "请先上传两张图并生成星场",
      recordingUnavailable: "当前浏览器不支持录制",
      videoExported: `${values[0]} 已导出`,
      recording: `录制中 ${values[0]}s / ${values[1]}s`,
      mp4Fallback: "当前浏览器不支持 MP4 录制，已改为导出 WebM"
    }
  };
  return messages[state.language]?.[key] || messages.en[key] || key;
}

function smoothstep(value) {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function smootherstep(value) {
  const x = clamp(value, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function setStatus(text) {
  exportStatus.textContent = text;
}

function luminance(r, g, b) {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function hashStars(stars) {
  let hash = 2166136261;
  for (let i = 0; i < Math.min(stars.length, 2048); i += 1) {
    hash ^= Math.floor(stars[i].x * 100000) + Math.floor(stars[i].y * 100000);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let t = Math.trunc(seed) + 0x6d2b79f5;
  return function random() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seededUnit(index, x, y, score) {
  const seed =
    Math.floor(x * 1000003) ^
    Math.floor(y * 917551) ^
    Math.floor(score * 65535) ^
    Math.imul(index + 1, 2654435761);
  return seededRandom(seed)();
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

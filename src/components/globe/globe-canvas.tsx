'use client';
/* eslint-disable react-hooks/immutability -- three.js materials, uniforms and instance buffers are mutable GPU
   resources by design: they are created once (useMemo) and updated imperatively per frame, outside React state. */

/**
 * WebGL globe (React Three Fiber). Loaded lazily via next/dynamic({ ssr:false }) from <Globe/>.
 *
 * Layers (inner → outer): shaded night sphere with fresnel rim · dotted land (Natural Earth) · dense India dots +
 * outline (geoBoundaries, merged) · ERA5 Tmax glyphs (pillars + additive halos) · atmosphere (back-face fresnel).
 * No post-processing: the "bloom" is additive halo sprites and fresnel terms, which cost almost nothing.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei/core/Line';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import {
  DEG,
  INDIA_FOCUS,
  hexToRgb,
  angleDelta,
  distanceForRadius,
  easeOutCubic,
  heatColor,
  heatLevel,
  latLonToVec3,
  orientationFor,
  vec3ToLatLon,
} from './globe-math';
import { buildGlobeGeometry, type DotField, type GlobeGeometry } from './land-dots';
import { TIER_SETTINGS, fpsFromDeltas, type RenderTier, type TierSettings } from './perf-tier';
import { buildCellIndex, hotness, sampleTmax, tintColor } from './global-heat';
import type { HeatGrid, HeatPoint } from './heat-grid';
import { isGlobeIntroHeld } from './readiness';

const FOV = 35;

/**
 * Our shaders write sRGB values straight to the canvas (no colour-space chunk, no tone mapping — `flat` Canvas), so
 * colours are created from raw sRGB components to match the brand hex values exactly.
 */
const srgb = (hex: string) => new THREE.Color().setRGB(...hexToRgb(hex));
/**
 * Light Sand is the default: a "paper" globe — cream sphere, ink-brown land dots, India in Wine Red, a soft wine
 * haze — that reads on sand backgrounds. The dark palette (night globe, additive glow) is used only when the page
 * theme is dark.
 */
export type GlobeTheme = 'light' | 'dark';
type Palette = {
  deep: string;
  lit: string;
  rim: string;
  rimAmount: number;
  land: string;
  landAlpha: number;
  india: string;
  indiaAlpha: number;
  indiaAlphaDim: number;
  outline: string;
  atmo: string;
  atmoIntensity: number;
  additive: boolean;
  halo: number;
};
const PALETTES: Record<GlobeTheme, Palette> = {
  light: {
    deep: '#e3cf9f',
    lit: '#fdf9ef',
    rim: '#9b1a39',
    rimAmount: 0.42,
    land: '#4a2a2c',
    landAlpha: 0.5,
    india: '#7f011f',
    indiaAlpha: 0.95,
    indiaAlphaDim: 0.55,
    outline: '#7f011f',
    atmo: '#b53853',
    atmoIntensity: 0.26,
    additive: false,
    halo: 0.55,
  },
  dark: {
    deep: '#0d0407',
    lit: '#2b0f17',
    rim: '#d98a6a',
    rimAmount: 0.6,
    land: '#efe2c4',
    landAlpha: 0.62,
    india: '#ff5a7a',
    indiaAlpha: 0.9,
    indiaAlphaDim: 0.42,
    outline: '#ff7a92',
    atmo: '#f2a27e',
    atmoIntensity: 0.95,
    additive: true,
    halo: 1,
  },
};

const INTRO_SECONDS = 3.2;
const INTRO_SPIN = 1.7; // radians the globe travels while easing in to face India

export type GlobeControl = { nudge: (dLon: number, dLat: number) => void };

export type GlobeCanvasProps = {
  tier: RenderTier;
  heat: HeatPoint[] | null;
  /** global context grid (ERA5 Tmax over land, same day) — tints the land dots outside India */
  globalHeat?: HeatGrid | null;
  reducedMotion: boolean;
  /** resolved page theme — selects the globe palette (light is the default) */
  theme?: GlobeTheme;
  /** false → frameloop "never" (off-screen) */
  active: boolean;
  /** 0 (framed card) → 1 (full-bleed) — written by the hero's scroll timeline */
  progressRef?: RefObject<number>;
  /** on-screen globe radius in px for a canvas of w×h at progress p */
  fitRadius?: (w: number, h: number, p: number) => number;
  controlRef?: RefObject<GlobeControl | null>;
  onReady?: () => void;
  onFps?: (fps: number) => void;
  onContextLost?: () => void;
};

export default function GlobeCanvas(props: GlobeCanvasProps) {
  const settings = TIER_SETTINGS[props.tier];
  const [interacting, setInteracting] = useState(false);
  // Always 'demand': <FrameDriver> requests frames — full rate while the globe moves, throttled when idle.
  const frameloop = !props.active ? 'never' : 'demand';
  return (
    <Canvas
      className="!absolute inset-0"
      style={{ touchAction: 'pan-y', cursor: 'grab' }}
      dpr={settings.dpr}
      flat
      frameloop={frameloop}
      gl={{ antialias: settings.antialias, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }}
      camera={{ fov: FOV, near: 0.1, far: 60, position: [0, 0, 5] }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.domElement.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          props.onContextLost?.();
        });
      }}
      aria-hidden
    >
      <Scene {...props} settings={settings} setInteracting={setInteracting} interacting={interacting} />
    </Canvas>
  );
}

type SceneProps = GlobeCanvasProps & { settings: TierSettings; setInteracting: (v: boolean) => void; interacting: boolean };

/** Idle redraw rate once the intro has finished and nothing is being dragged/scrolled (the sway is slow). */
const IDLE_FPS = 30;

/**
 * Frame scheduler for frameloop="demand": requests a frame on every display refresh while `hot()` is true
 * (intro spin, drag/inertia, scroll-driven resize) and at IDLE_FPS otherwise. Reduced motion → no ticking at all;
 * frames are then only requested by interactions.
 */
function FrameDriver({ hot, enabled }: { hot: () => boolean; enabled: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!enabled) return;
    let id = 0;
    let last = 0;
    const tick = (t: number) => {
      id = requestAnimationFrame(tick);
      if (hot() || t - last >= 1000 / IDLE_FPS - 2) {
        last = t;
        invalidate();
      }
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [hot, enabled, invalidate]);
  return null;
}

function Scene({ settings, theme = 'light', heat, globalHeat, reducedMotion, progressRef, fitRadius, controlRef, onReady, onFps, setInteracting, interacting }: SceneProps) {
  const { size, camera, gl, invalidate, scene } = useThree();
  const group = useRef<THREE.Group>(null);
  const [geo, setGeo] = useState<GlobeGeometry | null>(null);
  const radiusPx = useRef(200);
  const [pointScale] = useState(() => ({ value: 1 }));
  const rig = useRef({ t: 0, offY: 0, offX: 0, velY: 0, velX: 0, dist: 0, dragging: false, lastP: -1 });
  const [compiled, setCompiled] = useState(false);

  // Is anything moving fast enough to need full-rate frames?
  const hot = useCallback(() => {
    const r = rig.current;
    const p = progressRef?.current ?? 0;
    const scrolling = Math.abs(p - r.lastP) > 1e-4;
    r.lastP = p;
    return r.t < INTRO_SECONDS + 0.2 || r.dragging || Math.abs(r.velX) + Math.abs(r.velY) > 0.02 || Math.abs(r.offY) + Math.abs(r.offX) > 0.01 || scrolling;
  }, [progressRef]);
  const home = useMemo(() => orientationFor(INDIA_FOCUS.lat, INDIA_FOCUS.lon), []);
  const palette = PALETTES[theme];
  useEffect(() => {
    invalidate();
  }, [palette, invalidate]);

  useEffect(() => {
    let alive = true;
    buildGlobeGeometry(settings.dots, settings.indiaDensity).then((g) => {
      if (!alive) return;
      setGeo(g);
      invalidate();
    });
    return () => {
      alive = false;
    };
  }, [settings.dots, settings.indiaDensity, invalidate]);

  // Compile every shader program before the intro starts so the spin never stalls on a first-use compile.
  useEffect(() => {
    if (!geo || compiled) return;
    const id = requestAnimationFrame(() => {
      try {
        gl.compile(scene, camera);
      } catch {
        /* compilation errors surface on first draw as usual */
      }
      setCompiled(true);
      invalidate();
    });
    return () => cancelAnimationFrame(id);
  }, [geo, compiled, gl, scene, camera, invalidate]);

  // Keyboard / programmatic nudges (arrow keys on the wrapper).
  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = {
      nudge(dLon, dLat) {
        const r = rig.current;
        r.offY += dLon * DEG;
        r.offX = THREE.MathUtils.clamp(r.offX + dLat * DEG, -0.7, 0.7);
        invalidate();
      },
    };
    return () => {
      controlRef.current = null;
    };
  }, [controlRef, invalidate]);

  // Pointer drag: horizontal → longitude, vertical (mouse/pen only; touch keeps native vertical scrolling) → tilt.
  useEffect(() => {
    const el = gl.domElement;
    let id: number | null = null;
    let lx = 0;
    let ly = 0;
    let lt = 0;
    const r = rig.current;
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      id = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
      lt = performance.now();
      r.dragging = true;
      r.velX = r.velY = 0;
      setInteracting(true);
      el.style.cursor = 'grabbing';
      try {
        el.setPointerCapture(id);
      } catch {}
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const now = performance.now();
      const dt = Math.max(1, now - lt) / 1000;
      const k = 1 / Math.max(90, radiusPx.current);
      const dx = (e.clientX - lx) * k;
      const dy = e.pointerType === 'touch' ? 0 : (e.clientY - ly) * k;
      r.offY += dx;
      r.offX = THREE.MathUtils.clamp(r.offX + dy, -0.7, 0.7);
      r.velY = dx / dt;
      r.velX = dy / dt;
      lx = e.clientX;
      ly = e.clientY;
      lt = now;
      invalidate();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      r.dragging = false;
      r.offY = angleDelta(0, r.offY);
      if (reducedMotion) r.velX = r.velY = 0;
      el.style.cursor = 'grab';
      setInteracting(false);
      invalidate();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [gl, invalidate, reducedMotion, setInteracting]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const r = rig.current;
    // the intro clock starts once the dots exist and shaders are compiled — and the first-visit intro has let go
    if (compiled && (r.t > 0 || !isGlobeIntroHeld())) r.t += dt;
    const p = progressRef?.current ?? 0;

    // Camera distance that gives the requested on-screen radius.
    const rpx = fitRadius ? fitRadius(size.width, size.height, p) : 0.38 * Math.min(size.width, size.height);
    radiusPx.current = rpx;
    const target = distanceForRadius(rpx, size.height, FOV);
    r.dist = r.dist === 0 || reducedMotion ? target : THREE.MathUtils.damp(r.dist, target, 10, dt);
    camera.position.set(0, 0, r.dist);
    camera.lookAt(0, 0, 0);
    pointScale.value = (size.height * state.gl.getPixelRatio()) / (2 * Math.tan((FOV * DEG) / 2));

    // Rotation: ease in to face India, then a gentle sway; drags spring back home.
    const introK = reducedMotion ? 1 : easeOutCubic(r.t / INTRO_SECONDS);
    const intro = INTRO_SPIN * (1 - introK);
    const sway = reducedMotion ? 0 : Math.sin(r.t * 0.17) * 0.14 * introK;
    if (!r.dragging) {
      r.offY += r.velY * dt;
      r.offX = THREE.MathUtils.clamp(r.offX + r.velX * dt, -0.7, 0.7);
      r.velY *= Math.exp(-dt * 3.2);
      r.velX *= Math.exp(-dt * 3.2);
      if (!reducedMotion) {
        r.offY = THREE.MathUtils.damp(r.offY, 0, 0.75, dt);
        r.offX = THREE.MathUtils.damp(r.offX, 0, 1.1, dt);
      }
    }
    group.current?.rotation.set(home.x + r.offX - p * 0.1, home.y + intro + sway + r.offY, 0);
  });

  return (
    <>
      <group ref={group}>
        <Earth segments={settings.sphereSegments} palette={palette} />
        {geo && (
          <LandDots field={geo.dots} globalHeat={globalHeat ?? null} settings={settings} scale={pointScale} dimIndia={!!heat?.length} palette={palette} />
        )}
        {geo && geo.indiaOutline.length > 0 && <IndiaOutline segments={geo.indiaOutline} width={settings.outlineWidth} color={palette.outline} />}
        {geo && heat && heat.length > 0 && (
          <HeatGlyphs points={heat} halos={settings.halos} reducedMotion={reducedMotion} scale={pointScale} palette={palette} />
        )}
      </group>
      {settings.atmosphere && <Atmosphere palette={palette} />}
      <FrameDriver hot={hot} enabled={!reducedMotion || interacting} />
      {/* Sample frame rate only after warm-up (geometry + compiled shaders), never during set-up hitches. */}
      {onFps && !reducedMotion && compiled && <FpsProbe onResult={onFps} />}
      {geo && onReady && <ReadySignal onReady={onReady} />}
    </>
  );
}

// ─────────────────────────────── layers ───────────────────────────────

const earthVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const earthFragment = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uLit;
  uniform vec3 uRim;
  uniform float uRimAmount;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    float facing = max(dot(vN, vView), 0.0);
    float fres = pow(1.0 - facing, 2.8);
    float lit = clamp(dot(vN, normalize(vec3(-0.45, 0.55, 0.7))) * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uDeep, uLit, lit * lit);
    col = mix(col, uRim, clamp(fres * uRimAmount * 1.6, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

function Earth({ segments, palette }: { segments: number; palette: Palette }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: earthVertex,
        fragmentShader: earthFragment,
        uniforms: {
          uDeep: { value: srgb(palette.deep) },
          uLit: { value: srgb(palette.lit) },
          uRim: { value: srgb(palette.rim) },
          uRimAmount: { value: palette.rimAmount },
        },
      }),
    [palette],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} renderOrder={0}>
      <sphereGeometry args={[1, segments, Math.round(segments * 0.75)]} />
    </mesh>
  );
}

const dotsVertex = /* glsl */ `
  attribute float aIndia;
  attribute float aSeed;
  attribute vec3 aTint;
  attribute float aHot;
  uniform float uScale;
  uniform float uLandSize;
  uniform float uIndiaSize;
  uniform float uTime;
  varying float vIndia;
  varying float vFacing;
  varying float vSeed;
  varying vec3 vTint;
  varying float vHot;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * position);
    vFacing = dot(n, normalize(-mv.xyz));
    vIndia = aIndia;
    vSeed = aSeed;
    vTint = aTint;
    vHot = aHot;
    // hotter land reads a little larger; aHot < 0 = no global data for this dot
    float s = mix(uLandSize, uIndiaSize, aIndia) * (1.0 + 0.55 * max(aHot, 0.0));
    gl_PointSize = max(1.25, s * uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const dotsFragment = /* glsl */ `
  uniform vec3 uLand;
  uniform vec3 uIndia;
  uniform float uIndiaAlpha;
  uniform float uLandAlpha;
  uniform float uTime;
  varying float vIndia;
  varying float vFacing;
  varying float vSeed;
  varying vec3 vTint;
  varying float vHot;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.28, d);
    float limb = smoothstep(0.0, 0.45, vFacing);
    float shimmer = 0.88 + 0.12 * sin(uTime * 0.9 + vSeed * 6.2831);
    float tinted = step(0.0, vHot);
    vec3 land = mix(uLand, vTint, tinted);
    vec3 col = mix(land, uIndia, vIndia);
    float landAlpha = min(1.0, uLandAlpha * shimmer * (1.0 + tinted * (0.12 + 0.5 * max(vHot, 0.0))));
    float alpha = a * limb * mix(landAlpha, uIndiaAlpha, vIndia);
    gl_FragColor = vec4(col, alpha);
  }
`;

/** Per-dot tint (rgb) and heat emphasis from the global grid; India's dots and dots with no nearby cell get aHot = −1. */
function globalTint(field: DotField, grid: HeatGrid | null) {
  const tint = new Float32Array(field.count * 3);
  const hot = new Float32Array(field.count).fill(-1);
  if (!grid) return { tint, hot };
  const index = buildCellIndex(grid.points, grid.meta.resolutionDeg ?? undefined);
  const p = field.positions;
  for (let i = 0; i < field.count; i++) {
    if (field.india[i] > 0.5) continue;
    const { lat, lon } = vec3ToLatLon(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    const t = sampleTmax(index, lat, lon);
    if (t === null) continue;
    tint.set(tintColor(t), i * 3); // raw sRGB values, like the palette uniforms (these shaders do no colour conversion)
    hot[i] = hotness(t);
  }
  return { tint, hot };
}

function LandDots({
  field,
  globalHeat,
  settings,
  scale,
  dimIndia,
  palette,
}: {
  field: DotField;
  globalHeat: HeatGrid | null;
  settings: TierSettings;
  scale: { value: number };
  dimIndia: boolean;
  palette: Palette;
}) {
  const { geometry, material } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(field.positions, 3));
    g.setAttribute('aIndia', new THREE.BufferAttribute(field.india, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(field.seeds, 1));
    const { tint, hot } = globalTint(field, globalHeat);
    g.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    g.setAttribute('aHot', new THREE.BufferAttribute(hot, 1));
    g.computeBoundingSphere();
    const spacing = Math.sqrt((4 * Math.PI) / settings.dots);
    const indiaSpacing = spacing / Math.sqrt(settings.indiaDensity);
    const m = new THREE.ShaderMaterial({
      vertexShader: dotsVertex,
      fragmentShader: dotsFragment,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uScale: scale,
        uLandSize: { value: spacing * settings.dotScale },
        uIndiaSize: { value: indiaSpacing * 0.78 },
        uLand: { value: srgb(palette.land) },
        uIndia: { value: srgb(palette.india) },
        uIndiaAlpha: { value: palette.indiaAlpha },
        uLandAlpha: { value: palette.landAlpha },
        uTime: { value: 0 },
      },
    });
    return { geometry: g, material: m };
  }, [field, globalHeat, settings.dots, settings.dotScale, settings.indiaDensity, scale, palette]);
  useEffect(() => {
    material.uniforms.uIndiaAlpha.value = dimIndia ? palette.indiaAlphaDim : palette.indiaAlpha;
  }, [dimIndia, material, palette]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return <points geometry={geometry} material={material} renderOrder={1} />;
}

function IndiaOutline({ segments, width, color }: { segments: Float32Array; width: number; color: string }) {
  const points = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let i = 0; i < segments.length; i += 3) out.push([segments[i], segments[i + 1], segments[i + 2]]);
    return out;
  }, [segments]);
  const basic = useMemo(() => {
    if (width > 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(segments, 3));
    return { g, m: new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }) };
  }, [segments, width, color]);
  useEffect(
    () => () => {
      basic?.g.dispose();
      basic?.m.dispose();
    },
    [basic],
  );
  if (basic) return <lineSegments geometry={basic.g} material={basic.m} renderOrder={2} />;
  return <Line points={points} segments lineWidth={width} color={color} transparent opacity={0.95} renderOrder={2} />;
}

const glyphVertex = /* glsl */ `
  varying vec3 vColor;
  varying float vH;
  varying vec3 vN;
  void main() {
    vColor = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #endif
    vH = position.y;
    vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const glyphFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vH;
  varying vec3 vN;
  void main() {
    float light = 0.6 + 0.4 * max(dot(vN, normalize(vec3(-0.35, 0.5, 0.8))), 0.0);
    vec3 col = vColor * light + vColor * vH * 0.45;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const haloVertex = /* glsl */ `
  attribute float aLevel;
  attribute vec3 aColor;
  uniform float uScale;
  uniform float uSize;
  uniform float uGrow;
  varying vec3 vColor;
  varying float vLevel;
  varying float vFacing;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFacing = dot(normalize(normalMatrix * position), normalize(-mv.xyz));
    vColor = aColor;
    vLevel = aLevel;
    gl_PointSize = uSize * (0.6 + aLevel * 1.4) * uGrow * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const haloFragment = /* glsl */ `
  uniform float uStrength;
  varying vec3 vColor;
  varying float vLevel;
  varying float vFacing;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d2 = dot(c, c) * 4.0;
    float a = exp(-d2 * 3.2) * (0.18 + vLevel * 0.5) * smoothstep(0.05, 0.4, vFacing) * uStrength;
    gl_FragColor = vec4(vColor, a);
  }
`;

function HeatGlyphs({
  points,
  halos,
  reducedMotion,
  scale,
  palette,
}: {
  points: HeatPoint[];
  halos: boolean;
  reducedMotion: boolean;
  scale: { value: number };
  palette: Palette;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const grow = useRef(reducedMotion ? 1 : 0);
  const { invalidate } = useThree();

  const data = useMemo(() => {
    // Typical grid spacing (median nearest-neighbour distance) → glyph footprint.
    const nn: number[] = [];
    for (let i = 0; i < points.length; i++) {
      let best = Infinity;
      for (let j = 0; j < points.length; j++) {
        if (i === j) continue;
        const dLat = points[i].lat - points[j].lat;
        const dLon = (points[i].lon - points[j].lon) * Math.cos(points[i].lat * DEG);
        const d = dLat * dLat + dLon * dLon;
        if (d < best) best = d;
      }
      if (Number.isFinite(best)) nn.push(Math.sqrt(best));
    }
    nn.sort((a, b) => a - b);
    const spacingDeg = Math.min(3, Math.max(0.25, nn.length ? nn[Math.floor(nn.length / 2)] : 1));
    const width = spacingDeg * DEG * 0.46;
    const up = new THREE.Vector3(0, 1, 0);
    const items = points.map((p) => {
      const n = new THREE.Vector3(...latLonToVec3(p.lat, p.lon, 1));
      const level = heatLevel(p.tmaxC);
      return {
        normal: n,
        quat: new THREE.Quaternion().setFromUnitVectors(up, n),
        height: 0.012 + level * 0.17,
        color: new THREE.Color().setRGB(...heatColor(p.tmaxC)),
        level,
      };
    });
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.translate(0, 0.5, 0);
    const material = new THREE.ShaderMaterial({ vertexShader: glyphVertex, fragmentShader: glyphFragment });

    let halo: { g: THREE.BufferGeometry; m: THREE.ShaderMaterial } | null = null;
    if (halos) {
      const pos = new Float32Array(items.length * 3);
      const col = new Float32Array(items.length * 3);
      const lvl = new Float32Array(items.length);
      items.forEach((it, i) => {
        pos.set([it.normal.x * 1.004, it.normal.y * 1.004, it.normal.z * 1.004], i * 3);
        col.set([it.color.r, it.color.g, it.color.b], i * 3);
        lvl[i] = it.level;
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aLevel', new THREE.BufferAttribute(lvl, 1));
      const m = new THREE.ShaderMaterial({
        vertexShader: haloVertex,
        fragmentShader: haloFragment,
        transparent: true,
        depthWrite: false,
        blending: palette.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: {
          uScale: scale,
          uSize: { value: spacingDeg * DEG * 2.4 },
          uGrow: { value: reducedMotion ? 1 : 0 },
          uStrength: { value: palette.halo },
        },
      });
      halo = { g, m };
    }
    return { items, width, geometry, material, halo };
  }, [points, halos, scale, palette, reducedMotion]);

  useEffect(
    () => () => {
      data.geometry.dispose();
      data.material.dispose();
      data.halo?.g.dispose();
      data.halo?.m.dispose();
    },
    [data],
  );

  const place = (k: number) => {
    const m = mesh.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    const s = new THREE.Vector3();
    const pos = new THREE.Vector3();
    data.items.forEach((it, i) => {
      pos.copy(it.normal).multiplyScalar(1.001);
      s.set(data.width, Math.max(0.0005, it.height * k), data.width);
      mat.compose(pos, it.quat, s);
      m.setMatrixAt(i, mat);
    });
    m.instanceMatrix.needsUpdate = true;
    if (data.halo) data.halo.m.uniforms.uGrow.value = k;
  };

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    data.items.forEach((it, i) => m.setColorAt(i, it.color));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    place(easeOutCubic(grow.current));
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useFrame((_, dt) => {
    if (grow.current >= 1) return;
    grow.current = Math.min(1, grow.current + dt / 1.8);
    place(easeOutCubic(grow.current));
  });

  return (
    <>
      {data.halo && <points geometry={data.halo.g} material={data.halo.m} renderOrder={3} />}
      <instancedMesh ref={mesh} args={[data.geometry, data.material, data.items.length]} renderOrder={4} frustumCulled={false} />
    </>
  );
}

const atmoVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const atmoFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uEdge;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    // Back faces of a larger sphere: 0 at its silhouette, rising towards the planet's limb.
    float t = clamp(-dot(vN, vView) / uEdge, 0.0, 1.0);
    float a = pow(t, 2.4) * uIntensity;
    gl_FragColor = vec4(uColor, a);
  }
`;

function Atmosphere({ palette }: { palette: Palette }) {
  const R = 1.17;
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: atmoVertex,
        fragmentShader: atmoFragment,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: palette.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: {
          uColor: { value: srgb(palette.atmo) },
          uIntensity: { value: palette.atmoIntensity },
          uEdge: { value: Math.sqrt(1 - 1 / (R * R)) },
        },
      }),
    [palette],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} scale={R} renderOrder={5}>
      <sphereGeometry args={[1, 64, 48]} />
    </mesh>
  );
}

/** Samples frame times for ~1.5 s after a short warm-up, then reports a robust fps once. */
function FpsProbe({ onResult }: { onResult: (fps: number) => void }) {
  const s = useRef({ t: 0, deltas: [] as number[], done: false });
  useFrame((_, dt) => {
    const r = s.current;
    if (r.done) return;
    r.t += dt;
    if (r.t < 0.7) return;
    r.deltas.push(dt);
    if (r.t > 2.2) {
      r.done = true;
      onResult(fpsFromDeltas(r.deltas));
    }
  });
  return null;
}

/** Fires once after the first frames with real geometry have been drawn. */
function ReadySignal({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  const fired = useRef(false);
  const { invalidate } = useThree();
  useEffect(() => {
    invalidate();
  }, [invalidate]);
  useFrame(() => {
    if (fired.current) return;
    frames.current++;
    if (frames.current >= 2) {
      fired.current = true;
      onReady();
    } else invalidate();
  });
  return null;
}

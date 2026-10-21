import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type CameraPresetId = 'overview' | 'macro' | 'zenith' | 'horizon';
export type FinishPresetId = 'emerald_obsidian' | 'indigo_titanium' | 'amber_bronze';

export interface ZenSceneProps {
  darkMode: boolean;
  isFocusActive: boolean;
  completionPct: number;
  cameraPreset: CameraPresetId;
  finishPreset: FinishPresetId;
  explodedAmount: number; // 0..1
  kineticSpeed: number; // 0..2
}

// Pre-allocated scratch math objects at module scope (Zero GC in render loop)
const _targetCamPos = new THREE.Vector3();
const _targetLookAt = new THREE.Vector3();
const _currentLookAt = new THREE.Vector3(0, 1.3, 0);
const _dummyMatrix = new THREE.Matrix4();
const _dummyPos = new THREE.Vector3();
const _dummyQuat = new THREE.Quaternion();
const _dummyScale = new THREE.Vector3();
const _dummyEuler = new THREE.Euler();
const _tempColor = new THREE.Color();

const CAMERA_PRESETS: Record<CameraPresetId, { pos: [number, number, number]; target: [number, number, number] }> = {
  overview: { pos: [0, 3.4, 7.2], target: [0, 1.35, 0] },
  macro: { pos: [2.1, 2.1, 3.4], target: [0, 1.65, 0] },
  zenith: { pos: [0.01, 8.2, 0.8], target: [0, 0.8, 0] },
  horizon: { pos: [-5.2, 1.4, 4.6], target: [0, 1.5, 0] },
};

const FINISH_PALETTES: Record<
  FinishPresetId,
  {
    primaryMetal: number;
    secondaryMetal: number;
    accentGlow: number;
    coreColor: number;
  }
> = {
  emerald_obsidian: {
    primaryMetal: 0x1e293b,
    secondaryMetal: 0x94a3b8,
    accentGlow: 0x10b981,
    coreColor: 0x059669,
  },
  indigo_titanium: {
    primaryMetal: 0x334155,
    secondaryMetal: 0xcbd5e1,
    accentGlow: 0x6366f1,
    coreColor: 0x4f46e5,
  },
  amber_bronze: {
    primaryMetal: 0x451a03,
    secondaryMetal: 0xd97706,
    accentGlow: 0xf59e0b,
    coreColor: 0xb45309,
  },
};

function createDialCanvasTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0B0F17';
  ctx.fillRect(0, 0, 1024, 1024);

  const cx = 512;
  const cy = 512;

  // Subtle concentric chapter rings
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 3;
  [220, 320, 420, 468].forEach((r) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  });

  // 60 precision minute/second ticks + 12 major hour indices
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * Math.PI * 2;
    const isMajor = i % 5 === 0;
    const innerR = isMajor ? 410 : 440;
    const outerR = 464;
    ctx.strokeStyle = isMajor ? '#10B981' : '#64748B';
    ctx.lineWidth = isMajor ? 6 : 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
    ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(256, 256, 20, 256, 256, 240);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.25)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const ZenFocusScene3D: React.FC<ZenSceneProps> = (props) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef<ZenSceneProps>(props);
  propsRef.current = props;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return undefined;

    // 1. Detect software WebGL from GPU renderer string
    const isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    const initialBgHex = propsRef.current.darkMode ? 0x070b12 : 0xe2e8f0;
    scene.background = new THREE.Color(initialBgHex);
    scene.fog = new THREE.FogExp2(initialBgHex, 0.042);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 120);
    camera.position.set(0, 3.4, 7.2);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);

    // 2. Mandatory Studio Environment Reflection (RoomEnvironment + PMREMGenerator)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    pmremGenerator.dispose();

    // 3. OrbitControls with smooth damping
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 2.4;
    controls.maxDistance = 16;
    controls.target.set(0, 1.35, 0);

    let userInteractingWithCamera = false;
    controls.addEventListener('start', () => {
      userInteractingWithCamera = true;
    });

    // 4. Balanced 3-Point Studio Lighting Rig + Hemisphere Fill
    const hemiLight = new THREE.HemisphereLight(0x818cf8, 0x0f172a, 0.75);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e6, 2.2);
    keyLight.position.set(6, 10, 6);
    keyLight.castShadow = !isSoftwareGl;
    const d = 7;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 28;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x10b981, 1.6);
    rimLight.position.set(-6, 5, -6);
    scene.add(rimLight);

    // 5. Ground Plane & Contact Shadow Grounding
    const groundGeo = new THREE.CircleGeometry(36, 64);
    const groundMat = new THREE.MeshStandardMaterial({
      color: propsRef.current.darkMode ? 0x090d16 : 0xcbd5e1,
      roughness: 0.85,
      metalness: 0.15,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = 0;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    const contactShadowTex = createContactShadowTexture();
    const contactShadowGeo = new THREE.PlaneGeometry(5.8, 5.8);
    const contactShadowMat = new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const contactShadowMesh = new THREE.Mesh(contactShadowGeo, contactShadowMat);
    contactShadowMesh.rotation.x = -Math.PI / 2;
    contactShadowMesh.position.y = 0.015;
    scene.add(contactShadowMesh);

    // 6. Composite 9-Part Procedural Hero Model: The QuietPulse Zen Chronometer (THREE.Group)
    const heroGroup = new THREE.Group();
    heroGroup.position.set(0, 0, 0); // Pivoted flush at bottom-center y = 0
    scene.add(heroGroup);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const dialTex = createDialCanvasTexture(maxAniso);

    const primaryMetalMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.88,
      roughness: 0.24,
    });
    const secondaryMetalMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.92,
      roughness: 0.52, // Varied roughness by >= 0.25 from adjacent parts
    });
    const accentGlowMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x10b981,
      emissiveIntensity: 0.45,
      metalness: 0.65,
      roughness: 0.2,
    });
    const coreVesselMat = new THREE.MeshPhysicalMaterial({
      color: 0x059669,
      emissive: 0x059669,
      emissiveIntensity: 0.25,
      metalness: 0.3,
      roughness: 0.15,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
    });

    // Part 1: Stepped Lathe Pedestal Base (flush at y = 0)
    const lathePoints = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(1.85, 0),
      new THREE.Vector2(1.75, 0.14),
      new THREE.Vector2(1.45, 0.22),
      new THREE.Vector2(1.38, 0.38),
      new THREE.Vector2(1.52, 0.46),
      new THREE.Vector2(0, 0.46),
    ];
    const pedestalGeo = new THREE.LatheGeometry(lathePoints, 48);
    const pedestalMesh = new THREE.Mesh(pedestalGeo, primaryMetalMat);
    pedestalMesh.castShadow = true;
    pedestalMesh.receiveShadow = true;
    heroGroup.add(pedestalMesh);

    // Part 2: Engraved Chapter Dial Plate
    const dialGeo = new THREE.CylinderGeometry(1.42, 1.42, 0.08, 48);
    const dialMat = new THREE.MeshStandardMaterial({
      map: dialTex,
      roughness: 0.35,
      metalness: 0.6,
    });
    const dialMesh = new THREE.Mesh(dialGeo, dialMat);
    dialMesh.position.y = 0.5;
    dialMesh.receiveShadow = true;
    heroGroup.add(dialMesh);

    // Part 3: 4 Extruded Beveled Architectural Support Pylons
    const pylonShape = new THREE.Shape();
    pylonShape.moveTo(-0.08, 0);
    pylonShape.lineTo(0.08, 0);
    pylonShape.lineTo(0.05, 1.15);
    pylonShape.lineTo(-0.05, 1.15);
    pylonShape.closePath();
    const pylonGeo = new THREE.ExtrudeGeometry(pylonShape, {
      depth: 0.12,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.02,
      bevelSegments: 3,
    });
    pylonGeo.center();

    const pylonsGroup = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const pylon = new THREE.Mesh(pylonGeo, secondaryMetalMat);
      pylon.position.set(Math.cos(angle) * 1.48, 1.1, Math.sin(angle) * 1.48);
      pylon.rotation.y = -angle + Math.PI / 2;
      pylon.castShadow = true;
      pylonsGroup.add(pylon);
    }
    heroGroup.add(pylonsGroup);

    // Part 4: Outer Gimbal Ring
    const outerGimbalGeo = new THREE.TorusGeometry(1.36, 0.065, 24, 64);
    const outerGimbalMesh = new THREE.Mesh(outerGimbalGeo, secondaryMetalMat);
    outerGimbalMesh.position.y = 1.65;
    outerGimbalMesh.castShadow = true;
    heroGroup.add(outerGimbalMesh);

    // Part 5: Middle Gyroscopic Horizon Ring
    const midGimbalGeo = new THREE.TorusGeometry(1.08, 0.055, 24, 64);
    const midGimbalMesh = new THREE.Mesh(midGimbalGeo, primaryMetalMat);
    midGimbalMesh.position.y = 1.65;
    midGimbalMesh.castShadow = true;
    heroGroup.add(midGimbalMesh);

    // Part 6: Inner Focus Resonance Ring
    const innerGimbalGeo = new THREE.TorusGeometry(0.82, 0.045, 24, 64);
    const innerGimbalMesh = new THREE.Mesh(innerGimbalGeo, accentGlowMat);
    innerGimbalMesh.position.y = 1.65;
    innerGimbalMesh.castShadow = true;
    heroGroup.add(innerGimbalMesh);

    // Part 7: Sculpted Hourglass / Resonance Core Vessel (LatheGeometry)
    const coreProfile = [
      new THREE.Vector2(0.01, -0.46),
      new THREE.Vector2(0.36, -0.42),
      new THREE.Vector2(0.12, 0.0),
      new THREE.Vector2(0.36, 0.42),
      new THREE.Vector2(0.01, 0.46),
    ];
    const coreGeo = new THREE.LatheGeometry(coreProfile, 36);
    const coreMesh = new THREE.Mesh(coreGeo, coreVesselMat);
    coreMesh.position.y = 1.65;
    coreMesh.castShadow = true;
    heroGroup.add(coreMesh);

    // Part 8: 12 Precision Hour Index Finials around the Chapter Ring
    const finialGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.14, 12);
    const finialsGroup = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const finial = new THREE.Mesh(finialGeo, accentGlowMat);
      finial.position.set(Math.cos(a) * 1.25, 0.58, Math.sin(a) * 1.25);
      finialsGroup.add(finial);
    }
    heroGroup.add(finialsGroup);

    // Part 9: Optical Crystal Protective Dome (depthWrite: false, renderOrder: 10)
    const domeGeo = new THREE.SphereGeometry(1.62, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const domeMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.08,
      transmission: isSoftwareGl ? 0 : 0.92,
      transparent: true,
      opacity: isSoftwareGl ? 0.22 : 1.0,
      ior: 1.52,
      thickness: 0.6,
      clearcoat: 1.0,
      depthWrite: false,
    });
    const domeMesh = new THREE.Mesh(domeGeo, domeMat);
    domeMesh.position.y = 0.46;
    domeMesh.renderOrder = 10;
    heroGroup.add(domeMesh);

    // 7. InstancedMesh: 36 Orbiting Sanctuary Habit Stones & Monoliths (>20 repeated items)
    const instanceCount = 36;
    const stoneGeo = new THREE.OctahedronGeometry(0.14, 1);
    const stoneMat = new THREE.MeshStandardMaterial({
      roughness: 0.3,
      metalness: 0.75,
    });
    const instancedStones = new THREE.InstancedMesh(stoneGeo, stoneMat, instanceCount);
    instancedStones.castShadow = !isSoftwareGl;
    instancedStones.receiveShadow = true;

    const paletteHexes = [0x10b981, 0x6366f1, 0xf59e0b, 0x06b6d4, 0xf43f5e, 0x8b5cf6];
    const orbitRadii: number[] = [];
    const orbitAngles: number[] = [];
    const orbitHeights: number[] = [];
    const orbitScales: number[] = [];

    for (let i = 0; i < instanceCount; i++) {
      const ringIdx = i % 3;
      const r = 2.6 + ringIdx * 1.15 + (i % 5) * 0.08;
      const angle = (i / instanceCount) * Math.PI * 2;
      const h = 0.35 + ringIdx * 0.45 + Math.sin(i * 1.7) * 0.2;
      const sc = 0.85 + ((i * 7) % 30) / 100; // ±15% scale variation

      orbitRadii.push(r);
      orbitAngles.push(angle);
      orbitHeights.push(h);
      orbitScales.push(sc);

      _dummyPos.set(Math.cos(angle) * r, h, Math.sin(angle) * r);
      _dummyEuler.set(i * 0.2, angle, 0);
      _dummyQuat.setFromEuler(_dummyEuler);
      _dummyScale.set(sc, sc * 1.35, sc);
      _dummyMatrix.compose(_dummyPos, _dummyQuat, _dummyScale);
      instancedStones.setMatrixAt(i, _dummyMatrix);

      _tempColor.setHex(paletteHexes[i % paletteHexes.length]);
      instancedStones.setColorAt(i, _tempColor);
    }
    instancedStones.instanceMatrix.needsUpdate = true;
    if (instancedStones.instanceColor) instancedStones.instanceColor.needsUpdate = true;
    instancedStones.computeBoundingSphere();
    instancedStones.frustumCulled = false;
    scene.add(instancedStones);

    // Pre-warm shaders on hardware GPU
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Track prop changes for camera presets
    let lastCameraPreset: CameraPresetId = propsRef.current.cameraPreset;

    // 8. Animation & Software-WebGL Paced Loop
    const clock = new THREE.Clock();
    let frameId = 0;
    let isDisposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (isDisposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (isDisposed) return;

      const dt = Math.min(clock.getDelta(), 0.1);
      const elapsed = clock.getElapsedTime();
      const currentProps = propsRef.current;

      // Update theme background & fog smoothly
      const targetBg = currentProps.darkMode ? 0x070b12 : 0xe2e8f0;
      if (scene.background instanceof THREE.Color) {
        _tempColor.setHex(targetBg);
        scene.background.lerp(_tempColor, 1 - Math.exp(-6 * dt));
        if (scene.fog instanceof THREE.FogExp2) {
          scene.fog.color.copy(scene.background);
        }
      }
      _tempColor.setHex(currentProps.darkMode ? 0x090d16 : 0xcbd5e1);
      groundMat.color.lerp(_tempColor, 1 - Math.exp(-6 * dt));

      // Update material finish palette smoothly
      const finish = FINISH_PALETTES[currentProps.finishPreset] || FINISH_PALETTES.emerald_obsidian;
      _tempColor.setHex(finish.primaryMetal);
      primaryMetalMat.color.lerp(_tempColor, 1 - Math.exp(-5 * dt));

      _tempColor.setHex(finish.secondaryMetal);
      secondaryMetalMat.color.lerp(_tempColor, 1 - Math.exp(-5 * dt));

      const activeAccent = currentProps.isFocusActive ? 0x6366f1 : finish.accentGlow;
      _tempColor.setHex(activeAccent);
      accentGlowMat.color.lerp(_tempColor, 1 - Math.exp(-5 * dt));
      accentGlowMat.emissive.lerp(_tempColor, 1 - Math.exp(-5 * dt));
      rimLight.color.lerp(_tempColor, 1 - Math.exp(-5 * dt));

      _tempColor.setHex(currentProps.isFocusActive ? 0x4f46e5 : finish.coreColor);
      coreVesselMat.color.lerp(_tempColor, 1 - Math.exp(-5 * dt));
      coreVesselMat.emissive.lerp(_tempColor, 1 - Math.exp(-5 * dt));

      // Smooth Exploded-View Layer Separation using THREE.MathUtils.damp
      const explode = currentProps.explodedAmount;
      dialMesh.position.y = THREE.MathUtils.damp(dialMesh.position.y, 0.5 + explode * 0.35, 6, dt);
      outerGimbalMesh.position.y = THREE.MathUtils.damp(
        outerGimbalMesh.position.y,
        1.65 + explode * 0.75,
        6,
        dt
      );
      midGimbalMesh.position.y = THREE.MathUtils.damp(
        midGimbalMesh.position.y,
        1.65 + explode * 1.15,
        6,
        dt
      );
      innerGimbalMesh.position.y = THREE.MathUtils.damp(
        innerGimbalMesh.position.y,
        1.65 + explode * 1.55,
        6,
        dt
      );
      coreMesh.position.y = THREE.MathUtils.damp(
        coreMesh.position.y,
        1.65 + explode * 1.95,
        6,
        dt
      );
      domeMesh.position.y = THREE.MathUtils.damp(
        domeMesh.position.y,
        0.46 + explode * 2.6,
        6,
        dt
      );

      // Gyroscopic Rotation kinematics
      const speedMul = currentProps.kineticSpeed * (currentProps.isFocusActive ? 1.65 : 1.0);
      outerGimbalMesh.rotation.y += dt * 0.35 * speedMul;
      outerGimbalMesh.rotation.x = Math.sin(elapsed * 0.4 * speedMul) * 0.22;

      midGimbalMesh.rotation.x += dt * 0.52 * speedMul;
      midGimbalMesh.rotation.z = Math.cos(elapsed * 0.35 * speedMul) * 0.35;

      innerGimbalMesh.rotation.y -= dt * 0.78 * speedMul;
      innerGimbalMesh.rotation.z += dt * 0.44 * speedMul;

      coreMesh.rotation.y += dt * 0.9 * speedMul;

      // Update Orbiting Instanced Stones
      for (let i = 0; i < instanceCount; i++) {
        const currentAngle = orbitAngles[i] + elapsed * 0.12 * speedMul * (i % 2 === 0 ? 1 : -0.7);
        const r = orbitRadii[i] + explode * 0.8;
        const y = orbitHeights[i] + Math.sin(elapsed * 1.2 + i) * 0.08;
        const sc = orbitScales[i];

        _dummyPos.set(Math.cos(currentAngle) * r, y, Math.sin(currentAngle) * r);
        _dummyEuler.set(elapsed * 0.4 + i, currentAngle, 0);
        _dummyQuat.setFromEuler(_dummyEuler);
        _dummyScale.set(sc, sc * 1.35, sc);
        _dummyMatrix.compose(_dummyPos, _dummyQuat, _dummyScale);
        instancedStones.setMatrixAt(i, _dummyMatrix);
      }
      instancedStones.instanceMatrix.needsUpdate = true;

      // Smooth Camera Preset Transition if preset changed
      if (currentProps.cameraPreset !== lastCameraPreset) {
        lastCameraPreset = currentProps.cameraPreset;
        userInteractingWithCamera = false;
      }

      if (!userInteractingWithCamera) {
        const preset = CAMERA_PRESETS[currentProps.cameraPreset] || CAMERA_PRESETS.overview;
        _targetCamPos.set(preset.pos[0], preset.pos[1], preset.pos[2]);
        _targetLookAt.set(preset.target[0], preset.target[1], preset.target[2]);

        const dampFactor = 1 - Math.exp(-4.5 * dt);
        camera.position.lerp(_targetCamPos, dampFactor);
        _currentLookAt.lerp(_targetLookAt, dampFactor);
        controls.target.copy(_currentLookAt);
      }

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = window.requestAnimationFrame(tick);
      }
    }

    tick();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      isDisposed = true;
      window.removeEventListener('resize', handleResize);
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      controls.dispose();
      envTexture.dispose();
      dialTex.dispose();
      contactShadowTex.dispose();
      groundGeo.dispose();
      groundMat.dispose();
      pedestalGeo.dispose();
      dialGeo.dispose();
      pylonGeo.dispose();
      outerGimbalGeo.dispose();
      midGimbalGeo.dispose();
      innerGimbalGeo.dispose();
      coreGeo.dispose();
      finialGeo.dispose();
      domeGeo.dispose();
      stoneGeo.dispose();
      primaryMetalMat.dispose();
      secondaryMetalMat.dispose();
      accentGlowMat.dispose();
      coreVesselMat.dispose();
      domeMat.dispose();
      stoneMat.dispose();
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="fixed inset-0 w-screen h-screen pointer-events-auto z-0 overflow-hidden"
      aria-label="QuietPulse 3D Zen Chronometer Sanctuary"
    />
  );
};

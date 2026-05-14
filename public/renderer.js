// renderer.js
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { initPostProcessing } from './postprocessing.js';
import { createSettingsGUI } from './gui.js';

let scene, camera, renderer, controls;
let cameraRig;
let composer, updateComposer, setFocusDistance, dofEffect;
let chromaticAberration, velocityBlur, embossEffect;
const remoteMeshes = {};
let dummyMesh;

// ── HDRI toggle state ──────────────────────────
let environmentMap = null;
let hdriAmbientLight = null;

// ── Subpixel camera smoothing state ──────────
let targetYaw = 0, targetPitch = 0;
let currentYaw = 0, currentPitch = 0;
const MOUSE_SENSITIVITY = 0.001;
const SMOOTHING_SPEED = 30;
let lockOnOverride = false;

const visualPreset = {
  bloom: {
    strength: 1.5,
    threshold: 0.2,
    smoothing: 0.1,
    mipmapBlur: true,
    radius: 0.85,
    levels: 8
  },
  color: {
    brightness: 0.0,
    contrast: 0.0,
    saturation: 0.0,
    hue: 0
  },
  vignette: {
    enabled: true,
    technique: 0,
    offset: 0.5,
    darkness: 0.5
  },
  filmGrain: {
    enabled: true,
    intensity: 0.2,
    premultiply: false
  },
  dof: {
    enabled: true,
    focus: 10.0,
    focusRange: 1.5,
    bokehScale: 1.0,
    resolutionScale: 0.5
  },
  smaa: {
    enabled: true,
    preset: 1,
    edgeDetectionThreshold: 0.1,
    localContrastAdaptationFactor: 2.0,
    orthogonalSearchSteps: 16,
    diagonalSearchSteps: 6,
    diagonalDetection: true,
    cornerRounding: 25,
    cornerDetection: true
  },
  emboss: {
    enabled: true,
    strength: 0.5,
    angle: 45,
    detailScale: 1.0
  }
};

let arenaMode = false;
let arenaPit = null;
let fighter1Mesh = null;
let fighter2Mesh = null;
export let normalGround = null;   // ← now exported so main.js can hide it

export async function initRenderer() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 50, 120);

  // ── Camera Rig ───────────────────────────────────────────
  cameraRig = new THREE.Group();
  cameraRig.position.set(0, 1.6, 0);
  scene.add(cameraRig);

  camera = new THREE.PerspectiveCamera(
    100,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  cameraRig.add(camera);

  renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  controls = new PointerLockControls(cameraRig, renderer.domElement);

  const blocker = document.getElementById('blocker');
  blocker.addEventListener('click', () => controls.lock());
  controls.addEventListener('lock', () => {
    blocker.style.display = 'none';
    document.getElementById('hud').style.display = 'block';
  });
  controls.addEventListener('unlock', () => {
    blocker.style.display = 'flex';
    document.getElementById('hud').style.display = 'none';
  });

  // ── Replace built‑in mouse look with subpixel‑smooth version ──
  controls.connect();
  if (controls._onMouseMove) {
    document.removeEventListener('mousemove', controls._onMouseMove);
  }
  document.addEventListener('mousemove', onMouseMove);

  // ── Load HDRI environment map for image-based lighting ──
  const exrLoader = new EXRLoader();
  const exrTexture = await exrLoader.loadAsync('/assets/baselightingHDRI.exr');
  exrTexture.mapping = THREE.EquirectangularReflectionMapping;

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envMap = pmremGenerator.fromEquirectangular(exrTexture).texture;
  scene.environment = envMap;
  environmentMap = envMap;
  pmremGenerator.dispose();
  exrTexture.dispose();

  hdriAmbientLight = new THREE.AmbientLight(0xffffff, 0.2);

  // ── Ground ───────────────────────────────────────────────
  const groundGeo = new THREE.PlaneGeometry(40, 40);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x3a5f3a });
  normalGround = new THREE.Mesh(groundGeo, groundMat);   // ← assign to export
  normalGround.rotation.x = -Math.PI / 2;
  normalGround.receiveShadow = true;
  scene.add(normalGround);

  // ── Dummy ────────────────────────────────────────────────
  const dummyGeo = new THREE.CylinderGeometry(0.4, 0.4, 2, 8);
  dummyMesh = new THREE.Mesh(
    dummyGeo,
    new THREE.MeshStandardMaterial({ color: 0xaaaaaa })
  );
  dummyMesh.position.set(5, 1, -10);
  dummyMesh.castShadow = true;
  scene.add(dummyMesh);

  // Post‑processing
  const pp = await initPostProcessing(renderer, scene, camera);
  composer = pp.composer;
  updateComposer = pp.updateComposer;
  setFocusDistance = pp.setFocusDistance;
  dofEffect = pp.dofRef;
  chromaticAberration = pp.chromAberr;
  velocityBlur = pp.velocityBlur;
  embossEffect = pp.emboss;

  // Settings GUI
  const guiContainer = document.getElementById('gui-container');
  function buildGUI(preset) {
    createSettingsGUI(preset, guiContainer, (newPreset) => {
      updateComposer(preset);
      localStorage.setItem('visualPreset', JSON.stringify(preset));
    });
  }
  buildGUI(visualPreset);
  updateComposer(visualPreset);

  // Load saved preset
  const stored = localStorage.getItem('visualPreset');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.color) {
        if (parsed.color.brightness < -1 || parsed.color.brightness > 1)
          parsed.color.brightness = 0.0;
        if (parsed.color.contrast < -1 || parsed.color.contrast > 1)
          parsed.color.contrast = 0.0;
        if (parsed.color.saturation < -1 || parsed.color.saturation > 1)
          parsed.color.saturation = 0.0;
        if (parsed.color.hue === undefined) parsed.color.hue = 0;
      }
      if (parsed.dof) {
        delete parsed.dof.debugMode;
        delete parsed.dof.aperture;
        delete parsed.dof.maxblur;
      }
      if (parsed.smaa) {
        delete parsed.smaa.edgeDetectionMode;
        delete parsed.smaa.predicationMode;
      }
      if (parsed.filmGrain) {
        parsed.filmGrain.premultiply = Boolean(parsed.filmGrain.premultiply);
      }
      function deepMergeSection(target, source) {
        if (!source || typeof source !== 'object') return;
        for (const key of Object.keys(source)) {
          if (key in target) {
            if (
              typeof target[key] === 'object' &&
              typeof source[key] === 'object'
            ) {
              deepMergeSection(target[key], source[key]);
            } else {
              target[key] = source[key];
            }
          }
        }
      }
      deepMergeSection(visualPreset, parsed);
      buildGUI(visualPreset);
      updateComposer(visualPreset);
    } catch (e) {
      console.error('Failed to restore preset', e);
    }
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    if (dofEffect && dofEffect.cocMaterial) {
      dofEffect.cocMaterial.copyCameraSettings(camera);
    }
  });

  // ── HDRI toggle key (L) and global access ──────────────
  window.toggleHDRI = toggleHDRI;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyL') {
      e.preventDefault();
      toggleHDRI();
    }
  });
}

// ── Toggle between HDRI environment and a dim ambient fallback ──
function toggleHDRI() {
  if (scene.environment) {
    scene.environment = null;
    scene.add(hdriAmbientLight);
  } else {
    scene.remove(hdriAmbientLight);
    scene.environment = environmentMap;
  }
}

// ---------- Arena mode ----------
export function enterArenaMode(fighterUUID1, fighterUUID2, isSpectator) {
  if (arenaMode) return;
  arenaMode = true;

  if (normalGround) normalGround.visible = false;
  if (dummyMesh) dummyMesh.visible = false;

  const pitGroup = new THREE.Group();
  const floorGeo = new THREE.CylinderGeometry(5, 5, 0.2, 32);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x8b7355 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = -0.1;
  floor.receiveShadow = true;
  pitGroup.add(floor);

  const wallGeo = new THREE.TorusGeometry(4.8, 0.3, 16, 48);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x666666 });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.y = 0.3;
  wall.receiveShadow = true;
  wall.castShadow = true;
  pitGroup.add(wall);

  scene.add(pitGroup);
  arenaPit = pitGroup;

  const createFighterMesh = (color, position) => {
    const geo = new THREE.CapsuleGeometry(0.4, 1.2, 4, 8);
    const mat = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };

  const fighter1Pos = new THREE.Vector3(-3, 1.0, 0);
  const fighter2Pos = new THREE.Vector3(3, 1.0, 0);
  fighter1Mesh = createFighterMesh(0xff4444, fighter1Pos);
  fighter2Mesh = createFighterMesh(0x4444ff, fighter2Pos);

  if (isSpectator) {
    if (controls.isLocked) controls.unlock();
    cameraRig.position.set(0, 5, 10);
    cameraRig.lookAt(0, 0, 0);
  }
}

export function exitArenaMode() {
  if (!arenaMode) return;
  arenaMode = false;

  if (arenaPit) {
    scene.remove(arenaPit);
    arenaPit = null;
  }
  if (fighter1Mesh) {
    scene.remove(fighter1Mesh);
    fighter1Mesh = null;
  }
  if (fighter2Mesh) {
    scene.remove(fighter2Mesh);
    fighter2Mesh = null;
  }

  if (normalGround) normalGround.visible = true;
  if (dummyMesh) dummyMesh.visible = true;

  cameraRig.position.set(0, 1.6, 0);
  cameraRig.quaternion.identity();
}

export function isArenaMode() {
  return arenaMode;
}

// ---------- Exports ----------
export function renderFrame() {
  if (composer) composer.render();
}

// ── Subpixel‑smooth camera rotation ─────────
function onMouseMove(event) {
  if (!controls.isLocked) return;
  targetYaw   -= event.movementX * MOUSE_SENSITIVITY;
  targetPitch -= event.movementY * MOUSE_SENSITIVITY;
  targetPitch = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, targetPitch));
}

export function smoothCamera(deltaTime) {
  if (!controls.isLocked || lockOnOverride) return;
  const factor = 1 - Math.exp(-SMOOTHING_SPEED * Math.min(deltaTime, 0.1));
  currentYaw   += (targetYaw   - currentYaw)   * factor;
  currentPitch += (targetPitch - currentPitch) * factor;

  const yawQuat = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), currentYaw
  );
  const pitchQuat = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0), currentPitch
  );
  cameraRig.quaternion.copy(yawQuat).multiply(pitchQuat);
}

// ── Lock‑on helpers ─────────────────────────
export function setLockOnOverride(active) {
  lockOnOverride = active;
}

export function resetSmoothRotation(quat) {
  const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
  targetYaw   = euler.y;
  currentYaw  = euler.y;
  targetPitch = euler.x;
  currentPitch = euler.x;
}

export function addRemotePlayerMesh(sessionId, position) {
  const geo = new THREE.CapsuleGeometry(0.4, 1.2);
  const mat = new THREE.MeshStandardMaterial({ color: Math.random() * 0xffffff });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  mesh.castShadow = true;
  scene.add(mesh);
  remoteMeshes[sessionId] = mesh;
}

export function removeRemotePlayerMesh(sessionId) {
  const mesh = remoteMeshes[sessionId];
  if (mesh) {
    scene.remove(mesh);
    delete remoteMeshes[sessionId];
  }
}

export function updateRemotePlayerMesh(sessionId, x, y, z) {
  const mesh = remoteMeshes[sessionId];
  if (mesh) mesh.position.set(x, y, z);
}

export function getCamera() { return camera; }
export function getCameraRig() { return cameraRig; }
export function getControls() { return controls; }
export function getScene() { return scene; }
export function getDummyMesh() { return dummyMesh; }
export function getChromaticAberration() { return chromaticAberration; }
export function getVelocityBlur() { return velocityBlur; }
export function getEmbossEffect() { return embossEffect; }

export { remoteMeshes };
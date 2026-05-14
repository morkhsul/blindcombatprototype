// postprocessing.js
import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  DepthOfFieldEffect,
  BrightnessContrastEffect,
  VignetteEffect,
  NoiseEffect,
  SMAAEffect,
  HueSaturationEffect,
  VignetteTechnique,
  SMAAPreset,
  Effect,
  BlendFunction,
  ChromaticAberrationEffect,
} from 'postprocessing';

let composer, bloom, dof, brightnessContrast, hueSaturation, vignette, noise, smaa, clampEffect;
let chromaticAberration, velocityBlurEffect;

// Default blend functions
const BLOOM_DEFAULT_BLEND = BlendFunction.SCREEN;
const DOF_DEFAULT_BLEND = BlendFunction.NORMAL;
const BC_DEFAULT_BLEND = BlendFunction.SRC;
const HS_DEFAULT_BLEND = BlendFunction.SRC;
const VIGNETTE_DEFAULT_BLEND = BlendFunction.NORMAL;
const NOISE_DEFAULT_BLEND = BlendFunction.SCREEN;
const SMAA_DEFAULT_BLEND = BlendFunction.SRC;
const CA_DEFAULT_BLEND = BlendFunction.NORMAL;
const VELOCITY_BLUR_DEFAULT_BLEND = BlendFunction.NORMAL;

const clampFragmentShader = `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = clamp(inputColor, 0.0, 1.0);
}`;

/**
 * Simple directional blur shader – uses a hardcoded small kernel (5 taps).
 * Uniforms: intensity (float), direction (vec2) in screen space (normalized)
 */
const velocityBlurShader = `
uniform float intensity;
uniform vec2 direction;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec4 color = vec4(0.0);
  float stepCount = 4.0;
  for(float i = -stepCount; i <= stepCount; i += 1.0) {
    float weight = 1.0 / (2.0 * stepCount + 1.0);
    vec2 offset = direction * intensity * i * 0.003; // scale factor
    color += texture(inputBuffer, uv + offset) * weight;
  }
  outputColor = color;
}`;

export async function initPostProcessing(renderer, scene, camera) {
  composer = new EffectComposer(renderer, {
    depthTexture: true,
    frameBufferType: THREE.HalfFloatType,
  });
  composer.addPass(new RenderPass(scene, camera));

  bloom = new BloomEffect({
    intensity: 1.5,
    luminanceThreshold: 0.2,
    luminanceSmoothing: 0.1,
    mipmapBlur: true,
    radius: 0.85,
    levels: 8,
  });

  dof = new DepthOfFieldEffect(camera, {
    focusDistance: 10.0,
    focusRange: 1.5,
    bokehScale: 1.0,
    resolutionScale: 0.5,
  });

  brightnessContrast = new BrightnessContrastEffect();
  hueSaturation = new HueSaturationEffect();

  vignette = new VignetteEffect({
    offset: 0.5,
    darkness: 0.5,
  });

  noise = new NoiseEffect({
    premultiply: false,
  });

  smaa = new SMAAEffect();

  clampEffect = new Effect('ClampEffect', clampFragmentShader, {
    blendFunction: BlendFunction.SRC,
  });

  // ── Chromatic Aberration ────────────────────────────────
  chromaticAberration = new ChromaticAberrationEffect();
  chromaticAberration.blendMode.blendFunction = BlendFunction.SKIP; // off by default

  // ── Velocity Blur (custom) ───────────────────────────────
  // We'll use a custom Effect with uniforms: intensity & direction
  velocityBlurEffect = new Effect('VelocityBlur', velocityBlurShader, {
    blendFunction: BlendFunction.SKIP,
    uniforms: new Map([
      ['intensity', new THREE.Uniform(0.0)],
      ['direction', new THREE.Uniform(new THREE.Vector2(0.0, 1.0))],
    ]),
  });

  // Add everything to the passes
  const effectPass = new EffectPass(
    camera,
    bloom,
    dof,
    brightnessContrast,
    clampEffect,
    hueSaturation,
    vignette,
    noise,
    smaa,
    chromaticAberration,
    velocityBlurEffect,
  );
  composer.addPass(effectPass);

  // Return all references needed by the outside world
  return {
    composer,
    updateComposer,
    setFocusDistance,
    dofRef: dof,
    chromAberr: chromaticAberration,
    velocityBlur: velocityBlurEffect,
  };
}

function setEffectEnabled(effect, enabled, defaultBlend) {
  if (!effect) return;
  if (enabled) {
    effect.blendMode.blendFunction = defaultBlend;
  } else {
    effect.blendMode.blendFunction = BlendFunction.SKIP;
  }
}

function updateComposer(preset) {
  if (!composer) return;

  // Bloom
  bloom.intensity = preset.bloom.strength;
  bloom.luminanceThreshold = preset.bloom.threshold;
  bloom.luminanceSmoothing = preset.bloom.smoothing;
  bloom.mipmapBlur = preset.bloom.mipmapBlur;
  bloom.radius = preset.bloom.radius;
  bloom.levels = preset.bloom.levels;

  // Color
  brightnessContrast.brightness = preset.color.brightness;
  brightnessContrast.contrast = preset.color.contrast;
  hueSaturation.saturation = preset.color.saturation;
  hueSaturation.hue = THREE.MathUtils.degToRad(preset.color.hue);

  // Vignette
  setEffectEnabled(vignette, preset.vignette.enabled, VIGNETTE_DEFAULT_BLEND);
  vignette.technique =
    preset.vignette.technique === 0
      ? VignetteTechnique.DEFAULT
      : VignetteTechnique.ESKIL;
  vignette.offset = preset.vignette.offset;
  vignette.darkness = preset.vignette.darkness;

  // Film grain
  setEffectEnabled(noise, preset.filmGrain.enabled, NOISE_DEFAULT_BLEND);
  noise.blendMode.opacity.value = preset.filmGrain.intensity;
  noise.premultiply = Boolean(preset.filmGrain.premultiply);

  // DOF
  setEffectEnabled(dof, preset.dof.enabled, DOF_DEFAULT_BLEND);
  dof.focusDistance = preset.dof.focus;
  dof.focusRange = preset.dof.focusRange;
  dof.bokehScale = preset.dof.bokehScale;
  dof.resolutionScale = preset.dof.resolutionScale;

  // SMAA
  setEffectEnabled(smaa, preset.smaa.enabled, SMAA_DEFAULT_BLEND);
  const smaaPresets = [
    SMAAPreset.LOW,
    SMAAPreset.MEDIUM,
    SMAAPreset.HIGH,
    SMAAPreset.ULTRA,
  ];
  smaa.applyPreset(smaaPresets[preset.smaa.preset]);
  smaa.edgeDetectionMaterial.edgeDetectionThreshold =
    preset.smaa.edgeDetectionThreshold;
  smaa.edgeDetectionMaterial.localContrastAdaptationFactor =
    preset.smaa.localContrastAdaptationFactor;
  smaa.weightsMaterial.orthogonalSearchSteps =
    preset.smaa.orthogonalSearchSteps;
  smaa.weightsMaterial.diagonalSearchSteps =
    preset.smaa.diagonalSearchSteps;
  smaa.weightsMaterial.diagonalDetection =
    preset.smaa.diagonalDetection;
  smaa.weightsMaterial.cornerRounding =
    preset.smaa.cornerRounding;
  smaa.weightsMaterial.cornerDetection =
    preset.smaa.cornerDetection;
}

function setFocusDistance(distance) {
  if (dof) dof.focusDistance = distance;
}
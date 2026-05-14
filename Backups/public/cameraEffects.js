// cameraEffects.js
import * as THREE from 'three';
import { BlendFunction } from 'postprocessing';

/* ── Simple coherent noise ───────────────────────────── */
class SimpleNoise {
  get1D(t, seed) {
    return (
      Math.sin(t * 1.2345 + seed * 10.0) * 0.5 +
      Math.sin(t * 2.3456 + seed * 20.0 + 1.0) * 0.3 +
      Math.sin(t * 5.6789 + seed * 30.0 + 2.0) * 0.2
    );
  }
}

/* ── Spring physics ──────────────────────────────────── */
function createSpring({ stiffness, damping, mass = 1 }) {
  return {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    stiffness,
    damping,
    mass,
  };
}

function updateSpring(spring, currentPosition, target, dt) {
  const force = target.clone().sub(spring.position).multiplyScalar(spring.stiffness);
  const damp = spring.velocity.clone().multiplyScalar(spring.damping);
  const accel = force.sub(damp).divideScalar(spring.mass);

  spring.velocity.add(accel.multiplyScalar(dt));
  spring.position.add(spring.velocity.clone().multiplyScalar(dt));
  return spring.position.clone();
}

/* ── Deep merge ──────────────────────────────────────── */
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key])
    ) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

/* ── Main factory ────────────────────────────────────── */
export function createCameraEffects(camera, rig, options = {}) {
  const { postProcessors = {}, config = {} } = options;

  const defaultConfig = {
    parallax: { factor: 0.03 },
    shake: {
      idle:    { amplitude: 0.002, frequency: 0.4 },
      medium:  { amplitude: 0.005, frequency: 2.0 },
      intense: { amplitude: 0.015,  frequency: 3.0 },
    },
    inertia: { stiffness: 11, damping: 6, mass: 0.25 },
    stabilizerChain: {
      springs: [
        { stiffness: 10, damping: 4, mass: 0.2 },
        { stiffness: 8,  damping: 3, mass: 0.15 },
      ],
    },
    fovPulse: { amplitude: 1.2, frequency: 3.0 },
    chromaticAberration: { maxOffset: 0.003 },
    motionBlur: { maxIntensity: 0.25 },
  };

  const C = deepMerge(defaultConfig, config);

  const noise = new SimpleNoise();
  const inertiaSpring = createSpring(C.inertia);
  const stabilizers = C.stabilizerChain.springs.map(s => createSpring(s));

  if (camera.userData.baseFov === undefined) {
    camera.userData.baseFov = camera.fov;
  }
  const baseFov = camera.userData.baseFov;

  function setEffectBlend(effect, enabled) {
    if (!effect) return;
    const targetBlend = enabled ? BlendFunction.NORMAL : BlendFunction.SKIP;
    if (effect.blendMode.blendFunction !== targetBlend) {
      effect.blendMode.blendFunction = targetBlend;
    }
  }

  function update(dt, movementState) {
    const clampedDt = Math.min(dt, 0.1);
    const { isMoving, isSprinting, isGrounded, worldVelocity } = movementState;

    let shakeProfile = 'idle';
    if (isSprinting || !isGrounded) {
      shakeProfile = 'medium';
    } else if (isMoving) {
      shakeProfile = 'idle';
    }

    const shakeCfg = C.shake[shakeProfile];
    const t = performance.now() * 0.001;

    // 1. Parallax
    let localVel = worldVelocity.clone();
    if (rig) {
      rig.worldToLocal(localVel);
    }
    const parallaxOffset = new THREE.Vector3(
      -localVel.x * C.parallax.factor,
      0,
      -localVel.z * C.parallax.factor
    );

    // 2. Shake
    const shakeX = noise.get1D(t, 0) * shakeCfg.amplitude;
    const shakeY = noise.get1D(t, 1) * shakeCfg.amplitude;
    const shakeOffset = new THREE.Vector3(shakeX, shakeY, 0);
    const targetOffset = parallaxOffset.add(shakeOffset);

    // 3. Inertia spring
    const currentOffset = camera.position.clone();
    const inertedOffset = updateSpring(inertiaSpring, currentOffset, targetOffset, clampedDt);

    // 4. Stabilizers
    let stabilisedOffset = inertedOffset.clone();
    for (const spring of stabilizers) {
      stabilisedOffset = updateSpring(spring, stabilisedOffset, new THREE.Vector3(), clampedDt);
    }
    camera.position.copy(stabilisedOffset);

    // 5. Rotation shake
    const pitchAmp = shakeCfg.amplitude * 6;
    const rollAmp  = shakeCfg.amplitude * 4;
    camera.rotation.x = noise.get1D(t, 2) * pitchAmp;
    camera.rotation.z = noise.get1D(t, 3) * rollAmp;

    // 6. FOV pulse
    if (isSprinting) {
      const pulse = Math.sin(t * C.fovPulse.frequency * Math.PI * 2) * C.fovPulse.amplitude;
      camera.fov = baseFov + pulse;
      camera.updateProjectionMatrix();
    } else {
      if (Math.abs(camera.fov - baseFov) > 0.01) {
        camera.fov += (baseFov - camera.fov) * 0.2;
        camera.updateProjectionMatrix();
      } else if (camera.fov !== baseFov) {
        camera.fov = baseFov;
        camera.updateProjectionMatrix();
      }
    }

    // 7. Chromatic aberration (NO setEffectBlend – convolution effect cannot be merged safely)
    if (postProcessors.chromaticAberration) {
      const caEffect = postProcessors.chromaticAberration;
      const targetCA = (isSprinting || !isGrounded)
        ? C.chromaticAberration.maxOffset
        : 0.0;
      const currentCA = caEffect.offset.length();
      const newCA = currentCA + (targetCA - currentCA) * 0.08;
      caEffect.offset.set(newCA, newCA);
      // ❌ removed: setEffectBlend(caEffect, newCA > 0.001);   // causes merge error
    }

    // 8. Velocity blur
    if (postProcessors.velocityEffect) {
      const vbEffect = postProcessors.velocityEffect;
      const speed = worldVelocity.length();
      const targetIntensity = Math.min(speed * 0.12, C.motionBlur.maxIntensity);
      const currentIntensity = vbEffect.intensity ?? 0;
      vbEffect.intensity += (targetIntensity - currentIntensity) * 0.1;

      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      const worldUp = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
      const camUp = new THREE.Vector3().crossVectors(right, forward).normalize();
      const screenX = worldVelocity.dot(right);
      const screenY = worldVelocity.dot(camUp);
      const dir2D = new THREE.Vector2(screenX, screenY).normalize();
      vbEffect.uniforms.get('direction').value.copy(dir2D);

      setEffectBlend(vbEffect, vbEffect.intensity > 0.005);
    }
  }

  return { update };
}